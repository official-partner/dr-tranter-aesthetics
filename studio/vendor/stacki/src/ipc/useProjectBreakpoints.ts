import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Result } from '../../shared/core/result';
import {
  BREAKPOINT_DEFAULT_CONFIG,
  desktopFramePx,
  resolveBreakpoints,
  type BreakpointConfig,
  type BreakpointList,
  type ResolvedBreakpoint,
} from '../../shared/properties/projectBreakpoints';
import { breakpointsStore, type BreakpointsState } from './projectBreakpoints';

export interface ProjectBreakpoints {
  readonly config: BreakpointConfig;
  readonly list: BreakpointList;
  readonly desktopFramePx: number;
  readonly resolved: readonly ResolvedBreakpoint[];
  readonly state: BreakpointsState;
  readonly save: (config: BreakpointConfig) => Promise<Result<void>>;
}

const NO_PROJECT: BreakpointsState = {
  kind: 'loading',
  config: BREAKPOINT_DEFAULT_CONFIG,
  list: BREAKPOINT_DEFAULT_CONFIG.list,
  resolved: resolveBreakpoints(BREAKPOINT_DEFAULT_CONFIG.list),
};
const IGNORE_CHANGES = (): (() => void) => () => undefined;
const NO_PROJECT_STATE = (): BreakpointsState => NO_PROJECT;

export function useProjectBreakpoints(projectPath: string | undefined): ProjectBreakpoints {
  const store = projectPath === undefined || projectPath.length === 0 ? undefined : breakpointsStore(projectPath);
  const state = useSyncExternalStore(store === undefined ? IGNORE_CHANGES : store.subscribe, store === undefined ? NO_PROJECT_STATE : store.getState);
  useEffect(() => store?.retain(), [store]);
  const save = useCallback(
    (config: BreakpointConfig): Promise<Result<void>> => {
      if (store === undefined) {
        throw new Error('useProjectBreakpoints: no project is open, so nothing can be saved');
      }
      return store.save(config);
    },
    [store],
  );
  return { config: state.config, list: state.list, desktopFramePx: desktopFramePx(state.config.desktop), resolved: state.resolved, state, save };
}
