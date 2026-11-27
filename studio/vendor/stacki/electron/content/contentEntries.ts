import { cmsDirectoryPath, cmsSourcePath } from '../lib/contentPaths';
import fs from 'fs';
import path from 'path';

import { LIMITS } from '../../shared/core/limits';
import type { MessageRef } from '../../shared/core/i18n/messageReference';
import { described, type Described } from '../../shared/properties/i18n/messageRef';
import { toRecord, toArray } from '../../shared/core/record';
import { MAIN_LIMITS } from '../lib/mainLimits';
import { runSliced, runSync, type SlicedWork } from '../lib/slicedWork';
import { writeProjectText } from '../../../../src/features/cms/cmsHost';
import { assertContentWitness } from './contentWitness';
import { entryTitleOf, titleFieldsOf } from '../../shared/properties/entryTitle';
import * as frontmatter from './formats/markdownEntry';
import * as jsonFormat from './formats/json';
import * as yamlFormat from './formats/yaml';
import * as tomlFormat from './formats/toml';
import * as csvFormat from './formats/csv';
import * as ndjsonFormat from './formats/ndjson';


interface FormatEdit {
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
  readonly rename?: string;
}

interface FormatModule {
  readonly parseData: (text: string) => unknown;
  readonly applyEdits: (text: string, edits: readonly FormatEdit[], opts?: { readonly body?: string }) => string;
  readonly DELETE: symbol;
}

const FORMATS: Record<string, FormatModule> = {
  md: frontmatter,
  mdx: frontmatter,
  mdoc: frontmatter,
  markdown: frontmatter,
  json: jsonFormat,
  yaml: yamlFormat,
  yml: yamlFormat,
  toml: tomlFormat,
  csv: csvFormat,
  ndjson: ndjsonFormat,
};

const extensionOf = (file: string): string => (file.split('.').pop() || '').toLowerCase();
const formatFor = (file: string): FormatModule | undefined => FORMATS[extensionOf(file)];
const formatName = (file: string): string => {
  const ext = extensionOf(file);
  return FORMATS[ext] === frontmatter ? 'frontmatter' : ext;
};

const toPosix = (filePath: string): string => filePath.split(path.sep).join('/');
const isPlainObject = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value);

