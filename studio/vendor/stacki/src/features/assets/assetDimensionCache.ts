import { useEffect, useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import type { Result } from '../../../shared/core/result';

export const DIMENSION_READS_MAX = 4;
export const DIMENSION_QUEUE_MAX = 256;
export const DIMENSION_ENTRIES_MAX = 20_000;

export interface PixelSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

export type DimensionState = { readonly kind: 'pending' } | { readonly kind: 'known'; readonly size: PixelSize } | { readonly kind: 'none' };

export interface DimensionSubject {
  readonly rel: string;
  readonly size: number;
  readonly modifiedMs?: number;
}

export type DimensionReader = (rel: string) => Promise<Result<PixelSize | undefined, string>>;

export interface DimensionCache {
  readonly get: (subject: DimensionSubject) => DimensionState | undefined;
  readonly request: (subject: DimensionSubject) => void;
  readonly put: (subject: DimensionSubject, size: PixelSize) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly stats: () => { readonly reads: number; readonly entries: number; readonly waiting: number };
}

export function dimensionKey(subject: DimensionSubject): string {
  return `${subject.rel}\u0000${subject.size}\u0000${subject.modifiedMs ?? ''}`;
}

export function createDimensionCache(read: DimensionReader): DimensionCache {
  const entries = new Map<string, DimensionState>();
  const waiting = new Map<string, string>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();
  let running = 0;
  let reads = 0;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const remember = (key: string, state: DimensionState): void => {
    entries.delete(key);
    entries.set(key, state);
    if (entries.size > DIMENSION_ENTRIES_MAX) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) {
        entries.delete(oldest);
      }
    }
    assert(entries.size <= DIMENSION_ENTRIES_MAX, 'The cache keeps at most its entry count');
  };
  const finish = (key: string, state: DimensionState): void => {
    running -= 1;
    inFlight.delete(key);
    assert(running >= 0, 'Reads finish once each');
    assert(running === inFlight.size, 'Every running read is in flight once');
    remember(key, state);
    notify();
    queueMicrotask(drain);
  };
  const pump = (): void => {
    while (running < DIMENSION_READS_MAX && waiting.size > 0) {
      const key = [...waiting.keys()].at(-1);
      assert(key !== undefined, 'A non-empty queue has a newest request');
      const rel = waiting.get(key);
      assert(rel !== undefined, 'A waiting request names its file');
      waiting.delete(key);
      inFlight.add(key);
      running += 1;
      reads += 1;
      void read(rel)
        .then(
          (result) => (result.ok && result.value !== undefined ? { kind: 'known' as const, size: result.value } : { kind: 'none' as const }),
          () => ({ kind: 'none' as const }),
        )
        .then((state) => finish(key, state));
    }
    assert(running <= DIMENSION_READS_MAX, 'Reads in flight stay within their bound');
  };
  function drain(): void {
    pump();
  }

  return {
    get: (subject) => entries.get(dimensionKey(subject)),
    request: (subject) => {
      const key = dimensionKey(subject);
      if (entries.has(key) || waiting.has(key) || inFlight.has(key)) {
        return;
      }
      waiting.set(key, subject.rel);
      if (waiting.size > DIMENSION_QUEUE_MAX) {
        const oldest = waiting.keys().next().value;
        if (oldest !== undefined) {
          waiting.delete(oldest);
        }
      }
      assert(waiting.size <= DIMENSION_QUEUE_MAX, 'The queue stays within its bound');
      pump();
    },
    put: (subject, size) => {
      assert(size.widthPx > 0, 'A learned width is positive');
      assert(size.heightPx > 0, 'A learned height is positive');
      remember(dimensionKey(subject), { kind: 'known', size });
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stats: () => ({ reads, entries: entries.size, waiting: waiting.size }),
  };
}

const PENDING: DimensionState = { kind: 'pending' };

export function useDimensions(cache: DimensionCache, subject: DimensionSubject, options: { readonly wanted: boolean }): DimensionState {
  const { rel, size, modifiedMs } = subject;
  useEffect(() => {
    if (options.wanted) {
      cache.request(modifiedMs === undefined ? { rel, size } : { rel, size, modifiedMs });
    }
  }, [cache, rel, size, modifiedMs, options.wanted]);
  const state = useSyncExternalStore(cache.subscribe, () => cache.get(subject) ?? PENDING);
  return state;
}
