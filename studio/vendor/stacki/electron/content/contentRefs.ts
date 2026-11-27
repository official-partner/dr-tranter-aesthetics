import { cmsSourcePath } from '../lib/contentPaths';
import fs from 'fs';
import path from 'path';

import { LIMITS } from '../../shared/core/limits';
import type { MessageRef } from '../../shared/core/i18n/messageReference';
import { described, type Described } from '../../shared/properties/i18n/messageRef';
import { toRecord, toArray } from '../../shared/core/record';
import { listEntries, writeEntry } from './contentEntries';
import type { Entry as ListedEntry } from './contentEntries';


const REFERENCE_LIMITS = {
  derefDepthMax: 8,
  schemaDepthMax: 12,
  mentionsDepthMax: LIMITS.ipcDepthMax,
} as const;

const isPlainObject = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value);

const definitionsOf = (root: unknown): Record<string, unknown> => toRecord(toRecord(root)?.['$defs']) ?? {};

function deref(node: unknown, root: unknown, depth: number): Record<string, unknown> | undefined {
  const ref = toRecord(node)?.['$ref'];
  if (!ref || depth > REFERENCE_LIMITS.derefDepthMax) {
    return ref ? undefined : toRecord(node);
  }
  const name = String(ref).split('/').pop();
  const target = name === undefined ? undefined : definitionsOf(root)[name];
  if (!target) {
    return undefined;
  }
  return toRecord(target);
}

export type SchemaPath = readonly (string | number)[];

type SchemaNode = Record<string, unknown>;
type MatchPredicate = (node: SchemaNode, value: unknown) => boolean;

function referencePaths(
  schema: unknown,
  data: unknown,
  target: string,
  options: {
    readonly root?: unknown;
    readonly depth?: number;
    readonly path?: (string | number)[];
  } = {},
): SchemaPath[] {
  return matchingPaths(schema, data, (node, value) => node['astroReference'] === target && typeof value === 'string', options);
}

function matchingPaths(
  schema: unknown,
  data: unknown,
  match: MatchPredicate,
  { root = schema, depth = 0, path: at = [] }: { readonly root?: unknown; readonly depth?: number; readonly path?: (string | number)[] } = {},
): SchemaPath[] {
  const node = deref(schema, root, depth);
  if (!node || depth > REFERENCE_LIMITS.schemaDepthMax) {
    return [];
  }
  const found: SchemaPath[] = [];

  if (match(node, data)) {
    return [at];
  }

  const branches = toArray(node['oneOf']) ?? toArray(node['anyOf']);
  if (branches) {
    for (const branch of branches) {
      found.push(...matchingPaths(branch, data, match, { root, depth: depth + 1, path: at }));
    }
    return dedupe(found);
  }
  const items = toArray(data);
  if (node['type'] === 'array' && items) {
    items.forEach((item, index) => {
      found.push(
        ...matchingPaths(node['items'] ?? {}, item, match, {
          root,
          depth: depth + 1,
          path: [...at, index],
        }),
      );
    });
    return found;
  }
  const record = toRecord(data);
  if (record && isPlainObject(data)) {
    const properties = toRecord(node['properties']);
    const additional = toRecord(node['additionalProperties']);
    for (const [key, value] of Object.entries(record)) {
      const child = properties?.[key] ?? additional;
      if (!child) {
        continue;
      }
      found.push(...matchingPaths(child, value, match, { root, depth: depth + 1, path: [...at, key] }));
    }
  }
  return found;
}

