import { createPanelCache, prewarmPanelCache } from '../../lib/usePanelData';
import { readAssetListing, type AssetPanelEntry } from './assetPanelBridge';

export interface AssetListing {
  readonly entries: readonly AssetPanelEntry[];
  readonly missing: boolean;
}

export const assetCache = createPanelCache<AssetListing>();

export function prewarmAssetListing(projectPath: string): Promise<void> {
  return prewarmPanelCache(assetCache, projectPath, () => readAssetListing(projectPath));
}
