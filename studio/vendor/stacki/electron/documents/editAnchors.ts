import { assert } from '../../shared/core/assert';
import { toUtf16Offset } from '../../shared/core/brand';
import { diffCodePatch } from '../../shared/engine/codePatch';
import { DIFF_BUDGET, diffBytes, type DiffOutcome } from '../../shared/engine/diff';
import type { NodeRef } from '../../shared/engine/editRequest';
import type { RejectionReason, SourceEdit } from '../../shared/engine/intent';
import { mapSpanThroughOutcome } from '../../shared/engine/mapSpan';
import { nodeAtPath, type ValidProjection } from '../../shared/engine/planSupport';
import { toAnchorRef, toChildIndex, type AnchorRef } from '../../shared/page/ref';
import { err, ok, type Result } from '../../shared/core/result';
import type { Snapshot } from '../../shared/page/snapshot';
import type { ProjectedNode } from '../../shared/page/sourceProjection';
import { encodeUtf8, spansAscending, toByteSpan, utf16ToByteOffsets, type ByteSpan } from '../../shared/core/span';

export type PageFormat = 'astro' | 'md' | 'mdx';

export interface Authored {
  readonly snapshot: Snapshot;
  readonly text: string;
  readonly projection: ValidProjection;
  readonly format: PageFormat;
}

export interface Resolved {
  readonly anchor: AnchorRef;
  readonly node: ProjectedNode;
}

export function pageFormat(file: string): PageFormat {
  if (/\.mdx$/i.test(file)) {
    return 'mdx';
  }
  return /\.md$/i.test(file) ? 'md' : 'astro';
}

export function resolveRef(authored: Authored, ref: NodeRef): Result<Resolved, RejectionReason> {
  const node = nodeAtPath(authored.projection, ref.path.map(toChildIndex));
  if (node === undefined) {
    return err('anchor-moved');
  }
  if (node.kind !== ref.kind) {
    return err('anchor-moved');
  }
  const span = byteSpanOf(authored.text, ref.span.start, ref.span.end);
  if (span === undefined) {
    return err('anchor-moved');
  }
  if (span.start !== node.span.start || span.end !== node.span.end) {
    return err('anchor-moved');
  }
  const anchor = toAnchorRef({ span, path: node.path, expectedKind: node.kind });
  return ok({ anchor, node });
}

export function byteSpanOf(text: string, start: number, end: number): ByteSpan | undefined {
  if (end > text.length) {
    return undefined;
  }
  if (splitsPair(text, start) || splitsPair(text, end)) {
    return undefined;
  }
  const [first, last] = utf16ToByteOffsets(text, [toUtf16Offset(start), toUtf16Offset(end)]);
  assert(first !== undefined, 'The start was converted');
  assert(last !== undefined, 'The end was converted');
  return toByteSpan(first, last);
}

export function splitsPair(text: string, offset: number): boolean {
  if (offset === 0 || offset >= text.length) {
    return false;
  }
  const before = text.charCodeAt(offset - 1);
  const at = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
}

export function placedHunks(before: string, after: string, own: string): Result<readonly SourceEdit[], RejectionReason> {
  const change = diffCodePatch(before, after);
  if (!change.ok) {
    return change;
  }
  if (change.value.length === 0) {
    return err('unsupported-operation');
  }
  if (before === own) {
    return ok(change.value.map((hunk) => ({ span: hunk.span, text: hunk.text })));
  }
  const diff = diffBytes(encodeUtf8(before), encodeUtf8(own), DIFF_BUDGET);
  const placed: SourceEdit[] = [];
  for (const hunk of change.value) {
    const span = placedSpan(diff, hunk.span);
    if (span === undefined) {
      return err('unsupported-operation');
    }
    placed.push({ span, text: hunk.text });
  }
  if (!spansAscending(placed.map((hunk) => hunk.span))) {
    return err('unsupported-operation');
  }
  return ok(placed);
}

function placedSpan(diff: DiffOutcome, span: ByteSpan): ByteSpan | undefined {
  if (span.start < span.end) {
    const mapped = mapSpanThroughOutcome(diff, span);
    return mapped.tag === 'resolved' ? mapped.span : undefined;
  }
  if (span.start > 0) {
    const before = mapSpanThroughOutcome(diff, toByteSpan(span.start - 1, span.start));
    if (before.tag === 'resolved') {
      return toByteSpan(before.span.end, before.span.end);
    }
  }
  if (span.start < diff.diff.source.length) {
    const after = mapSpanThroughOutcome(diff, toByteSpan(span.start, span.start + 1));
    if (after.tag === 'resolved') {
      return toByteSpan(after.span.start, after.span.start);
    }
  }
  return undefined;
}

export function shiftedHunks(hunks: readonly SourceEdit[], start: number): readonly SourceEdit[] {
  return hunks.map((hunk) => ({
    span: toByteSpan(hunk.span.start + start, hunk.span.end + start),
    text: hunk.text,
  }));
}

export function frontmatterSlot(block: ByteSpan, before: string, printed: string): { readonly slot: ByteSpan; readonly text: string } {
  let prefix = 0;
  const shorter = Math.min(before.length, printed.length);
  while (prefix < shorter && before.charCodeAt(prefix) === printed.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < shorter - prefix && before.charCodeAt(before.length - 1 - suffix) === printed.charCodeAt(printed.length - 1 - suffix)) {
    suffix++;
  }
  if (splitsPair(before, prefix) || splitsPair(printed, prefix)) {
    prefix--;
  }
  if (splitsPair(before, before.length - suffix) || splitsPair(printed, printed.length - suffix)) {
    suffix--;
  }
  const slot = byteSpanOf(before, prefix, before.length - suffix);
  assert(slot !== undefined, 'The slot lies inside the block on code-point boundaries');
  const shifted = toByteSpan(block.start + slot.start, block.start + slot.end);
  return { slot: shifted, text: printed.slice(prefix, printed.length - suffix) };
}
