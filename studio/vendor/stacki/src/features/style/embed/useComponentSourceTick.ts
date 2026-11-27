
import { useEffect, useSyncExternalStore } from 'react';
import { assert } from '../../../../shared/core/assert';
import { onVariablesChanged } from '../../../ipc/editorEnvironment';
import { componentSourceVersion, forgetComponentSources, onComponentSourceChange } from '../model/componentSourceCache';

export function useComponentSourceTick(): number {
  useEffect(() => onVariablesChanged(() => forgetComponentSources([])), []);
  const version = useSyncExternalStore(onComponentSourceChange, componentSourceVersion);
  assert(Number.isSafeInteger(version), 'useComponentSourceTick: the version is an integer');
  return version;
}
