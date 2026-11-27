import { createPanelCache, prewarmPanelCache } from '../../lib/usePanelData';
import { readCSSVariables, type VariablesSnapshot } from '../../ipc/variablesBridge';

export const variableCache = createPanelCache<VariablesSnapshot>();

export function prewarmVariables(projectPath: string): Promise<void> {
  return prewarmPanelCache(variableCache, projectPath, () => readCSSVariables(projectPath));
}
