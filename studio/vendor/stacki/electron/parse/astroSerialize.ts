
import { parseSerializeNodes } from './astroParserValidation';
import { collapseText, encodeText, textValue } from '../../shared/page/htmlText';
import type { Attr } from '../../shared/page/pageNode';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { ParserNode, MapNode, CondNode, ValueNode } from './astroParserTypes';
import { serializeMapCallback } from './astroMapSerialize';
import { attrsAsWritten, serializeAttrs, required } from './astroAttrs';
import { normalizeHead, blockHead } from './astroScan';

const PRINT_INDENT_UNIT = '  ';

const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'sup', 'sub', 'code', 'a', 'span', 'br', 'small', 'mark', 'u', 's']);

function isSimpleExpr(node: ParserNode): boolean {
  return node.kind === 'expr' && /^\{[^{}]*\}$/.test(node.value) && !node.value.includes('<');
}

export function isInlineRun(nodes: readonly ParserNode[], depth: number): boolean {
  if (depth > LIMITS.treeDepthMax) {
    return false;
  }
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        node.kind === 'text' ||
        isSimpleExpr(node) ||
        (node.kind === 'element' &&
          INLINE_TAGS.has(node.name.toLowerCase()) &&
          (node.children === undefined || node.children.length === 0 || isInlineRun(node.children, depth + 1))),
    )
  );
}

function inlineString(nodes: readonly ParserNode[], depth: number): string {
  assert(depth <= LIMITS.treeDepthMax, 'inlineString: depth limit');
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += textOut(node);
    } else if (node.kind === 'expr') {
      out += node.value;
    } else if (node.kind !== 'element') {
      assert(false, 'Inline runs contain only text, expressions, and elements');
    } else if (node.children === undefined) {
      out += `<${node.name}${serializeAttrs(node.props, node.attrOrder)}${node.openVoid === true ? '>' : ' />'}`;
    } else if (node.children.length === 0) {
      out += `<${node.name}${serializeAttrs(node.props, node.attrOrder)}></${node.name}>`;
    } else {
      out += `<${node.name}${serializeAttrs(node.props, node.attrOrder)}>` + inlineString(node.children, depth + 1) + `</${node.name}>`;
    }
  }
  return out;
}

export function tagInlineRun(
  nodes: readonly ParserNode[],
  path: string,
  { atRoot, depth }: { readonly atRoot: boolean; readonly depth: number },
): ParserNode[] {
  assert(depth <= LIMITS.treeDepthMax, 'tagInlineRun: depth limit');
  return nodes.map((node, i) => {
    if (node.kind !== 'element') {
      return node;
    }
    const childPath = `${path}.${i}`;
    const forwards = Object.keys(node.props || {}).some((key) => key.startsWith('...'));
    const pathProp: Attr =
      atRoot || forwards
        ? {
            type: 'expr',
            value: `[${JSON.stringify(childPath)}, Astro.props["data-avb-p"]]` + '.filter(Boolean).join(" ")',
          }
        : { type: 'string', value: childPath };
    const tagged: ParserNode = {
      ...node,
      source: undefined,
      props: forwards ? { 'data-avb-p': pathProp, ...node.props } : { ...node.props, 'data-avb-p': pathProp },
      attrOrder: forwards && node.attrOrder ? ['data-avb-p', ...node.attrOrder] : node.attrOrder,
    };
    if (Array.isArray(node.children) && node.children.length > 0) {
      tagged.children = tagInlineRun(node.children, childPath, { atRoot: false, depth: depth + 1 });
    }
    return tagged;
  });
}

function textAsWritten(node: ValueNode): string | undefined {
  if (!node.source) {
    return encodeText(node.value);
  }
  return textValue(node.source) === node.value ? node.source : undefined;
}

function textOut(node: ValueNode): string {
  const source = node.source;
  return source !== undefined && textValue(source) === node.value ? collapseText(source) : encodeText(node.value);
}

