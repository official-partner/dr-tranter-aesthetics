
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import { loopSourcePath, parseLoopHead } from './loopSource';

export const ITERATION_MARKER_PREFIX = 'avb-i:';

export const ITERATION_LIMITS = {
  marksMax: 20_000,
  loopsMax: 16,
} as const;

export interface PreviewIteration {
  readonly path: string;
  readonly index: number;
}

const MARKER = /^avb-i:(-?\d{1,9}):([\s\S]+)$/;

export function parseIterationMarker(data: string): PreviewIteration | undefined {
  assert(data.length <= LIMITS.attrCharsMax, 'parseIterationMarker: comment data is bounded');
  const match = MARKER.exec(data);
  const index = match?.[1];
  const path = match?.[2];
  if (index === undefined || path === undefined) {
    return undefined;
  }
  const parsed = Number(index);
  if (!Number.isSafeInteger(parsed) || parsed < -1) {
    return undefined;
  }
  return { path, index: parsed };
}

export function iterationMarkerData(path: string, index: number): string {
  assert(path.length > 0, 'iterationMarkerData: a loop has a path');
  assert(Number.isSafeInteger(index), 'iterationMarkerData: an index is an integer');
  assert(index >= -1, 'iterationMarkerData: an index is an item place, or -1');
  return `${ITERATION_MARKER_PREFIX}${index}:${path}`;
}

export function iterationMarkerExpression(loopHead: string, loopPath: string): string | undefined {
  assert(loopPath.length > 0, 'iterationMarkerExpression: a loop has a path');
  const head = parseLoopHead(loopHead);
  if (head === undefined) {
    return undefined;
  }
  const source = loopSourcePath(head.source);
  if (source === undefined) {
    return undefined;
  }
  const list = source.kind === 'values' ? `Object.values(${source.path})` : source.path;
  const tail = JSON.stringify(`:${loopPath}-->`);
  const lookup = `(() => { try { const list = ${list}; const at = list.indexOf(${head.item}); return at === list.lastIndexOf(${head.item}) ? at : -1; } catch { return -1; } })()`;
  const expression = `${JSON.stringify(`<!--${ITERATION_MARKER_PREFIX}`)} + ${lookup} + ${tail}`;
  assert(expression.length < LIMITS.attrCharsMax, 'iterationMarkerExpression: the expression is bounded');
  return expression;
}
