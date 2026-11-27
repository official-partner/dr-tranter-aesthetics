import { assert } from '../core/assert';
import { err, ok, type Result } from '../core/result';
import { DescribedError, problemOf } from './describedError';
import { described, type Described, type MessageKey } from './i18n/messageRef';
import { record } from '../core/boundary';

export const PROJECT_FOLDERS_FILE = '.stacki/folders.json';

export const PAGES_FOLDER = 'src/pages';

export const PROJECT_FOLDER_LIMITS = {
  foldersPerKindMax: 16,
  pathCharsMax: 200,
  pathSegmentsMax: 8,
  segmentCharsMax: 64,
  fileCharsMax: 16_384,
  cmsFilesMax: 64,
  cmsHiddenCollectionsMax: 256,
  collectionNameCharsMax: 64,
  cmsPickerExcludedMax: 512,
  exportNameCharsMax: 128,
} as const satisfies Record<string, number>;

export const PROJECT_FOLDER_KINDS = ['components', 'layouts', 'assets', 'styles', 'variables'] as const;
export type ProjectFolderKind = (typeof PROJECT_FOLDER_KINDS)[number];

export const DEFAULT_PROJECT_FOLDERS: Readonly<Record<ProjectFolderKind, readonly string[]>> = {
  components: ['src/components'],
  layouts: ['src/layouts'],
  assets: ['public', 'src'],
  styles: ['src', 'public', 'styles'],
  variables: ['src', 'public', 'styles'],
};

export const PROJECT_FOLDER_ROOTS: Readonly<Record<ProjectFolderKind, readonly string[]>> = {
  components: ['src'],
  layouts: ['src'],
  assets: ['public', 'src'],
  styles: ['src', 'public', 'styles'],
  variables: ['src', 'public', 'styles'],
};

export interface ProjectFolders {
  readonly version: 1;
  readonly folders: ProjectFolderChoices;
  readonly unknownKeys?: ReadonlyArray<readonly [string, unknown]>;
  readonly unknownFolders?: ReadonlyArray<readonly [string, unknown]>;
  readonly cms?: ProjectCmsChoices;
}

export interface ProjectCmsChoices {
  readonly files?: readonly string[];
  readonly hiddenCollections?: readonly string[];
  readonly pickerExcluded?: readonly string[];
  readonly unknownKeys?: ReadonlyArray<readonly [string, unknown]>;
}

export const CMS_FILE_EXTENSION = /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx|json|astro)$/i;
const COLLECTION_NAME = /^[A-Za-z0-9_$-]+$/;
const EXPORT_NAME = /^[A-Za-z_$][\w$]*$/;

export type PickerExclusion =
  | { readonly kind: 'file'; readonly file: string }
  | { readonly kind: 'export'; readonly file: string; readonly exported: string }
  | { readonly kind: 'collection'; readonly name: string };

export interface ProjectFolderChoices {
  readonly components?: readonly string[];
  readonly layouts?: readonly string[];
  readonly assets?: readonly string[];
  readonly styles?: readonly string[];
  readonly variables?: readonly string[];
}

export type ProjectFoldersRead =
  { readonly kind: 'absent' } | { readonly kind: 'ready'; readonly config: ProjectFolders } | { readonly kind: 'invalid'; readonly message: string };

export const EMPTY_PROJECT_FOLDERS: ProjectFolders = { version: 1, folders: {} };

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_. -]*$/;
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', 'dist']);

export function foldersFor(kind: ProjectFolderKind, config: ProjectFolders | undefined): readonly string[] {
  assert(PROJECT_FOLDER_KINDS.includes(kind), 'foldersFor: kind is a project folder kind');
  const chosen = config?.folders[kind];
  const folders = chosen ?? DEFAULT_PROJECT_FOLDERS[kind];
  assert(folders.length <= PROJECT_FOLDER_LIMITS.foldersPerKindMax, 'foldersFor: the parser bounds folder count');
  return folders;
}

export function isCustomized(kind: ProjectFolderKind, config: ProjectFolders | undefined): boolean {
  return config?.folders[kind] !== undefined;
}

