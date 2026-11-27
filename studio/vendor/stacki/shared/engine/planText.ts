import { assert } from '../core/assert';
import { TAG_NAME_RE, type Operation, type RejectionReason, type SourceEdit } from './intent';
import type { CandidatePolicy, Plan, Splice } from './planner';
import { nodeEditable, nodeRewriteable, nodeUnchanged, resolveTarget, sameSpan, slice, validProjections, type PlanContext } from './planSupport';
import type { AnchorRef } from '../page/ref';
import { err, ok, type Result } from '../core/result';
import { byteStringsEqual, encodeUtf8, spansAscending, toByteSpan, utf8ByteLength, type ByteSpan, type ByteString } from '../core/span';

const HUNK_CONTEXT_BYTES = 64;

export function wrappedTextHunk(run: string, span: ByteSpan, name: string): SourceEdit | undefined {
  assert(utf8ByteLength(run) === span.end - span.start, 'A run is the text of its span');
  assert(TAG_NAME_RE.test(name), 'A wrapped run gets a valid tag name');
  if (run.trim() === '') {
    return undefined;
  }
  const leading = run.slice(0, run.length - run.trimStart().length);
  const trailing = run.slice(run.trimEnd().length);
  const before = leading.includes('\n') ? leading : '';
  const after = trailing.includes('\n') ? trailing : '';
  const kept = run.slice(before.length, run.length - after.length);
  const start = span.start + utf8ByteLength(before);
  const end = span.end - utf8ByteLength(after);
  assert(start < end, 'A wrapped run keeps at least one byte');
  assert(kept.trim() === run.trim(), 'Wrapping keeps every word of the run');
  return { span: toByteSpan(start, end), text: `<${name}>${kept}</${name}>` };
}

export function planRenameBinding(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'rename-binding' }>,
): Result<Plan, RejectionReason> {
  const resolved = resolveTarget(context, anchor);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.value;
  if (!nodeEditable(target.current)) {
    return err('unsupported-operation');
  }
  const from = encodeUtf8(operation.from);
  const splices: Splice[] = [];
  for (const site of operation.sites) {
    const moved = toByteSpan(site.start + target.shift, site.end + target.shift);
    const held = slice(context.current.bytes, moved);
    if (!byteStringsEqual(held, from)) {
      return err('anchor-moved');
    }
    if (!wholeIdentifier(context.current.bytes, moved)) {
      return err('anchor-moved');
    }
    splices.push({ range: moved, expectedBytes: held, replacementBytes: encodeUtf8(operation.to) });
  }
  const postKinds = [{ path: target.current.path, kind: target.current.kind }];
  return ok({ splices, postKinds, candidate: 'must-parse' });
}

export function planRewriteNode(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'rewrite-node' }>,
): Result<Plan, RejectionReason> {
  const resolved = resolveTarget(context, anchor);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.value;
  if (!nodeRewriteable(target.current)) {
    return err('unsupported-operation');
  }
  if (!nodeUnchanged(context, target)) {
    return err('region-externally-modified');
  }
  const shift = target.current.span.start - target.authored.span.start;
  assert(shift === target.shift, 'An unchanged node moved with its identity region');
  const splices = operation.hunks.map((hunk) => {
    const moved = toByteSpan(hunk.span.start + shift, hunk.span.end + shift);
    const splice = spliceAt(context.current.bytes, moved, hunk.text);
    assert(byteStringsEqual(splice.expectedBytes, slice(context.authored.bytes, hunk.span)), 'A rewritten range holds its authored bytes');
    return splice;
  });
  assert(spansAscending(splices.map((splice) => splice.range)), 'Moved hunks keep their order');
  return ok({ splices, postKinds: [], candidate: 'must-parse' });
}

export function planFrontmatterSlot(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'edit-frontmatter-slot' }>,
): Result<Plan, RejectionReason> {
  const projections = validProjections(context);
  if (!projections.ok) {
    return projections;
  }
  const authored = projections.value.authored.frontmatter;
  if (authored === undefined) {
    return err('anchor-moved');
  }
  if (!sameSpan(authored, anchor.span)) {
    return err('anchor-moved');
  }
  const mapped = context.mapSpan(authored);
  switch (mapped.tag) {
    case 'resolved': {
      const current = projections.value.current.frontmatter;
      if (current === undefined) {
        return err('anchor-moved');
      }
      if (!sameSpan(current, mapped.span)) {
        return err('anchor-moved');
      }
      const shift = mapped.span.start - authored.start;
      const slot = toByteSpan(operation.slot.start + shift, operation.slot.end + shift);
      const splice = spliceAt(context.current.bytes, slot, operation.text);
      return ok({ splices: [splice], postKinds: [], candidate: 'must-parse' });
    }
    case 'ambiguous':
      return err('anchor-ambiguous');
    case 'gone':
      return err('region-externally-modified');
    default: {
      const exhaustive: never = mapped;
      return exhaustive;
    }
  }
}

