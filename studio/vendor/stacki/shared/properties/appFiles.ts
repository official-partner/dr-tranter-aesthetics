import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';
import { APPS_DIRECTORY, parseAppId } from './apps';

export const APP_FILE_LIMITS = {
  pathCharsMax: 512,
  pathSegmentsMax: 32,
  writesPerMinuteMax: 120,
  writeBytesPerMinuteMax: 32 * 1024 * 1024,
  budgetWindowMs: 60_000,
  restorePathsMax: 40,
  undoSnapshotCharsMax: 4 * 1024 * 1024,
  budgetAppsMax: 50,
} as const satisfies Record<string, number>;

export const APP_FILE_ENCODINGS = ['utf8', 'base64'] as const;
export type AppFileEncoding = (typeof APP_FILE_ENCODINGS)[number];

export interface AppFileEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly sizeBytes: number;
}

export interface AppFileListing {
  readonly entries: readonly AppFileEntry[];
  readonly truncated: boolean;
}

export interface AppFileContent {
  readonly path: string;
  readonly encoding: AppFileEncoding;
  readonly content: string;
  readonly sizeBytes: number;
}

export type AppFileState =
  | { readonly path: string; readonly kind: 'absent' }
  | { readonly path: string; readonly kind: 'directory' }
  | { readonly path: string; readonly kind: 'file'; readonly base64: string };

export interface AppFileChange {
  readonly paths: readonly string[];
  readonly before: readonly AppFileState[];
  readonly after: readonly AppFileState[];
}

export type AppFileOperation =
  | { readonly kind: 'list'; readonly dir: string }
  | { readonly kind: 'read'; readonly path: string }
  | { readonly kind: 'write'; readonly path: string; readonly content: string; readonly encoding: AppFileEncoding }
  | { readonly kind: 'delete'; readonly path: string }
  | { readonly kind: 'move'; readonly from: string; readonly to: string }
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'restore'; readonly states: readonly AppFileState[] };

export type AppFileAnswer =
  | { readonly kind: 'listing'; readonly listing: AppFileListing }
  | { readonly kind: 'content'; readonly content: AppFileContent }
  | { readonly kind: 'changed'; readonly change: AppFileChange };


const SEGMENT_FORBIDDEN = /[\\\0:*?"<>|]/;

export function parseAppFilePath(input: unknown, appId: string | undefined, options: { readonly allowRoot: boolean }): string {
  const raw = text(input);
  const path = raw.replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (path === '' || path === '.') {
    if (options.allowRoot) {
      return '';
    }
    throw new Error('path names a file or folder in the project');
  }
  if (path.length > APP_FILE_LIMITS.pathCharsMax) {
    throw new Error(`path is at most ${APP_FILE_LIMITS.pathCharsMax} characters`);
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error('path is relative to the project, not absolute');
  }
  const segments = path.split('/');
  if (segments.length > APP_FILE_LIMITS.pathSegmentsMax) {
    throw new Error('path is nested too deeply');
  }
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error('path names a file without ., .. or empty segments');
    }
    if (SEGMENT_FORBIDDEN.test(segment) || /[\u0000-\u001f]/.test(segment)) {
      throw new Error(`"${segment.slice(0, 40)}" is not a file name an app may use`);
    }
  }
  const refusal = appFilePathRefusal(path, appId);
  if (refusal !== undefined) {
    throw new Error(refusal);
  }
  assert(!path.startsWith('/'), 'An app file path is relative');
  assert(!segments.includes('..'), 'An app file path never climbs');
  return path;
}

export function appFilePathRefusal(path: string, appId: string | undefined): string | undefined {
  const segments = path.split('/');
  if (segments.some((segment) => segment.toLowerCase() === '.git')) {
    return 'Apps cannot read or change Git’s own files (.git/)';
  }
  if (segments.some((segment) => segment === 'node_modules')) {
    return 'Apps cannot read or change installed packages (node_modules/)';
  }
  const name = segments[segments.length - 1] ?? '';
  if (/^\.env(?:\..*)?$/i.test(name)) {
    return 'Apps cannot read or change the project’s .env secrets; use app settings';
  }
  if (appId === undefined) {
    return undefined;
  }
  const id = parseAppId(appId);
  const appsPrefix = `${APPS_DIRECTORY}/`;
  if (path === APPS_DIRECTORY) {
    return 'Apps can reach only their own folder in .stacki/apps/';
  }
  if (path.startsWith(appsPrefix)) {
    const owner = path.slice(appsPrefix.length).split('/')[0];
    if (owner !== id) {
      return 'Apps can reach only their own folder in .stacki/apps/';
    }
  }
  const dataPrefix = '.stacki/app-data/';
  if (path.startsWith(dataPrefix) && path !== `${dataPrefix}${id}.json`) {
    return 'Apps cannot read or change another app’s stored data; use stacki.storage';
  }
  return undefined;
}


