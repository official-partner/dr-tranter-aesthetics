import { useSyncExternalStore } from 'react';

export interface UnlinkOffer {
  readonly label: string;
  readonly unlink: (nodeId: string) => void;
}

let offer: UnlinkOffer | undefined = undefined;
const listeners = new Set<() => void>();
const LISTENERS_MAX = 20;

export function setUnlinkMenu(next: UnlinkOffer | undefined): void {
  offer = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size >= LISTENERS_MAX) {
    throw new Error('Assertion failed: unlinkMenu: listeners are bounded');
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const currentUnlinkMenu = (): UnlinkOffer | undefined => offer;

export function useUnlinkMenu(): UnlinkOffer | undefined {
  return useSyncExternalStore(subscribe, currentUnlinkMenu, currentUnlinkMenu);
}
