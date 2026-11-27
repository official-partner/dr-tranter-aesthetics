import { readMetadata } from './projectMetadataBridge';
import { configOf, readProjectFoldersSource, type ProjectFolders } from '../../shared/properties/projectFolders';

const UNKNOWN_KIND = 'Unknown project metadata file';

export function isUnknownKind(failure: unknown): boolean {
  return failure instanceof Error && failure.message.includes(UNKNOWN_KIND);
}

export async function readProjectFolderSettings(projectPath: string): Promise<ProjectFolders | undefined> {
  try {
    const file = await readMetadata(projectPath, 'folders');
    return configOf(readProjectFoldersSource(file.source));
  } catch (failure: unknown) {
    if (isUnknownKind(failure)) {
      return undefined;
    }
    throw failure;
  }
}
