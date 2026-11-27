
import { assert } from '../../../shared/core/assert';
import { described } from '../../../shared/properties/i18n/messageRef';
import { remoteCollections, remoteDocument, remoteDocuments } from '../../ipc/remoteSource';
import type { RemoteCollection, RemoteDocument, RemoteDocumentList, RemoteReferenceOption, RemoteResult } from '../../../shared/properties/cmsRemote';

export interface RemoteCache<T> {
  readonly get: (key: string) => RemoteResult<T> | undefined;
  readonly set: (key: string, value: T) => void;
  readonly load: (key: string, read: () => Promise<RemoteResult<T>>) => Promise<RemoteResult<T>>;
  readonly prefetch: (key: string, read: () => Promise<RemoteResult<T>>) => void;
}

export function createRemoteCache<T>(entriesMax: number): RemoteCache<T> {
  assert(Number.isSafeInteger(entriesMax), 'A cache bound is a whole number');
  assert(entriesMax > 0, 'A cache keeps at least one entry');
  const entries = new Map<string, RemoteResult<T>>();
  const reading = new Map<string, Promise<RemoteResult<T>>>();
  const keep = (key: string, result: RemoteResult<T>) => {
    entries.delete(key);
    entries.set(key, result);
    const oldest = entries.size > entriesMax ? entries.keys().next().value : undefined;
    if (oldest !== undefined) {
      entries.delete(oldest);
    }
    assert(entries.size <= entriesMax, 'A remote cache stays within its bound');
  };
  const load = (key: string, read: () => Promise<RemoteResult<T>>) => {
    if (!online()) {
      const kept = entries.get(key);
      return Promise.resolve(kept?.ok ? kept : OFFLINE);
    }
    const inFlight = reading.get(key);
    if (inFlight) {
      return inFlight;
    }
    const request = read()
      .catch((error: unknown): RemoteResult<T> => ({ ok: false, message: String(error) }))
      .then((result) => {
        reading.delete(key);
        const kept = entries.get(key);
        if (result.ok || kept === undefined || !kept.ok) {
          keep(key, result);
          return result;
        }
        return kept;
      });
    reading.set(key, request);
    return request;
  };
  return {
    get: (key) => entries.get(key),
    set: (key, value) => keep(key, { ok: true, value }),
    load,
    prefetch: (key, read) => {
      if (!entries.has(key) && !reading.has(key)) {
        void load(key, read);
      }
    },
  };
}

const OFFLINE = { ok: false, ...described('cmsRemote.cache.offline') } as const;

export function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export const COLLECTIONS = createRemoteCache<readonly RemoteCollection[]>(16);
export const DOCUMENT_LISTS = createRemoteCache<RemoteDocumentList>(256);
export const DOCUMENTS = createRemoteCache<RemoteDocument>(512);
export const REFERENCE_OPTIONS = createRemoteCache<readonly RemoteReferenceOption[]>(64);

export const listKey = (connectionId: string, collection: string) => `${connectionId}:${collection}`;
export const documentKey = (connectionId: string, id: string) => `${connectionId}:${id}`;


export function prefetchConnection(projectPath: string, connectionId: string): void {
  if (!online()) {
    return;
  }
  void COLLECTIONS.load(connectionId, () => remoteCollections(projectPath, connectionId)).then((collections) => {
    for (const collection of collections.ok ? collections.value : []) {
      prefetchList(projectPath, connectionId, collection.name);
    }
  });
}

export function prefetchList(projectPath: string, connectionId: string, collection: string): void {
  const key = listKey(connectionId, collection);
  const read = () => remoteDocuments(projectPath, connectionId, collection);
  void DOCUMENT_LISTS.load(key, read).then((list) => {
    const only = list.ok && list.value.documents.length === 1 ? list.value.documents[0] : undefined;
    if (only) {
      prefetchDocument(projectPath, connectionId, only.id);
    }
  });
}

export function prefetchDocument(projectPath: string, connectionId: string, id: string): void {
  DOCUMENTS.prefetch(documentKey(connectionId, id), () => remoteDocument(projectPath, connectionId, id));
}