export function differsFromDefaults(kind: ProjectFolderKind, config: ProjectFolders | undefined): boolean {
  const reads = foldersFor(kind, config);
  const differs = reads.join('\n') !== DEFAULT_PROJECT_FOLDERS[kind].join('\n');
  assert(!differs || isCustomized(kind, config), 'differsFromDefaults: only a choice can differ');
  return differs;
}

export function configOf(read: ProjectFoldersRead): ProjectFolders | undefined {
  switch (read.kind) {
    case 'absent':
      return undefined;
    case 'ready':
      return read.config;
    case 'invalid':
      return undefined;
    default: {
      const exhaustive: never = read;
      return exhaustive;
    }
  }
}

export function readProjectFoldersSource(source: string | undefined): ProjectFoldersRead {
  if (source === undefined) {
    return { kind: 'absent' };
  }
  try {
    if (source.length > PROJECT_FOLDER_LIMITS.fileCharsMax) {
      throw new Error(`Folder settings exceed ${PROJECT_FOLDER_LIMITS.fileCharsMax} characters`);
    }
    const input: unknown = JSON.parse(source);
    return { kind: 'ready', config: parseProjectFolders(input) };
  } catch (error: unknown) {
    return { kind: 'invalid', message: error instanceof Error ? error.message : String(error) };
  }
}

export function parseProjectFolders(input: unknown): ProjectFolders {
  const value = record(input);
  if (value['version'] !== 1) {
    throw new Error('Unsupported folder settings version');
  }
  const unknownKeys = Object.entries(value).filter(([key]) => key !== 'version' && key !== 'folders' && key !== 'cms');
  const cms = value['cms'] === undefined ? undefined : parseCmsChoices(value['cms']);
  const folders = value['folders'] === undefined ? {} : record(value['folders']);
  const choices: Record<string, readonly string[]> = {};
  const unknownFolders: Array<readonly [string, unknown]> = [];
  for (const [key, item] of Object.entries(folders)) {
    const kind = knownFolderKind(key);
    if (kind === undefined) {
      unknownFolders.push([key, item]);
    } else {
      choices[kind] = parseKindFolders(kind, item);
    }
  }
  const legacyStyles = choices['styles'];
  if (legacyStyles !== undefined && choices['variables'] === undefined) {
    choices['variables'] = legacyStyles;
  }
  assert(choices['styles'] === undefined || choices['variables'] !== undefined, 'parseProjectFolders: chosen styles always come with variables');
  return {
    version: 1,
    folders: choices,
    ...(unknownKeys.length === 0 ? {} : { unknownKeys }),
    ...(unknownFolders.length === 0 ? {} : { unknownFolders }),
    ...(cms === undefined ? {} : { cms }),
  };
}

function parseCmsChoices(input: unknown): ProjectCmsChoices {
  const value = record(input);
  const unknownKeys = Object.entries(value).filter(([key]) => !CMS_KEYS.has(key));
  const files = value['files'] === undefined ? undefined : parseCmsFiles(value['files']);
  const hidden = value['hiddenCollections'] === undefined ? undefined : parseHiddenCollections(value['hiddenCollections']);
  const excluded = value['pickerExcluded'] === undefined ? undefined : parsePickerExcluded(value['pickerExcluded']);
  return {
    ...(files === undefined ? {} : { files }),
    ...(hidden === undefined ? {} : { hiddenCollections: hidden }),
    ...(excluded === undefined ? {} : { pickerExcluded: excluded }),
    ...(unknownKeys.length === 0 ? {} : { unknownKeys }),
  };
}

const CMS_KEYS: ReadonlySet<string> = new Set(['files', 'hiddenCollections', 'pickerExcluded']);

function parsePickerExcluded(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    throw new Error('Data picker exclusions: expected a list');
  }
  if (input.length > PROJECT_FOLDER_LIMITS.cmsPickerExcludedMax) {
    throw new Error(`Data picker exclusions: exceed ${PROJECT_FOLDER_LIMITS.cmsPickerExcludedMax} entries`);
  }
  const entries = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') {
      throw new Error('Data picker exclusions: each is a file, an export or a collection name');
    }
    parsePickerExclusion(item);
    if (entries.has(item)) {
      throw new Error(`Data picker exclusions: ${item} is listed twice`);
    }
    entries.add(item);
  }
  assert(entries.size === input.length, 'parsePickerExcluded: every entry is kept once');
  return [...entries];
}

