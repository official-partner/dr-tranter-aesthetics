import { useSyncExternalStore } from 'react';
import { assert } from '../../shared/core/assert';

export type PanelDragPhase = 'idle' | 'dragging';

const LISTENERS_MAX = 64;
const listeners = new Set<() => void>();
let phase: PanelDragPhase = 'idle';

export function panelDragPhase(): PanelDragPhase {
  return phase;
}

export function setPanelDragPhase(next: PanelDragPhase): void {
  if (next === phase) {
    return;
  }
  phase = next;
  for (const listener of [...listeners]) {
    listener();
  }
  assert(phase === next, 'A panel drag listener must not change the phase it is told about');
}

export function usePanelDragPhase(): PanelDragPhase {
  return useSyncExternalStore(subscribePanelDragPhase, panelDragPhase, panelDragPhase);
}

export function subscribePanelDragPhase(listener: () => void): () => void {
  assert(listeners.size < LISTENERS_MAX, 'Too many panel drag listeners');
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
