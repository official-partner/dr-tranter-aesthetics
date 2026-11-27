import { useEffect } from 'react';
import { assert } from '../../shared/core/assert';


export type TouchClaimState = 'pending' | 'claimed' | 'released';

export type TouchClaimAxis = 'x' | 'hold';

export const TOUCH_CLAIM = {
  slopPx: 8,
  holdMs: 350,
} as const satisfies Record<string, number>;

export function touchClaimStep(input: { readonly dxPx: number; readonly dyPx: number; readonly axis: TouchClaimAxis }): TouchClaimState {
  assert(Number.isFinite(input.dxPx), 'touchClaimStep: dx is finite');
  assert(Number.isFinite(input.dyPx), 'touchClaimStep: dy is finite');
  const across = Math.abs(input.dxPx);
  const along = Math.abs(input.dyPx);
  if (Math.max(across, along) < TOUCH_CLAIM.slopPx) {
    return 'pending';
  }
  if (input.axis === 'x') {
    if (across > along) {
      return 'claimed';
    }
    return 'released';
  }
  return 'released';
}

export interface TouchClaim {
  readonly state: () => TouchClaimState;
  readonly move: (point: { readonly clientX: number; readonly clientY: number }) => TouchClaimState;
  readonly end: () => void;
}

export function startTouchClaim(
  event: { readonly pointerType: string; readonly clientX: number; readonly clientY: number },
  options: { readonly axis: TouchClaimAxis },
  onHold?: () => void,
): TouchClaim {
  if (event.pointerType !== 'touch') {
    return settledClaim();
  }
  const start = { x: event.clientX, y: event.clientY };
  let state: TouchClaimState = 'pending';
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timer = undefined;
    if (state === 'pending') {
      state = 'claimed';
      claimedTouches += 1;
      onHold?.();
    }
  }, TOUCH_CLAIM.holdMs);
  const stopTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  let ended = false;
  return {
    state: () => state,
    move: (point) => {
      if (state === 'pending') {
        state = touchClaimStep({ dxPx: point.clientX - start.x, dyPx: point.clientY - start.y, axis: options.axis });
        if (state === 'claimed') {
          claimedTouches += 1;
        }
        if (state !== 'pending') {
          stopTimer();
        }
      }
      return state;
    },
    end: () => {
      stopTimer();
      if (ended) {
        return;
      }
      ended = true;
      if (state === 'claimed') {
        claimedTouches -= 1;
        assert(claimedTouches >= 0, 'touchClaim: every claimed touch ends once');
      }
    },
  };
}

let claimedTouches = 0;

export function touchClaimHeld(): boolean {
  assert(claimedTouches >= 0, 'touchClaim: the claimed count never goes negative');
  return claimedTouches > 0;
}

export function useTouchClaimGuard(): void {
  useEffect(() => {
    installTouchClaimGuard(document);
  }, []);
}

const guarded = new WeakSet<Document>();

export function installTouchClaimGuard(target: Document): void {
  if (guarded.has(target)) {
    return;
  }
  guarded.add(target);
  target.addEventListener('touchmove', guardTouchMove, { passive: false, capture: true });
  assert(guarded.has(target), 'touchClaim: the guard is recorded once installed');
}

function guardTouchMove(event: Event): void {
  if (touchClaimHeld()) {
    if (event.cancelable) {
      event.preventDefault();
    }
  }
}

function settledClaim(): TouchClaim {
  return {
    state: () => 'claimed',
    move: () => 'claimed',
    end: () => {},
  };
}