export function parsePickerExclusion(input: string): PickerExclusion {
  if (!input.includes('/')) {
    if (input.length === 0 || input.length > PROJECT_FOLDER_LIMITS.collectionNameCharsMax || !COLLECTION_NAME.test(input)) {
      throw new Error(`Data picker exclusions: ${input === '' ? 'an empty entry' : input} is not a collection name`);
    }
    return { kind: 'collection', name: input };
  }
  const hash = input.indexOf('#');
  const file = parseProjectFolder(hash === -1 ? input : input.slice(0, hash));
  if (!file.startsWith('src/') || !CMS_FILE_EXTENSION.test(file) || isAstroSource(file)) {
    throw new Error(`Data picker exclusions: ${file} is not a data file under src/`);
  }
  if (hash === -1) {
    return { kind: 'file', file };
  }
  const exported = input.slice(hash + 1);
  if (exported.length > PROJECT_FOLDER_LIMITS.exportNameCharsMax || !EXPORT_NAME.test(exported)) {
    throw new Error(`Data picker exclusions: ${exported === '' ? 'an empty export' : exported} is not an export name`);
  }
  return { kind: 'export', file, exported };
}

export function pickerExclusionText(exclusion: PickerExclusion): string {
  switch (exclusion.kind) {
    case 'file':
      return exclusion.file;
    case 'export':
      return `${exclusion.file}#${exclusion.exported}`;
    case 'collection':
      return exclusion.name;
    default: {
      const exhaustive: never = exclusion;
      return exhaustive;
    }
  }
}

export function isPickerShown(config: ProjectFolders | undefined, source: PickerExclusion): boolean {
  const excluded = config?.cms?.pickerExcluded;
  if (excluded === undefined) {
    return true;
  }
  assert(excluded.length <= PROJECT_FOLDER_LIMITS.cmsPickerExcludedMax, 'isPickerShown: the parser bounds the exclusions');
  if (excluded.includes(pickerExclusionText(source))) {
    return false;
  }
  if (source.kind === 'export') {
    return !excluded.includes(source.file);
  }
  return true;
}

export function withPickerShown(config: ProjectFolders | undefined, source: PickerExclusion, options: { readonly shown: boolean }): ProjectFolders {
  const text = pickerExclusionText(source);
  assert(pickerExclusionText(parsePickerExclusion(text)) === text, 'withPickerShown: the entry reads back as written');
  const rest = (config?.cms?.pickerExcluded ?? []).filter((other) => other !== text);
  const excluded = options.shown ? rest : [...rest, text];
  if (excluded.length > PROJECT_FOLDER_LIMITS.cmsPickerExcludedMax) {
    throw new Error(`At most ${PROJECT_FOLDER_LIMITS.cmsPickerExcludedMax} sources can be left out of the data picker`);
  }
  const next = withCmsChoices(config, { ...config?.cms, pickerExcluded: excluded });
  if (source.kind === 'export') {
    assert(options.shown || !isPickerShown(next, source), 'withPickerShown: a left-out export is not listed');
  } else {
    assert(isPickerShown(next, source) === options.shown, 'withPickerShown: the source reads as set');
  }
  return next;
}

function parseCmsFiles(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    throw new Error('CMS files: expected a list');
  }
  if (input.length > PROJECT_FOLDER_LIMITS.cmsFilesMax) {
    throw new Error(`CMS files: exceed ${PROJECT_FOLDER_LIMITS.cmsFilesMax} files`);
  }
  const files: string[] = [];
  for (const item of input) {
    const file = parseProjectFolder(item);
    const problem = cmsFileProblem(files, file);
    if (problem !== undefined) {
      throw new Error(`CMS files: ${problem}`);
    }
    files.push(file);
  }
  return files;
}

