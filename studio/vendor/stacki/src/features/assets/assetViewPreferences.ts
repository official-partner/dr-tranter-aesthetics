import { useCallback, useState } from 'react';
import {
  loadProjectPreference,
  parseStoredPreferences,
  saveProjectPreference,
  type PreferenceStorage,
  type ProjectPreferenceSpec,
} from '../../lib/projectPreference';
import { ASSET_SORT_DEFAULT, ASSET_VIEW_DEFAULT, isAssetSort, isAssetView, type AssetSort, type AssetView } from './assetOrder';

export const ASSET_VIEWS_KEY = 'stacki.assetsPanel.views';

export const ASSET_VIEW_PROJECTS_MAX = 50;

export interface AssetViewChoice {
  readonly view: AssetView;
  readonly sort: AssetSort;
}

export const ASSET_VIEW_CHOICE_DEFAULT: AssetViewChoice = { view: ASSET_VIEW_DEFAULT, sort: ASSET_SORT_DEFAULT };

export type StoredAssetViews = ReadonlyArray<readonly [string, AssetViewChoice]>;

type ViewStorage = PreferenceStorage;

function parseChoice(stored: unknown): AssetViewChoice | undefined {
  if (typeof stored !== 'object' || stored === null) {
    return undefined;
  }
  const view: unknown = Reflect.get(stored, 'view');
  const sort: unknown = Reflect.get(stored, 'sort');
  return isAssetView(view) && isAssetSort(sort) ? { view, sort } : undefined;
}

const SPEC: ProjectPreferenceSpec<AssetViewChoice> = { storageKey: ASSET_VIEWS_KEY, projectsMax: ASSET_VIEW_PROJECTS_MAX, parseValue: parseChoice };

export function parseStoredAssetViews(raw: unknown): StoredAssetViews {
  return parseStoredPreferences(raw, SPEC);
}

export function loadAssetViewChoice(project: string, storage?: ViewStorage): AssetViewChoice {
  return loadProjectPreference(SPEC, project, storage) ?? ASSET_VIEW_CHOICE_DEFAULT;
}

export function saveAssetViewChoice(project: string, choice: AssetViewChoice, storage?: ViewStorage): void {
  saveProjectPreference(SPEC, project, choice, storage);
}

export function useAssetViewChoice(project: string): readonly [AssetViewChoice, (next: AssetViewChoice) => void] {
  const [choice, setChoice] = useState(() => loadAssetViewChoice(project));
  const choose = useCallback(
    (next: AssetViewChoice): void => {
      setChoice(next);
      saveAssetViewChoice(project, next);
    },
    [project],
  );
  return [choice, choose];
}
