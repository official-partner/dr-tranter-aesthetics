
import { assert } from '../../shared/core/assert';
import { isElement, isText } from './frameBasics';
import { boxOfRun } from './frameMeasure';
import { inScope, regions, runsOf } from './frameRegions';
import { UNION_RUNS_MAX, unionAt, type UnionCandidate } from './unionHit';

export interface UnionTarget {
  readonly path: string;
  readonly occurrence: number;
}

const HOVER_KEEP_MS = 100;

interface KeptUnions {
  readonly best: string | undefined;
  readonly target: Node;
  readonly measuredMs: number;
  readonly candidates: readonly UnionCandidate[];
}

let kept: KeptUnions | undefined;

export function forgetUnionBoxes(): void {
  kept = undefined;
}

export function unionTargetAt(best: string | undefined, target: Node | undefined, x: number, y: number): UnionTarget | undefined {
  if (target === undefined) {
    return undefined;
  }
  const hit = unionAt(x, y, candidatesFor(best, target));
  if (hit === undefined) {
    return undefined;
  }
  assert(hit.occurrence >= 0, 'unionTargetAt: an occurrence is an index');
  return { path: hit.path, occurrence: hit.occurrence };
}

function candidatesFor(best: string | undefined, target: Node): readonly UnionCandidate[] {
  const nowMs = Date.now();
  if (kept !== undefined && kept.target === target && kept.best === best) {
    if (nowMs - kept.measuredMs < HOVER_KEEP_MS) {
      return kept.candidates;
    }
  }
  const candidates = measureCandidates(best, target);
  kept = { best, target, measuredMs: nowMs, candidates };
  return candidates;
}

function measureCandidates(best: string | undefined, target: Node): readonly UnionCandidate[] {
  const prefix = best === undefined ? '' : `${best}.`;
  const out: UnionCandidate[] = [];
  for (const [nodePath, recorded] of regions) {
    if (!nodePath.startsWith(prefix)) {
      continue;
    }
    if (recorded.some((run) => sitsIn(run, target))) {
      if (inScope(nodePath)) {
        addCandidates(nodePath, target, out);
      }
    }
    if (out.length >= UNION_RUNS_MAX) {
      break;
    }
  }
  assert(out.length <= UNION_RUNS_MAX, 'measureCandidates: candidates are capped');
  return out;
}

function addCandidates(nodePath: string, target: Node, out: UnionCandidate[]): void {
  const runs = runsOf(nodePath) ?? [];
  for (const [occurrence, run] of runs.entries()) {
    if (out.length >= UNION_RUNS_MAX) {
      return;
    }
    if (sitsIn(run, target) && drawsUnion(run)) {
      const box = boxOfRun(nodePath, run, runs.length);
      if (box !== undefined) {
        out.push({ path: nodePath, occurrence, box });
      }
    }
  }
}

function sitsIn(run: readonly Node[], target: Node): boolean {
  return run.some((node) => node.parentNode === target);
}

function drawsUnion(run: readonly Node[]): boolean {
  let count = 0;
  for (const node of run) {
    if (node.isConnected && putsContent(node)) {
      count += 1;
      if (count === 2) {
        return true;
      }
    }
  }
  return false;
}

function putsContent(node: Node): boolean {
  if (isElement(node)) {
    return node.tagName !== 'TEMPLATE';
  }
  return isText(node) && node.textContent.trim() !== '';
}
