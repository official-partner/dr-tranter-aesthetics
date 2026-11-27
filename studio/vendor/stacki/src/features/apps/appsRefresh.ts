import { useSyncExternalStore } from 'react';

let tick = 0;
const listeners = new Set<() => void>();

export function bumpAppsRefresh(): void {
  tick += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function useAppsRefresh(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => tick,
  );
}
