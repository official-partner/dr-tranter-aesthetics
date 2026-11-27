import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import { toByteSpan, type ByteSpan, type ByteString } from '../core/span';
import { alignedBlocks, type EqualBlock } from './coarseDiff';

export type { EqualBlock } from './coarseDiff';

export interface DiffBudget {
  readonly workMax: number;
  readonly distanceMax: number;
}

const LINEAR_PASSES = 4;

export const DIFF_BUDGET: DiffBudget = {
  workMax: LIMITS.diffWorkMax,
  distanceMax: LIMITS.diffDistanceMax,
};

export interface ByteDiff {
  readonly source: ByteString;
  readonly target: ByteString;
  readonly distance: number;
  readonly budget: DiffBudget;
  readonly workLimit: number;
  readonly workSpent: number;
  readonly distanceBefore: (x: number, y: number) => number | undefined;
  readonly distanceAfter: (x: number, y: number) => number | undefined;
}

export interface CoarseDiff {
  readonly source: ByteString;
  readonly target: ByteString;
  readonly blocks: readonly EqualBlock[];
}

export type DiffOutcome = { readonly tag: 'computed'; readonly diff: ByteDiff } | { readonly tag: 'coarse'; readonly diff: CoarseDiff };

export interface Hunk {
  readonly source: ByteSpan;
  readonly target: ByteSpan;
}

type Frontiers = readonly Int32Array[];

interface FrontierRun {
  readonly rows: Frontiers;
  readonly distance: number;
  readonly workSpent: number;
}

export function diffBytes(source: ByteString, target: ByteString, budget: DiffBudget): DiffOutcome {
  assert(budget.workMax <= LIMITS.diffWorkMax, 'The diff budget stays inside the work bound');
  assert(budget.distanceMax <= LIMITS.diffDistanceMax, 'The diff budget stays inside the distance');
  assert(source.length <= LIMITS.sourceBytesMax, 'Diffed source bytes are inside the file bound');
  assert(target.length <= LIMITS.sourceBytesMax, 'Diffed target bytes are inside the file bound');
  if (Math.abs(source.length - target.length) > budget.distanceMax) {
    return coarse(source, target);
  }
  const workLimit = budget.workMax + LINEAR_PASSES * (source.length + target.length);
  const forward = runFrontiers(source, target, workLimit, budget.distanceMax, 0);
  if (forward === undefined) {
    return coarse(source, target);
  }
  const backward = runFrontiers(reversed(source), reversed(target), workLimit, budget.distanceMax, forward.workSpent);
  if (backward === undefined) {
    return coarse(source, target);
  }
  const distance = forward.distance;
  assert(backward.distance === distance, 'Both directions find the same minimum distance');
  const sizeChange = Math.abs(source.length - target.length);
  assert(distance >= sizeChange, 'The distance covers the size change');
  assert((distance - sizeChange) % 2 === 0, 'The distance has the parity of N + M');
  const diff: ByteDiff = {
    source,
    target,
    distance,
    budget,
    workLimit,
    workSpent: backward.workSpent,
    distanceBefore: (x, y) => {
      checkPoint(source, target, x, y);
      return frontierDistance(forward.rows, distance, x, y);
    },
    distanceAfter: (x, y) => {
      checkPoint(source, target, x, y);
      return frontierDistance(backward.rows, distance, source.length - x, target.length - y);
    },
  };
  const endDistance = diff.distanceBefore(source.length, target.length);
  assert(endDistance === distance, 'The end costs the distance');
  assert(diff.distanceAfter(0, 0) === distance, 'The start costs the distance, read backward');
  return { tag: 'computed', diff };
}

export function coarseHunks(diff: CoarseDiff): readonly Hunk[] {
  const hunks: Hunk[] = [];
  let sourceAt = 0;
  let targetAt = 0;
  for (const block of diff.blocks) {
    if (block.sourceStart > sourceAt || block.targetStart > targetAt) {
      hunks.push({ source: toByteSpan(sourceAt, block.sourceStart), target: toByteSpan(targetAt, block.targetStart) });
    }
    sourceAt = block.sourceStart + block.length;
    targetAt = block.targetStart + block.length;
  }
  if (sourceAt < diff.source.length || targetAt < diff.target.length) {
    hunks.push({ source: toByteSpan(sourceAt, diff.source.length), target: toByteSpan(targetAt, diff.target.length) });
  }
  return hunks;
}

export function diffHunks(diff: ByteDiff): readonly Hunk[] {
  const { source, target } = diff;
  const hunks: Hunk[] = [];
  let x = source.length;
  let y = target.length;
  let distance = diff.distance;
  let hunkEnd: { readonly x: number; readonly y: number } | undefined;
  const stepsMax = source.length + target.length;
  for (let step = 0; step < stepsMax; step++) {
    if (x + y === 0) {
      break;
    }
    if (matchesBehind(source, target, x, y)) {
      if (hunkEnd !== undefined) {
        hunks.push({ source: toByteSpan(x, hunkEnd.x), target: toByteSpan(y, hunkEnd.y) });
        hunkEnd = undefined;
      }
      x -= 1;
      y -= 1;
      continue;
    }
    hunkEnd ??= { x, y };
    if (deletionBehind(diff, x, y, distance)) {
      x -= 1;
    } else {
      assert(y > 0, 'Without a deletion behind, an insertion is');
      assert(diff.distanceBefore(x, y - 1) === distance - 1, 'The insertion lies on the script');
      y -= 1;
    }
    distance -= 1;
  }
  assert(x + y === 0, 'The traceback reaches the start of both files');
  assert(distance === 0, 'The traceback spent exactly the distance');
  if (hunkEnd !== undefined) {
    hunks.push({ source: toByteSpan(0, hunkEnd.x), target: toByteSpan(0, hunkEnd.y) });
  }
  return hunks.reverse();
}


