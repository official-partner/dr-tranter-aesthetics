import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import { APP_RPC_LIMITS, type AppRect } from '../../../shared/properties/appsRpc';
import type { MeasuredRects } from './overlayPlacement';

export interface AppNodeMeasurer {
  readonly measure: (nodeId: string, occurrence: number | undefined) => Promise<readonly AppRect[]>;
}

interface Measurement {
  readonly rects: MeasuredRects;
  readonly pathFor: (nodeId: string) => string | undefined;
}

export interface OverlayMeasureStore extends AppNodeMeasurer {
  readonly note: (measurement: Measurement) => void;
  readonly requested: () => readonly string[];
  readonly subscribe: (listener: () => void) => () => void;
}

export function createOverlayMeasure(options: { readonly timeoutMs: number }): OverlayMeasureStore {
  let latest: Measurement | undefined;
  let requested: readonly string[] = [];
  const waiters = new Map<string, Set<() => void>>();
  const listeners = new Set<() => void>();
  const setRequested = (next: readonly string[]): void => {
    requested = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const boxesOf = (nodeId: string, occurrence: number | undefined): readonly AppRect[] | undefined => {
    const path = latest?.pathFor(nodeId);
    const boxes = path === undefined ? undefined : latest?.rects[path];
    if (boxes === undefined) {
      return undefined;
    }
    const chosen = occurrence === undefined ? boxes.slice(0, APP_RPC_LIMITS.measureRectsMax) : boxes.slice(occurrence, occurrence + 1);
    return chosen.map((box) => ({ x: box.x, y: box.y, width: Math.max(0, box.w), height: Math.max(0, box.h) }));
  };
  return {
    note: (measurement) => {
      latest = measurement;
      for (const [nodeId, resolvers] of [...waiters]) {
        const path = measurement.pathFor(nodeId);
        if (path !== undefined && measurement.rects[path] !== undefined) {
          waiters.delete(nodeId);
          for (const resolve of resolvers) {
            resolve();
          }
        }
      }
    },
    requested: () => requested,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    measure: async (nodeId, occurrence) => {
      const known = boxesOf(nodeId, occurrence);
      if (known !== undefined) {
        return known;
      }
      if (latest?.pathFor(nodeId) === undefined) {
        return [];
      }
      if (waiters.size >= APP_RPC_LIMITS.measureRequestsMax && !waiters.has(nodeId)) {
        return [];
      }
      await new Promise<void>((resolve) => {
        const resolvers = waiters.get(nodeId) ?? new Set<() => void>();
        resolvers.add(resolve);
        waiters.set(nodeId, resolvers);
        if (!requested.includes(nodeId)) {
          setRequested([...requested, nodeId]);
        }
        setTimeout(resolve, options.timeoutMs);
      });
      if (!waiters.has(nodeId)) {
        setRequested(requested.filter((id) => id !== nodeId));
      }
      assert(waiters.size <= APP_RPC_LIMITS.measureRequestsMax, 'Measure requests are bounded');
      return boxesOf(nodeId, occurrence) ?? [];
    },
  };
}

export const overlayMeasure: OverlayMeasureStore = createOverlayMeasure({ timeoutMs: APP_RPC_LIMITS.measureTimeoutMs });

export function useMeasureRequests(): readonly string[] {
  return useSyncExternalStore(overlayMeasure.subscribe, overlayMeasure.requested);
}
