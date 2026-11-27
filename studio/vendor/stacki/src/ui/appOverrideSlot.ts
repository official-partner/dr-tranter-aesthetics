import { useSyncExternalStore } from 'react';
import { assert } from '../../shared/core/assert';
import { defaultAnswer, type AppOverrideAnswer, type AppOverrideContexts, type AppOverridePoint } from '../../shared/properties/appsRpc';

export type AppOverrideAsk =
  | { readonly point: 'assets.pick'; readonly context: AppOverrideContexts['assets.pick'] }
  | { readonly point: 'cms.bind'; readonly context: Omit<AppOverrideContexts['cms.bind'], 'selection'> };

export interface AppOverrideCall {
  readonly answer: Promise<AppOverrideAnswer>;
  readonly cancel: () => void;
}

export interface AppOverrideSlot {
  readonly owner: (point: AppOverridePoint) => string | undefined;
  readonly dispatch: (ask: AppOverrideAsk) => AppOverrideCall;
  readonly subscribe: (listener: () => void) => () => void;
}

let slot: AppOverrideSlot | undefined;
let stopSlot: (() => void) | undefined;
const slotListeners = new Set<() => void>();
let altAtLastPress = false;
let pressListening = false;

export function setAppOverrideSlot(next: AppOverrideSlot | undefined): void {
  stopSlot?.();
  slot = next;
  stopSlot = next?.subscribe(notifyOwners);
  listenForPresses();
  notifyOwners();
}

export function askAppOverride(ask: AppOverrideAsk, gesture: { readonly bypass: boolean }): AppOverrideCall {
  if (gesture.bypass || slot === undefined) {
    return { answer: Promise.resolve(defaultAnswer(ask.point)), cancel: () => undefined };
  }
  return slot.dispatch(ask);
}

export function useAppOverrideOwner(point: AppOverridePoint): string | undefined {
  return useSyncExternalStore(subscribeOwner, () => slot?.owner(point));
}

export function altHeldAtLastPress(): boolean {
  return altAtLastPress;
}

function subscribeOwner(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}

function notifyOwners(): void {
  for (const listener of [...slotListeners]) {
    listener();
  }
}

function listenForPresses(): void {
  if (pressListening || typeof window === 'undefined') {
    return;
  }
  pressListening = true;
  const note = (event: MouseEvent): void => {
    altAtLastPress = event.altKey;
  };
  window.addEventListener('pointerdown', note, { capture: true });
  window.addEventListener('mousedown', note, { capture: true });
  assert(pressListening, 'Presses are heard once per window');
}
