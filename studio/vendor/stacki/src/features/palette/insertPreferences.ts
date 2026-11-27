import type { InsertTab } from './insertGrid';
import { parseInsertFolderKey, type InsertFolderKey } from './insertFolders';

const INSERT_TAB_KEY = 'stacki.insertPalette.tab';

export const INSERT_TAB_DEFAULT: InsertTab = 'all';

const INSERT_TABS: readonly InsertTab[] = ['all', 'components', 'elements', 'other', 'apps'];

export function parseStoredInsertTab(raw: unknown): InsertTab {
  return INSERT_TABS.find((tab) => tab === raw) ?? INSERT_TAB_DEFAULT;
}

export function loadInsertTab(): InsertTab {
  try {
    return parseStoredInsertTab(localStorage.getItem(INSERT_TAB_KEY));
  } catch {
    return INSERT_TAB_DEFAULT;
  }
}

export function saveInsertTab(tab: InsertTab): void {
  try {
    localStorage.setItem(INSERT_TAB_KEY, tab);
  } catch {
  }
}

const INSERT_FOLDERS_KEY = 'stacki.insertPalette.folders';

export const insertFolderProjectsMax = 50;

const projectKeyCharsMax = 4096;

export type StoredInsertFolders = ReadonlyArray<readonly [string, InsertFolderKey]>;

export function parseStoredInsertFolders(raw: unknown): StoredInsertFolders {
  if (typeof raw !== 'string') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const stored: readonly unknown[] = parsed;
  const entries: Array<readonly [string, InsertFolderKey]> = [];
  for (const entry of stored.slice(0, insertFolderProjectsMax)) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      continue;
    }
    const pair: readonly unknown[] = entry;
    const project = pair[0];
    const folder = pair[1];
    const key = parseInsertFolderKey(folder);
    if (typeof project === 'string' && project.length > 0 && project.length <= projectKeyCharsMax && key !== undefined) {
      entries.push([project, key]);
    }
  }
  return entries;
}

export function loadInsertFolder(project: string | undefined): InsertFolderKey | undefined {
  if (project === undefined) {
    return undefined;
  }
  try {
    return parseStoredInsertFolders(localStorage.getItem(INSERT_FOLDERS_KEY)).find(([stored]) => stored === project)?.[1];
  } catch {
    return undefined;
  }
}

export function saveInsertFolder(project: string | undefined, folder: InsertFolderKey | undefined): void {
  if (project === undefined) {
    return;
  }
  try {
    const others = parseStoredInsertFolders(localStorage.getItem(INSERT_FOLDERS_KEY)).filter(([stored]) => stored !== project);
    const next = folder === undefined ? others : [[project, folder] as const, ...others];
    localStorage.setItem(INSERT_FOLDERS_KEY, JSON.stringify(next.slice(0, insertFolderProjectsMax)));
  } catch {
  }
}
