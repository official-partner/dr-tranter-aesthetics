import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Result } from '../../shared/core/result';
import { hiddenVariablesStore, type HiddenVariablesState } from './hiddenVariables';

export interface HiddenVariables {
  readonly hidden: ReadonlySet<string>;
  readonly state: HiddenVariablesState;
  readonly isHidden: (name: string) => boolean;
  readonly hide: (name: string) => Promise<Result<void>>;
  readonly show: (name: string) => Promise<Result<void>>;
}

const NOTHING_HIDDEN: ReadonlySet<string> = new Set();
const NO_PROJECT: HiddenVariablesState = { kind: 'loading', hidden: NOTHING_HIDDEN };
const IGNORE_CHANGES = (): (() => void) => () => undefined;
const NO_PROJECT_STATE = (): HiddenVariablesState => NO_PROJECT;

export function useHiddenVariables(projectPath: string | undefined): HiddenVariables {
  const store = projectPath === undefined || projectPath.length === 0 ? undefined : hiddenVariablesStore(projectPath);
  const state = useSyncExternalStore(store === undefined ? IGNORE_CHANGES : store.subscribe, store === undefined ? NO_PROJECT_STATE : store.getState);
  useEffect(() => store?.retain(), [store]);
  const isHidden = useCallback((name: string) => state.hidden.has(name), [state]);
  const hide = useCallback((name: string) => requireStore(store).hide(name), [store]);
  const show = useCallback((name: string) => requireStore(store).show(name), [store]);
  return { hidden: state.hidden, state, isHidden, hide, show };
}

function requireStore(store: ReturnType<typeof hiddenVariablesStore> | undefined): ReturnType<typeof hiddenVariablesStore> {
  if (store === undefined) {
    throw new Error('useHiddenVariables: no project is open, so nothing can be hidden');
  }
  return store;
}
