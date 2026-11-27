
import { assert } from '../../shared/core/assert';
import { type Box } from './frameBasics';
import { boxHolds } from './pseudoHit';

export const UNION_RUNS_MAX = 256;

export interface UnionCandidate {
  readonly path: string;
  readonly occurrence: number;
  readonly box: Box;
}

export function unionAt(x: number, y: number, candidates: readonly UnionCandidate[]): UnionCandidate | undefined {
  assert(Number.isFinite(x), 'unionAt: x is a finite number');
  assert(Number.isFinite(y), 'unionAt: y is a finite number');
  assert(candidates.length <= UNION_RUNS_MAX, 'unionAt: candidates are capped');
  let best: UnionCandidate | undefined = undefined;
  for (const candidate of candidates) {
    if (boxHolds(candidate.box, x, y)) {
      best = best === undefined ? candidate : innermost(best, candidate);
    }
  }
  return best;
}

function innermost(held: UnionCandidate, next: UnionCandidate): UnionCandidate {
  const heldArea = areaOf(held.box);
  const nextArea = areaOf(next.box);
  if (nextArea < heldArea) {
    return next;
  }
  if (heldArea < nextArea) {
    return held;
  }
  return depthOf(next.path) < depthOf(held.path) ? next : held;
}

function areaOf(box: Box): number {
  const area = (box.right - box.left) * (box.bottom - box.top);
  assert(area > 0, 'areaOf: a box holding a point has area');
  return area;
}

function depthOf(nodePath: string): number {
  assert(nodePath.length > 0, 'depthOf: a node has a path');
  return nodePath.split('.').length;
}
