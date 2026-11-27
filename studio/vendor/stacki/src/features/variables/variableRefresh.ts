import type { Result } from '../../../shared/core/result';
import type { VariablesSnapshot } from '../../ipc/variablesBridge';
import { assert } from '../../../shared/core/assert';
import { createCoalescedRun } from '../../lib/coalescedRun';
import { readCSSVariables } from '../../ipc/variablesBridge';

type RefreshState = { readonly kind: 'open' | 'disposed' };

export function createVariableRefresh(projectPath: string, publish: (result: Result<VariablesSnapshot, string>) => void) {
  let state: RefreshState = { kind: 'open' };
  const disposed = (): boolean => state.kind === 'disposed';
  const read = async (): Promise<void> => {
    if (disposed()) {
      return;
    }
    const result = await readCSSVariables(projectPath);
    if (disposed()) {
      return;
    }
    publish(result);
  };
  const reads = createCoalescedRun(read);
  const refresh = (): Promise<void> => {
    if (state.kind === 'disposed') {
      return Promise.resolve();
    }
    assert(state.kind === 'open', 'Variable refresh: an open coordinator reads');
    return reads.request();
  };
  const dispose = () => {
    state = { kind: 'disposed' };
  };
  return { refresh, dispose };
}
