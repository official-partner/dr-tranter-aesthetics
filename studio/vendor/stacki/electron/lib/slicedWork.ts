import { assert } from '../../shared/core/assert';
import { PLATFORM_LIMITS } from '../../shared/core/limits';

export type SlicedWork<T> = Generator<void, T, void>;

export const SLICE_MS_MAX = 8;

export function runSync<T>(work: SlicedWork<T>): T {
  let steps = 0;
  let next = work.next();
  while (next.done !== true) {
    steps += 1;
    assert(steps <= PLATFORM_LIMITS.safeIntegerMax, 'runSync: the step count stays an exact integer');
    next = work.next();
  }
  return next.value;
}

export async function runSliced<T>(work: SlicedWork<T>): Promise<T> {
  let sliceStartedMs = performance.now();
  let steps = 0;
  let next = work.next();
  while (next.done !== true) {
    steps += 1;
    assert(steps <= PLATFORM_LIMITS.safeIntegerMax, 'runSliced: the step count stays an exact integer');
    if (performance.now() - sliceStartedMs >= SLICE_MS_MAX) {
      await yieldToEventLoop();
      sliceStartedMs = performance.now();
    }
    next = work.next();
  }
  return next.value;
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export function createSliceClock(): { readonly yieldIfDue: () => Promise<void> } {
  let sliceStartedMs = performance.now();
  return {
    yieldIfDue: async () => {
      if (performance.now() - sliceStartedMs >= SLICE_MS_MAX) {
        await yieldToEventLoop();
        sliceStartedMs = performance.now();
      }
    },
  };
}
