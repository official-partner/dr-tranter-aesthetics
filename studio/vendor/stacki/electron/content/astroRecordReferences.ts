
import fs from 'node:fs';
import path from 'node:path';

import { assert } from '../../shared/core/assert';
import { toArray, toRecord } from '../../shared/core/record';
import { REMOTE_SCHEMA_LIMITS, type RemoteOption, type RemoteSchemaField, type RemoteType } from '../../shared/properties/cmsRemoteSchema';
import type { Entry } from './contentEntries';

export interface RecordCollection {
  readonly name: string;
  readonly entries: readonly Entry[];
  readonly imageOf?: ((entry: Entry) => string | undefined) | undefined;
}

export function withInferredReferences(
  fields: readonly RemoteSchemaField[],
  own: RecordCollection,
  collections: readonly RecordCollection[],
): readonly RemoteSchemaField[] {
  const inferred = fields.map((field) => {
    const scalar = plainString(field.type);
    if (scalar === undefined) {
      return field;
    }
    const values = fieldValues(own.entries, field.name);
    const options = values.length === 0 ? undefined : targetOptions(values, collections);
    if (options === undefined) {
      return field;
    }
    const choice = { kind: 'string' as const, options };
    const type: RemoteType = scalar === 'list' ? { kind: 'array', of: [choice] } : choice;
    return { ...field, type };
  });
  assert(inferred.length === fields.length, 'Inference changes fields, never their number');
  return inferred;
}

function plainString(type: RemoteType): 'one' | 'list' | undefined {
  const free = (member: RemoteType | undefined) => member?.kind === 'string' && member.options.length === 0 && member.asset === undefined;
  if (free(type)) {
    return 'one';
  }
  if (type.kind === 'array' && type.of.length === 1 && free(type.of[0])) {
    return 'list';
  }
  return undefined;
}

function fieldValues(entries: readonly Entry[], name: string): readonly string[] {
  const values = new Set<string>();
  for (const entry of entries) {
    const value = toRecord(entry.data)?.[name];
    const items = toArray(value) ?? [value];
    for (const item of items) {
      if (typeof item === 'string' && item.length > 0) {
        values.add(item);
      }
    }
  }
  return [...values];
}

function targetOptions(values: readonly string[], collections: readonly RecordCollection[]): readonly RemoteOption[] | undefined {
  for (const collection of collections) {
    if (collection.entries.length > REMOTE_SCHEMA_LIMITS.optionsMax) {
      continue;
    }
    for (const key of KEYS) {
      const named = new Set(collection.entries.map(key).filter(isString));
      if (values.every((value) => named.has(value))) {
        return collection.entries.flatMap((entry) => {
          const value = key(entry);
          const imageFile = collection.imageOf?.(entry);
          return value === undefined ? [] : [{ title: entry.title, value, ...(imageFile === undefined ? {} : { imageFile }) }];
        });
      }
    }
  }
  return undefined;
}

const KEYS: readonly ((entry: Entry) => string | undefined)[] = [
  (entry) => entry.id,
  (entry) => {
    const id = toRecord(entry.data)?.['_id'];
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  },
];

export function projectImage(projectPath: string, entryFile: string, value: string): string | undefined {
  const target = value.trim().split(/[?#]/)[0] ?? '';
  if (target.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('@')) {
    return undefined;
  }
  if (target.startsWith('/')) {
    const published = inProject(path.posix.join('public', target));
    const rooted = inProject(target.slice(1));
    if (published !== undefined && isFile(projectPath, published)) {
      return published;
    }
    return rooted !== undefined && isFile(projectPath, rooted) ? rooted : published;
  }
  return inProject(path.posix.join(path.posix.dirname(entryFile), target));
}

export function entryImage(projectPath: string, entry: Entry, imageField: string | undefined): string | undefined {
  const picture = imageField === undefined ? undefined : toRecord(entry.data)?.[imageField];
  return typeof picture === 'string' ? projectImage(projectPath, entry.file, picture) : undefined;
}

function inProject(joined: string): string | undefined {
  const file = path.posix.normalize(joined);
  if (file.startsWith('..') || path.posix.isAbsolute(file)) {
    return undefined;
  }
  assert(!file.split('/').includes('..'), 'A project image stays inside the project');
  assert(file.length > 0, 'A project image names a file');
  return file;
}

function isFile(projectPath: string, file: string): boolean {
  assert(path.isAbsolute(projectPath), 'A project path is absolute');
  return fs.statSync(path.join(projectPath, file), { throwIfNoEntry: false })?.isFile() === true;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
