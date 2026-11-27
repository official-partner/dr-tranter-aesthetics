import { assert } from '../core/assert';
import { boolean, count, digest, list, object, optional, pathText, record, text } from '../core/boundary';
import type { Brand, Digest } from '../core/brand';
import { err, ok, type Result } from '../core/result';

export const FILE_EXPLORER_LIMITS = {
  listEntriesMax: 5_000,
  nameCharsMax: 255,
  pathSegmentsMax: 128,
  pathCharsMax: 4_096,
  textBytesMax: 8 * 1024 * 1024,
  sniffBytesMax: 8 * 1024,
  batchItemsMax: 1_000,
  copyEntriesMax: 20_000,
  copyBytesMax: 2 * 1024 * 1024 * 1024,
  watchDirectoriesMax: 512,
  queryCharsMax: 200,
  findResultsMax: 200,
  findVisitedMax: 100_000,
  collisionNamesMax: 50,
  copyNameAttemptsMax: 1_000,
} as const satisfies Record<string, number>;

export type ExplorerPath = Brand<string, 'ExplorerPath'>;

export const EXPLORER_ROOT = toExplorerPath('');

export function toExplorerPath(value: string): ExplorerPath {
  assert(value.length <= FILE_EXPLORER_LIMITS.pathCharsMax, 'An explorer path is within its length bound');
  if (value === '') {
    return value as ExplorerPath;
  }
  const segments = value.split('/');
  assert(segments.length <= FILE_EXPLORER_LIMITS.pathSegmentsMax, 'An explorer path is within its segment bound');
  for (const segment of segments) {
    const problem = segmentProblem(segment);
    if (problem !== undefined) {
      throw new Error(`Explorer path: ${problem}`);
    }
  }
  return value as ExplorerPath;
}

export function parseExplorerPath(input: unknown): ExplorerPath {
  const value = pathText(input);
  if (value.length > FILE_EXPLORER_LIMITS.pathCharsMax) {
    throw new Error('Explorer path exceeds its length bound');
  }
  if (value !== '' && value.split('/').length > FILE_EXPLORER_LIMITS.pathSegmentsMax) {
    throw new Error('Explorer path exceeds its segment bound');
  }
  return toExplorerPath(value);
}

