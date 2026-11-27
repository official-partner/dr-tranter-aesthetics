
import { useEffect, useRef, useState } from 'react';
import { parseImportant } from './styleDisplay';

const LIVE_DELAY_MS = 100;

export function useExternalDraft(external: string) {
  const [draft, setDraft] = useState(external);
  const focused = useRef(false);
  followWhileRendering(useState(external), external, () => {
    if (!focused.current) {
      setDraft(external);
    }
  });
  return { draft, setDraft, focused };
}

export function followWhileRendering<T>(seen: readonly [T, (next: T) => void], value: T, onChange: () => void): void {
  const [seenValue, setSeenValue] = seen;
  if (Object.is(seenValue, value)) {
    return;
  }
  setSeenValue(value);
  onChange();
}

export function useDebouncedLive(write: (value: string, important: boolean) => void) {
  const liveTimer = useRef<number | undefined>(undefined);
  const cancelLive = () => {
    if (liveTimer.current !== undefined) {
      window.clearTimeout(liveTimer.current);
      liveTimer.current = undefined;
    }
  };
  useEffect(() => cancelLive, []);
  const liveNow = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const parsed = parseImportant(trimmed);
    write(parsed.value, parsed.important);
  };
  const scheduleLive = (text: string) => {
    cancelLive();
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined;
      liveNow(text);
    }, LIVE_DELAY_MS);
  };
  return { cancelLive, liveNow, scheduleLive };
}

export function useCustomFocus({ customMode, busy }: { customMode: boolean; busy: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wantFocus = useRef(false);
  useEffect(() => {
    if (customMode && wantFocus.current && !busy) {
      wantFocus.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [customMode, busy]);
  return {
    inputRef,
    requestFocus: () => {
      wantFocus.current = true;
    },
  };
}

export function openAfterRemoval(open: number | undefined, removed: number): number | undefined {
  if (open === undefined) {
    return undefined;
  }
  if (open === removed) {
    return undefined;
  }
  return open > removed ? open - 1 : open;
}
