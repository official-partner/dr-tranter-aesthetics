import { assert } from '../core/assert';
import { capabilityAcceptsNodeRewrite, capabilityAcceptsVisualIntent } from '../page/capability';
import { LIMITS } from '../core/limits';
import type { SpanMapping } from './mapSpan';
import type { AnchorRef, NodeKind, StructuralPath } from '../page/ref';
import { err, ok, type Result } from '../core/result';
import type { RejectionReason } from './intent';
import type { Snapshot } from '../page/snapshot';
import type { ProjectedNode, Projection } from '../page/sourceProjection';
import { byteStringsEqual, decodeUtf8, toByteSpan, toByteString, utf16ToByteOffsets, type ByteSpan, type ByteString } from '../core/span';
import { toUtf16Offset } from '../core/brand';

export type SpanMapper = (span: ByteSpan) => SpanMapping;

export type ValidProjection = Extract<Projection, { tag: 'valid' }>;

export interface PlanContext {
  readonly authored: Snapshot;
  readonly current: Snapshot;
  readonly mapSpan: SpanMapper;
}

export interface Target {
  readonly authored: ProjectedNode;
  readonly current: ProjectedNode;
  readonly shift: number;
}

const TAG_OPEN = 0x3c;
const TAG_CLOSE = 0x3e;
const SLASH = 0x2f;
const NEWLINE = 0x0a;

export function validProjections(context: PlanContext): Result<{ readonly authored: ValidProjection; readonly current: ValidProjection }, RejectionReason> {
  const authored = context.authored.projection;
  const current = context.current.projection;
  if (current.tag === 'parse-error') {
    return err('source-invalid');
  }
  if (authored.tag === 'parse-error') {
    return err('source-invalid');
  }
  return ok({ authored, current });
}

export function resolveTarget(context: PlanContext, anchor: AnchorRef): Result<Target, RejectionReason> {
  const projections = validProjections(context);
  if (!projections.ok) {
    return projections;
  }
  const authored = nodeAtPath(projections.value.authored, anchor.path);
  if (authored === undefined) {
    return err('anchor-moved');
  }
  if (authored.kind !== anchor.expectedKind) {
    return err('anchor-moved');
  }
  if (!sameSpan(authored.span, anchor.span)) {
    return err('anchor-moved');
  }
  const region = identityRegion(context.authored.bytes, authored);
  const mapped = context.mapSpan(region);
  switch (mapped.tag) {
    case 'resolved': {
      assert(mapped.span.end - mapped.span.start === region.end - region.start, 'A resolved region keeps its length');
      const shift = mapped.span.start - region.start;
      return currentTarget(context, projections.value.current, authored, mapped.span, shift);
    }
    case 'ambiguous':
      return err('anchor-ambiguous');
    case 'gone':
      return err('anchor-moved');
    default: {
      const exhaustive: never = mapped;
      return exhaustive;
    }
  }
}

function currentTarget(
  context: PlanContext,
  current: ValidProjection,
  authored: ProjectedNode,
  mappedRegion: ByteSpan,
  shift: number,
): Result<Target, RejectionReason> {
  const start = authored.span.start + shift;
  const found = current.nodes.filter((node) => node.span.start === start && node.kind === authored.kind);
  const [node, ...others] = found.length > 1 ? atDepthOf(found, authored) : found;
  if (node === undefined) {
    return err(found.length > 1 ? 'anchor-ambiguous' : 'anchor-moved');
  }
  if (others.length > 0) {
    return err('anchor-ambiguous');
  }
  if (!sameSpan(identityRegion(context.current.bytes, node), mappedRegion)) {
    return err('anchor-moved');
  }
  if (node.capability !== authored.capability) {
    return err('region-externally-modified');
  }
  return ok({ authored, current: node, shift });
}

function atDepthOf(found: readonly ProjectedNode[], authored: ProjectedNode): readonly ProjectedNode[] {
  assert(found.length > 1, 'Only several candidates need their depth compared');
  return found.filter((node) => node.path.length === authored.path.length);
}

export function writtenAsTag(node: ProjectedNode): boolean {
  if (node.syntax === 'markup') {
    return isTagKind(node.kind);
  }
  return false;
}

