import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';
import { parseOptionalMessageRef, type MessageRef } from '../core/i18n/messageReference';
import { APP_LIMITS, appsFailure, parseAppSummary, type AppSummary } from './apps';

export const APP_FOLDER_LIMITS = {
  entriesMax: APP_LIMITS.appsMax * 4,
  folderCharsMax: 255,
  settleMs: 500,
  pollMs: 1000,
  stampCharsMax: 64,
} as const satisfies Record<string, number>;

export interface AppFolderBroken {
  readonly folder: string;
  readonly message: string;
  readonly messageRef?: MessageRef | undefined;
}

export interface AppFoldersChange {
  readonly folders: readonly string[];
}

export interface AppFolderStamps {
  readonly folders: Readonly<Record<string, string>>;
  readonly files: string;
}

export function parseAppFolderName(input: unknown): string {
  const folder = text(input);
  if (folder.length === 0 || folder.length > APP_FOLDER_LIMITS.folderCharsMax) {
    throw new Error(`An app folder name is 1 to ${APP_FOLDER_LIMITS.folderCharsMax} characters`);
  }
  if (folder.startsWith('.') || /[\\/\0]/.test(folder)) {
    throw new Error('An app folder name is one visible path segment');
  }
  assert(folder !== '..', 'A folder name never climbs');
  return folder;
}

export function parseAppFolderBroken(input: unknown): AppFolderBroken {
  const value = record(input);
  const message = text(value['message']).trim();
  if (message.length === 0 || message.length > APP_LIMITS.messageCharsMax) {
    throw new Error(`A broken row's reason is 1 to ${APP_LIMITS.messageCharsMax} characters`);
  }
  const messageRef = parseOptionalMessageRef(value['messageRef']);
  return { folder: parseAppFolderName(value['folder']), message, ...(messageRef === undefined ? {} : { messageRef }) };
}

export function parseAppFoldersBroken(input: unknown): readonly AppFolderBroken[] {
  const items = toArray(input);
  if (items === undefined || items.length > APP_FOLDER_LIMITS.entriesMax) {
    throw new Error('Expected a bounded list of broken app folders');
  }
  return items.map(parseAppFolderBroken);
}

export interface InstalledAppList {
  readonly apps: readonly AppSummary[];
  readonly broken: readonly AppFolderBroken[];
}

export function parseInstalledAppList(input: unknown): InstalledAppList {
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('Expected a list of apps');
  }
  if (items.length > APP_LIMITS.appsMax) {
    throw new Error('Too many apps');
  }
  const apps: AppSummary[] = [];
  const broken: AppFolderBroken[] = [];
  for (const [index, item] of items.entries()) {
    try {
      apps.push(parseAppSummary(item));
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Assertion failed')) {
        throw error;
      }
      broken.push({ folder: summaryFolder(item, index), ...appsFailure(error) });
    }
  }
  assert(apps.length + broken.length === items.length, 'Every listed app is one row');
  assert(apps.length <= APP_LIMITS.appsMax, 'Listed apps are bounded by the app bound');
  return { apps, broken };
}

export function parseReadableAppSummaries(input: unknown): readonly AppSummary[] {
  return parseInstalledAppList(input).apps;
}

export function joinBrokenRows(folders: readonly AppFolderBroken[], unreadable: readonly AppFolderBroken[]): readonly AppFolderBroken[] {
  const named = new Set(folders.map((row) => row.folder));
  const rows = [...folders, ...unreadable.filter((row) => !named.has(row.folder))];
  assert(rows.length >= folders.length, 'Joining never drops a broken folder');
  assert(rows.length <= folders.length + unreadable.length, 'Joining adds each unreadable app at most once');
  return rows;
}

function summaryFolder(item: unknown, index: number): string {
  const fallback = `app-${index + 1}`;
  if (typeof item !== 'object' || item === null) {
    return fallback;
  }
  const manifest: unknown = Reflect.get(item, 'manifest');
  if (typeof manifest !== 'object' || manifest === null) {
    return fallback;
  }
  try {
    return parseAppFolderName(Reflect.get(manifest, 'id'));
  } catch {
    return fallback;
  }
}

export function parseAppFoldersChange(input: unknown): AppFoldersChange {
  const items = toArray(record(input)['folders']);
  if (items === undefined || items.length > APP_FOLDER_LIMITS.entriesMax) {
    throw new Error('Expected a bounded list of changed app folders');
  }
  return { folders: items.map(parseAppFolderName) };
}

export function parseAppFolderStamps(input: unknown): AppFolderStamps {
  const value = record(input);
  const folders = record(value['folders']);
  const entries = Object.entries(folders);
  if (entries.length > APP_FOLDER_LIMITS.entriesMax) {
    throw new Error('Expected a bounded set of app folder stamps');
  }
  const parsed: Record<string, string> = {};
  for (const [folder, stamp] of entries) {
    parsed[parseAppFolderName(folder)] = parseStamp(stamp);
  }
  return { folders: parsed, files: parseStamp(value['files']) };
}

function parseStamp(input: unknown): string {
  const stamp = text(input);
  if (stamp.length > APP_FOLDER_LIMITS.stampCharsMax || !/^[0-9a-f]*$/.test(stamp)) {
    throw new Error('An app folder stamp is a short hex digest');
  }
  return stamp;
}

export function changedAppFolders(before: AppFolderStamps, after: AppFolderStamps): { readonly folders: readonly string[]; readonly any: boolean } {
  const names = new Set([...Object.keys(before.folders), ...Object.keys(after.folders)]);
  assert(names.size <= APP_FOLDER_LIMITS.entriesMax * 2, 'Two bounded readings name a bounded set of folders');
  const folders = [...names].filter((name) => before.folders[name] !== after.folders[name]).sort();
  const any = folders.length > 0 || before.files !== after.files;
  assert(folders.length <= names.size, 'Only folders either reading named can have changed');
  return { folders, any };
}
