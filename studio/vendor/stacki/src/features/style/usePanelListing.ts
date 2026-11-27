import { useEffect, useMemo, useState } from 'react';
import { readCSSVariables, type VariablesSnapshot } from '../../ipc/variablesBridge';
import { getHost } from './model/host';
import { panelListing, type PanelListing } from './model/panelVariableList';
import type { ProjectVariable } from './model/webflow';


let last: { readonly projectPath: string; readonly snapshot: VariablesSnapshot } | undefined = undefined;

export function usePanelListing(active: { readonly active: boolean }, self: string | undefined, known: readonly ProjectVariable[]): PanelListing | undefined {
  const projectPath = getHost().projectPath ?? '';
  const [snapshot, setSnapshot] = useState<VariablesSnapshot | undefined>(() => cachedSnapshot(projectPath));
  const enabled = active.active && projectPath !== '';
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let live = true;
    setSnapshot(cachedSnapshot(projectPath));
    void readCSSVariables(projectPath).then((result) => {
      if (live && result.ok) {
        last = { projectPath, snapshot: result.value };
        setSnapshot(result.value);
      }
    });
    return () => {
      live = false;
    };
  }, [enabled, projectPath]);
  return useMemo(() => (enabled && snapshot !== undefined ? panelListing(snapshot, { self, known }) : undefined), [enabled, snapshot, self, known]);
}

function cachedSnapshot(projectPath: string): VariablesSnapshot | undefined {
  if (projectPath === '') {
    return undefined;
  }
  return last?.projectPath === projectPath ? last.snapshot : undefined;
}
