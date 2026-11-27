
import { useSyncExternalStore } from 'react';
import { parseIpcPayload } from '../../../../shared/ipc/ipcPayloads';
import { parsePreferences } from '../../../../shared/ipc/preferences';

export type CodeChipsMode = 'shown' | 'plain';

let mode: CodeChipsMode = 'shown';
let loadStarted = false;
const listeners = new Set<() => void>();

export function codeChipsModeOf({ enabled }: { readonly enabled: boolean }): CodeChipsMode {
  return enabled ? 'shown' : 'plain';
}

export function publishCodeChipsMode(next: CodeChipsMode): void {
  if (next === mode) {
    return;
  }
  mode = next;
  for (const listener of listeners) {
    listener();
  }
}

export function currentCodeChipsMode(): CodeChipsMode {
  return mode;
}

export function subscribeCodeChipsMode(listener: () => void): () => void {
  listeners.add(listener);
  loadCodeChipsModeOnce();
  return () => {
    listeners.delete(listener);
  };
}

export function useCodeChipsMode(): CodeChipsMode {
  return useSyncExternalStore(subscribeCodeChipsMode, currentCodeChipsMode, currentCodeChipsMode);
}

function loadCodeChipsModeOnce(): void {
  if (loadStarted) {
    return;
  }
  loadStarted = true;
  if (typeof window === 'undefined') {
    return;
  }
  if (typeof window.avb?.settings !== 'function') {
    return;
  }
  void window.avb.settings(parseIpcPayload('settings:get', undefined)).then(
    (reply: unknown) => publishCodeChipsMode(codeChipsModeOf({ enabled: parsePreferences(reply).codeChips })),
    (error: unknown) => console.error('Reading the CSS chips preference failed', error),
  );
}
