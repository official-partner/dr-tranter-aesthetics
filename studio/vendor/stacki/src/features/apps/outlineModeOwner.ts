import { assert } from '../../../shared/core/assert';
import type { AppEditOutcome, AppEventData, AppEventName, AppOutlineMode, AppOutlineReason } from '../../../shared/properties/appsRpc';

export interface OutlineModeDeps {
  readonly emit: <E extends AppEventName>(appId: string, event: E, data: AppEventData[E]) => number;
  readonly running: (appId: string) => boolean;
  readonly apply: (mode: AppOutlineMode) => void;
}

export interface OutlineModeOwner {
  readonly set: (appId: string, mode: AppOutlineMode) => AppEditOutcome;
  readonly owner: () => string | undefined;
  readonly reset: (reason: Exclude<AppOutlineReason, 'app' | 'restored'>) => boolean;
  readonly restore: (appId: string) => boolean;
  readonly shown: (appId: string) => void;
  readonly changed: () => void;
}

export function createOutlineModeOwner(deps: OutlineModeDeps): OutlineModeOwner {
  let owner: string | undefined;
  const requested = new Set<string>();
  const release = (): string | undefined => {
    const previous = owner;
    owner = undefined;
    deps.apply('normal');
    return previous;
  };
  const reset = (reason: Exclude<AppOutlineReason, 'app' | 'restored'>): boolean => {
    if (reason === 'project') {
      requested.clear();
    }
    if (owner === undefined) {
      return false;
    }
    const previous = release();
    assert(previous !== undefined, 'A reset releases the owner it had');
    deps.emit(previous, 'canvas.outline', { mode: 'normal', reason });
    return true;
  };
  return {
    set: (appId, mode) => {
      if (mode === 'normal') {
        requested.delete(appId);
        if (owner === appId) {
          release();
          deps.emit(appId, 'canvas.outline', { mode: 'normal', reason: 'app' });
        }
        assert(owner !== appId, 'An app that sets normal holds no deep mode');
        return { applied: true };
      }
      if (!deps.running(appId)) {
        return { applied: false, reason: 'Only a running app sets the outline mode' };
      }
      if (owner !== undefined && owner !== appId) {
        reset('replaced');
      }
      owner = appId;
      requested.add(appId);
      deps.apply('deep');
      deps.emit(appId, 'canvas.outline', { mode: 'deep', reason: 'app' });
      assert(owner === appId, 'The latest app to set deep mode owns it');
      return { applied: true };
    },
    owner: () => owner,
    reset,
    restore: (appId) => {
      if (owner === appId || !requested.has(appId) || !deps.running(appId)) {
        return false;
      }
      if (owner !== undefined) {
        reset('replaced');
      }
      owner = appId;
      deps.apply('deep');
      deps.emit(appId, 'canvas.outline', { mode: 'deep', reason: 'restored' });
      assert(requested.has(appId), 'Only a requested mode is restored');
      return true;
    },
    shown: (appId) => {
      if (owner !== undefined && owner !== appId) {
        reset('replaced');
      }
    },
    changed: () => {
      for (const appId of [...requested]) {
        if (!deps.running(appId)) {
          requested.delete(appId);
        }
      }
      if (owner !== undefined && !deps.running(owner)) {
        release();
      }
    },
  };
}
