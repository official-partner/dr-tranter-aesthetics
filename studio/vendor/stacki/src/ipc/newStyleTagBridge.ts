
import type { NewStyleLocations } from '../../shared/properties/newStyleLocations';
import {
  EMPTY_KEEP_LIST,
  effectiveNewStyleLocations,
  parseStyleKeepList,
  serializeStyleKeepList,
  type StyleKeepList,
} from '../../shared/properties/styleKeepList';
import { readMetadata, writeMetadata } from './projectMetadataBridge';

interface Stored {
  readonly keepList: StyleKeepList;
  readonly source: string | undefined;
}

async function readStored(projectPath: string): Promise<Stored> {
  const stored = await readMetadata(projectPath, 'styles');
  if (stored.source === undefined) {
    return { keepList: EMPTY_KEEP_LIST, source: undefined };
  }
  const input: unknown = JSON.parse(stored.source);
  return { keepList: parseStyleKeepList(input), source: stored.source };
}

export async function readNewStyleLocations(projectPath: string): Promise<NewStyleLocations> {
  const stored = await readStored(projectPath);
  return effectiveNewStyleLocations(stored.keepList);
}

export async function writeNewStyleLocations(projectPath: string, locations: NewStyleLocations): Promise<NewStyleLocations> {
  const stored = await readStored(projectPath);
  const source = serializeStyleKeepList({ ...stored.keepList, newStyleLocations: locations });
  await writeMetadata(projectPath, stored.source === undefined ? { kind: 'styles', source } : { kind: 'styles', source, base: stored.source });
  return locations;
}
