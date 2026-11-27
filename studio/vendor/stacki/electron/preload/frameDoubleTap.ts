import { assert } from '../../shared/core/assert';

export interface TapPoint {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
}

export const DOUBLE_TAP_MS_MAX = 350;
export const DOUBLE_TAP_PX_MAX = 24;

export function isTouchDoubleTap(previous: TapPoint | undefined, next: TapPoint): boolean {
  assert(Number.isFinite(next.timeMs), 'A tap carries a finite time');
  assert(Number.isFinite(next.x), 'A tap carries a finite x');
  assert(Number.isFinite(next.y), 'A tap carries a finite y');
  if (previous === undefined) {
    return false;
  }
  const elapsedMs = next.timeMs - previous.timeMs;
  if (elapsedMs < 0) {
    return false;
  }
  if (elapsedMs > DOUBLE_TAP_MS_MAX) {
    return false;
  }
  return Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_PX_MAX;
}
