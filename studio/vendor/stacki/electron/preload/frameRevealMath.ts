
import { assert } from '../../shared/core/assert';
import type { Rect } from './frameBasics';

export const SCROLL_MARGIN = 24;

export const INSET_FRACTION_MAX = 0.4;

export const GLIDE_MS_MIN = 300;
export const GLIDE_MS_MAX = 450;
const GLIDE_PX_FULL = 2_400;

export const landingTop = (rect: Rect, viewportHeight: number, scrollTop: number, insetTop: number): number => {
  assert(viewportHeight >= 0, 'landingTop: a scroller has a height');
  assert(Number.isFinite(scrollTop), 'landingTop: a scroller has a position');
  assert(insetTop >= 0, 'landingTop: a bar covers no negative height');
  assert(insetTop <= viewportHeight, 'landingTop: a bar is no taller than the view');
  const room = viewportHeight - insetTop;
  const offset = rect.h >= room - SCROLL_MARGIN * 2 ? insetTop + SCROLL_MARGIN : insetTop + Math.floor((room - rect.h) / 2);
  const target = Math.max(0, Math.round(scrollTop + rect.y - offset));
  assert(target >= 0, 'landingTop: a scroll position is never negative');
  return target;
};

export const boxComfortable = (rect: Rect, viewportHeight: number, insetTop: number): boolean => {
  assert(rect.w >= 0, 'boxComfortable: a box has no negative width');
  assert(rect.h >= 0, 'boxComfortable: a box has no negative height');
  assert(insetTop >= 0, 'boxComfortable: a bar covers no negative height');
  const bottom = rect.y + rect.h;
  if (rect.w > 0 && rect.h > 0) {
    if (rect.y >= insetTop) {
      if (bottom <= viewportHeight) {
        return true;
      }
    }
    const room = viewportHeight - insetTop;
    if (rect.h > room) {
      const overlap = Math.min(bottom, viewportHeight) - Math.max(rect.y, insetTop);
      return overlap * 2 >= room;
    }
    return false;
  }
  if (rect.y >= 0) {
    if (bottom <= viewportHeight) {
      return true;
    }
  }
  if (rect.y <= 0) {
    return bottom >= viewportHeight;
  }
  return false;
};

export const glideDurationMs = (distancePx: number): number => {
  assert(Number.isFinite(distancePx), 'glideDurationMs: a distance is a number');
  const fraction = Math.min(1, Math.abs(distancePx) / GLIDE_PX_FULL);
  const durationMs = Math.round(GLIDE_MS_MIN + (GLIDE_MS_MAX - GLIDE_MS_MIN) * fraction);
  assert(durationMs >= GLIDE_MS_MIN, 'glideDurationMs: never shorter than the minimum');
  assert(durationMs <= GLIDE_MS_MAX, 'glideDurationMs: never longer than the cap');
  return durationMs;
};

export const glidePosition = (from: number, to: number, elapsedMs: number, durationMs: number): number => {
  assert(durationMs > 0, 'glidePosition: a glide takes time');
  assert(Number.isFinite(elapsedMs), 'glidePosition: elapsed time is a number');
  if (elapsedMs >= durationMs) {
    return to;
  }
  const progress = Math.max(0, elapsedMs) / durationMs;
  const eased = 1 - (1 - progress) ** 3;
  return Math.round(from + (to - from) * eased);
};