function coarse(source: ByteString, target: ByteString): DiffOutcome {
  return { tag: 'coarse', diff: { source, target, blocks: alignedBlocks(source, target) } };
}

function matchesBehind(source: ByteString, target: ByteString, x: number, y: number): boolean {
  if (x > 0) {
    if (y > 0) {
      return source[x - 1] === target[y - 1];
    }
  }
  return false;
}

function deletionBehind(diff: ByteDiff, x: number, y: number, distance: number): boolean {
  if (x > 0) {
    return diff.distanceBefore(x - 1, y) === distance - 1;
  }
  return false;
}

function checkPoint(source: ByteString, target: ByteString, x: number, y: number): void {
  assert(Number.isSafeInteger(x), 'A diff point has an integer x');
  assert(Number.isSafeInteger(y), 'A diff point has an integer y');
  assert(x >= 0, 'A diff point lies right of the grid start');
  assert(y >= 0, 'A diff point lies below the grid start');
  assert(x <= source.length, 'A diff point lies inside the source');
  assert(y <= target.length, 'A diff point lies inside the target');
}

function runFrontiers(source: Uint8Array, target: Uint8Array, workLimit: number, distanceMax: number, workStart: number): FrontierRun | undefined {
  const rows: Int32Array[] = [];
  let work = workStart;
  const endDiagonal = source.length - target.length;
  for (let distance = 0; distance <= distanceMax; distance++) {
    work += 2 * distance + 1;
    if (work > workLimit) {
      return undefined;
    }
    const row = new Int32Array(2 * distance + 1).fill(-1);
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const start = frontierStart(rows, distance, diagonal, source.length, target.length);
      if (start < 0) {
        continue;
      }
      const end = snake(source, target, start, start - diagonal, workLimit - work);
      if (end === undefined) {
        return undefined;
      }
      work += end - start;
      row[diagonal + distance] = end;
    }
    rows.push(row);
    assert(rows.length === distance + 1, 'One frontier row per distance');
    if (row[endDiagonal + distance] === source.length) {
      assert(Math.abs(endDiagonal) <= distance, 'The end diagonal is inside the final row');
      return { rows, distance, workSpent: work };
    }
  }
  return undefined;
}

function frontierStart(rows: Frontiers, distance: number, diagonal: number, sourceLength: number, targetLength: number): number {
  if (distance === 0) {
    return 0;
  }
  if (diagonal > sourceLength) {
    return -1;
  }
  if (diagonal < -targetLength) {
    return -1;
  }
  let best = frontierAt(rows, distance - 2, diagonal);
  const above = frontierAt(rows, distance - 1, diagonal + 1);
  if (above >= 0) {
    const from = Math.min(above, targetLength + diagonal);
    best = from >= Math.max(0, diagonal + 1) ? Math.max(best, from) : best;
  }
  const left = frontierAt(rows, distance - 1, diagonal - 1);
  if (left >= 0) {
    const from = Math.min(left, sourceLength - 1);
    best = from >= Math.max(0, diagonal - 1) ? Math.max(best, from + 1) : best;
  }
  assert(best <= sourceLength, 'A frontier start lies inside the source');
  if (best >= 0) {
    assert(best - diagonal <= targetLength, 'A frontier start lies inside the target');
  }
  return best;
}

function frontierAt(rows: Frontiers, distance: number, diagonal: number): number {
  if (distance < 0) {
    return -1;
  }
  if (Math.abs(diagonal) > distance) {
    return -1;
  }
  const row = rows[distance];
  assert(row !== undefined, 'Earlier frontier rows are kept');
  const x = row[diagonal + distance];
  assert(x !== undefined, 'The diagonal lies inside its row');
  return x;
}

function snake(source: Uint8Array, target: Uint8Array, x: number, y: number, workLeft: number): number | undefined {
  const stepsMax = Math.min(source.length - x, target.length - y);
  assert(stepsMax >= 0, 'A snake starts inside the grid');
  assert(workLeft >= 0, 'A snake starts inside the work budget');
  for (let step = 0; step < stepsMax; step++) {
    if (source[x + step] !== target[y + step]) {
      return x + step;
    }
    if (step + 1 > workLeft) {
      return undefined;
    }
  }
  return x + stepsMax;
}

function frontierDistance(rows: Frontiers, distance: number, x: number, y: number): number | undefined {
  const diagonal = x - y;
  const first = Math.abs(diagonal);
  if (first > distance) {
    return undefined;
  }
  const candidates = Math.floor((distance - first) / 2) + 1;
  let low = 0;
  let high = candidates;
  const probesMax = 64;
  for (let probe = 0; probe < probesMax; probe++) {
    if (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frontierAt(rows, first + 2 * middle, diagonal) >= x) {
        high = middle;
      } else {
        low = middle + 1;
      }
    } else {
      break;
    }
  }
  assert(low === high, 'The binary search converged inside its probe bound');
  if (low < candidates) {
    const found = first + 2 * low;
    assert(frontierAt(rows, found, diagonal) >= x, 'The found row reaches the point');
    assert(frontierAt(rows, found - 2, diagonal) < x, 'No cheaper row reaches the point');
    return found;
  }
  return undefined;
}

function reversed(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes).reverse();
  assert(copy.length === bytes.length, 'Reversing keeps the length');
  assert(copy.buffer !== bytes.buffer, 'The reversed copy shares no memory with its input');
  return copy;
}
