import { assert } from '../../../shared/core/assert';
import type { AppFolderBroken, InstalledAppList } from '../../../shared/properties/appFolders';
import { listInstalledAppList } from '../../ipc/appsBridge';
import { listBrokenAppFolders } from '../../ipc/appFoldersBridge';
import { createPanelCache } from '../../lib/usePanelData';

export interface KeptInstalledApps {
  readonly list: InstalledAppList;
  readonly brokenFolders: readonly AppFolderBroken[];
}

export const installedAppsCache = createPanelCache<KeptInstalledApps>();

export async function prewarmInstalledApps(projectPath: string): Promise<void> {
  assert(projectPath.length > 0, 'prewarmInstalledApps: a project is open');
  if (installedAppsCache.get(projectPath) !== undefined) {
    return;
  }
  const [answer, folders] = await Promise.all([
    listInstalledAppList(projectPath),
    listBrokenAppFolders(projectPath).catch(() => undefined),
  ]);
  if (!answer.ok) {
    return;
  }
  if (installedAppsCache.get(projectPath) === undefined) {
    installedAppsCache.set(projectPath, { list: answer.value, brokenFolders: folders?.ok === true ? folders.value : [] });
  }
}
