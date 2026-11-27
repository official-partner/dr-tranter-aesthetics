import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import type { Splice } from './planner';
import type { ProjectedAttribute, ProjectedNode, Projection } from '../page/sourceProjection';
import { byteStringsEqual, toByteSpan, toByteString, type ByteSpan, type ByteString } from '../core/span';

type ValidProjection = Extract<Projection, { tag: 'valid' }>;

export function projectValueSplice(projection: Projection, bytes: ByteString, splice: Splice): Projection | undefined {
  assert(projection.byteLength === bytes.length, 'The projection describes these bytes');
  assert(splice.range.end <= bytes.length, 'The splice lies inside the bytes');
  const held = toByteString(bytes.subarray(splice.range.start, splice.range.end));
  assert(byteStringsEqual(held, splice.expectedBytes), 'The witness held: the caller checked');
  if (projection.tag !== 'valid') {
    return undefined;
  }
  const context = hostContext(projection, splice.range);
  if (context === 'refused') {
    return undefined;
  }
  if (!valueBytesNeutral(splice.expectedBytes, context)) {
    return undefined;
  }
  if (!valueBytesNeutral(splice.replacementBytes, context)) {
    return undefined;
  }
  if (splice.replacementBytes.length > LIMITS.attrCharsMax) {
    return undefined;
  }
  const delta = splice.replacementBytes.length - splice.expectedBytes.length;
  const byteLength = bytes.length + delta;
  if (byteLength > LIMITS.sourceBytesMax) {
    return undefined;
  }
  const unitDelta = utf16Units(splice.replacementBytes) - utf16Units(splice.expectedBytes);
  const utf16Length = projection.utf16Length + unitDelta;
  assert(utf16Length <= byteLength, 'UTF-16 never takes more units than UTF-8 takes bytes');
  if (utf16Length > LIMITS.ipcFieldCharsMax) {
    return undefined;
  }
  const patched = shiftProjection(projection, splice.range, { bytes: delta, units: unitDelta });
  assert(patched.nodes.length === projection.nodes.length, 'A value edit keeps every node');
  assert(patched.byteLength === byteLength, 'The patch measures the spliced bytes');
  assert(patched.utf16Length === utf16Length, 'The patch counts the spliced units');
  return patched;
}

export type HostContext = 'markup' | 'expression' | 'refused';

export function valueBytesNeutral(bytes: ByteString, context: Exclude<HostContext, 'refused'>): boolean {
  assert(bytes.length <= LIMITS.sourceBytesMax, 'Checked bytes are inside the file bound');
  const table = context === 'markup' ? MARKUP_VALUE_BYTES : EXPRESSION_VALUE_BYTES;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    assert(byte !== undefined, 'The index lies inside the bytes');
    if (!table[byte]) {
      return false;
    }
  }
  return true;
}

export function hostContext(projection: Projection, range: ByteSpan): HostContext {
  if (projection.tag !== 'valid') {
    return 'refused';
  }
  if (projection.nodes[0]?.list === 'blocks') {
    return 'refused';
  }
  const containing = projection.nodes.filter((node) => contains(node.span, range));
  const host = containing.at(-1);
  if (host === undefined) {
    return 'refused';
  }
  const values = host.attributes.filter((attribute) => isValueAt(attribute, range));
  if (values.length === 0) {
    return 'refused';
  }
  assert(values.length === 1, 'One attribute value occupies one range');
  assertOneChain(containing);
  if (!MARKUP_KINDS.has(host.kind)) {
    return 'refused';
  }
  if (containing.every((node) => MARKUP_KINDS.has(node.kind))) {
    return 'markup';
  }
  const known = (node: ProjectedNode): boolean => MARKUP_KINDS.has(node.kind) || EXPRESSION_KINDS.has(node.kind);
  return containing.every(known) ? 'expression' : 'refused';
}


function utf16Units(bytes: ByteString): number {
  assert(bytes.length <= LIMITS.sourceBytesMax, 'Counted bytes are inside the file bound');
  let units = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index] ?? 0;
    if ((byte & 0xc0) === 0x80) {
      continue;
    }
    units += byte >= 0xf0 ? 2 : 1;
  }
  assert(units <= bytes.length, 'UTF-16 never takes more units than UTF-8 takes bytes');
  return units;
}

