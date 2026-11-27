import { useSyncExternalStore } from 'react';
import { assert } from '../../../../shared/core/assert';
import { requestAppMarketplace } from '../appsDirectory';

let focus: string | undefined;
const listeners = new Set<() => void>();

function publish(next: string | undefined): void {
  focus = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function requestMarketplaceApp(appId: string | undefined): void {
  assert(appId === undefined || appId.length > 0, 'A marketplace app to show has an id');
  publish(appId);
  requestAppMarketplace();
}

export function useMarketplaceFocus(): { readonly appId: string | undefined; readonly shown: () => void } {
  const appId = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => focus,
  );
  return { appId, shown: () => publish(undefined) };
}
