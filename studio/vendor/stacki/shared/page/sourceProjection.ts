import { assert } from '../core/assert';
import { toUtf16Offset, type Utf16Offset } from '../core/brand';
import type { Capability } from './capability';
import { LIMITS } from '../core/limits';
import type { Attr, AttrSpan, PageModel, PageNode, ParsePageResult } from './pageNode';
import { toChildIndex, type NodeKind, type StructuralPath } from './ref';
import { spanContains, spansAscending, toByteSpan, utf16ToByteOffsets, utf8ByteLength, type ByteSpan, type Utf16Span } from '../core/span';

export interface ProjectedAttribute {
  readonly name: string;
  readonly type: AttrSpan['type'];
  readonly span: ByteSpan;
  readonly nameSpan: ByteSpan | undefined;
  readonly valueSpan: ByteSpan | undefined;
  readonly capability: Capability;
}

export type NodeSyntax = 'markup' | 'markdown';

export type NodeList = 'markup' | 'blocks' | 'items' | 'inline';

export interface ProjectedNode {
  readonly kind: NodeKind;
  readonly path: StructuralPath;
  readonly span: ByteSpan;
  readonly attributes: readonly ProjectedAttribute[];
  readonly capability: Capability;
  readonly syntax: NodeSyntax;
  readonly list: NodeList;
  readonly callback?: true;
}

export interface Diagnostic {
  readonly message: string;
  readonly near: string | undefined;
}

export type Projection =
  | {
      readonly tag: 'valid';
      readonly byteLength: number;
      readonly utf16Length: number;
      readonly frontmatter: ByteSpan | undefined;
      readonly nodes: readonly ProjectedNode[];
    }
  | {
      readonly tag: 'parse-error';
      readonly byteLength: number;
      readonly diagnostics: readonly Diagnostic[];
    };

export function projectionAcceptsVisualIntents(projection: Projection): boolean {
  switch (projection.tag) {
    case 'valid':
      return true;
    case 'parse-error':
      return false;
    default: {
      const exhaustive: never = projection;
      return exhaustive;
    }
  }
}

export function projectPage(text: string, result: ParsePageResult): Projection {
  assert(text.length <= LIMITS.ipcFieldCharsMax, 'A page is no longer than the platform string');
  const byteLength = utf8ByteLength(text);
  assert(byteLength <= LIMITS.sourceBytesMax, 'Projected source is inside the file bound');
  if (!result.editable) {
    const near = result.bail === undefined ? undefined : clip(result.bail.near);
    return {
      tag: 'parse-error',
      byteLength,
      diagnostics: [{ message: clip(result.reason), near }],
    };
  }
  const model = result.model;
  assert(model.bodyStart !== undefined, 'The projected parse recorded source offsets');
  const pending = collectNodes(model.nodes, model.format === undefined ? undefined : text);
  const frontmatter = frontmatterSpan(text, model);
  const converter = spanConverter(text, pending, frontmatter);
  const nodes = pending.map((entry) => projectNode(entry, converter));
  assert(nodes.length === pending.length, 'Every collected node is projected');
  return {
    tag: 'valid',
    byteLength,
    utf16Length: text.length,
    frontmatter: frontmatter === undefined ? undefined : converter(frontmatter),
    nodes,
  };
}

export function projectOpaqueDocument(text: string): Projection {
  assert(text.length <= LIMITS.ipcFieldCharsMax, 'A document is no longer than the platform string');
  const byteLength = utf8ByteLength(text);
  assert(byteLength <= LIMITS.sourceBytesMax, 'Projected source is inside the file bound');
  assert(byteLength >= text.length, 'UTF-8 never takes fewer bytes than UTF-16 units');
  return { tag: 'valid', byteLength, utf16Length: text.length, frontmatter: undefined, nodes: [] };
}


interface PendingNode {
  readonly node: PageNode;
  readonly path: StructuralPath;
  readonly span: Utf16Span;
  readonly repeated: boolean;
  readonly syntax: NodeSyntax;
  readonly list: NodeList;
}

type SpanConverter = (span: Utf16Span) => ByteSpan;