const MARKUP_REFUSED_ASCII = '"\'`\\<>{}';
const EXPRESSION_REFUSED_ASCII = `${MARKUP_REFUSED_ASCII}()[]?:&;/*`;

const MARKUP_VALUE_BYTES = valueTable(MARKUP_REFUSED_ASCII);
const EXPRESSION_VALUE_BYTES = valueTable(EXPRESSION_REFUSED_ASCII);

function valueTable(refused: string): readonly boolean[] {
  return Array.from({ length: 256 }, (_, byte) => {
    if (byte >= 0x80) {
      return true;
    }
    if (byte < 0x20) {
      return false;
    }
    if (byte === 0x7f) {
      return false;
    }
    return !refused.includes(String.fromCharCode(byte));
  });
}

const MARKUP_KINDS: ReadonlySet<ProjectedNode['kind']> = new Set(['element', 'component']);
const EXPRESSION_KINDS: ReadonlySet<ProjectedNode['kind']> = new Set(['cond', 'branch', 'map']);

function assertOneChain(containing: readonly ProjectedNode[]): void {
  assert(containing.length <= LIMITS.treeDepthMax + 1, 'The chain is inside the depth bound');
  for (let index = 1; index < containing.length; index++) {
    const parent = containing[index - 1];
    const child = containing[index];
    assert(parent !== undefined, 'The parent lies inside the chain');
    assert(child !== undefined, 'The child lies inside the chain');
    assert(isPrefix(parent.path, child.path), 'Nodes containing a range form one chain');
  }
}

function isValueAt(attribute: ProjectedAttribute, range: ByteSpan): boolean {
  if (attribute.type !== 'string') {
    return false;
  }
  const value = attribute.valueSpan;
  if (value === undefined) {
    return false;
  }
  return value.start === range.start && value.end === range.end;
}

function shiftProjection(projection: ValidProjection, range: ByteSpan, lengths: { readonly bytes: number; readonly units: number }): ValidProjection {
  const delta = lengths.bytes;
  const frontmatter = projection.frontmatter;
  if (frontmatter !== undefined) {
    assert(frontmatter.end <= range.start, 'The frontmatter lies before every attribute value');
  }
  assert(projection.nodes.length <= LIMITS.treeNodesMax, 'The projection is inside its bound');
  const nodes = projection.nodes.map((node) => {
    if (node.span.end < range.start) {
      return node;
    }
    return shiftNode(node, range, delta);
  });
  const byteLength = projection.byteLength + delta;
  const utf16Length = projection.utf16Length + lengths.units;
  return { tag: 'valid', byteLength, utf16Length, frontmatter, nodes };
}

function shiftNode(node: ProjectedNode, range: ByteSpan, delta: number): ProjectedNode {
  const span = shiftSpan(node.span, range, delta);
  const attributes = node.attributes.map((attribute) => ({
    ...attribute,
    span: shiftSpan(attribute.span, range, delta),
    nameSpan: shiftOptional(attribute.nameSpan, range, delta),
    valueSpan: shiftOptional(attribute.valueSpan, range, delta),
  }));
  assert(attributes.length === node.attributes.length, 'A value edit keeps every attribute');
  const grown = contains(node.span, range) ? delta : 0;
  assert(span.end - span.start === node.span.end - node.span.start + grown, 'Only hosts resize');
  return { ...node, span, attributes };
}

function shiftOptional(span: ByteSpan | undefined, range: ByteSpan, delta: number): ByteSpan | undefined {
  return span === undefined ? undefined : shiftSpan(span, range, delta);
}

function shiftSpan(span: ByteSpan, range: ByteSpan, delta: number): ByteSpan {
  const start = span.start <= range.start ? span.start : span.start + delta;
  const end = span.end < range.end ? span.end : span.end + delta;
  if (span.start > range.start) {
    assert(span.start >= range.end, 'No span starts inside a replaced value');
  }
  if (span.end < range.end) {
    assert(span.end <= range.start, 'No span ends inside a replaced value');
  }
  return toByteSpan(start, end);
}

function contains(outer: ByteSpan, inner: ByteSpan): boolean {
  if (outer.start <= inner.start) {
    return inner.end <= outer.end;
  }
  return false;
}

function isPrefix(prefix: readonly number[], path: readonly number[]): boolean {
  if (prefix.length < path.length) {
    return prefix.every((step, index) => step === path[index]);
  }
  return false;
}
