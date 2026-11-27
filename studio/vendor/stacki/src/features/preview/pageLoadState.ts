
import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';

export const PAGE_LOAD_FRAMES_MAX = 16;

const loadingIds = new Set<string>();
const listeners = new Set<() => void>();
let startSerial = 0;
let load = 0;

function publish(): void {
  const next = loadingIds.size > 0 ? startSerial : 0;
  if (next === load) {
    return;
  }
  load = next;
  for (const listener of listeners) {
    listener();
  }
}

export function pageLoadStart(frameId: string): void {
  assert(frameId.length > 0, 'pageLoadStart: a frame id is never empty');
  if (loadingIds.size < PAGE_LOAD_FRAMES_MAX) {
    loadingIds.add(frameId);
    startSerial += 1;
  }
  assert(loadingIds.size <= PAGE_LOAD_FRAMES_MAX, 'pageLoadStart: the tracked frames are bounded');
  publish();
}

export function pageLoadEnd(frameId: string): void {
  assert(frameId.length > 0, 'pageLoadEnd: a frame id is never empty');
  loadingIds.delete(frameId);
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageLoad(): number {
  return useSyncExternalStore(
    subscribe,
    () => load,
    () => 0,
  );
}
