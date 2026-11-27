import { assert } from '../core/assert';
import { DIFF_BUDGET, coarseHunks, diffBytes, diffHunks, type Hunk } from './diff';
import { LIMITS } from '../core/limits';
import { err, ok, type Result } from '../core/result';
import { decodeUtf8, encodeUtf8, toByteSpan, toByteString, utf8ByteLength, type ByteSpan, type ByteString } from '../core/span';

export interface CodeHunk {
  readonly span: ByteSpan;
  readonly expected: string;
  readonly text: string;
}

const HUNK_GAP_BYTES_MIN = 8;

const CONTINUATION_BYTES_MAX = 3;

export function diffCodePatch(baseline: string, next: string): Result<readonly CodeHunk[], 'resource-limit'> {
  if (next.length > LIMITS.ipcFieldCharsMax) {
    return err('resource-limit');
  }
  if (utf8ByteLength(next) > LIMITS.sourceBytesMax) {
    return err('resource-limit');
  }
  const source = encodeUtf8(baseline);
  const target = encodeUtf8(next);
  const regions = changedRegions(source, target);
  const hunks = regions.map((region) => codeHunk(source, target, region));
  assert(applyCodePatch(baseline, hunks) === next, 'The patch turns the baseline into the text');
  return ok(hunks);
}

export function codePatchBytes(hunks: readonly CodeHunk[]): number {
  return hunks.reduce((total, hunk) => total + utf8ByteLength(hunk.text), 0);
}

export function applyCodePatch(baseline: string, hunks: readonly CodeHunk[]): string {
  const source = encodeUtf8(baseline);
  const pieces: Uint8Array[] = [];
  let at = 0;
  for (const hunk of hunks) {
    assert(at <= hunk.span.start, 'Hunks ascend without overlapping');
    assert(hunk.span.end <= source.length, 'A hunk lies inside the baseline');
    const held = decodeUtf8(toByteString(source.subarray(hunk.span.start, hunk.span.end)));
    assert(held.ok, 'A hunk starts and ends on code points');
    assert(held.value === hunk.expected, 'A hunk replaces the text it names');
    pieces.push(source.subarray(at, hunk.span.start), encodeUtf8(hunk.text));
    at = hunk.span.end;
  }
  pieces.push(source.subarray(at));
  const decoded = decodeUtf8(concatBytes(pieces));
  assert(decoded.ok, 'Whole code points in, whole code points out');
  return decoded.value;
}

export function mergeTyping(base: string, ours: string, theirs: string): Result<string, 'merge-conflict' | 'resource-limit'> {
  if (ours === base || ours === theirs) {
    return ok(theirs);
  }
  if (theirs === base) {
    return ok(ours);
  }
  const mine = diffCodePatch(base, ours);
  if (!mine.ok) {
    return mine;
  }
  const other = diffCodePatch(base, theirs);
  if (!other.ok) {
    return other;
  }
  for (const left of mine.value) {
    for (const right of other.value) {
      if (spansTouch(left.span, right.span)) {
        return err('merge-conflict');
      }
    }
  }
  const both = [...mine.value, ...other.value].sort((left, right) => left.span.start - right.span.start);
  const merged = applyCodePatch(base, both);
  assert(merged !== base, 'Two changes merged are a change');
  return ok(merged);
}


interface Region {
  readonly source: ByteSpan;
  readonly target: ByteSpan;
}

function changedRegions(source: ByteString, target: ByteString): readonly Region[] {
  const middle = trimmedMiddle(source, target);
  if (middle === undefined) {
    return [];
  }
  const inner = diffBytes(
    toByteString(source.subarray(middle.source.start, middle.source.end)),
    toByteString(target.subarray(middle.target.start, middle.target.end)),
    DIFF_BUDGET,
  );
  const hunks = inner.tag === 'computed' ? diffHunks(inner.diff) : coarseHunks(inner.diff);
  const shifted = hunks.map((hunk) => shiftHunk(hunk, middle));
  return joinRegions(shifted.map((hunk) => widenRegion(source, target, hunk)));
}

