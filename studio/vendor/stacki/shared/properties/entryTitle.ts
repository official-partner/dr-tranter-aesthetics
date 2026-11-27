
import { assert } from '../core/assert';
import { toArray, toRecord } from '../core/record';

export const NAME_KEYS = ['title', 'name', 'heading', 'label'] as const;

const ASTRO_NAME_KEYS = ['header', 'question', 'siteName', 'quote'] as const;

export const ENTRY_TITLE_CHARS_MAX = 200;

const ENTRY_TITLE_FIELDS_MAX = 200;

export const UNTITLED = 'untitled';

const IMAGE_PATH = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

export interface TitleFields {
  readonly order: readonly string[];
  readonly skipped: readonly string[];
}

export const NO_TITLE_FIELDS: TitleFields = { order: [], skipped: [] };

export function titleFieldsOf(schema: unknown): TitleFields {
  const properties = toRecord(toRecord(schema)?.['properties']);
  if (properties === undefined) {
    return NO_TITLE_FIELDS;
  }
  const order: string[] = [];
  const skipped: string[] = [];
  for (const [name, property] of Object.entries(properties).slice(0, ENTRY_TITLE_FIELDS_MAX)) {
    order.push(name);
    if (namesNothing(property)) {
      skipped.push(name);
    }
  }
  assert(order.length <= ENTRY_TITLE_FIELDS_MAX, 'Title fields are bounded');
  assert(skipped.length <= order.length, 'Only declared fields are skipped');
  return { order, skipped };
}

export function entryTitleOf(data: unknown, context: { readonly id: string; readonly fields: TitleFields }): string {
  const title = entryNameOf(data, context.fields) ?? (context.id.trim() || UNTITLED);
  const shown = title.slice(0, ENTRY_TITLE_CHARS_MAX);
  assert(shown.length > 0, 'An entry is always named');
  assert(shown.length <= ENTRY_TITLE_CHARS_MAX, 'An entry name is bounded');
  return shown;
}

export function entryNameOf(data: unknown, fields: TitleFields): string | undefined {
  const record = toRecord(data) ?? {};
  const name = namedTitle(record) ?? firstTextTitle(record, fields);
  assert(name === undefined || name.trim() !== '', 'A name is never blank');
  return name?.slice(0, ENTRY_TITLE_CHARS_MAX);
}

function namedTitle(record: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of [...NAME_KEYS, ...ASTRO_NAME_KEYS]) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

function firstTextTitle(record: Readonly<Record<string, unknown>>, fields: TitleFields): string | undefined {
  const declared = new Set(fields.order);
  const names = [...fields.order, ...Object.keys(record).filter((name) => !declared.has(name))].slice(0, ENTRY_TITLE_FIELDS_MAX);
  for (const name of names) {
    if (fields.skipped.includes(name)) {
      continue;
    }
    const text = shortText(record[name]);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function shortText(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  if (text === '') {
    return undefined;
  }
  if (text.length > ENTRY_TITLE_CHARS_MAX) {
    return undefined;
  }
  if (text.includes('\n')) {
    return undefined;
  }
  return IMAGE_PATH.test(text) ? undefined : text;
}

function namesNothing(property: unknown): boolean {
  const node = toRecord(property);
  if (node === undefined) {
    return false;
  }
  const branches = toArray(node['anyOf']) ?? toArray(node['oneOf']) ?? [];
  return [node, ...branches.slice(0, 2)].some((each) => {
    const branch = toRecord(each);
    if (branch === undefined) {
      return false;
    }
    if (branch['astroImage'] === true) {
      return true;
    }
    return branch['astroReference'] !== undefined;
  });
}