function reindentRun(source: string, indent: string): string {
  const lines = source.split('\n');
  const base = required(lines[lines.length - 1], 'Split source has a final line');
  if (lines.length < 2 || !/^[ \t]*$/.test(base) || base === indent) {
    return source;
  }
  let shift: (line: string) => string;
  if (indent.startsWith(base)) {
    const add = indent.slice(base.length);
    shift = (line) => (line.trim() ? add + line : line);
  } else if (base.startsWith(indent)) {
    const drop = base.slice(indent.length);
    shift = (line) => (line.startsWith(drop) ? line.slice(drop.length) : line);
  } else {
    return source;
  }
  return [lines[0], ...lines.slice(1, -1).map(shift), indent].join('\n');
}

const squash = (text: string) => text.replace(/\s+/g, '');

function inlineRunUnchanged(node: ParserNode, depth: number): boolean {
  return (
    !!node.source &&
    node.source.includes('\n') &&
    squash(collapseText(node.source)) === squash(inlineString(node.children ?? [], depth + 1))
  );
}

function blockAsWritten(node: ParserNode, indent: string, depth: number, unit: string): string[] | undefined {
  if (!node.source) {
    return undefined;
  }
  const probe = { ...node, source: undefined, blankBefore: 0, blankAfter: 0 };
  const rebuilt: string[] = [];
  serializeNode(probe, '', rebuilt, depth, unit);
  const flat = (text: string) => text.replace(/[\s(){}]+/g, '').trim();
  const comparedSource =
    node.kind === 'map' && node.children.length === 1 && node.children[0]?.kind === 'cond' ? node.source.replace(/,(\s*\)\s*\})$/, '$1') : node.source;
  if (flat(rebuilt.join('\n')) !== flat(comparedSource)) {
    return undefined;
  }
  const sourceLines = node.source.split('\n');
  const finalLine = required(sourceLines[sourceLines.length - 1], 'Source has a final line');
  const base = (finalLine.match(/^[ \t]*/) || [''])[0];
  return sourceLines.map((line, i) => (i === 0 ? indent + line : line.startsWith(base) ? indent + line.slice(base.length) : line));
}

function serializeCondBody(node: CondNode, indent: string, lines: string[], depth: number, unit: string): void {
  assert(depth <= LIMITS.treeDepthMax, 'serializeCondBody: depth limit');
  const kidsOf = (i: number) => node.children?.[i]?.children || [];
  const thenKids = kidsOf(0);
  const elseKids = node.op === '&&' ? undefined : kidsOf(1);
  const chained = elseKids && elseKids.length === 1 && elseKids[0]?.kind === 'cond' ? elseKids[0] : undefined;
  const tail = elseKids === undefined ? '' : chained ? ' :' : elseKids.length ? ' : (' : ' : null';
  const head = `${node.test} ${node.op === '&&' ? '&&' : '?'} `;
  const branchOut = (kids: readonly ParserNode[], at: string) => {
    if (kids.length === 1 && kids[0]?.kind === 'expr') {
      const raw = String(kids[0].value ?? '')
        .trim()
        .replace(/^\{/, '')
        .replace(/\}$/, '');
      raw.split('\n').forEach((line, i) => lines.push(i === 0 ? at + line : line));
      return;
    }
    for (const child of kids) {
      serializeNode(child, at, lines, depth + 2, unit);
    }
  };
  if (thenKids.length) {
    lines.push(indent + head + '(');
    branchOut(thenKids, indent + unit);
    lines.push(indent + ')' + tail);
  } else {
    lines.push(indent + head + 'null' + tail);
  }
  if (chained) {
    serializeCondBody(chained, indent, lines, depth + 2, unit);
  } else if (elseKids && elseKids.length) {
    branchOut(elseKids, indent + unit);
    lines.push(indent + ')');
  }
}

