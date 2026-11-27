import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import { APP_FOLDER_LIMITS } from '../../../shared/properties/appFolders';

const revisions = new Map<string, number>();
const listeners = new Set<() => void>();

export function bumpAppFileRevisions(appIds: readonly string[]): void {
  assert(appIds.length <= APP_FOLDER_LIMITS.entriesMax * 2, 'A reload names a bounded set of apps');
  for (const id of appIds) {
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
  }
  if (revisions.size > APP_FOLDER_LIMITS.entriesMax * 4) {
    const oldest = revisions.keys().next().value;
    if (oldest !== undefined) {
      revisions.delete(oldest);
    }
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

export function useAppFileRevision(appId: string): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revisions.get(appId) ?? 0,
  );
}
