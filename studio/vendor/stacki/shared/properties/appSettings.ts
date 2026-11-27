import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';

export const APP_SETTINGS_FILE = '.stacki/apps/settings.json';

export const APP_SETTINGS_LIMITS = {
  settingsMax: 16,
  idCharsMax: 64,
  labelCharsMax: 60,
  descriptionCharsMax: 280,
  placeholderCharsMax: 120,
  valueCharsMax: 4096,
  fileBytesMax: 256 * 1024,
  appsMax: 50,
} as const satisfies Record<string, number>;

export const APP_SETTING_KINDS = ['text', 'secret', 'url'] as const;
export type AppSettingKind = (typeof APP_SETTING_KINDS)[number];

export interface AppSettingDeclaration {
  readonly id: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly kind: AppSettingKind;
  readonly required: boolean;
  readonly placeholder: string | undefined;
  readonly advanced: boolean;
}

export type AppSettingValues = Readonly<Record<string, string>>;

const SETTING_ID = /^[a-z][a-z0-9_-]*$/;

export function parseAppSettingDeclarations(input: unknown): readonly AppSettingDeclaration[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('settings is a list');
  }
  if (items.length > APP_SETTINGS_LIMITS.settingsMax) {
    throw new Error(`An app declares at most ${APP_SETTINGS_LIMITS.settingsMax} settings`);
  }
  const settings = items.map(parseDeclaration);
  if (new Set(settings.map((setting) => setting.id)).size !== settings.length) {
    throw new Error('Two settings share an id');
  }
  assert(settings.length <= APP_SETTINGS_LIMITS.settingsMax, 'Declarations are bounded');
  return settings;
}

function parseDeclaration(input: unknown): AppSettingDeclaration {
  const value = record(input);
  const id = parseAppSettingId(value['id']);
  const kind = APP_SETTING_KINDS.find((known) => known === value['kind']);
  if (kind === undefined) {
    throw new Error(`Setting ${id}: kind is text, secret or url`);
  }
  const required = value['required'];
  if (required !== undefined && typeof required !== 'boolean') {
    throw new Error(`Setting ${id}: required is true or false`);
  }
  const advanced = value['advanced'];
  if (advanced !== undefined && typeof advanced !== 'boolean') {
    throw new Error(`Setting ${id}: advanced is true or false`);
  }
  return {
    id,
    label: boundedText(value['label'], APP_SETTINGS_LIMITS.labelCharsMax, `Setting ${id} label`),
    description: optionalText(value['description'], APP_SETTINGS_LIMITS.descriptionCharsMax, `Setting ${id} description`),
    kind,
    required: required === true,
    placeholder: optionalText(value['placeholder'], APP_SETTINGS_LIMITS.placeholderCharsMax, `Setting ${id} placeholder`),
    advanced: advanced === true,
  };
}

export function parseAppSettingId(input: unknown): string {
  const id = text(input).trim();
  if (id.length === 0 || id.length > APP_SETTINGS_LIMITS.idCharsMax) {
    throw new Error(`A setting id is 1 to ${APP_SETTINGS_LIMITS.idCharsMax} characters`);
  }
  if (!SETTING_ID.test(id)) {
    throw new Error(`Setting id "${id}" must start with a letter and use lowercase letters, digits, - and _`);
  }
  return id;
}

export function parseAppSettingValues(input: unknown, declarations: readonly AppSettingDeclaration[]): AppSettingValues {
  const value = record(input);
  const entries = Object.entries(value);
  if (entries.length > APP_SETTINGS_LIMITS.settingsMax) {
    throw new Error(`An app has at most ${APP_SETTINGS_LIMITS.settingsMax} settings`);
  }
  const values: Record<string, string> = {};
  for (const [id, raw] of entries) {
    const declaration = declarations.find((entry) => entry.id === id);
    if (declaration === undefined) {
      throw new Error(`The app declares no setting "${id.slice(0, APP_SETTINGS_LIMITS.idCharsMax)}"`);
    }
    const parsed = parseAppSettingValue(declaration, raw);
    if (parsed !== '') {
      values[id] = parsed;
    }
  }
  assert(Object.keys(values).length <= declarations.length, 'Values are bounded by the declarations');
  return values;
}

export function parseAppSettingValue(declaration: AppSettingDeclaration, input: unknown): string {
  const value = text(input);
  if (value.length > APP_SETTINGS_LIMITS.valueCharsMax) {
    throw new Error(`${declaration.label} exceeds ${APP_SETTINGS_LIMITS.valueCharsMax} characters`);
  }
  const trimmed = declaration.kind === 'secret' ? value : value.trim();
  if (trimmed === '') {
    return '';
  }
  if (declaration.kind === 'url') {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`${declaration.label} is not a web address`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`${declaration.label} starts with https://`);
    }
  }
  return trimmed;
}