function collectNodes(roots: readonly PageNode[], markdown: string | undefined): readonly PendingNode[] {
  const out: PendingNode[] = [];
  const stack: Omit<PendingNode, 'span'>[] = [];
  const pushChildren = (children: readonly PageNode[], parent: Pick<PendingNode, 'path' | 'repeated'>, list: NodeList) => {
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      assert(child !== undefined, 'Child index lies inside its list');
      const path = [...parent.path, toChildIndex(index)];
      const syntax = syntaxIn(list, child, markdown);
      stack.push({ node: child, path, repeated: parent.repeated, syntax, list });
    }
  };
  pushChildren(roots, { path: [], repeated: false }, markdown === undefined ? 'markup' : 'blocks');
  while (stack.length > 0) {
    assert(out.length < LIMITS.treeNodesMax, 'Projection stays inside the tree node bound');
    const entry = stack.pop();
    assert(entry !== undefined, 'The stack is non-empty inside the loop');
    assert(entry.path.length <= LIMITS.treeDepthMax + 1, 'Projection stays inside the depth bound');
    const span = nodeSpan(entry.node);
    out.push({ ...entry, span });
    const children = childrenOf(entry.node);
    if (children.length > 0) {
      checkChildSpans(span, children);
      const repeated = entry.repeated || entry.node.kind === 'map';
      pushChildren(children, { path: entry.path, repeated }, childList(entry));
    }
  }
  return out;
}

function syntaxIn(list: NodeList, node: PageNode, markdown: string | undefined): NodeSyntax {
  switch (list) {
    case 'markup':
      return 'markup';
    case 'items':
    case 'inline':
      return 'markdown';
    case 'blocks': {
      assert(markdown !== undefined, 'Only a Markdown page has blocks');
      if (node.kind === 'raw-line') {
        return 'markdown';
      }
      if (node.kind !== 'element') {
        return 'markup';
      }
      const start = nodeSpan(node).start;
      return markdown.charCodeAt(start) === 0x3c ? 'markup' : 'markdown';
    }
    default: {
      const exhaustive: never = list;
      return exhaustive;
    }
  }
}

function childList(parent: Omit<PendingNode, 'span'>): NodeList {
  if (parent.syntax === 'markup') {
    return 'markup';
  }
  const name = 'name' in parent.node ? parent.node.name : '';
  switch (name) {
    case 'ul':
    case 'ol':
      return 'items';
    case 'li':
    case 'blockquote':
      return 'blocks';
    default:
      return 'inline';
  }
}

function childrenOf(node: PageNode): readonly PageNode[] {
  if ('children' in node) {
    return node.children ?? [];
  }
  return [];
}

function nodeSpan(node: PageNode): Utf16Span {
  assert(node.start !== undefined, `A projected ${node.kind} node has a start offset`);
  assert(node.end !== undefined, `A projected ${node.kind} node has an end offset`);
  return { start: node.start, end: node.end };
}

function checkChildSpans(parent: Utf16Span, children: readonly PageNode[]): void {
  const spans = children.map(nodeSpan);
  for (const span of spans) {
    assert(spanContains(parent, span), 'A child span lies inside its parent');
  }
  assert(spansAscending(spans), 'Sibling spans ascend without overlapping');
}

function frontmatterSpan(text: string, model: PageModel): Utf16Span | undefined {
  if (!model.hadFrontmatter) {
    return undefined;
  }
  const bodyStart = model.bodyStart;
  assert(bodyStart !== undefined, 'A located parse records where the body starts');
  const start = text.startsWith('﻿') ? 1 : 0;
  assert(start < bodyStart, 'The frontmatter block is not empty');
  return { start: toUtf16Offset(start), end: toUtf16Offset(bodyStart) };
}

function spanConverter(text: string, pending: readonly PendingNode[], frontmatter: Utf16Span | undefined): SpanConverter {
  const collected: number[] = [];
  const add = (span: Utf16Span): void => {
    collected.push(span.start, span.end);
  };
  if (frontmatter !== undefined) {
    add(frontmatter);
  }
  for (const entry of pending) {
    add(entry.span);
    for (const attribute of attrSpansOf(entry.node)) {
      forEachAttrSpan(attribute, add);
    }
  }
  const unique = sortedUniqueOffsets(collected, text.length);
  const converted = utf16ToByteOffsets(
    text,
    Array.from(unique, (offset) => toUtf16Offset(offset)),
  );
  assert(converted.length === unique.length, 'Conversion returns one offset per input');
  const lookup = (offset: Utf16Offset): number => {
    const index = offsetIndex(unique, offset);
    assert(index !== undefined, 'Span offset was collected for conversion');
    const bytes = converted[index];
    assert(bytes !== undefined, 'Every collected offset was converted');
    return bytes;
  };
  return (span) => toByteSpan(lookup(span.start), lookup(span.end));
}

