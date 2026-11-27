
import { LIMITS } from '../../shared/core/limits';
import { assert } from '../../shared/core/assert';
import type { EditorNode } from './pageView';
import type { Attr } from '../../shared/page/pageNode';

const MAP_HEAD_RE = /^([\s\S]+?)\.map\(\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)\s*=>\s*\($/;

export interface LoopHead {
  readonly data: string;
  readonly item: string;
  readonly index: string;
}

export function splitMapHead(head: unknown): LoopHead | undefined {
  const match = String(head).trim().match(MAP_HEAD_RE);
  const data = match?.[1];
  const item = match?.[2];
  if (!match || data === undefined || item === undefined) {
    return undefined;
  }
  return { data: data.trim(), item, index: match[3] || '' };
}

const DESTRUCTURED_HEAD_RE = /^([\s\S]+?)\.map\(\s*\(\s*(\{[\w$\s,:.]*\})\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)\s*=>\s*\($/;

export interface DestructuredLoopHead {
  readonly data: string;
  readonly pattern: string;
  readonly index: string;
}

export function splitDestructuredHead(head: unknown): DestructuredLoopHead | undefined {
  const text = String(head).trim();
  const match = text.match(DESTRUCTURED_HEAD_RE);
  const data = match?.[1];
  const pattern = match?.[2];
  if (!match || data === undefined || pattern === undefined) {
    return undefined;
  }
  if (pattern.replace(/[{}\s]/g, '') === '') {
    return undefined;
  }
  return { data: data.trim(), pattern, index: match[3] || '' };
}

const escapeIdentifier = (name: string): string => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const identifierPattern = (name: string, flags?: string): RegExp => new RegExp(`(?<![.\\w$])${escapeIdentifier(name)}(?![\\w$])`, flags);
const renameIdent = (code: unknown, from: string, to: string): string => String(code ?? '').replace(identifierPattern(from, 'g'), () => to);

const renameInBraces = (text: unknown, from: string, to: string): string =>
  String(text ?? '').replace(/\{([^{}]*)\}/g, (_, inner) => `{${renameIdent(inner, from, to)}}`);

const loopHeadOf = (data: string, head: LoopHead): string => `${data}.map((${head.item}${head.index ? `, ${head.index}` : ''}) => (`;

function childrenOf(node: EditorNode): readonly EditorNode[] | undefined {
  return node.children;
}

function withChildren(node: EditorNode, change: (children: readonly EditorNode[]) => readonly EditorNode[]): EditorNode {
  const children = childrenOf(node);
  if (children === undefined) {
    return node;
  }
  const next = change(children);
  assert(next.length === children.length, 'Loop rewrites keep every child');
  return Object.assign({}, node, { children: next });
}

function withExpressions(node: EditorNode, rename: (code: string) => string): EditorNode {
  const props = node.props;
  if (props === undefined) {
    return node;
  }
  const next = Object.fromEntries(
    Object.entries(props).map(([key, value]): [string, Attr] => (value.type === 'expr' ? [key, { ...value, value: rename(value.value) }] : [key, value])),
  );
  return { ...node, props: next };
}

export function renamedLoopVar(nodes: readonly EditorNode[], from: string, to: string): readonly EditorNode[] {
  assert(from.length > 0, 'A rename names the variable it renames');
  assert(from !== to, 'A rename changes the name');
  return renamedList(nodes, from, to, 0);
}

function renamedList(nodes: readonly EditorNode[], from: string, to: string, depth: number): readonly EditorNode[] {
  assert(depth <= LIMITS.treeDepthMax, `renamedLoopVar: depth ${depth} exceeds the tree cap`);
  return nodes.map((node) => renamedNode(node, from, to, depth));
}

function renamedNode(node: EditorNode, from: string, to: string, depth: number): EditorNode {
  const rename = (code: string): string => renameIdent(code, from, to);
  const below = (next: EditorNode): EditorNode => withChildren(withExpressions(next, rename), (children) => renamedList(children, from, to, depth + 1));
  switch (node.kind) {
    case 'map': {
      const head = splitMapHead(node.head);
      if (head === undefined) {
        return below({ ...node, head: rename(node.head) });
      }
      const data = rename(head.data);
      const renamed = data === head.data ? node : { ...node, head: loopHeadOf(data, head) };
      if (head.item === from || head.index === from) {
        return renamed;
      }
      const body = node.body?.map(rename);
      return below(body === undefined ? renamed : { ...renamed, body });
    }
    case 'expr':
      return below({ ...node, value: rename(node.value) });
    case 'cond':
      return below({ ...node, test: rename(node.test) });
    case 'text':
      return below({ ...node, value: renameInBraces(node.value, from, to) });
    case 'raw-line':
    case 'element':
    case 'component':
    case 'raw':
    case 'comment':
    case 'branch':
    case 'chunk-group':
      return below(node);
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export const parseLoopHead = splitMapHead;

const readsVar = (expr: unknown, name: string): boolean => identifierPattern(name).test(String(expr || ''));

export function disconnectedLoops(nodes: readonly EditorNode[], vars: readonly string[]): readonly EditorNode[] {
  assert(vars.length > 0, 'Loops are disconnected from named variables');
  return disconnectedList(nodes, vars, 0);
}

function disconnectedList(nodes: readonly EditorNode[], vars: readonly string[], depth: number): readonly EditorNode[] {
  assert(depth <= LIMITS.treeDepthMax, `disconnectedLoops: depth ${depth} exceeds the tree cap`);
  return nodes.map((node) => disconnectedNode(node, vars, depth));
}

function disconnectedNode(node: EditorNode, vars: readonly string[], depth: number): EditorNode {
  const below = (next: EditorNode, active: readonly string[]): EditorNode => withChildren(next, (children) => disconnectedList(children, active, depth + 1));
  if (node.kind === 'map') {
    const head = parseLoopHead(node.head);
    const reads = head !== undefined && vars.some((name) => readsVar(head.data, name));
    const next = reads ? { ...node, head: loopHeadOf('[]', head) } : node;
    const shadowed = new Set([head?.item, head?.index].filter(Boolean));
    const rest = vars.filter((name) => !shadowed.has(name));
    return rest.length > 0 ? below(next, rest) : next;
  }
  if (node.kind === 'cond') {
    const reads = vars.some((name) => readsVar(node.test, name));
    return below(reads ? { ...node, test: 'false' } : node, vars);
  }
  return below(node, vars);
}

function findPath(nodes: readonly EditorNode[], id: string, trail: readonly EditorNode[], depth: number): readonly EditorNode[] | undefined {
  assert(depth <= LIMITS.treeDepthMax, `findPath: depth ${depth} exceeds parser cap`);
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.id === id) {
      return next;
    }
    const children = childrenOf(node);
    const hit = children === undefined ? undefined : findPath(children, id, next, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

export function loopVarsAt(nodes: readonly EditorNode[], id: string): string[] {
  const path = findPath(nodes, id, [], 0) ?? [];
  const vars = path.slice(0, -1).flatMap((node) => {
    const head = node.kind === 'map' ? parseLoopHead(node.head) : undefined;
    return [head?.item, head?.index].filter((name): name is string => Boolean(name));
  });
  return [...new Set(vars)];
}

const UNBOUND_TEXT = 'content';

export interface Stripped {
  readonly node: EditorNode;
  readonly removed: number;
}

export function strippedBindings(node: EditorNode, vars: readonly string[]): Stripped {
  if (vars.length === 0) {
    return { node, removed: 0 };
  }
  const stripped = strippedNode(node, vars, 0);
  assert(stripped.removed >= 0, 'A count of removed bindings is never negative');
  assert(stripped.node.id === node.id, 'Stripping keeps the node');
  return stripped;
}

function strippedNode(node: EditorNode, active: readonly string[], depth: number): Stripped {
  assert(depth <= LIMITS.treeDepthMax, `strippedBindings: depth ${depth} exceeds the tree cap`);
  const reads = (code: string): boolean => active.some((x) => readsVar(code, x));
  const props = strippedProps(node, reads);
  const own = strippedOwn(props.node, active, reads);
  const removed = props.removed + own.removed;
  if (own.below.length === 0) {
    return { node: own.node, removed };
  }
  const children = childrenOf(own.node);
  if (children === undefined) {
    return { node: own.node, removed };
  }
  const walked = children.map((child) => strippedNode(child, own.below, depth + 1));
  const count = walked.reduce((sum, child) => sum + child.removed, removed);
  const next = withChildren(own.node, () => walked.map((child) => child.node));
  return { node: next, removed: count };
}

function strippedProps(node: EditorNode, reads: (code: string) => boolean): Stripped {
  const props = node.props;
  if (props === undefined) {
    return { node, removed: 0 };
  }
  const kept = Object.entries(props).filter(([, value]) => !(value.type === 'expr' && reads(value.value)));
  const removed = Object.keys(props).length - kept.length;
  assert(removed >= 0, 'Dropping attributes never adds one');
  if (removed === 0) {
    return { node, removed };
  }
  return { node: { ...node, props: Object.fromEntries(kept) }, removed };
}

interface StrippedOwn extends Stripped {
  readonly below: readonly string[];
}

function strippedOwn(node: EditorNode, active: readonly string[], reads: (code: string) => boolean): StrippedOwn {
  switch (node.kind) {
    case 'expr':
      return reads(node.value) ? { node: { ...node, kind: 'text', value: UNBOUND_TEXT }, removed: 1, below: [] } : { node, removed: 0, below: active };
    case 'text': {
      if (!node.value.includes('{')) {
        return { node, removed: 0, below: active };
      }
      const value = node.value.replace(/\{([^{}]*)\}/g, (whole, inner: string) => (reads(inner) ? UNBOUND_TEXT : whole));
      const removed = value === node.value ? 0 : 1;
      return { node: removed === 0 ? node : { ...node, value }, removed, below: active };
    }
    case 'map':
      return strippedLoop(node, active, reads);
    case 'cond':
      return reads(node.test) ? { node: { ...node, test: 'false' }, removed: 1, below: active } : { node, removed: 0, below: active };
    case 'raw-line':
    case 'element':
    case 'component':
    case 'raw':
    case 'comment':
    case 'branch':
    case 'chunk-group':
      return { node, removed: 0, below: active };
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function strippedLoop(node: Extract<EditorNode, { readonly kind: 'map' }>, active: readonly string[], reads: (code: string) => boolean): StrippedOwn {
  const head = parseLoopHead(node.head);
  const repoint = head !== undefined && reads(head.data);
  const pointed = repoint ? { ...node, head: loopHeadOf('[]', head) } : node;
  const below = active.filter((name) => name !== head?.item && name !== head?.index);
  if (below.length === 0 || node.body === undefined) {
    return { node: pointed, removed: repoint ? 1 : 0, below };
  }
  const stillReads = (code: string): boolean => below.some((x) => readsVar(code, x));
  const body = node.body.map((line) => {
    const declaration = stillReads(line) ? line.match(/^((?:const|let)\s+[^=]+=\s*)/) : undefined;
    return declaration ? `${declaration[1] ?? ''}'${UNBOUND_TEXT}';` : line;
  });
  const swapped = body.filter((line, index) => line !== node.body?.[index]).length;
  return { node: { ...pointed, body }, removed: (repoint ? 1 : 0) + swapped, below };
}
