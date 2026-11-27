
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { assert } from '../../../../shared/core/assert';
import { getHost, onHostChange } from '../model/host';

export type FollowMode = 'follow' | 'pinned';

export const FOLLOW_STORAGE_PREFIX = 'stacki.styleContext:';

function forgetStored(projectKey: string | undefined): void {
  try {
    window.localStorage.removeItem(`${FOLLOW_STORAGE_PREFIX}${projectKey ?? ''}`);
  } catch {
  }
}

const modes = new Map<string, FollowMode>();
const listeners = new Set<() => void>();

let openProject: string | undefined;
let projectSeen = false;

function modeOf(projectKey: string | undefined): FollowMode {
  if (!projectSeen || openProject !== projectKey) {
    projectSeen = true;
    openProject = projectKey;
    modes.clear();
    forgetStored(projectKey);
  }
  return modes.get(projectKey ?? '') ?? 'follow';
}

function setModeOf(projectKey: string | undefined, mode: FollowMode): void {
  modeOf(projectKey);
  assert(modes.size <= 1, 'one project is open at a time, so at most one mode is held');
  modes.set(projectKey ?? '', mode);
  for (const listener of listeners) {
    listener();
  }
}

export function forgetFollowModes(): void {
  modes.clear();
  projectSeen = false;
  for (const listener of listeners) {
    listener();
  }
}

const subscribeModes = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useFollowMode(projectKey: string | undefined): readonly [FollowMode, (mode: FollowMode) => void] {
  const mode = useSyncExternalStore(subscribeModes, () => modeOf(projectKey));
  const setMode = useCallback((next: FollowMode) => setModeOf(projectKey, next), [projectKey]);
  return [mode, setMode] as const;
}

const subscribeHost = (listener: () => void): (() => void) => onHostChange(listener);
const readCanvasWidth = (): number | undefined => {
  const width = getHost().canvasWidthPx;
  assert(width === undefined || Number.isFinite(width), 'the canvas width is a number when it is known');
  return width;
};

export function useCanvasWidthPx(): number | undefined {
  return useSyncExternalStore(subscribeHost, readCanvasWidth);
}

const readCanvasDevice = (): string => {
  const device = getHost().device;
  assert(device.length > 0, 'the canvas device is named');
  return device;
};

export function useCanvasDevice(): string {
  return useSyncExternalStore(subscribeHost, readCanvasDevice);
}

const TOGGLE_HANDLERS_MAX = 16;
const toggleHandlers = new Set<(from: FollowMode) => void>();

export function useFollowToggleHandler(handler: (from: FollowMode) => void): void {
  useEffect(() => {
    toggleHandlers.add(handler);
    assert(toggleHandlers.size <= TOGGLE_HANDLERS_MAX, 'useFollowToggleHandler: one handler per mounted style panel');
    return () => {
      toggleHandlers.delete(handler);
    };
  }, [handler]);
}

export function toggleFollowMode(projectKey: string | undefined): boolean {
  if (readCanvasWidth() === undefined) {
    return false;
  }
  const from = modeOf(projectKey);
  if (toggleHandlers.size === 0) {
    setModeOf(projectKey, from === 'follow' ? 'pinned' : 'follow');
    return true;
  }
  flushSync(() => {
    for (const handler of [...toggleHandlers]) {
      handler(from);
    }
  });
  return true;
}

export function followRetargetKey(state: {
  readonly following: boolean;
  readonly settled: boolean;
  readonly matchedKey: string | undefined;
  readonly context: string;
  readonly pickPending?: boolean;
}): string | undefined {
  if (!state.following || !state.settled || state.matchedKey === undefined) {
    return undefined;
  }
  if (state.pickPending === true) {
    return undefined;
  }
  return state.matchedKey === state.context ? undefined : state.matchedKey;
}
