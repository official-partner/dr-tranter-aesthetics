
import { useEffect, useState } from 'react';

export const GROUPED_STORAGE_KEY = 'stacki.variablePicker.grouped';

export const GROUPED_DEFAULT = true;

export interface PickerStorage {
  getItem(key: string): string | undefined;
  setItem(key: string, value: string): void;
}

export function parseGrouped(raw: string | undefined): boolean | undefined {
  if (raw === '1') {
    return true;
  }
  if (raw === '0') {
    return false;
  }
  return undefined;
}

function defaultStorage(): PickerStorage | undefined {
  try {
    if (typeof localStorage === 'undefined') {
      return undefined;
    }
    const platform = localStorage;
    return { getItem: (key) => platform.getItem(key) ?? undefined, setItem: (key, value) => platform.setItem(key, value) };
  } catch {
    return undefined;
  }
}

export function readGrouped(storage: PickerStorage | undefined = defaultStorage()): boolean {
  if (storage === undefined) {
    return GROUPED_DEFAULT;
  }
  try {
    return parseGrouped(storage.getItem(GROUPED_STORAGE_KEY)) ?? GROUPED_DEFAULT;
  } catch {
    return GROUPED_DEFAULT;
  }
}

export function writeGrouped({ grouped, storage = defaultStorage() }: { readonly grouped: boolean; readonly storage?: PickerStorage | undefined }): void {
  if (storage === undefined) {
    return;
  }
  try {
    storage.setItem(GROUPED_STORAGE_KEY, grouped ? '1' : '0');
  } catch {
  }
}

export function useGrouped(): readonly [boolean, (change: { readonly grouped: boolean }) => void] {
  const [grouped, setGrouped] = useState(() => readGrouped());
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === GROUPED_STORAGE_KEY) {
        setGrouped(parseGrouped(event.newValue ?? undefined) ?? GROUPED_DEFAULT);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const set = (change: { readonly grouped: boolean }): void => {
    setGrouped(change.grouped);
    writeGrouped(change);
  };
  return [grouped, set];
}
