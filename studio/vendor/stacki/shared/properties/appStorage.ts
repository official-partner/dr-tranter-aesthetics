import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { parseAppId } from './apps';

export const APP_DATA_DIRECTORY = '.stacki/app-data';

export const APP_STORAGE_SCOPES = ['project', 'local'] as const;
export type AppStorageScope = (typeof APP_STORAGE_SCOPES)[number];

export const APP_STORAGE_LIMITS = {
  valueBytesMax: 256 * 1024,
  appBytesMax: 4 * 1024 * 1024,
  keysMax: 1000,
  keyCharsMax: 128,
  keySegmentsMax: 8,
  fileBytesMax: 4 * 1024 * 1024 * 2 + 64 * 1024,
  changeKeysMax: 64,
  writerCharsMax: 64,
} as const satisfies Record<string, number>;

export type AppStorageValues = ReadonlyMap<string, string>;

export interface AppStorageChange {
  readonly appId: string;
  readonly scope: AppStorageScope;
  readonly keys: readonly string[] | undefined;
  readonly writer: string | undefined;
}

const KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const WRITER = /^[A-Za-z0-9_-]+$/;
const FILE_VERSION = 1;

export function parseAppStorageScope(input: unknown): AppStorageScope {
  if (input === undefined) {
    return 'project';
  }
  const found = APP_STORAGE_SCOPES.find((scope) => scope === input);
  if (found === undefined) {
    throw new Error(`scope must be one of ${APP_STORAGE_SCOPES.join(', ')}`);
  }
  return found;
}

export function parseAppStorageKey(input: unknown): string {
  const key = text(input);
  if (key.length === 0 || key.length > APP_STORAGE_LIMITS.keyCharsMax) {
    throw new Error(`A storage key is 1 to ${APP_STORAGE_LIMITS.keyCharsMax} characters`);
  }
  const segments = key.split('/');
  if (segments.length > APP_STORAGE_LIMITS.keySegmentsMax) {
    throw new Error(`A storage key has at most ${APP_STORAGE_LIMITS.keySegmentsMax} segments`);
  }
  for (const segment of segments) {
    if (!KEY_SEGMENT.test(segment)) {
      throw new Error(`"${key.slice(0, 40)}" is not a storage key: use letters, digits, ., _ and - in segments joined by /`);
    }
  }
  assert(
    segments.every((segment) => segment !== '..' && segment !== '.'),
    'A key never names . or ..',
  );
  return key;
}

export function parseAppStorageValue(input: unknown): string {
  const value = text(input);
  if (utf8Bytes(value) > APP_STORAGE_LIMITS.valueBytesMax) {
    throw new Error(`A storage value is at most ${APP_STORAGE_LIMITS.valueBytesMax} bytes`);
  }
  return value;
}

export function parseAppStorageWriter(input: unknown): string {
  const writer = text(input);
  if (writer.length === 0 || writer.length > APP_STORAGE_LIMITS.writerCharsMax || !WRITER.test(writer)) {
    throw new Error('A storage writer is 1 to 64 letters, digits, _ and -');
  }
  return writer;
}

export function appStorageBytes(values: AppStorageValues): number {
  let bytes = 0;
  for (const [key, value] of values) {
    bytes += utf8Bytes(key) + utf8Bytes(value);
  }
  return bytes;
}

export function nextAppStorageValues(
  values: AppStorageValues,
  key: string,
  value: string | undefined,
): { readonly ok: true; readonly values: AppStorageValues } | { readonly ok: false; readonly reason: string } {
  const next = new Map(values);
  if (value === undefined) {
    next.delete(key);
    return { ok: true, values: next };
  }
  next.set(key, value);
  if (next.size > APP_STORAGE_LIMITS.keysMax) {
    return { ok: false, reason: `An app keeps at most ${APP_STORAGE_LIMITS.keysMax} keys in one scope; remove some first` };
  }
  const bytes = appStorageBytes(next);
  if (bytes > APP_STORAGE_LIMITS.appBytesMax) {
    return { ok: false, reason: `An app keeps at most ${APP_STORAGE_LIMITS.appBytesMax} bytes in one scope; this would make ${bytes}` };
  }
  assert(next.get(key) === value, 'The set value is the one kept');
  return { ok: true, values: next };
}

export function parseAppStorageSource(source: string): AppStorageValues {
  if (utf8Bytes(source) > APP_STORAGE_LIMITS.fileBytesMax) {
    throw new Error(`An app storage file exceeds ${APP_STORAGE_LIMITS.fileBytesMax} bytes`);
  }
  const file = record(JSON.parse(source) as unknown);
  if (file['version'] !== FILE_VERSION) {
    throw new Error(`An app storage file is version ${FILE_VERSION}`);
  }
  const entries = Object.entries(record(file['values']));
  if (entries.length > APP_STORAGE_LIMITS.keysMax) {
    throw new Error(`An app storage file holds at most ${APP_STORAGE_LIMITS.keysMax} keys`);
  }
  const values = new Map<string, string>();
  for (const [key, value] of entries) {
    values.set(parseAppStorageKey(key), parseAppStorageValue(value));
  }
  if (appStorageBytes(values) > APP_STORAGE_LIMITS.appBytesMax) {
    throw new Error(`An app storage file holds at most ${APP_STORAGE_LIMITS.appBytesMax} bytes of values`);
  }
  return values;
}

export function serializeAppStorage(values: AppStorageValues): string {
  assert(values.size <= APP_STORAGE_LIMITS.keysMax, 'Stored keys are bounded');
  const sorted: Record<string, string> = {};
  for (const key of [...values.keys()].sort()) {
    const value = values.get(key);
    assert(value !== undefined, 'A sorted key has its value');
    sorted[key] = value;
  }
  return `${JSON.stringify({ version: FILE_VERSION, values: sorted }, undefined, 2)}\n`;
}

export function changedAppStorageKeys(before: AppStorageValues, after: AppStorageValues): readonly string[] {
  const changed = new Set<string>();
  for (const [key, value] of after) {
    if (before.get(key) !== value) {
      changed.add(key);
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) {
      changed.add(key);
    }
  }
  assert(changed.size <= before.size + after.size, 'Changed keys come from the two readings');
  return [...changed].sort();
}

export function parseAppStorageChange(input: unknown): AppStorageChange {
  const value = record(input);
  const keys = value['keys'];
  let parsedKeys: readonly string[] | undefined;
  if (keys === undefined) {
    parsedKeys = undefined;
  } else {
    if (!Array.isArray(keys) || keys.length > APP_STORAGE_LIMITS.changeKeysMax) {
      throw new Error(`A storage change names at most ${APP_STORAGE_LIMITS.changeKeysMax} keys`);
    }
    parsedKeys = keys.map(parseAppStorageKey);
  }
  return {
    appId: parseAppId(value['appId']),
    scope: parseAppStorageScope(value['scope']),
    keys: parsedKeys,
    writer: value['writer'] === undefined ? undefined : parseAppStorageWriter(value['writer']),
  };
}

export function appStorageChange(appId: string, scope: AppStorageScope, keys: readonly string[], writer: string | undefined): AppStorageChange {
  assert(keys.length > 0, 'A change names what moved');
  return { appId, scope, keys: keys.length > APP_STORAGE_LIMITS.changeKeysMax ? undefined : keys, writer };
}

const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}
