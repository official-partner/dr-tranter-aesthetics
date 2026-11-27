import { assert } from '../../../shared/core/assert';


export type InsertFolderKey = 'root' | `folder:${string}`;

export const insertFolderNameCharsMax = 256;

export const insertFoldersMax = 200;

export function insertFolderOf(folder: string): InsertFolderKey {
  const top =
    folder
      .replaceAll('\\', '/')
      .split('/')
      .find((segment) => segment !== '') ?? '';
  if (top === '') {
    return 'root';
  }
  assert(top.length <= insertFolderNameCharsMax, 'insertFolders: a folder name is bounded');
  return `folder:${top}`;
}

export function insertFolderLabel(key: InsertFolderKey): string {
  if (key === 'root') {
    return 'components';
  }
  const name = key.slice('folder:'.length);
  assert(name.length > 0, 'insertFolders: a folder key names a folder');
  return name;
}

export function insertFolderKeys(folders: Iterable<InsertFolderKey>): readonly InsertFolderKey[] {
  const unique = new Set(folders);
  const named = [...unique].filter((key) => key !== 'root').sort((left, right) => left.localeCompare(right));
  const keys: InsertFolderKey[] = [...(unique.has('root') ? ['root' as const] : []), ...named];
  assert(keys.length === unique.size, 'insertFolders: every folder is listed once');
  return keys.slice(0, insertFoldersMax);
}

export function parseInsertFolderKey(raw: unknown): InsertFolderKey | undefined {
  if (raw === 'root') {
    return raw;
  }
  if (typeof raw !== 'string' || !raw.startsWith('folder:')) {
    return undefined;
  }
  const name = raw.slice('folder:'.length);
  if (name.length === 0) {
    return undefined;
  }
  if (name.length > insertFolderNameCharsMax) {
    return undefined;
  }
  if (name.includes('/')) {
    return undefined;
  }
  return `folder:${name}`;
}