export function serializeNode(node: ParserNode, indent: string, lines: string[], depth: number, unit: string = PRINT_INDENT_UNIT): void {
  assert(depth <= LIMITS.treeDepthMax, 'serializeNode: depth limit');
  if (node.kind === 'chunk-group') {
    return;
  }
  for (let i = 0; i < (node.blankBefore || 0); i++) {
    lines.push('');
  }
  if (node.chunkFile || node.chunkAggregate) {
    lines.push(`${indent}<${node.name}${serializeAttrs(node.props, node.attrOrder)} />`);
    return;
  }
  switch (node.kind) {
    case 'text':
      return serializeNodeText(node, indent, lines);
    case 'expr': {
      const exprLines = node.value.split('\n');
      lines.push(indent + exprLines[0]);
      for (let i = 1; i < exprLines.length; i++) {
        lines.push(required(exprLines[i], 'Expression line index is in bounds'));
      }
      return;
    }
    case 'map':
      return serializeNodeMap(node, indent, lines, depth, unit);
    case 'cond': {
      const kept = blockAsWritten(node, indent, depth, unit);
      if (kept) {
        for (const line of kept) {
          lines.push(line);
        }
        return;
      }
      lines.push(indent + '{');
      serializeCondBody(node, indent + unit, lines, depth, unit);
      lines.push(indent + '}');
      return;
    }
    case 'branch':
      for (const child of node.children || []) {
        serializeNode(child, indent, lines, depth + 1, unit);
      }
      return;
    case 'comment':
      lines.push(node.jsx ? `${indent}{/*${node.value}*/}` : `${indent}<!--${node.value}-->`);
      return;
    case 'raw-line':
      lines.push(indent + node.value);
      return;
    case 'raw':
      return serializeNodeRaw(node, indent, lines);
    case 'component':
    case 'element':
      return serializeNodeElement(node, indent, lines, depth, unit);
  }
}

export function serializeNodes(input: readonly unknown[], unit: string = PRINT_INDENT_UNIT): string {
  const nodes = parseSerializeNodes(input);
  const lines: string[] = [];
  for (const node of nodes) {
    serializeNode(node, '', lines, 0, unit);
  }
  return lines.join('\n') + '\n';
}

function serializeNodeCallback(node: MapNode, indent: string, lines: string[], depth: number, unit: string): void {
  const text = serializeMapCallback(node, (child) => {
    const rendered: string[] = [];
    serializeNode(child, '', rendered, depth + 1, unit);
    return rendered.join('\n');
  });
  lines.push(indent + text);
}

function serializeNodeText(node: ValueNode, indent: string, lines: string[]): void {
  const written = textAsWritten(node);
  if (written === undefined || !written.includes('\n')) {
    lines.push(indent + textOut(node).replace(/^ +| +$/g, ''));
    return;
  }
  const body = written.replace(/^[ \t]*\r?\n/, '').replace(/\s+$/, '');
  const [first, ...more] = body.split('\n');
  lines.push(indent + required(first, 'Split text has a first line').replace(/^[ \t]+/, ''));
  for (const line of more) {
    lines.push(line);
  }
  return;
}