function parseHiddenCollections(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    throw new Error('Hidden collections: expected a list');
  }
  if (input.length > PROJECT_FOLDER_LIMITS.cmsHiddenCollectionsMax) {
    throw new Error(`Hidden collections: exceed ${PROJECT_FOLDER_LIMITS.cmsHiddenCollectionsMax} names`);
  }
  const names = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string' || item.length === 0 || item.length > PROJECT_FOLDER_LIMITS.collectionNameCharsMax || !COLLECTION_NAME.test(item)) {
      throw new Error('Hidden collections: each is a collection name');
    }
    if (names.has(item)) {
      throw new Error(`Hidden collections: ${item} is listed twice`);
    }
    names.add(item);
  }
  return [...names];
}

export function cmsFileProblem(existing: readonly string[], file: string): string | undefined {
  return cmsFileProblemDescribed(existing, file)?.message;
}

export function cmsFileProblemDescribed(existing: readonly string[], file: string): Described | undefined {
  assert(file.length > 0, 'cmsFileProblem: the file is named');
  if (!file.startsWith('src/')) {
    return described('settings.folders.problem.cms.outside', { file });
  }
  if (!CMS_FILE_EXTENSION.test(file) || /\.d\.[cm]?ts$/i.test(file)) {
    return described('settings.folders.problem.cms.notEditable', { file });
  }
  if (existing.includes(file)) {
    return described('settings.folders.problem.listed', { item: file });
  }
  if (existing.length >= PROJECT_FOLDER_LIMITS.cmsFilesMax) {
    return described('settings.folders.problem.cms.filesMax', { count: PROJECT_FOLDER_LIMITS.cmsFilesMax });
  }
  return undefined;
}

export function cmsFilesFor(config: ProjectFolders | undefined): readonly string[] | undefined {
  return config?.cms?.files;
}

export function isAstroSource(file: string): boolean {
  return /\.astro$/i.test(file);
}

export function cmsDataFiles(config: ProjectFolders | undefined, detected: readonly string[]): readonly string[] {
  const files = (cmsFilesFor(config) ?? detected).filter((file) => !isAstroSource(file));
  assert(
    files.every((file) => !isAstroSource(file)),
    'cmsDataFiles: no Astro file is a data file',
  );
  return files;
}

export function isCollectionHidden(config: ProjectFolders | undefined, name: string): boolean {
  return config?.cms?.hiddenCollections?.includes(name) ?? false;
}

export function withCmsFiles(config: ProjectFolders | undefined, files: readonly string[] | undefined): ProjectFolders {
  const cms = config?.cms;
  const next = withCmsChoices(config, {
    ...(files === undefined ? {} : { files }),
    ...(cms?.hiddenCollections === undefined ? {} : { hiddenCollections: cms.hiddenCollections }),
    ...(cms?.pickerExcluded === undefined ? {} : { pickerExcluded: cms.pickerExcluded }),
  });
  assert(cmsFilesFor(next) === files, 'withCmsFiles: the files are what was set');
  return next;
}

function withCmsChoices(config: ProjectFolders | undefined, choices: ProjectCmsChoices): ProjectFolders {
  const base = config ?? EMPTY_PROJECT_FOLDERS;
  const { files, hiddenCollections: hidden, pickerExcluded: excluded } = choices;
  const unknownKeys = base.cms?.unknownKeys;
  const cms: ProjectCmsChoices = {
    ...(files === undefined ? {} : { files }),
    ...(hidden === undefined || hidden.length === 0 ? {} : { hiddenCollections: hidden }),
    ...(excluded === undefined || excluded.length === 0 ? {} : { pickerExcluded: excluded }),
    ...(unknownKeys === undefined ? {} : { unknownKeys }),
  };
  const rest: ProjectFolders = {
    version: 1,
    folders: base.folders,
    ...(base.unknownKeys === undefined ? {} : { unknownKeys: base.unknownKeys }),
    ...(base.unknownFolders === undefined ? {} : { unknownFolders: base.unknownFolders }),
  };
  return Object.keys(cms).length === 0 ? rest : { ...rest, cms };
}

export function addCmsFile(config: ProjectFolders | undefined, input: string, detected: readonly string[]): Result<ProjectFolders, string> {
  const added = addCmsFileDescribed(config, input, detected);
  return added.ok ? added : err(added.error.message);
}