function sortedUniqueOffsets(offsets: readonly number[], textLength: number): Uint32Array {
  assert(textLength < 2 ** 32, 'Text offsets fit an unsigned 32-bit integer');
  const sorted = Uint32Array.from(offsets).sort();
  let count = 0;
  for (let index = 0; index < sorted.length; index++) {
    const offset = sorted[index];
    assert(offset !== undefined, 'The index lies inside the sorted offsets');
    assert(offset <= textLength, 'A collected offset lies inside the text');
    const previous = count === 0 ? undefined : sorted[count - 1];
    if (previous !== offset) {
      sorted[count] = offset;
      count++;
    }
  }
  return sorted.subarray(0, count);
}

function offsetIndex(unique: Uint32Array, offset: number): number | undefined {
  let low = 0;
  let high = unique.length;
  for (let pass = 0; pass <= 33; pass++) {
    if (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const found = unique[middle];
      assert(found !== undefined, 'The middle lies inside the range');
      if (found < offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    } else {
      return unique[low] === offset ? low : undefined;
    }
  }
  throw new Error('Assertion failed: binary search ends within 33 passes');
}

function attrSpansOf(node: PageNode): readonly AttrSpan[] {
  return node.attrSpans ?? [];
}

function forEachAttrSpan(attribute: AttrSpan, visit: (span: Utf16Span) => void): void {
  visit(attribute.span);
  switch (attribute.type) {
    case 'string':
    case 'expr':
      visit(attribute.nameSpan);
      visit(attribute.valueSpan);
      return;
    case 'bare':
      visit(attribute.nameSpan);
      return;
    case 'spread':
    case 'markdown':
      visit(attribute.valueSpan);
      return;
    default: {
      const exhaustive: never = attribute;
      throw new Error(`Unknown attribute span ${JSON.stringify(exhaustive)}`);
    }
  }
}

function projectNode(entry: PendingNode, convert: SpanConverter): ProjectedNode {
  const capability = classifyNode(entry.node, { repeated: entry.repeated });
  const attributes = attrSpansOf(entry.node).map((attribute) => ({
    name: attribute.name,
    type: attribute.type,
    span: convert(attribute.span),
    nameSpan: 'nameSpan' in attribute ? convert(attribute.nameSpan) : undefined,
    valueSpan: 'valueSpan' in attribute ? convert(attribute.valueSpan) : undefined,
    capability: classifyAttribute(attribute, capability),
  }));
  return {
    kind: entry.node.kind,
    path: entry.path,
    span: convert(entry.span),
    attributes,
    capability,
    syntax: entry.syntax,
    list: entry.list,
    ...(entry.node.kind === 'map' && entry.node.bodyParts !== undefined ? { callback: true as const } : {}),
  };
}

export function classifyNode(node: PageNode, placement: { readonly repeated: boolean }): Capability {
  if (placement.repeated) {
    return 'repeated-source-node';
  }
  switch (node.kind) {
    case 'component':
    case 'element':
      if (node.name === 'Fragment') {
        return 'editable';
      }
      return writesChildrenAtRuntime(node.props) ? 'read-only-opaque' : 'editable';
    case 'raw':
      return node.name === 'style' ? 'editable' : 'read-only-opaque';
    case 'expr':
    case 'raw-line':
      return 'read-only-opaque';
    case 'chunk-group':
      return 'runtime-aggregate';
    case 'text':
    case 'comment':
    case 'map':
    case 'cond':
    case 'branch':
      return 'editable';
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function writesChildrenAtRuntime(props: Readonly<Record<string, Attr>> | undefined): boolean {
  if (props === undefined) {
    return false;
  }
  return Object.hasOwn(props, 'set:html') || Object.hasOwn(props, 'set:text');
}

function classifyAttribute(attribute: AttrSpan, node: Capability): Capability {
  if (node !== 'editable') {
    return node;
  }
  if (attribute.type === 'spread') {
    return 'read-only-opaque';
  }
  if (attribute.type === 'expr') {
    const shorthand = attribute.nameSpan.start === attribute.valueSpan.start && attribute.nameSpan.end === attribute.valueSpan.end;
    return shorthand ? 'read-only-opaque' : 'editable';
  }
  return 'editable';
}

function clip(message: string): string {
  return message.length <= LIMITS.diagnosticCharsMax ? message : message.slice(0, LIMITS.diagnosticCharsMax);
}