export function planInsertFrontmatter(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'insert-frontmatter' }>,
): Result<Plan, RejectionReason> {
  assert(anchor.expectedKind === 'document', 'A new frontmatter block anchors the document');
  const projections = validProjections(context);
  if (!projections.ok) {
    return projections;
  }
  if (projections.value.authored.frontmatter !== undefined) {
    return err('anchor-moved');
  }
  if (projections.value.current.frontmatter !== undefined) {
    return err('anchor-moved');
  }
  const bytes = context.current.bytes;
  const at = hasByteOrderMark(bytes) ? 3 : 0;
  const splice = spliceAt(bytes, toByteSpan(at, at), operation.source);
  assert(splice.expectedBytes.length === 0, 'A new block replaces nothing');
  return ok({ splices: [splice], postKinds: [], candidate: 'must-parse' });
}

function hasByteOrderMark(bytes: ByteString): boolean {
  if (bytes[0] === 0xef) {
    if (bytes[1] === 0xbb) {
      return bytes[2] === 0xbf;
    }
  }
  return false;
}

export function planCodePatch(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'apply-code-patch' }>,
): Result<Plan, RejectionReason> {
  return planHunks(context, anchor, operation.hunks, {
    stale: 'merge-conflict',
    candidate: 'may-be-invalid',
  });
}

export function planRevertSplices(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'revert-splices' }>,
): Result<Plan, RejectionReason> {
  const parsed = context.authored.projection.tag === 'valid';
  return planHunks(context, anchor, operation.hunks, {
    stale: 'region-externally-modified',
    candidate: parsed ? 'must-parse' : 'may-be-invalid',
  });
}

export function planRewriteText(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'rewrite-text' }>,
): Result<Plan, RejectionReason> {
  assert(anchor.expectedKind === 'document', 'A rewrite anchors the whole document');
  assert(anchor.span.start === 0, 'A document anchor starts at byte 0');
  if (context.current.checksum !== context.authored.checksum) {
    return err('region-externally-modified');
  }
  if (anchor.span.end !== context.current.bytes.length) {
    return err('anchor-moved');
  }
  const bytes = context.current.bytes;
  const splices = operation.hunks.map((hunk) => spliceAt(bytes, hunk.span, hunk.text));
  return ok({ splices, postKinds: [], candidate: 'may-be-invalid' });
}

interface HunkPolicy {
  readonly stale: RejectionReason;
  readonly candidate: CandidatePolicy;
}

function planHunks(context: PlanContext, anchor: AnchorRef, hunks: readonly SourceEdit[], policy: HunkPolicy): Result<Plan, RejectionReason> {
  assert(anchor.expectedKind === 'document', 'Hunks anchor the whole document');
  const authored = context.authored.bytes;
  if (anchor.span.end !== authored.length) {
    return err('anchor-moved');
  }
  const fresh = context.authored.checksum === context.current.checksum;
  const splices: Splice[] = [];
  for (const hunk of hunks) {
    const mapped = fresh ? ok(hunk.span) : mapHunk(context, hunk.span, policy.stale);
    if (!mapped.ok) {
      return mapped;
    }
    const splice = spliceAt(context.current.bytes, mapped.value, hunk.text);
    assert(byteStringsEqual(splice.expectedBytes, slice(authored, hunk.span)), 'A mapped hunk holds its authored bytes');
    splices.push(splice);
  }
  if (!spansAscending(splices.map((splice) => splice.range))) {
    return err(policy.stale);
  }
  return ok({ splices, postKinds: [], candidate: policy.candidate });
}

function mapHunk(context: PlanContext, span: ByteSpan, stale: RejectionReason): Result<ByteSpan, RejectionReason> {
  const length = context.authored.bytes.length;
  const region = toByteSpan(Math.max(0, span.start - HUNK_CONTEXT_BYTES), Math.min(length, span.end + HUNK_CONTEXT_BYTES));
  if (region.start === region.end) {
    return err(stale);
  }
  const mapped = context.mapSpan(region);
  switch (mapped.tag) {
    case 'resolved': {
      const shift = mapped.span.start - region.start;
      return ok(toByteSpan(span.start + shift, span.end + shift));
    }
    case 'ambiguous':
    case 'gone':
      return err(stale);
    default: {
      const exhaustive: never = mapped;
      return exhaustive;
    }
  }
}

function wholeIdentifier(bytes: ByteString, span: ByteSpan): boolean {
  const before = bytes[span.start - 1];
  const after = bytes[span.end];
  if (before !== undefined) {
    if (identifierByte(before) || before === 0x2e) {
      return false;
    }
  }
  if (after !== undefined) {
    return !identifierByte(after);
  }
  return true;
}

function identifierByte(byte: number): boolean {
  if (byte >= 0x30 && byte <= 0x39) {
    return true;
  }
  if (byte >= 0x41 && byte <= 0x5a) {
    return true;
  }
  if (byte >= 0x61 && byte <= 0x7a) {
    return true;
  }
  return byte === 0x5f || byte === 0x24 || byte >= 0x80;
}

function spliceAt(bytes: ByteString, range: ByteSpan, replacement: string): Splice {
  return {
    range,
    expectedBytes: slice(bytes, range),
    replacementBytes: encodeUtf8(replacement),
  };
}