export function addCmsFileDescribed(config: ProjectFolders | undefined, input: string, detected: readonly string[]): Result<ProjectFolders, Described> {
  let file: string;
  try {
    file = parseProjectFolder(input);
  } catch (error: unknown) {
    return err(problemOf(error));
  }
  if (isAstroSource(file)) {
    return err(described('settings.folders.problem.cms.astro', { file }));
  }
  const current = cmsDataFiles(config, detected);
  const problem = cmsFileProblemDescribed(current, file);
  if (problem !== undefined) {
    return err(problem);
  }
  return ok(withCmsFiles(config, [...current, file]));
}

export function removeCmsFile(config: ProjectFolders | undefined, file: string, detected: readonly string[]): ProjectFolders {
  const current = cmsDataFiles(config, detected);
  assert(current.includes(file), 'removeCmsFile: the file is in the list');
  return withCmsFiles(
    config,
    current.filter((other) => other !== file),
  );
}

export function shownCollections<T extends { readonly name: string }>(collections: readonly T[], config: ProjectFolders | undefined): readonly T[] {
  const shown = collections.filter((collection) => !isCollectionHidden(config, collection.name));
  assert(shown.length <= collections.length, 'shownCollections: hiding only removes');
  return shown;
}

export function withCollectionShown(config: ProjectFolders | undefined, name: string, options: { readonly shown: boolean }): ProjectFolders {
  assert(COLLECTION_NAME.test(name), 'withCollectionShown: a collection name');
  const hidden = (config?.cms?.hiddenCollections ?? []).filter((other) => other !== name);
  return withCmsChoices(config, { ...config?.cms, hiddenCollections: options.shown ? hidden : [...hidden, name] });
}

export function knownFolderKind(input: string): ProjectFolderKind | undefined {
  return PROJECT_FOLDER_KINDS.find((kind) => kind === input);
}

function parseKindFolders(kind: ProjectFolderKind, input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    throw new Error(`Folders for ${kind}: expected a list`);
  }
  if (input.length > PROJECT_FOLDER_LIMITS.foldersPerKindMax) {
    throw new Error(`Folders for ${kind}: exceed ${PROJECT_FOLDER_LIMITS.foldersPerKindMax} folders`);
  }
  const folders: string[] = [];
  for (const item of input) {
    const folder = parseProjectFolder(item);
    const problem = folderChoiceProblem(kind, folders, folder);
    if (problem !== undefined) {
      throw new Error(`Folders for ${kind}: ${problem}`);
    }
    folders.push(folder);
  }
  return folders;
}

export function parseProjectFolder(input: unknown): string {
  if (typeof input !== 'string') {
    throw new DescribedError(described('settings.folders.path.notText'));
  }
  if (input.length === 0) {
    throw new DescribedError(described('settings.folders.path.empty'));
  }
  if (input.length > PROJECT_FOLDER_LIMITS.pathCharsMax) {
    throw new DescribedError(described('settings.folders.path.tooLong', { max: PROJECT_FOLDER_LIMITS.pathCharsMax }));
  }
  if (input.startsWith('/')) {
    throw new DescribedError(described('settings.folders.path.absolute'));
  }
  if (input.includes('\\')) {
    throw new DescribedError(described('settings.folders.path.backslash'));
  }
  if (/^[A-Za-z]:/.test(input)) {
    throw new DescribedError(described('settings.folders.path.drive'));
  }
  const segments = input.split('/');
  if (segments.length > PROJECT_FOLDER_LIMITS.pathSegmentsMax) {
    throw new DescribedError(described('settings.folders.path.tooDeep', { max: PROJECT_FOLDER_LIMITS.pathSegmentsMax }));
  }
  for (const segment of segments) {
    folderSegment(segment);
  }
  return input;
}

function folderSegment(segment: string): void {
  if (segment.length === 0) {
    throw new DescribedError(described('settings.folders.path.emptyName'));
  }
  if (segment === '.' || segment === '..') {
    throw new DescribedError(described('settings.folders.path.stepOut'));
  }
  if (segment.length > PROJECT_FOLDER_LIMITS.segmentCharsMax) {
    throw new DescribedError(described('settings.folders.path.nameTooLong', { max: PROJECT_FOLDER_LIMITS.segmentCharsMax }));
  }
  if (segment.startsWith('.')) {
    throw new DescribedError(described('settings.folders.path.hidden'));
  }
  if (!SEGMENT.test(segment)) {
    throw new DescribedError(described('settings.folders.path.badChars', { name: segment }));
  }
  if (segment.endsWith(' ')) {
    throw new DescribedError(described('settings.folders.path.trailingSpace'));
  }
  if (RESERVED_SEGMENTS.has(segment)) {
    throw new DescribedError(described('settings.folders.path.reserved', { name: segment }));
  }
}

