
import { assert } from '../../shared/core/assert';
import { glideDurationMs, glidePosition } from './frameRevealMath';

export const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

const GLIDE_FRAMES_MAX = 120;
const GLIDE_STALL_MS = 250;

export interface GlideMove {
  readonly from: number;
  readonly to: number;
  readonly scrollTo: (top: number) => void;
  readonly events: EventTarget;
}

export type GlideOutcome = 'arrived' | 'taken-over';

export const startGlide = (moves: readonly GlideMove[], onEnd: (outcome: GlideOutcome) => void): (() => void) => {
  assert(moves.length > 0, 'startGlide: there is something to move');
  const distanceMax = Math.max(...moves.map((move) => Math.abs(move.to - move.from)));
  const durationMs = glideDurationMs(distanceMax);
  let originMs: number | undefined;
  let frames = 0;
  let frameHandle: number | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let live = true;

  const land = (): void => {
    for (const move of moves) {
      move.scrollTo(move.to);
    }
  };
  const teardown = (): void => {
    live = false;
    if (frameHandle !== undefined) {
      cancelAnimationFrame(frameHandle);
    }
    clearTimeout(stallTimer);
    for (const move of moves) {
      for (const type of TAKEOVER_EVENTS) {
        move.events.removeEventListener(type, takeOver, true);
      }
    }
  };
  const takeOver = (): void => {
    if (live) {
      teardown();
      onEnd('taken-over');
    }
  };
  const arrive = (): void => {
    if (live) {
      land();
      teardown();
      onEnd('arrived');
    }
  };
  const armStall = (): void => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(arrive, GLIDE_STALL_MS);
  };
  const step = (nowMs: number): void => {
    if (!live) {
      return;
    }
    frames += 1;
    originMs ??= nowMs;
    const elapsedMs = nowMs - originMs;
    if (frames > GLIDE_FRAMES_MAX || elapsedMs >= durationMs) {
      arrive();
      return;
    }
    for (const move of moves) {
      move.scrollTo(glidePosition(move.from, move.to, elapsedMs, durationMs));
    }
    frameHandle = requestAnimationFrame(step);
    armStall();
  };

  for (const move of moves) {
    for (const type of TAKEOVER_EVENTS) {
      move.events.addEventListener(type, takeOver, { capture: true, passive: true });
    }
  }
  frameHandle = requestAnimationFrame(step);
  armStall();
  return teardown;
};