function segmentProblem(segment: string): string | undefined {
  if (segment === '') {
    return 'empty segment';
  }
  if (segment === '.' || segment === '..') {
    return 'relative segment';
  }
  if (segment.includes('\\')) {
    return 'backslash';
  }
  if (CONTROL_CHARACTERS.test(segment)) {
    return 'control character';
  }
  if (segment.length > FILE_EXPLORER_LIMITS.nameCharsMax) {
    return 'segment exceeds the name bound';
  }
  return undefined;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function explorerSegments(path: ExplorerPath): readonly string[] {
  return path === '' ? [] : path.split('/');
}

export function childPath(parent: ExplorerPath, name: string): ExplorerPath {
  assert(name.length > 0, 'A child has a name');
  assert(!name.includes('/'), 'A child name is one segment');
  return toExplorerPath(parent === '' ? name : `${parent}/${name}`);
}

export function parentPath(path: ExplorerPath): ExplorerPath | undefined {
  if (path === '') {
    return undefined;
  }
  const slash = path.lastIndexOf('/');
  return toExplorerPath(slash < 0 ? '' : path.slice(0, slash));
}

export function baseName(path: ExplorerPath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isWithinPath(ancestor: ExplorerPath, candidate: ExplorerPath): boolean {
  if (ancestor === '') {
    return true;
  }
  return candidate === ancestor || candidate.startsWith(`${ancestor}/`);
}

export function rebasePath(path: ExplorerPath, from: ExplorerPath, to: ExplorerPath): ExplorerPath {
  assert(isWithinPath(from, path), 'Only a path inside the moved entry is rebased');
  assert(from !== '', 'The project root never moves');
  return toExplorerPath(`${to}${path.slice(from.length)}`);
}

export function isProtectedPath(path: ExplorerPath): boolean {
  const segments = explorerSegments(path).map((segment) => segment.toLowerCase());
  const first = segments[0];
  if (first === '.git') {
    return true;
  }
  return first === '.stacki' && segments[1] === 'io';
}


export const ENTRY_NAME_PROBLEMS = ['empty', 'reserved', 'separator', 'control', 'too-long', 'whitespace', 'windows-character', 'windows-name'] as const;
export type EntryNameProblem = (typeof ENTRY_NAME_PROBLEMS)[number];

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const WINDOWS_CHARACTERS = /[<>:"|?*]/;

export function entryNameProblem(name: string, platform: string): EntryNameProblem | undefined {
  if (name.length === 0) {
    return 'empty';
  }
  if (name === '.' || name === '..') {
    return 'reserved';
  }
  if (name.includes('/') || name.includes('\\')) {
    return 'separator';
  }
  if (CONTROL_CHARACTERS.test(name)) {
    return 'control';
  }
  if (name.length > FILE_EXPLORER_LIMITS.nameCharsMax) {
    return 'too-long';
  }
  if (name.trim() !== name) {
    return 'whitespace';
  }
  if (platform === 'win32') {
    if (WINDOWS_CHARACTERS.test(name)) {
      return 'windows-character';
    }
    if (WINDOWS_DEVICE_NAME.test(name) || name.endsWith('.')) {
      return 'windows-name';
    }
  }
  return undefined;
}

export function parseEntryName(input: unknown): string {
  const name = text(input);
  const problem = entryNameProblem(name, 'posix');
  if (problem !== undefined) {
    throw new Error(`Entry name: ${problem}`);
  }
  return name;
}


export const EXPLORER_ENTRY_KINDS = ['directory', 'file', 'link-directory', 'link-file', 'link-outside', 'link-broken', 'other'] as const;
export type ExplorerEntryKind = (typeof EXPLORER_ENTRY_KINDS)[number];

export interface ExplorerEntry {
  readonly name: string;
  readonly kind: ExplorerEntryKind;
}

export interface ExplorerListing {
  readonly path: ExplorerPath;
  readonly entries: readonly ExplorerEntry[];
  readonly totalCount: number;
}

export function isFolderKind(kind: ExplorerEntryKind): boolean {
  return kind === 'directory' || kind === 'link-directory';
}

export function isFileKind(kind: ExplorerEntryKind): boolean {
  return kind === 'file' || kind === 'link-file';
}

const NATURAL_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function compareEntries(left: ExplorerEntry, right: ExplorerEntry): number {
  const leftFolder = isFolderKind(left.kind) ? 0 : 1;
  const rightFolder = isFolderKind(right.kind) ? 0 : 1;
  if (leftFolder !== rightFolder) {
    return leftFolder - rightFolder;
  }
  const natural = NATURAL_ORDER.compare(left.name, right.name);
  if (natural !== 0) {
    return natural;
  }
  if (left.name === right.name) {
    return 0;
  }
  return left.name < right.name ? -1 : 1;
}

function parseEntryKind(input: unknown): ExplorerEntryKind {
  const found = EXPLORER_ENTRY_KINDS.find((kind) => kind === input);
  if (found === undefined) {
    throw new Error('Explorer entry: unknown kind');
  }
  return found;
}

export function parseExplorerEntry(input: unknown): ExplorerEntry {
  const value = record(input);
  const name = text(value['name']);
  if (name.includes('/') || segmentProblem(name) !== undefined) {
    throw new Error('Explorer entry: the name is not one segment');
  }
  return { name, kind: parseEntryKind(value['kind']) };
}

export function parseExplorerListing(input: unknown): ExplorerListing {
  const value = record(input);
  const entries = list(parseExplorerEntry)(value['entries']);
  if (entries.length > FILE_EXPLORER_LIMITS.listEntriesMax) {
    throw new Error('Explorer listing exceeds its entry bound');
  }
  const totalCount = count(value['totalCount']);
  if (totalCount < entries.length) {
    throw new Error('Explorer listing: the total is below the entries it holds');
  }
  return { path: parseExplorerPath(value['path']), entries, totalCount };
}


export const EXPLORER_MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type ExplorerMediaKind = (typeof EXPLORER_MEDIA_KINDS)[number];

const MEDIA_EXTENSIONS: Readonly<Record<string, ExplorerMediaKind>> = {
  apng: 'image',
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  ico: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  webp: 'image',
  m4v: 'video',
  mov: 'video',
  mp4: 'video',
  ogv: 'video',
  webm: 'video',
  aac: 'audio',
  flac: 'audio',
  m4a: 'audio',
  mp3: 'audio',
  oga: 'audio',
  ogg: 'audio',
  wav: 'audio',
};

export function mediaKindOf(name: string): ExplorerMediaKind | undefined {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return undefined;
  }
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(MEDIA_EXTENSIONS, extension) ? MEDIA_EXTENSIONS[extension] : undefined;
}

export type ExplorerContent =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly checksum: Digest;
      readonly byteOrderMark: boolean;
      readonly sizeBytes: number;
    }
  | { readonly kind: 'media'; readonly media: ExplorerMediaKind; readonly sizeBytes: number }
  | { readonly kind: 'binary'; readonly sizeBytes: number }
  | { readonly kind: 'too-large'; readonly sizeBytes: number };

export function parseExplorerContent(input: unknown): ExplorerContent {
  const value = record(input);
  const sizeBytes = count(value['sizeBytes']);
  switch (value['kind']) {
    case 'text': {
      const body = text(value['text']);
      if (body.startsWith('﻿')) {
        throw new Error('Explorer content: the byte-order mark is reported, never left in the text');
      }
      return { kind: 'text', text: body, checksum: digest(value['checksum']), byteOrderMark: boolean(value['byteOrderMark']), sizeBytes };
    }
    case 'media': {
      const media = EXPLORER_MEDIA_KINDS.find((kind) => kind === value['media']);
      if (media === undefined) {
        throw new Error('Explorer content: unknown media kind');
      }
      return { kind: 'media', media, sizeBytes };
    }
    case 'binary':
      return { kind: 'binary', sizeBytes };
    case 'too-large':
      return { kind: 'too-large', sizeBytes };
    default:
      throw new Error('Explorer content: unknown kind');
  }
}


export const EXPLORER_ERROR_CODES = [
  'not-open',
  'missing',
  'exists',
  'collision',
  'protected',
  'outside',
  'not-directory',
  'not-file',
  'into-itself',
  'too-large',
  'too-many',
  'conflict',
  'not-text',
  'filesystem',
] as const;
export type ExplorerErrorCode = (typeof EXPLORER_ERROR_CODES)[number];

export interface ExplorerError {
  readonly code: ExplorerErrorCode;
  readonly names: readonly string[];
  readonly detail: string | undefined;
}

export function explorerError(code: ExplorerErrorCode, extra: { readonly names?: readonly string[]; readonly detail?: string } = {}): ExplorerError {
  const names = (extra.names ?? []).slice(0, FILE_EXPLORER_LIMITS.collisionNamesMax);
  return { code, names, detail: extra.detail };
}

const SYSTEM_CODE = /^E[A-Z0-9]{1,15}$/;

export function parseExplorerError(input: unknown): ExplorerError {
  const value = record(input);
  const code = EXPLORER_ERROR_CODES.find((each) => each === value['code']);
  if (code === undefined) {
    throw new Error('Explorer error: unknown code');
  }
  const names = list(text)(value['names']);
  if (names.length > FILE_EXPLORER_LIMITS.collisionNamesMax) {
    throw new Error('Explorer error: too many names');
  }
  const detail = optional(text)(value['detail']);
  if (detail !== undefined && !SYSTEM_CODE.test(detail)) {
    throw new Error('Explorer error: the detail is a system error code');
  }
  return { code, names, detail };
}

export function parseExplorerResult<T>(input: unknown, parseValue: (value: unknown) => T): Result<T, ExplorerError> {
  const value = record(input);
  if (boolean(value['ok'])) {
    return ok(parseValue(value['value']));
  }
  return err(parseExplorerError(value['error']));
}

export type ExplorerResult<T> = Result<T, ExplorerError>;


export const COLLISION_CHOICES = ['refuse', 'keep-both', 'replace'] as const;
export type CollisionChoice = (typeof COLLISION_CHOICES)[number];

export const TRANSFER_MODES = ['move', 'copy'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const CREATE_KINDS = ['file', 'directory'] as const;
export type CreateKind = (typeof CREATE_KINDS)[number];

function oneOf<const T extends readonly string[]>(values: T, label: string): (input: unknown) => T[number] {
  return (input) => {
    const found = values.find((value) => value === input);
    if (found === undefined) {
      throw new Error(`${label}: unknown value`);
    }
    return found;
  };
}

function explorerPaths(input: unknown): readonly ExplorerPath[] {
  const paths = list(parseExplorerPath)(input);
  if (paths.length === 0) {
    throw new Error('Explorer request names no path');
  }
  if (paths.length > FILE_EXPLORER_LIMITS.batchItemsMax) {
    throw new Error('Explorer request exceeds its batch bound');
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error('Explorer request names a path twice');
  }
  return paths;
}

function absoluteSources(input: unknown): readonly string[] {
  const sources = list(pathText)(input);
  if (sources.length === 0) {
    throw new Error('Explorer import names no file');
  }
  if (sources.length > FILE_EXPLORER_LIMITS.batchItemsMax) {
    throw new Error('Explorer import exceeds its batch bound');
  }
  return sources;
}

function watchedDirectories(input: unknown): readonly ExplorerPath[] {
  const directories = list(parseExplorerPath)(input);
  if (directories.length > FILE_EXPLORER_LIMITS.watchDirectoriesMax) {
    throw new Error('Explorer watch exceeds its folder bound');
  }
  return directories;
}

function findQuery(input: unknown): string {
  const query = text(input);
  if (query.trim().length === 0) {
    throw new Error('Explorer find: an empty query');
  }
  if (query.length > FILE_EXPLORER_LIMITS.queryCharsMax) {
    throw new Error('Explorer find: the query exceeds its bound');
  }
  return query;
}

function editorText(input: unknown): string {
  const value = text(input);
  if (value.length > FILE_EXPLORER_LIMITS.textBytesMax) {
    throw new Error('Explorer write exceeds the text bound');
  }
  if (value.startsWith('﻿')) {
    throw new Error('Explorer write: the byte-order mark is a flag, not text');
  }
  return value;
}

const project = { projectPath: pathText };

export const FILE_EXPLORER_PAYLOADS = {
  'files:list': object({ ...project, path: parseExplorerPath }),
  'files:read': object({ ...project, path: parseExplorerPath }),
  'files:write': object({ ...project, path: parseExplorerPath, text: editorText, byteOrderMark: boolean, base: digest }),
  'files:create': object({ ...project, parent: parseExplorerPath, name: parseEntryName, kind: oneOf(CREATE_KINDS, 'Create kind') }),
  'files:rename': object({ ...project, path: parseExplorerPath, name: parseEntryName }),
  'files:transfer': object({
    ...project,
    paths: explorerPaths,
    target: parseExplorerPath,
    mode: oneOf(TRANSFER_MODES, 'Transfer mode'),
    collision: oneOf(COLLISION_CHOICES, 'Collision choice'),
  }),
  'files:trash': object({ ...project, paths: explorerPaths }),
  'files:import': object({ ...project, sources: absoluteSources, target: parseExplorerPath, collision: oneOf(COLLISION_CHOICES, 'Collision choice') }),
  'files:reveal': object({ ...project, path: parseExplorerPath }),
  'files:find': object({ ...project, query: findQuery }),
  'files:watch': object({ ...project, directories: watchedDirectories }),
  'files:guardClose': object({ unsaved: boolean }),
  'files:allowClose': object({ proceed: boolean }),
} as const;


export interface TransferPlacement {
  readonly from: string;
  readonly to: ExplorerPath;
}

export interface FindMatch {
  readonly path: ExplorerPath;
  readonly folder: boolean;
}

export interface FindAnswer {
  readonly matches: readonly FindMatch[];
  readonly complete: boolean;
}

export interface FileExplorerResults {
  readonly 'files:list': ExplorerResult<ExplorerListing>;
  readonly 'files:read': ExplorerResult<ExplorerContent>;
  readonly 'files:write': ExplorerResult<{ readonly checksum: Digest }>;
  readonly 'files:create': ExplorerResult<{ readonly path: ExplorerPath }>;
  readonly 'files:rename': ExplorerResult<{ readonly path: ExplorerPath }>;
  readonly 'files:transfer': ExplorerResult<{ readonly placed: readonly TransferPlacement[] }>;
  readonly 'files:trash': ExplorerResult<{ readonly count: number }>;
  readonly 'files:import': ExplorerResult<{ readonly placed: readonly TransferPlacement[] }>;
  readonly 'files:reveal': ExplorerResult<{ readonly shown: true }>;
  readonly 'files:find': ExplorerResult<FindAnswer>;
  readonly 'files:watch': { readonly watching: number };
  readonly 'files:guardClose': { readonly ok: true };
  readonly 'files:allowClose': { readonly ok: true };
}

export function parsePathValue(input: unknown): { readonly path: ExplorerPath } {
  return { path: parseExplorerPath(record(input)['path']) };
}

export function parseChecksumValue(input: unknown): { readonly checksum: Digest } {
  return { checksum: digest(record(input)['checksum']) };
}

export function parsePlacements(input: unknown): { readonly placed: readonly TransferPlacement[] } {
  const placed = list((each) => {
    const value = record(each);
    return { from: pathText(value['from']), to: parseExplorerPath(value['to']) };
  })(record(input)['placed']);
  if (placed.length > FILE_EXPLORER_LIMITS.batchItemsMax) {
    throw new Error('Explorer placements exceed the batch bound');
  }
  return { placed };
}

export function parseFindAnswer(input: unknown): FindAnswer {
  const value = record(input);
  const matches = list((each) => {
    const match = record(each);
    return { path: parseExplorerPath(match['path']), folder: boolean(match['folder']) };
  })(value['matches']);
  if (matches.length > FILE_EXPLORER_LIMITS.findResultsMax) {
    throw new Error('Explorer find exceeds its result bound');
  }
  return { matches, complete: boolean(value['complete']) };
}

export function parseFilesChanged(input: unknown): { readonly directories: readonly ExplorerPath[] } {
  return { directories: watchedDirectories(record(input)['directories']) };
}