const dedupe = (paths: SchemaPath[]): SchemaPath[] => {
  const seen = new Set<string>();
  return paths.filter((schemaPath) => {
    const key = schemaPath.join(' ');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

function mentions(schema: unknown, target: string, seen = new Set<unknown>(), depth = 0): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  if (depth > REFERENCE_LIMITS.mentionsDepthMax) {
    return true;
  }
  const list = toArray(schema);
  if (list) {
    for (const item of list) {
      if (typeof item !== 'object' || item === null || seen.has(item)) {
        continue;
      }
      seen.add(item);
      if (mentions(item, target, seen, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  const node = toRecord(schema);
  if (!node) {
    return false;
  }
  if (node['astroReference'] === target) {
    return true;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$defs' || key === '$schema') {
      continue;
    }
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    if (mentions(value, target, seen, depth + 1)) {
      return true;
    }
  }
  return Object.values(definitionsOf(node)).some((definition) => mentions(definition, target, seen, depth + 1));
}

const isRelativeAsset = (value: unknown): boolean => typeof value === 'string' && !!value && !/^(\/|[a-z][a-z0-9+.-]*:)/i.test(value);

const posix = path.posix;

function rewriteRelative(value: string, sourceDirectory: string, targetDirectory: string): string {
  const target = posix.normalize(posix.join(sourceDirectory, value));
  const next = posix.relative(targetDirectory, target);
  return next.startsWith('.') ? next : './' + next;
}

interface CollectionLike {
  readonly name: string;
  readonly editable?: boolean;
  readonly schema?: unknown;
  readonly loader: { readonly kind: string; readonly generateId?: unknown };
}

type Move =
  | { readonly kind: 'generated'; readonly note: string; readonly noteRef: MessageRef }
  | { readonly kind: 'unknown'; readonly note: string; readonly noteRef: MessageRef }
  | { readonly kind: 'file'; readonly from: string; readonly to: string }
  | { readonly kind: 'key'; readonly file: string; readonly locator: readonly (string | number)[] }
  | {
      readonly kind: 'field';
      readonly file: string;
      readonly locator: readonly (string | number)[];
    };

export interface Pointer {
  readonly collection: string;
  readonly entryId: string;
  readonly entryTitle: string;
  readonly file: string;
  readonly path: SchemaPath;
  readonly entry: { readonly file: string; readonly locator: readonly (string | number)[] };
}

export interface ImageEdit {
  readonly path: SchemaPath;
  readonly from: unknown;
  readonly value: string;
}

export interface RenamePlan {
  readonly collection: string;
  readonly from: string;
  readonly to: string;
  readonly entry: ListedEntry;
  readonly move: Move;
  readonly pointers: readonly Pointer[];
  readonly imageEdits: readonly ImageEdit[];
}

const stepInto = (node: unknown, key: string | number): unknown => (typeof key === 'number' ? toArray(node)?.[key] : toRecord(node)?.[key]);

function planRename(
  projectPath: string,
  collections: readonly CollectionLike[],
  { collection: name, from, to }: { readonly collection: string; readonly from: string; readonly to: string },
): RenamePlan {
  const collection = collections.find((candidate) => candidate.name === name);
  if (!collection) {
    throw new Error(`${name} is not a collection in this project.`);
  }
  const listed = listEntries(projectPath, collection);
  const entry = listed.entries.find((listedEntry) => listedEntry.id === from);
  if (!entry) {
    throw new Error(`${name} has no entry with the id "${from}".`);
  }
  if (listed.entries.some((listedEntry) => listedEntry.id === to)) {
    throw new Error(`${name} already has an entry with the id "${to}".`);
  }
  const pointers = pointersTo(projectPath, collections, name, from);
  const move = entryMove(collection, entry, { name, from, to });
  const imageEdits = move.kind === 'file' ? movedImageEdits(collection, entry, move.to) : [];
  return { collection: name, from, to, entry, move, pointers, imageEdits };
}

const valueAt = (data: unknown, at: SchemaPath): unknown =>
  at.reduce<unknown>((node, key) => (node === undefined || node === null ? node : stepInto(node, key)), data);

function pointersTo(projectPath: string, collections: readonly CollectionLike[], name: string, from: string): Pointer[] {
  const pointers: Pointer[] = [];
  for (const other of collections) {
    if (!other.editable || !other.schema || !mentions(other.schema, name)) {
      continue;
    }
    const otherEntries = listEntries(projectPath, other).entries;
    for (const candidate of otherEntries) {
      for (const at of referencePaths(other.schema, candidate.data, name)) {
        if (valueAt(candidate.data, at) !== from) {
          continue;
        }
        pointers.push({
          collection: other.name,
          entryId: candidate.id,
          entryTitle: candidate.title,
          file: candidate.file,
          path: at,
          entry: { file: candidate.file, locator: candidate.locator },
        });
      }
    }
  }
  return pointers;
}

function entryMove(
  collection: CollectionLike,
  entry: ListedEntry,
  { name, from, to }: { readonly name: string; readonly from: string; readonly to: string },
): Move {
  if (collection.loader.kind === 'glob') {
    if (collection.loader.generateId) {
      const problem = described('cmsBackend.entry.generated', { collection: name });
      return { kind: 'generated', note: problem.message, noteRef: problem.messageRef };
    }
    const extension = path.extname(entry.file);
    const pathPrefix = entry.file.slice(0, entry.file.length - extension.length - from.length);
    return { kind: 'file', from: entry.file, to: `${pathPrefix}${to}${extension}` };
  }
  if (entry.keyed) {
    return { kind: 'key', file: entry.file, locator: entry.locator };
  }
  if (isPlainObject(entry.data) && typeof toRecord(entry.data)?.['id'] === 'string') {
    return { kind: 'field', file: entry.file, locator: entry.locator };
  }
  const problem = described('cmsBackend.entry.noId', { file: entry.file });
  return { kind: 'unknown', note: problem.message, noteRef: problem.messageRef };
}

function entryRenameLock(collection: CollectionLike & { readonly loader: { readonly parser?: unknown } }, entry: ListedEntry): Described | undefined {
  if (collection.loader.parser) {
    return described('cmsBackend.entry.parsed', { collection: collection.name });
  }
  const move = entryMove(collection, entry, { name: collection.name, from: entry.id, to: entry.id });
  switch (move.kind) {
    case 'generated':
    case 'unknown':
      return { message: move.note, messageRef: move.noteRef };
    case 'file':
    case 'key':
    case 'field':
      return undefined;
    default: {
      const exhaustive: never = move;
      return exhaustive;
    }
  }
}

function movedImageEdits(collection: CollectionLike, entry: ListedEntry, movedTo: string): ImageEdit[] {
  const imageEdits: ImageEdit[] = [];
  if (!collection.schema) {
    return imageEdits;
  }
  const sourceDirectory = posix.dirname(entry.file);
  const targetDirectory = posix.dirname(movedTo);
  if (sourceDirectory === targetDirectory) {
    return imageEdits;
  }
  const isImage = (node: SchemaNode, value: unknown): boolean => !!node['astroImage'] && isRelativeAsset(value);
  for (const at of matchingPaths(collection.schema, entry.data, isImage)) {
    const value = valueAt(entry.data, at);
    imageEdits.push({
      path: at,
      from: value,
      value: rewriteRelative(String(value), sourceDirectory, targetDirectory),
    });
  }
  return imageEdits;
}

function applyRename(projectPath: string, plan: RenamePlan): { renamed: boolean; pointers: number; files: string[] } {
  const touched = new Set<string>();
  for (const pointer of plan.pointers) {
    writeEntry(projectPath, pointer.entry, [{ path: pointer.path, value: plan.to }]);
    touched.add(pointer.file);
  }

  const { move } = plan;
  if (move.kind === 'file') {
    if (plan.imageEdits.length) {
      writeEntry(
        projectPath,
        plan.entry,
        plan.imageEdits.map(({ path: at, value }) => ({ path: at, value })),
      );
    }
    const from = cmsSourcePath(projectPath, move.from);
    const to = cmsSourcePath(projectPath, move.to);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    touched.add(move.to);
  } else if (move.kind === 'key') {
    writeEntry(projectPath, { file: move.file, locator: [] }, [{ path: move.locator, rename: plan.to }]);
    touched.add(move.file);
  } else if (move.kind === 'field') {
    writeEntry(projectPath, plan.entry, [{ path: ['id'], value: plan.to }]);
    touched.add(move.file);
  }

  return {
    renamed: move.kind !== 'unknown' && move.kind !== 'generated',
    pointers: plan.pointers.length,
    files: [...touched],
  };
}

export { planRename, applyRename, entryRenameLock, referencePaths, matchingPaths, rewriteRelative, mentions };