export function identityRegion(bytes: ByteString, node: ProjectedNode): ByteSpan {
  if (writtenAsTag(node)) {
    assert(bytes[node.span.start] === TAG_OPEN, 'A tag opens with `<`');
    const nameEnd = tagNameEnd(bytes, node);
    const end = node.attributes.reduce<number>((last, attribute) => Math.max(last, attribute.span.end), nameEnd);
    assert(end <= node.span.end, 'Attributes lie inside their node');
    if (end > nameEnd) {
      return toByteSpan(node.span.start + 1, end);
    }
  }
  assert(node.span.start < node.span.end, 'A projected node covers at least one byte');
  return node.span;
}

export function isTagKind(kind: NodeKind): boolean {
  switch (kind) {
    case 'element':
    case 'component':
    case 'raw':
      return true;
    case 'text':
    case 'expr':
    case 'raw-line':
    case 'comment':
    case 'map':
    case 'cond':
    case 'branch':
    case 'chunk-group':
      return false;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function tagNameEnd(bytes: ByteString, node: ProjectedNode): number {
  let index = node.span.start + 1;
  while (index < node.span.end) {
    const byte = bytes[index];
    assert(byte !== undefined, 'The tag lies inside the bytes');
    if (isWhitespace(byte) || byte === SLASH || byte === TAG_CLOSE) {
      break;
    }
    index++;
  }
  return index;
}

export function openTagEnd(bytes: ByteString, node: ProjectedNode): { readonly end: number; readonly selfClosing: boolean } {
  assert(isTagKind(node.kind), 'Only a tag has an opening tag');
  let index = node.attributes.reduce<number>((last, attribute) => Math.max(last, attribute.span.end), tagNameEnd(bytes, node));
  while (index < node.span.end) {
    const byte = bytes[index];
    assert(byte !== undefined, 'The tag lies inside the bytes');
    if (byte === TAG_CLOSE) {
      return { end: index + 1, selfClosing: bytes[index - 1] === SLASH };
    }
    index++;
  }
  throw new Error('Assertion failed: an opening tag ends with `>` inside its node');
}

export function closeTagStart(bytes: ByteString, node: ProjectedNode, from: number): number | undefined {
  for (let index = node.span.end - 2; index >= from; index--) {
    if (bytes[index] === TAG_OPEN) {
      if (bytes[index + 1] === SLASH) {
        return index;
      }
    }
  }
  return undefined;
}

export function nodeAtPath(projection: ValidProjection, path: StructuralPath): ProjectedNode | undefined {
  assert(projection.nodes.length <= LIMITS.treeNodesMax, 'The projection is inside its bound');
  return projection.nodes.find((candidate) => samePath(candidate.path, path));
}

export function parentPath(path: StructuralPath): StructuralPath {
  assert(path.length > 0, 'A tree node has a path');
  return path.slice(0, -1);
}

export function blankText(bytes: ByteString, node: ProjectedNode): boolean {
  if (node.kind !== 'text') {
    return false;
  }
  for (let index = node.span.start; index < node.span.end; index++) {
    const byte = bytes[index];
    assert(byte !== undefined, 'A text node lies inside the bytes');
    if (!isWhitespace(byte)) {
      return false;
    }
  }
  return true;
}

export function siblingsOf(projection: ValidProjection, node: ProjectedNode): readonly ProjectedNode[] {
  const parent = parentPath(node.path);
  return projection.nodes.filter((candidate) => candidate.path.length === node.path.length && startsWith(candidate.path, parent));
}

export function subtreeOf(projection: ValidProjection, node: ProjectedNode): readonly ProjectedNode[] {
  return projection.nodes.filter((candidate) => startsWith(candidate.path, node.path));
}

export function ancestorsOf(projection: ValidProjection, path: StructuralPath): readonly ProjectedNode[] {
  const found: ProjectedNode[] = [];
  for (let depth = 1; depth < path.length; depth++) {
    const ancestor = nodeAtPath(projection, path.slice(0, depth));
    assert(ancestor !== undefined, 'Every ancestor of a projected node is projected');
    found.push(ancestor);
  }
  return found;
}

export function startsWith(path: StructuralPath, prefix: StructuralPath): boolean {
  if (prefix.length <= path.length) {
    return prefix.every((step, index) => step === path[index]);
  }
  return false;
}

export function samePath(left: StructuralPath, right: StructuralPath): boolean {
  if (left.length === right.length) {
    return startsWith(left, right);
  }
  return false;
}

export function sameSpan(left: ByteSpan, right: ByteSpan): boolean {
  if (left.start === right.start) {
    return left.end === right.end;
  }
  return false;
}

export function slice(bytes: ByteString, span: ByteSpan): ByteString {
  assert(span.end <= bytes.length, 'A sliced span lies inside the bytes');
  return toByteString(bytes.subarray(span.start, span.end));
}

export function nodeUnchanged(context: PlanContext, target: Target): boolean {
  const authored = slice(context.authored.bytes, target.authored.span);
  return byteStringsEqual(authored, slice(context.current.bytes, target.current.span));
}

export function textOf(bytes: ByteString, span: ByteSpan): string {
  const decoded = decodeUtf8(slice(bytes, span));
  assert(decoded.ok, 'A projected span decodes');
  return decoded.value;
}

export function byteOffsetsIn(text: string, offsets: readonly number[]): readonly number[] {
  return utf16ToByteOffsets(
    text,
    offsets.map((offset) => toUtf16Offset(offset)),
  );
}

export function isWhitespace(byte: number): boolean {
  switch (byte) {
    case 0x20:
    case 0x09:
    case 0x0a:
    case 0x0d:
      return true;
    default:
      return false;
  }
}

export function whitespaceBefore(bytes: ByteString, end: number, floor: number): number {
  let index = end;
  while (index > floor) {
    const byte = bytes[index - 1];
    assert(byte !== undefined, 'The scan lies inside the bytes');
    if (!isWhitespace(byte)) {
      break;
    }
    index--;
  }
  return index;
}

export function whitespaceAfter(bytes: ByteString, start: number, ceiling: number): number {
  let index = start;
  while (index < ceiling) {
    const byte = bytes[index];
    assert(byte !== undefined, 'The scan lies inside the bytes');
    if (!isWhitespace(byte)) {
      break;
    }
    index++;
  }
  return index;
}

export function containsNewline(bytes: ByteString, span: ByteSpan): boolean {
  return bytes.subarray(span.start, span.end).includes(NEWLINE);
}

const WHITESPACE_ELEMENT = /<(code|pre|script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function indentedFragment(text: string, indent: string, eol: '\n' | '\r\n'): string {
  assert(indent.trim().length === 0, 'indentedFragment: an indent is only whitespace');
  const kept = Array.from(text.matchAll(WHITESPACE_ELEMENT), (match) => ({ start: match.index, end: match.index + match[0].length }));
  const written = text.replace(/\r?\n/g, (_lineBreak: string, at: number) => {
    const content = kept.some((element) => element.start <= at && at < element.end);
    return content ? eol : `${eol}${indent}`;
  });
  assert(written.split('\n').length === text.split('\n').length, 'indentedFragment: every line stays a line');
  return written;
}

export function lineIndent(bytes: ByteString, offset: number): string {
  let lineStart = offset;
  while (lineStart > 0) {
    if (bytes[lineStart - 1] === NEWLINE) {
      break;
    }
    lineStart--;
  }
  let index = lineStart;
  while (index < offset) {
    const byte = bytes[index];
    if (byte === 0x20 || byte === 0x09) {
      index++;
    } else {
      break;
    }
  }
  return textOf(bytes, toByteSpan(lineStart, index));
}

export function nodePlaceable(node: ProjectedNode): boolean {
  switch (node.capability) {
    case 'editable':
    case 'read-only-opaque':
      return true;
    case 'repeated-source-node':
    case 'runtime-aggregate':
    case 'unsupported':
      return false;
    default: {
      const exhaustive: never = node.capability;
      return exhaustive;
    }
  }
}

export function nodeEditable(node: ProjectedNode): boolean {
  return capabilityAcceptsVisualIntent(node.capability);
}

export function nodeRewriteable(node: ProjectedNode): boolean {
  return capabilityAcceptsNodeRewrite(node.capability);
}