function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i);
    if (ch === '*') {
      if (pattern.charAt(i + 1) === '*') {
        out += pattern.charAt(i + 2) === '/' ? '(?:.*\\/)?' : '.*';
        i += pattern.charAt(i + 2) === '/' ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '[' && pattern.indexOf(']', i + 2) !== -1) {
      const close = pattern.indexOf(']', i + 2);
      out += characterClass(pattern.slice(i + 1, close));
      i = close;
    } else if (ch === '{') {
      const close = pattern.indexOf('}', i);
      out += `(?:${pattern
        .slice(i + 1, close)
        .split(',')
        .map((choice) => choice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})`;
      i = close;
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function characterClass(body: string): string {
  const negated = body.startsWith('!') || body.startsWith('^');
  const members = (negated ? body.slice(1) : body).replace(/[\\[\]^]/g, '\\$&');
  return negated ? `[^/${members}]` : `(?!/)[${members}]`;
}

function globMatcher(pattern: LoaderInfo['pattern']): (relative: string) => boolean {
  const list: readonly string[] = typeof pattern === 'string' ? [pattern] : (pattern ?? []);
  const wanted = list.filter((each) => !each.startsWith('!')).map(globToRegExp);
  const excluded = list.filter((each) => each.startsWith('!')).map((each) => globToRegExp(each.slice(1)));
  return (relative) => wanted.some((matcher) => matcher.test(relative)) && !excluded.some((matcher) => matcher.test(relative));
}

function* walkFilesSliced(directory: string, base = directory, out: string[] = [], depth = 0): SlicedWork<string[]> {
  if (depth > MAIN_LIMITS.directoryDepthMax) {
    return out;
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkFilesSliced(full, base, out, depth + 1);
    } else {
      out.push(toPosix(path.relative(base, full)));
    }
  }
  yield;
  return out;
}

export interface LoaderInfo {
  readonly kind?: string;
  readonly base?: string;
  readonly pattern?: string | readonly string[];
  readonly file?: string;
  readonly generateId?: unknown;
  readonly parser?: unknown;
}

export interface ContentCollection {
  readonly name: string;
  readonly loader?: LoaderInfo;
  readonly editable?: boolean;
  readonly schema?: unknown;
}

export interface Entry {
  readonly id: string;
  readonly file: string;
  readonly format: string;
  readonly locator: readonly (string | number)[];
  readonly data: unknown;
  readonly title: string;
  readonly body?: string;
  readonly hasBody?: boolean;
  readonly error?: string;
  readonly keyed?: boolean;
}

export interface EntryEdit {
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
  readonly rename?: string;
}

export interface ListResult {
  readonly entries: Entry[];
  readonly readOnly: boolean;
  readonly reason?: string | undefined;
  readonly reasonRef?: MessageRef | undefined;
  readonly idsAreGuesses?: boolean;
  readonly idNote?: string | undefined;
  readonly idNoteRef?: MessageRef | undefined;
  readonly shape?: string;
  readonly parsed?: boolean;
  readonly parserNote?: string | undefined;
  readonly parserNoteRef?: MessageRef | undefined;
}

function idNoteFields(problem: Described): Pick<ListResult, 'idNote' | 'idNoteRef'> {
  return { idNote: problem.message, ...(problem.messageRef === undefined ? {} : { idNoteRef: problem.messageRef }) };
}

function parserNoteFields(problem: Described): Pick<ListResult, 'parserNote' | 'parserNoteRef'> {
  return { parserNote: problem.message, ...(problem.messageRef === undefined ? {} : { parserNoteRef: problem.messageRef }) };
}

function listEntries(projectPath: string, collection: ContentCollection): ListResult {
  return runSync(entriesSliced(projectPath, collection));
}

function listEntriesSliced(projectPath: string, collection: ContentCollection): Promise<ListResult> {
  return runSliced(entriesSliced(projectPath, collection));
}

function* entriesSliced(projectPath: string, collection: ContentCollection): SlicedWork<ListResult> {
  const loader = collection.loader ?? {};
  if (loader.kind === 'glob') {
    return yield* globEntries(projectPath, collection);
  }
  if (loader.kind === 'file') {
    return fileEntries(projectPath, collection);
  }
  return { entries: [], readOnly: true, ...readOnlyReason(collection) };
}

function readOnlyReason(collection: ContentCollection): ReasonFields {
  const loader = collection.loader ?? {};
  if (loader.kind === 'custom') {
    return reasonFields(described('cmsBackend.entries.customLoader', { collection: collection.name }));
  }
  return {};
}

type ReasonFields = { readonly reason?: string; readonly reasonRef?: MessageRef };
function reasonFields(problem: Described): ReasonFields {
  return { reason: problem.message, ...(problem.messageRef === undefined ? {} : { reasonRef: problem.messageRef }) };
}

function* globEntries(projectPath: string, collection: ContentCollection): SlicedWork<ListResult> {
  const loader = collection.loader ?? {};
  const root = cmsDirectoryPath(projectPath, String(loader.base ?? ''));
  const files = (yield* walkFilesSliced(root)).filter(globMatcher(loader.pattern));
  files.sort();

  const titleFields = titleFieldsOf(collection.schema);
  const entries: Entry[] = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    const format = formatFor(rel);
    if (!format) {
      continue;
    }
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const base: Pick<Entry, 'id' | 'file' | 'format' | 'locator'> = {
      id: rel.replace(/\.[^./]+$/, ''),
      file: toPosix(path.relative(projectPath, abs)),
      format: formatName(rel),
      locator: [],
    };
    let entry: Omit<Entry, 'title'>;
    try {
      if (format === frontmatter) {
        const parsed = frontmatter.parse(text);
        entry = { ...base, data: parsed.data || {}, body: parsed.body, hasBody: true };
      } else {
        entry = { ...base, data: format.parseData(text) };
      }
    } catch (error: unknown) {
      entry = { ...base, error: String(error instanceof Error ? error.message : error), data: {} };
    }
    entries.push({ ...entry, title: entryTitleOf(entry.data, { id: entry.id, fields: titleFields }) });
    yield;
  }

  const generated = loader.generateId;
  return {
    entries,
    readOnly: false,
    idsAreGuesses: !!generated,
    ...(generated ? idNoteFields(described('cmsBackend.entries.idsGenerated', { collection: collection.name })) : {}),
  };
}