export function missingRequiredSettings(declarations: readonly AppSettingDeclaration[], values: AppSettingValues): readonly AppSettingDeclaration[] {
  const missing = declarations.filter((declaration) => declaration.required && (values[declaration.id] ?? '') === '');
  assert(missing.length <= declarations.length, 'Missing settings are declared ones');
  assert(
    missing.every((declaration) => declaration.required),
    'Only a required setting is missing',
  );
  return missing;
}

export function splitAppSettingValues(
  declarations: readonly AppSettingDeclaration[],
  values: AppSettingValues,
): { readonly plain: AppSettingValues; readonly secret: AppSettingValues } {
  const plain: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const declaration of declarations) {
    const value = values[declaration.id];
    if (value === undefined) {
      continue;
    }
    if (declaration.kind === 'secret') {
      secret[declaration.id] = value;
    } else {
      plain[declaration.id] = value;
    }
  }
  assert(
    Object.keys(plain).every((id) => declarations.find((entry) => entry.id === id)?.kind !== 'secret'),
    'A secret value is never among the project file’s values',
  );
  assert(Object.keys(plain).length + Object.keys(secret).length <= declarations.length, 'Splitting adds no value');
  return { plain, secret };
}

export function parseAppSettingValuesReply(input: unknown): AppSettingValues {
  const value = record(input);
  const entries = Object.entries(value);
  if (entries.length > APP_SETTINGS_LIMITS.settingsMax) {
    throw new Error(`An app has at most ${APP_SETTINGS_LIMITS.settingsMax} settings`);
  }
  const values: Record<string, string> = {};
  for (const [id, raw] of entries) {
    const parsedId = parseAppSettingId(id);
    const parsed = text(raw);
    if (parsed.length > APP_SETTINGS_LIMITS.valueCharsMax) {
      throw new Error('A setting value exceeds its limit');
    }
    values[parsedId] = parsed;
  }
  return values;
}


export interface AppSettingsFile {
  readonly version: 1;
  readonly apps: Readonly<Record<string, AppSettingValues>>;
}

export const EMPTY_APP_SETTINGS_FILE: AppSettingsFile = { version: 1, apps: {} };

export function parseAppSettingsFileSource(source: string, parseAppId: (input: unknown) => string): AppSettingsFile {
  if (source.length > APP_SETTINGS_LIMITS.fileBytesMax) {
    throw new Error(`${APP_SETTINGS_FILE} exceeds ${APP_SETTINGS_LIMITS.fileBytesMax} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error: unknown) {
    throw new Error(`${APP_SETTINGS_FILE} is not JSON: ${String(error).slice(0, 200)}`);
  }
  const value = record(parsed);
  if (value['version'] !== 1) {
    throw new Error(`${APP_SETTINGS_FILE} version must be 1`);
  }
  const apps = Object.entries(record(value['apps']));
  if (apps.length > APP_SETTINGS_LIMITS.appsMax) {
    throw new Error(`${APP_SETTINGS_FILE} names at most ${APP_SETTINGS_LIMITS.appsMax} apps`);
  }
  const result: Record<string, AppSettingValues> = {};
  for (const [id, values] of apps) {
    result[parseAppId(id)] = parseAppSettingValuesReply(values);
  }
  return { version: 1, apps: result };
}

export function serializeAppSettingsFile(file: AppSettingsFile): string {
  const apps: Record<string, AppSettingValues> = {};
  for (const id of Object.keys(file.apps).sort()) {
    const values = file.apps[id] ?? {};
    if (Object.keys(values).length === 0) {
      continue;
    }
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(values).sort()) {
      sorted[key] = values[key] ?? '';
    }
    apps[id] = sorted;
  }
  const source = `${JSON.stringify({ version: 1, apps }, undefined, 2)}\n`;
  if (source.length > APP_SETTINGS_LIMITS.fileBytesMax) {
    throw new Error(`${APP_SETTINGS_FILE} would exceed ${APP_SETTINGS_LIMITS.fileBytesMax} bytes`);
  }
  assert(Object.keys(apps).length <= APP_SETTINGS_LIMITS.appsMax, 'The settings file is bounded');
  return source;
}

function boundedText(input: unknown, charsMax: number, what: string): string {
  const value = text(input).trim();
  if (value.length === 0) {
    throw new Error(`${what} is empty`);
  }
  if (value.length > charsMax) {
    throw new Error(`${what} exceeds ${charsMax} characters`);
  }
  return value;
}

function optionalText(input: unknown, charsMax: number, what: string): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const value = text(input).trim();
  if (value.length > charsMax) {
    throw new Error(`${what} exceeds ${charsMax} characters`);
  }
  return value === '' ? undefined : value;
}
