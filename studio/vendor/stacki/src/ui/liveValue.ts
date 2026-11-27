
import { useSyncExternalStore } from 'react';
import { assert } from '../../shared/core/assert';

const LISTENERS_MAX = 64;

export interface LiveValue<T> {
  readonly get: () => T;
  readonly set: (next: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createLiveValue<T>(initial: T): LiveValue<T> {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (Object.is(next, current)) {
        return;
      }
      current = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe: (listener) => {
      assert(!listeners.has(listener), 'A listener subscribes once');
      listeners.add(listener);
      assert(listeners.size <= LISTENERS_MAX, 'A live value has a handful of readers');
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const NO_LIVE_TEXT: LiveValue<string> = createLiveValue('');

export function useLiveValue<T>(source: LiveValue<T>): T {
  return useSyncExternalStore(source.subscribe, source.get);
}