interface RawRecord {
  readonly id: string;
  readonly idKey: string | undefined;
  readonly keyed?: boolean;
  readonly locator: readonly (string | number)[];
  readonly record: Record<string, unknown>;
}

function locateRecords(data: unknown): { shape: string; records: RawRecord[] } {
  const list = toArray(data);
  if (list) {
    if (!list.length || !list.every(isPlainObject)) {
      return { shape: 'array', records: [] };
    }
    return {
      shape: 'array',
      records: list.map((record, index) => {
        const rec = toRecord(record) ?? {};
        const id = rec['id'];
        return {
          id: typeof id === 'string' ? id : String(index),
          idKey: typeof id === 'string' ? 'id' : undefined,
          locator: [index],
          record: rec,
        };
      }),
    };
  }
  const top = toRecord(data);
  if (!top) {
    return { shape: 'unknown', records: [] };
  }

  const keys = Object.keys(top).filter((key) => key !== '$schema');
  if (keys.length && keys.every((key) => isPlainObject(top[key]))) {
    return {
      shape: 'keyed',
      records: keys.map((key) => ({
        id: key,
        idKey: undefined,
        keyed: true,
        locator: [key],
        record: toRecord(top[key]) ?? {},
      })),
    };
  }

  const records: RawRecord[] = [];
  const visit = (node: unknown, locator: readonly (string | number)[]): void => {
    const depth = locator.length;
    if (depth > LIMITS.ipcDepthMax) {
      return;
    }
    const items = toArray(node);
    if (items) {
      items.forEach((item, index) => visit(item, [...locator, index]));
      return;
    }
    const record = toRecord(node);
    if (!record) {
      return;
    }
    const id = record['id'];
    if (typeof id === 'string' && locator.length) {
      records.push({ id, idKey: 'id', locator, record });
      return;
    }
    for (const [key, value] of Object.entries(record)) {
      visit(value, [...locator, key]);
    }
  };
  visit(data, []);
  return { shape: records.length ? 'nested' : 'single', records };
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function fileEntries(projectPath: string, collection: ContentCollection): ListResult {
  const loader = collection.loader ?? {};
  const rel = toPosix(String(loader.file ?? '')).replace(/^\.\//, '');
  const abs = cmsSourcePath(projectPath, rel);
  const format = formatFor(rel);
  if (!format) {
    return {
      entries: [],
      readOnly: true,
      ...reasonFields(described('cmsBackend.data.unreadableFormat', { extension: path.extname(rel) })),
    };
  }
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (error: unknown) {
    return {
      entries: [],
      readOnly: true,
      ...reasonFields(described('cmsBackend.data.readFailed', { file: rel, detail: errorMessage(error) })),
    };
  }

  let data: unknown;
  try {
    data = format.parseData(text);
  } catch (error: unknown) {
    return {
      entries: [],
      readOnly: true,
      ...reasonFields(described('cmsBackend.data.parseFailed', { file: rel, detail: errorMessage(error) })),
    };
  }

  const { shape, records } = locateRecords(data);
  const titleFields = titleFieldsOf(collection.schema);
  const entries: Entry[] = records.map(({ id, locator, record, keyed }) => ({
    id,
    file: rel,
    format: formatName(rel),
    locator,
    keyed: !!keyed,
    data: record,
    title: entryTitleOf(record, { id, fields: titleFields }),
  }));

  return {
    entries,
    readOnly: false,
    shape,
    parsed: !!loader.parser,
    ...(loader.parser ? parserNoteFields(described('cmsBackend.entries.parserNote', { collection: collection.name })) : {}),
  };
}

function writeEntry(
  projectPath: string,
  entry: { readonly file: string; readonly locator?: readonly (string | number)[] },
  edits: readonly EntryEdit[],
  {
    body,
    expected,
  }: {
    readonly body?: string;
    readonly expected?: { readonly data?: unknown; readonly body?: string | undefined };
  } = {},
): { ok: true; changed: boolean } {
  const abs = cmsSourcePath(projectPath, entry.file);
  const format = formatFor(entry.file);
  if (!format) {
    throw new Error(`Stacki cannot write ${path.extname(entry.file)} files.`);
  }
  const text = fs.readFileSync(abs, 'utf8');

  const locator = entry.locator ?? [];
  if (expected) {
    assertContentWitness(format.parseData(text), locator, expected.data);
    if (expected.body !== undefined && frontmatter.parse(text).body !== expected.body) {
      throw new Error('Content changed. Reopen the text before saving.');
    }
  }
  const prefixed: FormatEdit[] = edits.map((edit) =>
    edit.rename !== undefined
      ? { path: [...locator, ...edit.path], rename: edit.rename }
      : {
          path: [...locator, ...edit.path],
          value: edit.value === undefined ? format.DELETE : edit.value,
        },
  );

  const next = format === frontmatter ? frontmatter.applyEdits(text, prefixed, { body }) : format.applyEdits(text, prefixed);
  if (next === text) {
    return { ok: true, changed: false };
  }
  writeProjectText(abs, next, text);
  return { ok: true, changed: true };
}

function countEntries(projectPath: string, collection: ContentCollection): number {
  return runSync(countEntriesWork(projectPath, collection));
}

function countEntriesSliced(projectPath: string, collection: ContentCollection): Promise<number> {
  return runSliced(countEntriesWork(projectPath, collection));
}

function* countEntriesWork(projectPath: string, collection: ContentCollection): SlicedWork<number> {
  const loader = collection.loader ?? {};
  if (loader.kind === 'glob') {
    const root = cmsDirectoryPath(projectPath, String(loader.base ?? ''));
    return (yield* walkFilesSliced(root)).filter(globMatcher(loader.pattern)).length;
  }
  if (loader.kind === 'file') {
    try {
      return (yield* entriesSliced(projectPath, collection)).entries.length;
    } catch {
      return 0;
    }
  }
  return 0;
}

function coveredPaths(
  projectPath: string,
  collections: readonly ContentCollection[],
): {
  files: string[];
  dirs: string[];
} {
  return runSync(coveredSliced(projectPath, collections));
}

function coveredPathsSliced(projectPath: string, collections: readonly ContentCollection[]): Promise<CoveredPaths> {
  return runSliced(coveredSliced(projectPath, collections));
}

interface CoveredPaths {
  files: string[];
  dirs: string[];
}

function* coveredSliced(projectPath: string, collections: readonly ContentCollection[]): SlicedWork<CoveredPaths> {
  const files: string[] = [];
  const directories: string[] = [];
  for (const collection of collections) {
    const loader = collection.loader ?? {};
    if (loader.kind === 'file' && loader.file) {
      files.push(toPosix(loader.file).replace(/^\.\//, ''));
    }
    if (loader.kind === 'glob' && loader.base) {
      const base = toPosix(loader.base).replace(/^\.\//, '').replace(/\/$/, '');
      if (isDataDirectory(base)) {
        const root = cmsDirectoryPath(projectPath, base);
        const matches = globMatcher(loader.pattern);
        for (const relative of yield* walkFilesSliced(root)) {
          if (matches(relative)) {
            files.push(toPosix(path.relative(projectPath, path.join(root, relative))));
          }
        }
      } else {
        directories.push(base);
      }
    }
  }
  return {
    files: [...new Set(files)].sort(),
    dirs: [...new Set(directories)].sort(),
  };
}

function isDataDirectory(directory: string): boolean {
  if (directory === 'src/data') {
    return true;
  }
  return directory.startsWith('src/data/');
}

export {
  listEntries,
  listEntriesSliced,
  writeEntry,
  countEntries,
  countEntriesSliced,
  coveredPaths,
  coveredPathsSliced,
  locateRecords,
  globMatcher,
  formatFor,
  formatName,
};
