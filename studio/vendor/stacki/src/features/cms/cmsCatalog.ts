import type { Result } from '../../../shared/core/result';
import { assert } from '../../../shared/core/assert';
import { createPanelCache, prewarmPanelCache } from '../../lib/usePanelData';
import { readCmsFiles, readContentCollections, type CmsPanelContent, type CmsPanelFile } from './cmsPanelBridge';
import { readProjectFolderSettings } from '../../ipc/projectFolderSettings';
import { shownCollections, type ProjectFolders } from '../../../shared/properties/projectFolders';
import { listCmsConnections } from '../../ipc/cmsConnectionsBridge';
import type { CmsConnection } from '../../../shared/properties/cmsConnections';

export interface CmsCatalog {
  readonly files: readonly CmsPanelFile[];
  readonly content: CmsPanelContent;
}

export const cmsCache = createPanelCache<CmsCatalog>();

export const keptCmsConnections = createPanelCache<readonly CmsConnection[]>();

export function prewarmCmsCatalog(projectPath: string): Promise<void> {
  return prewarmPanelCache(cmsCache, projectPath, () => readCmsCatalog(projectPath));
}

export async function prewarmCmsConnections(projectPath: string): Promise<void> {
  assert(projectPath.length > 0, 'prewarmCmsConnections: a project is open');
  if (keptCmsConnections.get(projectPath) !== undefined) {
    return;
  }
  const list = await listCmsConnections(projectPath);
  if (keptCmsConnections.get(projectPath) === undefined) {
    keptCmsConnections.set(projectPath, list.connections);
  }
}

async function readCmsFolderSettings(projectPath: string): Promise<ProjectFolders | undefined> {
  try {
    return await readProjectFolderSettings(projectPath);
  } catch {
    return undefined;
  }
}
export async function readCmsCatalog(projectPath: string): Promise<Result<CmsCatalog, string>> {
  const [files, content, folders] = await Promise.all([readCmsFiles(projectPath), readContentCollections(projectPath), readCmsFolderSettings(projectPath)]);
  if (!files.ok) {
    return files;
  }
  if (!content.ok) {
    return content;
  }
  const collections = shownCollections(content.value.collections, folders);
  return { ok: true, value: { files: files.value, content: { ...content.value, collections } } };
}
