import { useSyncExternalStore } from 'react';
import { assert } from '../../../../shared/core/assert';

export interface TickerClock {
  readonly now: () => number;
  readonly setInterval: (callback: () => void, periodMs: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface Ticker {
  readonly subscribe: (listener: () => void) => () => void;
  readonly read: () => number;
  readonly listenerCount: () => number;
}

export const TICK_MS = 1000;

const STALE_MS = 500;

export function createTicker(clock: TickerClock, periodMs: number): Ticker {
  assert(periodMs > 0, 'createTicker: a positive period');
  const listeners = new Set<() => void>();
  let handle: unknown;
  let reading = clock.now();
  const tick = (): void => {
    reading = clock.now();
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        reading = clock.now();
        handle = clock.setInterval(tick, periodMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clock.clearInterval(handle);
          handle = undefined;
        }
      };
    },
    read() {
      if (listeners.size === 0) {
        const current = clock.now();
        if (current - reading >= STALE_MS) {
          reading = current;
        }
      }
      return reading;
    },
    listenerCount: () => listeners.size,
  };
}

const systemClock: TickerClock = {
  now: () => Date.now(),
  setInterval: (callback, periodMs) => window.setInterval(callback, periodMs),
  clearInterval: (handle) => window.clearInterval(typeof handle === 'number' ? handle : undefined),
};

let shared: Ticker | undefined;

export function sharedTicker(): Ticker {
  shared ??= createTicker(systemClock, TICK_MS);
  return shared;
}

export function useNow(): number {
  const ticker = sharedTicker();
  return useSyncExternalStore(ticker.subscribe, ticker.read, ticker.read);
}
