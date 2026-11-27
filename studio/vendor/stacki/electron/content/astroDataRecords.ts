
import { assert } from '../../shared/core/assert';
import { toRecord } from '../../shared/core/record';
import type { RemoteSchemaField } from '../../shared/properties/cmsRemoteSchema';
import fs from 'node:fs';
import { cmsSourcePath } from '../lib/contentPaths';
import { formatFor, formatName, writeEntry, type Entry } from './contentEntries';

const WRITABLE_FORMATS = new Set(['json', 'yaml', 'yml']);
const RECORD_IDS_MAX = 1000;

export interface AddedRecord {
  readonly id: string;
}

export function addDataRecord(
  projectPath: string,
  context: {
    readonly file: string;
    readonly entries: readonly Entry[];
    readonly fields: readonly RemoteSchemaField[];
  },
): AddedRecord {
  const format = formatName(context.file);
  writableFormat(format);
  const last = context.entries.at(-1);
  const id = freeId(context.entries);
  const seeded = seed(context.fields, context.entries);
  const container = last?.locator.slice(0, -1) ?? [];
  const place = last === undefined ? emptyShape(projectPath, context.file) : last.locator.at(-1);
  if (typeof place === 'number') {
    const named = last === undefined || 'id' in (toRecord(last.data) ?? {});
    const record = named ? { id, ...seeded } : seeded;
    writeEntry(projectPath, { file: context.file, locator: container }, [{ path: [place + 1], value: record }]);
    return { id: named ? id : String(place + 1) };
  }
  assert(typeof place === 'string', 'A keyed record sits under its key');
  writeEntry(projectPath, { file: context.file, locator: container }, [{ path: [id], value: seeded }]);
  return { id };
}

function emptyShape(projectPath: string, file: string): number | string {
  const format = formatFor(file);
  assert(format !== undefined, 'A writable data file has a format');
  const data = format.parseData(fs.readFileSync(cmsSourcePath(projectPath, file), 'utf8'));
  if (Array.isArray(data)) {
    return -1;
  }
  if (toRecord(data) !== undefined) {
    return 'key';
  }
  throw new Error(`${file} holds no list or object of records to add to.`);
}

export function removeDataRecords(projectPath: string, entries: readonly Entry[]): number {
  const ordered = [...entries].sort((left, right) => placeOrder(right) - placeOrder(left));
  for (const entry of ordered) {
    writableFormat(entry.format);
    assert(entry.locator.length > 0, 'A record in a data file has a place in it');
    writeEntry(projectPath, { file: entry.file, locator: [] }, [{ path: entry.locator, value: undefined }]);
  }
  assert(ordered.length === entries.length, 'Every record named is removed');
  return ordered.length;
}

function writableFormat(format: string): void {
  if (!WRITABLE_FORMATS.has(format)) {
    throw new Error(`Stacki adds and removes records in JSON and YAML files, not ${format}.`);
  }
}

function placeOrder(entry: Entry): number {
  const place = entry.locator.at(-1);
  return typeof place === 'number' ? place : -1;
}

function freeId(entries: readonly Entry[]): string {
  const taken = new Set(entries.map((entry) => entry.id));
  for (let index = 1; index <= RECORD_IDS_MAX; index += 1) {
    const id = index === 1 ? 'untitled' : `untitled-${index}`;
    if (!taken.has(id)) {
      return id;
    }
  }
  throw new Error('Rename some untitled records before adding another.');
}

function seed(fields: readonly RemoteSchemaField[], entries: readonly Entry[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.required) {
      record[field.name] = blank(field);
    }
  }
  const sample = toRecord(entries.at(-1)?.data) ?? {};
  const named = ['title', 'name'].find((key) => key in record || key in sample) ?? 'title';
  record[named] = 'Untitled';
  assert(record[named] === 'Untitled', 'A new record is named as new');
  return record;
}

function blank(field: RemoteSchemaField): unknown {
  const { type } = field;
  if (type.kind === 'boolean') {
    return false;
  }
  if (type.kind === 'number') {
    return 0;
  }
  if (type.kind === 'array') {
    return [];
  }
  if (type.kind === 'object') {
    return {};
  }
  return type.kind === 'string' && type.options[0] !== undefined ? type.options[0].value : '';
}
