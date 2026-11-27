import { assert } from '../core/assert';
import { diffBytes, type ByteDiff, type CoarseDiff, type DiffBudget, type DiffOutcome } from './diff';
import { toByteSpan, type ByteSpan, type ByteString } from '../core/span';

export type SpanMapping = { readonly tag: 'resolved'; readonly span: ByteSpan } | { readonly tag: 'ambiguous' } | { readonly tag: 'gone' };

export function mapSpan(source: ByteString, target: ByteString, span: ByteSpan, budget: DiffBudget): SpanMapping {
  return mapSpanThroughOutcome(diffBytes(source, target, budget), span);
}

export function mapSpanThroughOutcome(outcome: DiffOutcome, span: ByteSpan): SpanMapping {
  switch (outcome.tag) {
    case 'computed':
      return mapSpanThroughDiff(outcome.diff, span);
    case 'coarse':
      return mapSpanThroughCoarse(outcome.diff, span);
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function mapSpanThroughCoarse(diff: CoarseDiff, span: ByteSpan): SpanMapping {
  assert(span.start < span.end, 'Only non-empty spans are mapped');
  assert(span.end <= diff.source.length, 'The mapped span lies inside the authored bytes');
  let low = 0;
  let high = diff.blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const block = diff.blocks[middle];
    assert(block !== undefined, 'The search stays inside the blocks');
    if (block.sourceStart <= span.start) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const block = low > 0 ? diff.blocks[low - 1] : undefined;
  if (block === undefined) {
    return { tag: 'gone' };
  }
  if (span.end > block.sourceStart + block.length) {
    return { tag: 'gone' };
  }
  const target = block.targetStart + (span.start - block.sourceStart);
  const mapped = toByteSpan(target, target + (span.end - span.start));
  assert(mapped.end <= diff.target.length, 'A resolved span lies inside the current bytes');
  return { tag: 'resolved', span: mapped };
}

export function mapSpanThroughDiff(diff: ByteDiff, span: ByteSpan): SpanMapping {
  assert(span.start < span.end, 'Only non-empty spans are mapped');
  assert(span.end <= diff.source.length, 'The mapped span lies inside the authored bytes');
  if (diff.distance === 0) {
    assert(diff.source.length === diff.target.length, 'Identical bytes have one length');
    return { tag: 'resolved', span };
  }
  const workLeft = diff.workLimit - diff.workSpent;
  const length = span.end - span.start;
  const first = crossings(diff, span.start);
  const target = soleMatch(first);
  if (target !== undefined) {
    const last = soleMatch(crossings(diff, span.end - 1));
    if (last === target + length - 1) {
      if (runsAgree(diff, span.start, target, length)) {
        const mapped = toByteSpan(target, target + length);
        assert(mapped.end <= diff.target.length, 'A resolved span lies inside the current bytes');
        return { tag: 'resolved', span: mapped };
      }
    }
  }
  return keptBySomeScript(diff, span, first, workLeft);
}


interface Crossings {
  readonly matches: readonly number[];
  readonly deleted: boolean;
}

function crossings(diff: ByteDiff, x: number): Crossings {
  assert(x < diff.source.length, 'A crossed column is a source byte');
  const total = diff.distance;
  const matches: number[] = [];
  let deleted = false;
  const yMin = Math.max(0, x - total);
  const yMax = Math.min(diff.target.length, x + total);
  assert(yMax - yMin <= 2 * total, 'At most 2D + 1 targets are candidates');
  for (let y = yMin; y <= yMax; y++) {
    const before = diff.distanceBefore(x, y);
    if (before === undefined) {
      continue;
    }
    const afterDeletion = diff.distanceAfter(x + 1, y);
    if (afterDeletion !== undefined) {
      if (before + 1 + afterDeletion === total) {
        deleted = true;
      }
    }
    if (matchCrossesAt(diff, x, y, before)) {
      matches.push(y);
    }
  }
  const crossingCount = matches.length + (deleted ? 1 : 0);
  assert(crossingCount > 0, 'Some minimum script crosses every source byte');
  return { matches, deleted };
}

function matchCrossesAt(diff: ByteDiff, x: number, y: number, before: number): boolean {
  if (y < diff.target.length) {
    if (diff.source[x] === diff.target[y]) {
      const after = diff.distanceAfter(x + 1, y + 1);
      if (after !== undefined) {
        return before + after === diff.distance;
      }
    }
  }
  return false;
}

function soleMatch(crossing: Crossings): number | undefined {
  assert(strictlyAscending(crossing.matches), 'Matched targets ascend without repeats');
  if (crossing.deleted) {
    return undefined;
  }
  if (crossing.matches.length === 1) {
    return crossing.matches[0];
  }
  return undefined;
}

function runsAgree(diff: ByteDiff, source: number, target: number, length: number): boolean {
  assert(source + length <= diff.source.length, 'The compared run lies inside the source');
  assert(target + length <= diff.target.length, 'The compared run lies inside the target');
  for (let offset = 0; offset < length; offset++) {
    if (diff.source[source + offset] !== diff.target[target + offset]) {
      return false;
    }
  }
  return true;
}

function keptBySomeScript(diff: ByteDiff, span: ByteSpan, first: Crossings, workLeft: number): SpanMapping {
  const length = span.end - span.start;
  assert(length > 0, 'A mapped span is non-empty');
  assert(first.matches.length <= 2 * diff.distance + 1, 'Matches come from the candidate band');
  let work = 0;
  for (const target of first.matches) {
    if (target + length <= diff.target.length) {
      work += length;
      if (work > workLeft) {
        return { tag: 'ambiguous' };
      }
      if (runsAgree(diff, span.start, target, length)) {
        return { tag: 'ambiguous' };
      }
    }
  }
  assert(work <= workLeft, 'The search stayed inside the work budget');
  return { tag: 'gone' };
}

function strictlyAscending(targets: readonly number[]): boolean {
  for (let index = 1; index < targets.length; index++) {
    const previous = targets[index - 1];
    const current = targets[index];
    assert(previous !== undefined, 'Previous target exists inside the bounds');
    assert(current !== undefined, 'Current target exists inside the bounds');
    if (previous < current) {
      continue;
    }
    return false;
  }
  return true;
}