export function parseAppFileContent(content: unknown, encoding: unknown): { readonly content: string; readonly encoding: AppFileEncoding } {
  const parsedEncoding = encoding === undefined ? 'utf8' : APP_FILE_ENCODINGS.find((known) => known === encoding);
  if (parsedEncoding === undefined) {
    throw new Error('encoding is utf8 or base64');
  }
  const value = text(content);
  if (parsedEncoding === 'base64') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
      throw new Error('content is not base64');
    }
    return { content: value, encoding: 'base64' };
  }
  return { content: value, encoding: 'utf8' };
}

export function parseFilePathShape(input: unknown, options: { readonly allowRoot: boolean }): string {
  return parseAppFilePath(input, undefined, options);
}

export function parseAppFileOperation(input: unknown, appId: string): AppFileOperation {
  const value = record(input);
  switch (value['kind']) {
    case 'list':
      return { kind: 'list', dir: parseAppFilePath(value['dir'], appId, { allowRoot: true }) };
    case 'read':
      return { kind: 'read', path: parseAppFilePath(value['path'], appId, { allowRoot: false }) };
    case 'write':
      return { kind: 'write', path: parseAppFilePath(value['path'], appId, { allowRoot: false }), ...parseAppFileContent(value['content'], value['encoding']) };
    case 'delete':
      return { kind: 'delete', path: parseAppFilePath(value['path'], appId, { allowRoot: false }) };
    case 'move': {
      const from = parseAppFilePath(value['from'], appId, { allowRoot: false });
      const to = parseAppFilePath(value['to'], appId, { allowRoot: false });
      if (from === to) {
        throw new Error('from and to name the same path');
      }
      return { kind: 'move', from, to };
    }
    case 'mkdir':
      return { kind: 'mkdir', path: parseAppFilePath(value['path'], appId, { allowRoot: false }) };
    case 'restore': {
      const states = parseAppFileStates(value['states'], appId);
      if (states.length === 0) {
        throw new Error('An undo step restores at least one path');
      }
      return { kind: 'restore', states };
    }
    default:
      throw new Error('A file operation is list, read, write, delete, move, mkdir or restore');
  }
}

export function parseAppFileStates(input: unknown, appId: string): readonly AppFileState[] {
  const items = toArray(input);
  if (items === undefined || items.length > APP_FILE_LIMITS.restorePathsMax) {
    throw new Error(`A change names at most ${APP_FILE_LIMITS.restorePathsMax} paths`);
  }
  return items.map((item) => parseAppFileState(item, appId));
}

function parseAppFileState(input: unknown, appId: string): AppFileState {
  const value = record(input);
  const path = parseAppFilePath(value['path'], appId, { allowRoot: false });
  switch (value['kind']) {
    case 'absent':
      return { path, kind: 'absent' };
    case 'directory':
      return { path, kind: 'directory' };
    case 'file':
      return { path, kind: 'file', base64: parseAppFileContent(value['base64'], 'base64').content };
    default:
      throw new Error('A file state is absent, directory or file');
  }
}


export function parseAppFileAnswer(input: unknown, appId: string): AppFileAnswer {
  const value = record(input);
  switch (value['kind']) {
    case 'listing':
      return { kind: 'listing', listing: parseListing(value['listing'], appId) };
    case 'content':
      return { kind: 'content', content: parseContent(value['content'], appId) };
    case 'changed':
      return { kind: 'changed', change: parseChange(value['change'], appId) };
    default:
      throw new Error('A file answer is a listing, content or a change');
  }
}

function parseListing(input: unknown, appId: string): AppFileListing {
  const value = record(input);
  const items = toArray(value['entries']);
  if (items === undefined) {
    throw new Error('A listing holds a list of entries');
  }
  if (typeof value['truncated'] !== 'boolean') {
    throw new Error('A listing says whether it was cut');
  }
  const entries = items.map((item): AppFileEntry => {
    const entry = record(item);
    const kind = entry['kind'] === 'file' || entry['kind'] === 'directory' ? entry['kind'] : undefined;
    if (kind === undefined) {
      throw new Error('An entry is a file or a directory');
    }
    return { path: parseAppFilePath(entry['path'], appId, { allowRoot: false }), kind, sizeBytes: sizeOf(entry['sizeBytes']) };
  });
  return { entries, truncated: value['truncated'] };
}

function parseContent(input: unknown, appId: string): AppFileContent {
  const value = record(input);
  const parsed = parseAppFileContent(value['content'], value['encoding']);
  return { path: parseAppFilePath(value['path'], appId, { allowRoot: false }), ...parsed, sizeBytes: sizeOf(value['sizeBytes']) };
}

function parseChange(input: unknown, appId: string): AppFileChange {
  const value = record(input);
  const paths = toArray(value['paths']);
  if (paths === undefined || paths.length > APP_FILE_LIMITS.restorePathsMax) {
    throw new Error('A change names a bounded list of paths');
  }
  return {
    paths: paths.map((path) => parseAppFilePath(path, appId, { allowRoot: false })),
    before: parseAppFileStates(value['before'], appId),
    after: parseAppFileStates(value['after'], appId),
  };
}

function sizeOf(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new Error('A size is a whole number of bytes');
  }
  return input;
}
