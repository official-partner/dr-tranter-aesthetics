
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { encodeText } from '../../shared/page/htmlText';
import type { Attr } from '../../shared/page/pageNode';
import { splitMapHead } from './loopBindings';
import type { TreeNode } from './dataSample';
import type { EditorNode } from './pageView';

export type ItemSamples = Readonly<Record<string, string>>;

export interface RemovedLoopBody {
  readonly nodes: readonly EditorNode[];
  readonly replaced: number;
  readonly emptied: number;
}

export type LoopRemoval = ({ readonly ok: true } & RemovedLoopBody) | { readonly ok: false; readonly reason: 'unreadableCode' | 'unreadableHead' };

const SAMPLES_MAX = 4_000;

export function removedLoopBody(children: readonly EditorNode[], names: { readonly item: string; readonly index: string }, samples: ItemSamples): LoopRemoval {
  assert(/^[A-Za-z_$][\w$]*$/.test(names.item), 'A loop item is named by an identifier');
  assert(Object.keys(samples).length <= SAMPLES_MAX, 'The samples of one item are bounded');
  const tally = new Tally();
  const nodes = children.map((child) => flattened(child, { ...names, depth: 0 }, samples, tally));
  if (tally.refusedCode) {
    return { ok: false, reason: 'unreadableCode' };
  }
  return { ok: true, nodes, replaced: tally.replacedCount, emptied: tally.emptiedCount };
}

export function readsLoopItem(code: string, names: { readonly item: string; readonly index: string }): boolean {
  return referencePattern(names).test(code);
}

class Tally {
  replacedCount = 0;
  emptiedCount = 0;
  refusedCode = false;
  replace(): void {
    this.replacedCount++;
  }
  empty(): void {
    this.emptiedCount++;
  }
  refuse(): void {
    this.refusedCode = true;
  }
}

interface Scope {
  readonly item: string;
  readonly index: string;
  readonly depth: number;
}

function referencePattern(names: { readonly item: string; readonly index: string }): RegExp {
  const item = names.item.replace(/\$/g, '\\$');
  const index = names.index === '' ? undefined : names.index.replace(/\$/g, '\\$');
  const alternatives = [`${item}((?:\\??\\.[A-Za-z_$][\\w$]*)*)`, ...(index === undefined ? [] : [`(${index})(?![\\w$])`])];
  return new RegExp(`(?<![.\\w$])(?:${alternatives.join('|')})`, 'g');
}

function flattened(node: EditorNode, scope: Scope, samples: ItemSamples, tally: Tally): EditorNode {
  assert(scope.depth <= LIMITS.treeDepthMax, `removedLoopBody: depth ${scope.depth} exceeds the tree cap`);
  const own = ownFlattened(withFlattenedProps(node, scope, samples, tally), scope, samples, tally);
  if (own.shadowed) {
    return own.node;
  }
  const children = own.node.children;
  if (children === undefined) {
    return own.node;
  }
  const next = children.map((child) => flattened(child, { ...scope, depth: scope.depth + 1 }, samples, tally));
  assert(next.length === children.length, 'Removing a loop keeps every child');
  return Object.assign({}, own.node, { children: next });
}

function withFlattenedProps(node: EditorNode, scope: Scope, samples: ItemSamples, tally: Tally): EditorNode {
  const props = node.props;
  if (props === undefined) {
    return node;
  }
  const kept: [string, Attr][] = [];
  let changed = false;
  for (const [key, value] of Object.entries(props)) {
    if (value.type === 'expr') {
      const next = attributeOf(value.value, scope, samples, tally);
      changed ||= next !== value;
      kept.push([key, next]);
    } else if (value.type === 'spread') {
      if (referencePattern(scope).test(value.value)) {
        tally.empty();
        changed = true;
      } else {
        kept.push([key, value]);
      }
    } else {
      kept.push([key, value]);
    }
  }
  if (!changed) {
    return node;
  }
  const names = new Set(kept.map(([key]) => key));
  const { attrSpans: staleSpans, ...rest } = node;
  void staleSpans;
  const order = rest.attrOrder?.filter((name) => names.has(name));
  return { ...rest, props: Object.fromEntries(kept), ...(order === undefined ? {} : { attrOrder: order }) };
}

function attributeOf(code: string, scope: Scope, samples: ItemSamples, tally: Tally): Attr {
  const whole = wholeReference(code, scope);
  if (whole !== undefined) {
    return { type: 'string', value: valueOf(whole, scope, samples, tally) ?? '' };
  }
  return { type: 'expr', value: substituted(code, scope, samples, tally) };
}

function wholeReference(code: string, scope: Scope): string | undefined {
  const trimmed = code.trim();
  const pattern = referencePattern(scope);
  const found = [...trimmed.matchAll(pattern)];
  const only = found[0];
  return found.length === 1 && only !== undefined && only[0] === trimmed ? normalized(trimmed) : undefined;
}