function trimmedMiddle(source: ByteString, target: ByteString): Region | undefined {
  const shorter = Math.min(source.length, target.length);
  let prefix = 0;
  while (prefix < shorter && source[prefix] === target[prefix]) {
    prefix++;
  }
  if (prefix === source.length && prefix === target.length) {
    return undefined;
  }
  let suffix = 0;
  while (suffix < shorter - prefix && source[source.length - 1 - suffix] === target[target.length - 1 - suffix]) {
    suffix++;
  }
  const region = {
    source: toByteSpan(prefix, source.length - suffix),
    target: toByteSpan(prefix, target.length - suffix),
  };
  return widenRegion(source, target, region);
}

function shiftHunk(hunk: Hunk, middle: Region): Region {
  return {
    source: toByteSpan(hunk.source.start + middle.source.start, hunk.source.end + middle.source.start),
    target: toByteSpan(hunk.target.start + middle.target.start, hunk.target.end + middle.target.start),
  };
}

function widenRegion(source: ByteString, target: ByteString, region: Region): Region {
  let sourceStart: number = region.source.start;
  let targetStart: number = region.target.start;
  for (let step = 0; step <= CONTINUATION_BYTES_MAX; step++) {
    if (!continues(source, sourceStart) && !continues(target, targetStart)) {
      break;
    }
    assert(step < CONTINUATION_BYTES_MAX, 'A code point has at most three continuation bytes');
    sourceStart--;
    targetStart--;
  }
  let sourceEnd: number = region.source.end;
  let targetEnd: number = region.target.end;
  for (let step = 0; step <= CONTINUATION_BYTES_MAX; step++) {
    if (!continues(source, sourceEnd) && !continues(target, targetEnd)) {
      break;
    }
    assert(step < CONTINUATION_BYTES_MAX, 'A code point has at most three continuation bytes');
    sourceEnd++;
    targetEnd++;
  }
  return {
    source: toByteSpan(sourceStart, sourceEnd),
    target: toByteSpan(targetStart, targetEnd),
  };
}

function continues(bytes: ByteString, offset: number): boolean {
  const byte = bytes[offset];
  if (byte === undefined) {
    return false;
  }
  return byte >= 0x80 && byte < 0xc0;
}

function joinRegions(regions: readonly Region[]): readonly Region[] {
  const joined: Region[] = [];
  for (const region of regions) {
    const last = joined[joined.length - 1];
    if (last !== undefined && region.source.start < last.source.end + HUNK_GAP_BYTES_MIN) {
      const sourceGap = region.source.start - last.source.end;
      assert(sourceGap === region.target.start - last.target.end, 'Matched gaps have one length');
      joined[joined.length - 1] = {
        source: toByteSpan(last.source.start, Math.max(last.source.end, region.source.end)),
        target: toByteSpan(last.target.start, Math.max(last.target.end, region.target.end)),
      };
      continue;
    }
    joined.push(region);
  }
  return joined;
}

function codeHunk(source: ByteString, target: ByteString, region: Region): CodeHunk {
  const expected = decodeUtf8(toByteString(source.subarray(region.source.start, region.source.end)));
  const text = decodeUtf8(toByteString(target.subarray(region.target.start, region.target.end)));
  assert(expected.ok, 'A widened region holds whole code points of the baseline');
  assert(text.ok, 'A widened region holds whole code points of the text');
  return { span: region.source, expected: expected.value, text: text.value };
}

function spansTouch(left: ByteSpan, right: ByteSpan): boolean {
  if (left.start <= right.end) {
    return right.start <= left.end;
  }
  return false;
}

function concatBytes(pieces: readonly Uint8Array[]): ByteString {
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    joined.set(piece, at);
    at += piece.length;
  }
  assert(at === total, 'Every piece was copied');
  return toByteString(joined);
}