function serializeNodeMap(node: MapNode, indent: string, lines: string[], depth: number, unit: string): void {
  const keptMap = blockAsWritten(node, indent, depth, unit);
  if (keptMap) {
    for (const line of keptMap) {
      lines.push(line);
    }
    return;
  }
  if (node.bodyParts !== undefined) {
    return serializeNodeCallback(node, indent, lines, depth, unit);
  }
  lines.push(indent + '{');
  if (node.body && node.body.length) {
    lines.push(indent + unit + blockHead(node.head));
    for (const line of node.body) {
      lines.push(indent + unit + unit + line);
    }
    lines.push(indent + '    return (');
    serializeLoopBody(node, indent + unit + unit + unit, lines, depth, unit);
    lines.push(indent + '    );');
    lines.push(indent + '  })');
    lines.push(indent + '}');
    return;
  }
  const conditional = node.children.length === 1 ? node.children[0] : undefined;
  if (conditional?.kind === 'cond') {
    lines.push(indent + unit + node.head);
    serializeCondBody(conditional, indent + unit + unit, lines, depth + 1, unit);
    lines.push(indent + '  ))');
    lines.push(indent + '}');
    return;
  }
  if (node.bare) {
    lines.push(indent + unit + node.head.replace(/\($/, '').trimEnd());
    serializeLoopBody(node, indent + unit + unit, lines, depth, unit);
    lines.push(indent + '  )');
    lines.push(indent + '}');
    return;
  }
  const kept = node.headSource && normalizeHead(node.headSource) === node.head ? node.headSource : undefined;
  let inner = '';
  if (kept) {
    const headLines = kept.split('\n');
    for (const line of headLines) {
      lines.push(line ? indent + unit + line : '');
    }
    inner = required(headLines[headLines.length - 1], 'Loop head has a final line').match(/^[ \t]*/)?.[0] ?? '';
  } else {
    lines.push(indent + unit + node.head);
  }
  serializeLoopBody(node, indent + unit + inner + unit, lines, depth, unit);
  lines.push(indent + unit + inner + '))');
  lines.push(indent + '}');
  return;
}

function serializeLoopBody(node: MapNode, indent: string, lines: string[], depth: number, unit: string): void {
  const children = node.children || [];
  if (children.length === 0) {
    lines.push(indent + 'null');
    return;
  }
  const wrapper = loopBodyWrapper(node);
  if (wrapper === undefined) {
    for (const child of children) {
      serializeNode(child, indent, lines, depth + 1, unit);
    }
    return;
  }
  lines.push(indent + (wrapper === '<>' ? '<>' : '<Fragment>'));
  for (const child of children) {
    serializeNode(child, indent + unit, lines, depth + 1, unit);
  }
  lines.push(indent + (wrapper === '<>' ? '</>' : '</Fragment>'));
}

export function loopBodyWrapper(node: Pick<MapNode, 'children' | 'fragment'>): '<>' | 'Fragment' | undefined {
  if (node.fragment !== undefined) {
    return node.fragment;
  }
  assert(node.children.length > 0, 'loopBodyWrapper: an empty loop writes null, not a wrapper');
  return node.children.every(isLoopTag) ? undefined : '<>';
}

function isLoopTag(child: ParserNode): boolean {
  switch (child.kind) {
    case 'element':
    case 'component':
    case 'raw':
      return true;
    case 'comment':
      return child.jsx !== true;
    case 'text':
    case 'expr':
    case 'raw-line':
    case 'map':
    case 'cond':
    case 'branch':
    case 'chunk-group':
      return false;
    default: {
      const exhaustive: never = child;
      return exhaustive;
    }
  }
}

function serializeNodeRaw(node: Extract<ParserNode, { kind: 'raw' }>, indent: string, lines: string[]): void {
  const open = `${indent}<${node.name}${serializeAttrs(node.props, node.attrOrder)}>`;
  const inner = node.inner.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
  if (!inner.trim()) {
    lines.push(`${open}</${node.name}>`);
    return;
  }
  lines.push(open);
  for (const line of inner.split('\n')) {
    lines.push(line);
  }
  lines.push(`${indent}</${node.name}>`);
  return;
}

function serializeNodeElement(
  node: Extract<ParserNode, { kind: 'element' | 'component' }>,
  indent: string,
  lines: string[],
  depth: number,
  unit: string,
): void {
  const kept = attrsAsWritten(node);
  const attrs = kept === undefined ? serializeAttrs(node.props, node.attrOrder) : kept;
  const tagName = node.shorthand && node.name === 'Fragment' && !attrs ? '' : node.name;
  const closeTag = node.closeSource && node.closeSource.startsWith(`</${tagName}`) ? node.closeSource : `</${tagName}>`;
  const openTag = (close: string) => {
    const tail = kept !== undefined && /\s$/.test(attrs) ? close.replace(/^ /, '') : close;
    const text = `${indent}<${tagName}${attrs}${tail}`;
    for (const line of text.split('\n')) {
      lines.push(line);
    }
  };
  if (node.children === undefined) {
    openTag(node.openVoid === true ? '>' : node.tightClose ? '/>' : ' />');
    return;
  }
  if (node.children.length > 0 && isInlineRun(node.children, depth + 1)) {
    if (inlineRunUnchanged(node, depth)) {
      openTag(`>${reindentRun(required(node.source, 'Unchanged inline run has source'), indent)}` + closeTag);
      return;
    }
    openTag(`>${inlineString(node.children, depth + 1)}${closeTag}`);
    return;
  }
  if (node.children.length === 0) {
    const inner = node.source !== undefined && node.source.trim() === '' ? node.source : '';
    openTag(`>${inner ? reindentRun(inner, indent) : ''}${closeTag}`);
    return;
  }
  openTag('>');
  for (const child of node.children) {
    serializeNode(child, indent + unit, lines, depth + 1, unit);
  }
  for (let i = 0; i < (node.blankAfter || 0); i++) {
    lines.push('');
  }
  for (const line of `${indent}${closeTag}`.split('\n')) {
    lines.push(line);
  }
}