function normalized(reference: string): string {
  return reference.replace(/\?\./g, '.');
}

function valueOf(reference: string, scope: Scope, samples: ItemSamples, tally: Tally): string | undefined {
  if (scope.index !== '' && reference === scope.index) {
    tally.replace();
    return '0';
  }
  const value = Object.hasOwn(samples, reference) ? samples[reference] : undefined;
  if (value === undefined) {
    tally.empty();
    return undefined;
  }
  tally.replace();
  return value;
}

function substituted(code: string, scope: Scope, samples: ItemSamples, tally: Tally): string {
  return code.replace(referencePattern(scope), (whole: string) => {
    if (scope.index !== '' && whole === scope.index) {
      tally.replace();
      return '0';
    }
    const value = valueOf(normalized(whole), scope, samples, tally);
    return value === undefined ? 'undefined' : JSON.stringify(value);
  });
}

function ownFlattened(node: EditorNode, scope: Scope, samples: ItemSamples, tally: Tally): { readonly node: EditorNode; readonly shadowed: boolean } {
  switch (node.kind) {
    case 'expr': {
      const braced = /^\{([\s\S]*)\}$/.exec(node.value.trim());
      const whole = wholeReference(braced?.[1] ?? node.value, scope);
      if (whole !== undefined) {
        const value = valueOf(whole, scope, samples, tally);
        return { node: { ...node, kind: 'text', value: encodeText(value ?? '') }, shadowed: false };
      }
      return { node: { ...node, value: substituted(node.value, scope, samples, tally) }, shadowed: false };
    }
    case 'text': {
      if (!node.value.includes('{')) {
        return { node, shadowed: false };
      }
      const value = node.value.replace(/\{([^{}]*)\}/g, (segment: string, inner: string) => {
        if (!referencePattern(scope).test(inner)) {
          return segment;
        }
        const whole = wholeReference(inner, scope);
        if (whole !== undefined) {
          return encodeText(valueOf(whole, scope, samples, tally) ?? '');
        }
        return `{${substituted(inner, scope, samples, tally)}}`;
      });
      return { node: { ...node, value }, shadowed: false };
    }
    case 'cond':
      return { node: { ...node, test: substituted(node.test, scope, samples, tally) }, shadowed: false };
    case 'map':
      return flattenedLoop(node, scope, tally);
    case 'raw':
    case 'raw-line':
      if (referencePattern(scope).test(node.kind === 'raw' ? node.inner : node.value)) {
        tally.refuse();
      }
      return { node, shadowed: false };
    case 'element':
    case 'component':
    case 'comment':
    case 'branch':
    case 'chunk-group':
      return { node, shadowed: false };
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function flattenedLoop(
  node: Extract<EditorNode, { readonly kind: 'map' }>,
  scope: Scope,
  tally: Tally,
): { readonly node: EditorNode; readonly shadowed: boolean } {
  const head = splitMapHead(node.head);
  if (head === undefined) {
    if (referencePattern(scope).test(node.head)) {
      tally.refuse();
    }
    return { node, shadowed: false };
  }
  const reads = referencePattern(scope).test(head.data);
  if (reads) {
    tally.empty();
  }
  const parameters = head.item + (head.index ? `, ${head.index}` : '');
  const rewritten = reads ? { ...node, head: `[].map((${parameters}) => (` } : node;
  return { node: rewritten, shadowed: head.item === scope.item || head.index === scope.item };
}

export function itemSamples(tree: readonly TreeNode[] | undefined, lists: readonly string[], item: string): ItemSamples {
  for (const list of lists) {
    const node = treeNodeAt(tree, list);
    const first = node?.children?.[0];
    if (first !== undefined) {
      return leavesOf(first, item);
    }
  }
  return {};
}

function treeNodeAt(tree: readonly TreeNode[] | undefined, path: string): TreeNode | undefined {
  const pending: TreeNode[] = [...(tree ?? [])];
  for (let visited = 0; pending.length > 0 && visited < LIMITS.treeNodesMax; visited++) {
    const node = pending.shift();
    if (node?.path === path) {
      return node;
    }
    if (node?.children !== undefined && path.startsWith(node.path)) {
      pending.push(...node.children);
    }
  }
  return undefined;
}

function leavesOf(entry: TreeNode, item: string): ItemSamples {
  const samples: Record<string, string> = {};
  const pending: TreeNode[] = [entry];
  for (let visited = 0; pending.length > 0 && visited < LIMITS.treeNodesMax && Object.keys(samples).length < SAMPLES_MAX; visited++) {
    const node = pending.shift();
    if (node === undefined) {
      break;
    }
    if (node.children === undefined || node.children.length === 0) {
      if (node.path.startsWith(entry.path) && node.preview !== '') {
        samples[`${item}${node.path.slice(entry.path.length)}`] = node.preview;
      }
    } else {
      pending.push(...node.children);
    }
  }
  return samples;
}