export function folderChoiceProblem(kind: ProjectFolderKind, existing: readonly string[], folder: string): string | undefined {
  return folderChoiceProblemDescribed(kind, existing, folder)?.message;
}

const OUTSIDE_KEYS = {
  components: 'settings.folders.problem.outside.components',
  layouts: 'settings.folders.problem.outside.layouts',
  assets: 'settings.folders.problem.outside.assets',
  styles: 'settings.folders.problem.outside.styles',
  variables: 'settings.folders.problem.outside.variables',
} as const satisfies Record<ProjectFolderKind, MessageKey>;

export function folderChoiceProblemDescribed(kind: ProjectFolderKind, existing: readonly string[], folder: string): Described | undefined {
  assert(folder.length > 0, 'folderChoiceProblem: the folder is named');
  const roots = PROJECT_FOLDER_ROOTS[kind];
  const top = folder.split('/')[0] ?? '';
  if (!roots.includes(top)) {
    return described(OUTSIDE_KEYS[kind], { folder });
  }
  if (kind === 'components' || kind === 'layouts') {
    if (isWithin(PAGES_FOLDER, folder)) {
      return described('settings.folders.problem.insidePages', { folder, pages: PAGES_FOLDER });
    }
    if (folder === 'src') {
      return described(kind === 'components' ? 'settings.folders.problem.srcPages.components' : 'settings.folders.problem.srcPages.layouts');
    }
  }
  for (const other of existing) {
    if (other === folder) {
      return described('settings.folders.problem.listed', { item: folder });
    }
    if (isWithin(other, folder)) {
      return described('settings.folders.problem.covered', { folder, other });
    }
    if (isWithin(folder, other)) {
      return described('settings.folders.problem.wouldCover', { folder, other });
    }
  }
  if (existing.length >= PROJECT_FOLDER_LIMITS.foldersPerKindMax) {
    return described('settings.folders.problem.foldersMax', { count: PROJECT_FOLDER_LIMITS.foldersPerKindMax });
  }
  return undefined;
}

export function isWithin(folder: string, rel: string): boolean {
  assert(folder.length > 0, 'isWithin: the folder is named');
  assert(!folder.endsWith('/'), 'isWithin: a folder has no trailing slash');
  return rel === folder || rel.startsWith(folder + '/');
}

export function folderHolding(folders: readonly string[], rel: string): string | undefined {
  assert(folders.length <= PROJECT_FOLDER_LIMITS.foldersPerKindMax, 'folderHolding: the folder list is bounded');
  return folders.find((folder) => isWithin(folder, rel));
}

export function isAboveFolder(folders: readonly string[], rel: string): boolean {
  assert(rel.length > 0, 'isAboveFolder: the path is named');
  return folders.some((folder) => folder !== rel && isWithin(rel, folder));
}

export function componentGroup(folders: readonly string[], rel: string): string {
  const folder = folderHolding(folders, rel);
  assert(folder !== undefined, 'componentGroup: the component is inside a component folder');
  const directory = rel.slice(0, Math.max(rel.lastIndexOf('/'), 0));
  const below = directory === folder ? '' : directory.slice(folder.length + 1);
  if (folders.length === 1) {
    return below;
  }
  const lead = folder.startsWith('src/') ? folder.slice('src/'.length) : folder;
  return below === '' ? lead : `${lead}/${below}`;
}

export function withFolders(config: ProjectFolders | undefined, kind: ProjectFolderKind, folders: readonly string[] | undefined): ProjectFolders {
  const base = config ?? EMPTY_PROJECT_FOLDERS;
  const choices: Record<string, readonly string[]> = {};
  for (const other of PROJECT_FOLDER_KINDS) {
    const chosen = other === kind ? folders : base.folders[other];
    if (chosen !== undefined) {
      choices[other] = chosen;
    }
  }
  if (choices['styles'] !== undefined && choices['variables'] === undefined) {
    choices['variables'] = DEFAULT_PROJECT_FOLDERS.variables;
  }
  const next: ProjectFolders = {
    version: 1,
    folders: choices,
    ...(base.unknownKeys === undefined ? {} : { unknownKeys: base.unknownKeys }),
    ...(base.unknownFolders === undefined ? {} : { unknownFolders: base.unknownFolders }),
    ...(base.cms === undefined ? {} : { cms: base.cms }),
  };
  assert(foldersFor(kind, next).join('\n') === (folders ?? DEFAULT_PROJECT_FOLDERS[kind]).join('\n'), 'withFolders: the kind reads what was set');
  assert(next.folders.styles === undefined || next.folders.variables !== undefined, 'withFolders: chosen styles always come with variables');
  return next;
}

export function addFolder(config: ProjectFolders | undefined, kind: ProjectFolderKind, input: string): Result<ProjectFolders, string> {
  const added = addFolderDescribed(config, kind, input);
  return added.ok ? added : err(added.error.message);
}

export function addFolderDescribed(config: ProjectFolders | undefined, kind: ProjectFolderKind, input: string): Result<ProjectFolders, Described> {
  let folder: string;
  try {
    folder = parseProjectFolder(input);
  } catch (error: unknown) {
    return err(problemOf(error));
  }
  const current = foldersFor(kind, config);
  const problem = folderChoiceProblemDescribed(kind, current, folder);
  if (problem !== undefined) {
    return err(problem);
  }
  const next = withFolders(config, kind, [...current, folder]);
  assert(foldersFor(kind, next).includes(folder), 'addFolder: the folder was added');
  return ok(next);
}

export function removeFolder(config: ProjectFolders | undefined, kind: ProjectFolderKind, folder: string): ProjectFolders {
  const current = foldersFor(kind, config);
  assert(current.includes(folder), 'removeFolder: the folder is in the list');
  const next = withFolders(
    config,
    kind,
    current.filter((other) => other !== folder),
  );
  assert(!foldersFor(kind, next).includes(folder), 'removeFolder: the folder was removed');
  return next;
}

export function serializeProjectFolders(config: ProjectFolders): string {
  const folders: Record<string, readonly string[]> = {};
  for (const kind of PROJECT_FOLDER_KINDS) {
    const chosen = config.folders[kind];
    if (chosen !== undefined) {
      folders[kind] = chosen;
    }
  }
  const shape = {
    version: 1,
    ...Object.fromEntries(config.unknownKeys ?? []),
    folders: { ...folders, ...Object.fromEntries((config.unknownFolders ?? []).filter(([key]) => knownFolderKind(key) === undefined)) },
    ...(config.cms === undefined ? {} : { cms: cmsShape(config.cms) }),
  };
  const source = JSON.stringify(shape, undefined, 2) + '\n';
  const reread = readProjectFoldersSource(source);
  assert(reread.kind === 'ready', 'serializeProjectFolders: the text parses');
  for (const kind of PROJECT_FOLDER_KINDS) {
    assert(reread.config.folders[kind]?.join('\n') === config.folders[kind]?.join('\n'), 'serializeProjectFolders: every kind round-trips');
  }
  assert((reread.config.unknownFolders?.length ?? 0) === (config.unknownFolders?.length ?? 0), 'serializeProjectFolders: unknown panels round-trip');
  assert(reread.config.cms?.files?.join('\n') === config.cms?.files?.join('\n'), 'serializeProjectFolders: CMS files round-trip');
  assert(reread.config.cms?.pickerExcluded?.join('\n') === config.cms?.pickerExcluded?.join('\n'), 'serializeProjectFolders: picker exclusions round-trip');
  return source;
}

function cmsShape(cms: ProjectCmsChoices) {
  return {
    ...(cms.files === undefined ? {} : { files: cms.files }),
    ...(cms.hiddenCollections === undefined ? {} : { hiddenCollections: cms.hiddenCollections }),
    ...(cms.pickerExcluded === undefined ? {} : { pickerExcluded: cms.pickerExcluded }),
    ...Object.fromEntries(cms.unknownKeys ?? []),
  };
}
