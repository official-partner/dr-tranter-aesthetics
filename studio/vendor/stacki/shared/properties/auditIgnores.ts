import { assert } from '../core/assert';
import { toArray, toRecord } from '../core/record';
import { parseCustomAudits, serializedCustomAudits, type CustomAudit } from './customAudits';

export const AUDIT_IGNORES_FILE = '.stacki/audits.json';

export const AUDIT_IGNORE_LIMITS = {
  entriesMax: 2_000,
  pagesMax: 500,
  idCharsMax: 1_024,
  reasonCharsMax: 500,
  checksMax: 100,
  listItemsMax: 200,
  listItemCharsMax: 120,
} as const satisfies Record<string, number>;

export interface AuditIgnore {
  readonly id: string;
  readonly reason: string | undefined;
}

export interface AuditIgnoredPage {
  readonly file: string;
  readonly reason: string | undefined;
}

export const AUDIT_SETTING_PRIORITIES = ['high', 'medium', 'low'] as const;
export type AuditSettingPriority = (typeof AUDIT_SETTING_PRIORITIES)[number];

export interface AuditCheckSetting {
  readonly enabled: boolean;
  readonly priority: AuditSettingPriority | undefined;
}

export interface AuditTokenSettings {
  readonly properties: readonly string[];
  readonly colors: boolean;
  readonly px: boolean;
  readonly remOutsideVariables: boolean;
  readonly sizes: boolean;
  readonly allowed: readonly string[];
  readonly allowedUnits: readonly AuditAllowableUnit[];
}

export const AUDIT_ALLOWABLE_UNITS = ['em', '%', 'vw', 'vh', 'vmin', 'vmax', 'svh', 'dvh', 'lvh', 'ch', 'ex', 'cqw', 'cqh', 'pt'] as const;
export type AuditAllowableUnit = (typeof AUDIT_ALLOWABLE_UNITS)[number];

export const AUDIT_UNIT_GROUPS = {
  em: ['em'],
  percent: ['%'],
  viewport: ['vw', 'vh', 'vmin', 'vmax', 'svh', 'dvh', 'lvh'],
  character: ['ch', 'ex'],
} as const satisfies Record<string, readonly AuditAllowableUnit[]>;
export type AuditUnitGroup = keyof typeof AUDIT_UNIT_GROUPS;
export const AUDIT_UNIT_GROUP_IDS = ['em', 'percent', 'viewport', 'character'] as const satisfies readonly AuditUnitGroup[];

export function tokenUnit(token: string): string {
  const unit = token.replace(/^-?(?:\d+\.?\d*|\.\d+)/, '').toLowerCase();
  assert(unit.length < token.length || token.length === 0, 'tokenUnit: a token starts with its number');
  return unit;
}

export function unitGroupOf(token: string): AuditUnitGroup | undefined {
  const unit = tokenUnit(token);
  return AUDIT_UNIT_GROUP_IDS.find((group) => AUDIT_UNIT_GROUPS[group].some((member) => member === unit));
}

export function unitGroupAllowed(settings: Pick<AuditTokenSettings, 'allowedUnits'>, group: AuditUnitGroup): boolean {
  const members: readonly AuditAllowableUnit[] = AUDIT_UNIT_GROUPS[group];
  assert(members.length > 0, 'unitGroupAllowed: a group has units');
  return members.every((unit) => settings.allowedUnits.includes(unit));
}

export function withUnitGroup(settings: AuditTokenSettings, group: AuditUnitGroup, allowed: 'allowed' | 'flagged'): AuditTokenSettings {
  const members: readonly AuditAllowableUnit[] = AUDIT_UNIT_GROUPS[group];
  const others = settings.allowedUnits.filter((unit) => !members.includes(unit));
  const next = allowed === 'allowed' ? [...others, ...members] : others;
  const allowedUnits = AUDIT_ALLOWABLE_UNITS.filter((unit) => next.includes(unit));
  assert(allowedUnits.length <= AUDIT_ALLOWABLE_UNITS.length, 'withUnitGroup: bounded by the known units');
  return { ...settings, allowedUnits };
}

export interface AuditFile {
  readonly version: 2;
  readonly ignored: readonly AuditIgnore[];
  readonly ignoredPages: readonly AuditIgnoredPage[];
  readonly checks: Readonly<Record<string, AuditCheckSetting>>;
  readonly tokens: AuditTokenSettings;
  readonly placeholders: readonly string[];
  readonly customAudits: readonly CustomAudit[];
}

export type AuditIgnores = AuditFile;

export const DEFAULT_TOKEN_SETTINGS: AuditTokenSettings = {
  properties: ['border-radius', 'gap', 'row-gap', 'column-gap', 'font-size', 'line-height', 'letter-spacing', 'padding*', 'margin*', 'width', 'max-width'],
  colors: true,
  px: true,
  remOutsideVariables: false,
  sizes: false,
  allowed: ['0', 'auto', 'inherit', 'initial', 'unset', 'currentcolor', 'transparent', 'none', 'normal', '100%'],
  allowedUnits: [],
};

export const DEFAULT_PLACEHOLDERS: readonly string[] = [
  'lorem',
  'lorem ipsum',
  'ipsum dolor',
  'dolor sit amet',
  'button text',
  'heading',
  'subheading',
  'text alongside',
  'your text here',
  'sample text',
  'body text',
  'link text',
  'title goes here',
  'placeholder',
  'example',
  'example text',
  'heading text',
  'paragraph text',
  'add your text',
  'text goes here',
];

export const EMPTY_AUDIT_IGNORES: AuditFile = {
  version: 2,
  ignored: [],
  ignoredPages: [],
  checks: {},
  tokens: DEFAULT_TOKEN_SETTINGS,
  placeholders: DEFAULT_PLACEHOLDERS,
  customAudits: [],
};

const TOP_FIELDS = ['version', 'ignored', 'ignoredPages', 'checks', 'tokens', 'placeholders', 'customAudits'] as const;
const TOKEN_FIELDS = ['properties', 'colors', 'px', 'remOutsideVariables', 'sizes', 'allowed', 'allowedUnits'] as const;

export function parseAuditIgnores(input: unknown): AuditFile {
  const value = toRecord(input);
  if (value === undefined) {
    throw new Error('Audit ignores: expected an object');
  }
  for (const key of Object.keys(value)) {
    if (!TOP_FIELDS.some((field) => field === key)) {
      throw new Error(`Audit ignores: unknown field "${key}"`);
    }
  }
  const version = value['version'];
  if (version !== 1 && version !== 2) {
    throw new Error('Audit ignores: unsupported version');
  }
  if (
    version === 1 &&
    (value['checks'] !== undefined || value['tokens'] !== undefined || value['placeholders'] !== undefined || value['customAudits'] !== undefined)
  ) {
    throw new Error('Audit ignores: settings need version 2');
  }
  const list = toArray(value['ignored']);
  if (list === undefined) {
    throw new Error('Audit ignores.ignored: expected an array');
  }
  if (list.length > AUDIT_IGNORE_LIMITS.entriesMax) {
    throw new Error(`Audit ignores.ignored: more than ${AUDIT_IGNORE_LIMITS.entriesMax} entries`);
  }
  const ignored = list.map((entry, index) => parseAuditIgnore(entry, index));
  if (new Set(ignored.map((entry) => entry.id)).size !== ignored.length) {
    throw new Error('Audit ignores.ignored: an id is listed twice');
  }
  assert(ignored.length <= AUDIT_IGNORE_LIMITS.entriesMax, 'parseAuditIgnores: the list is bounded');
  return {
    version: 2,
    ignored,
    ignoredPages: parseIgnoredPages(value['ignoredPages']),
    checks: value['checks'] === undefined ? {} : parseChecks(value['checks']),
    tokens: value['tokens'] === undefined ? DEFAULT_TOKEN_SETTINGS : parseTokens(value['tokens']),
    placeholders: value['placeholders'] === undefined ? DEFAULT_PLACEHOLDERS : parseList(value['placeholders'], 'Audit settings.placeholders'),
    customAudits: value['customAudits'] === undefined ? [] : parseCustomAudits(value['customAudits']),
  };
}

function parseIgnoredPages(input: unknown): readonly AuditIgnoredPage[] {
  if (input === undefined) {
    return [];
  }
  const list = toArray(input);
  if (list === undefined) {
    throw new Error('Audit ignores.ignoredPages: expected an array');
  }
  if (list.length > AUDIT_IGNORE_LIMITS.pagesMax) {
    throw new Error(`Audit ignores.ignoredPages: more than ${AUDIT_IGNORE_LIMITS.pagesMax} entries`);
  }
  const pages = list.map((entry, index): AuditIgnoredPage => {
    const where = `Audit ignores.ignoredPages[${index}]`;
    const value = toRecord(entry);
    if (value === undefined) {
      throw new Error(`${where}: expected an object`);
    }
    for (const key of Object.keys(value)) {
      if (key !== 'file' && key !== 'reason') {
        throw new Error(`${where}: unknown field "${key}"`);
      }
    }
    const file = value['file'];
    if (typeof file !== 'string' || file.length === 0 || file.startsWith('/')) {
      throw new Error(`${where}.file: expected a project-relative path`);
    }
    if (file.length > AUDIT_IGNORE_LIMITS.idCharsMax) {
      throw new Error(`${where}.file: longer than ${AUDIT_IGNORE_LIMITS.idCharsMax} characters`);
    }
    return { file, reason: parseReason(value['reason'], where) };
  });
  if (new Set(pages.map((page) => page.file)).size !== pages.length) {
    throw new Error('Audit ignores.ignoredPages: a file is listed twice');
  }
  return pages;
}

function parseAuditIgnore(input: unknown, index: number): AuditIgnore {
  assert(Number.isSafeInteger(index), 'parseAuditIgnore: an index is an integer');
  const where = `Audit ignores.ignored[${index}]`;
  const value = toRecord(input);
  if (value === undefined) {
    throw new Error(`${where}: expected an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== 'id' && key !== 'reason') {
      throw new Error(`${where}: unknown field "${key}"`);
    }
  }
  const id = value['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${where}.id: expected a non-empty string`);
  }
  if (id.length > AUDIT_IGNORE_LIMITS.idCharsMax) {
    throw new Error(`${where}.id: longer than ${AUDIT_IGNORE_LIMITS.idCharsMax} characters`);
  }
  return { id, reason: parseReason(value['reason'], where) };
}

function parseReason(input: unknown, where: string): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`${where}.reason: expected a non-empty string when present`);
  }
  if (input.length > AUDIT_IGNORE_LIMITS.reasonCharsMax) {
    throw new Error(`${where}.reason: longer than ${AUDIT_IGNORE_LIMITS.reasonCharsMax} characters`);
  }
  return input;
}

function parseChecks(input: unknown): Readonly<Record<string, AuditCheckSetting>> {
  const value = toRecord(input);
  if (value === undefined) {
    throw new Error('Audit settings.checks: expected an object');
  }
  const entries = Object.entries(value);
  if (entries.length > AUDIT_IGNORE_LIMITS.checksMax) {
    throw new Error(`Audit settings.checks: more than ${AUDIT_IGNORE_LIMITS.checksMax} checks`);
  }
  const checks: Record<string, AuditCheckSetting> = {};
  for (const [id, raw] of entries) {
    const where = `Audit settings.checks.${id}`;
    if (!/^[a-z0-9-]{1,40}$/.test(id)) {
      throw new Error(`${where}: not a check id`);
    }
    const setting = toRecord(raw);
    if (setting === undefined) {
      throw new Error(`${where}: expected an object`);
    }
    for (const key of Object.keys(setting)) {
      if (key !== 'enabled' && key !== 'priority') {
        throw new Error(`${where}: unknown field "${key}"`);
      }
    }
    const enabled = setting['enabled'] ?? true;
    if (typeof enabled !== 'boolean') {
      throw new Error(`${where}.enabled: expected a boolean`);
    }
    const priority = setting['priority'];
    const known = AUDIT_SETTING_PRIORITIES.find((candidate) => candidate === priority);
    if (priority !== undefined && known === undefined) {
      throw new Error(`${where}.priority: expected high, medium or low`);
    }
    checks[id] = { enabled, priority: known };
  }
  return checks;
}

function parseTokens(input: unknown): AuditTokenSettings {
  const value = toRecord(input);
  if (value === undefined) {
    throw new Error('Audit settings.tokens: expected an object');
  }
  for (const key of Object.keys(value)) {
    if (!TOKEN_FIELDS.some((field) => field === key)) {
      throw new Error(`Audit settings.tokens: unknown field "${key}"`);
    }
  }
  const flag = (key: 'colors' | 'px' | 'remOutsideVariables' | 'sizes'): boolean => {
    const raw = value[key] ?? DEFAULT_TOKEN_SETTINGS[key];
    if (typeof raw !== 'boolean') {
      throw new Error(`Audit settings.tokens.${key}: expected a boolean`);
    }
    return raw;
  };
  return {
    properties: value['properties'] === undefined ? DEFAULT_TOKEN_SETTINGS.properties : parseList(value['properties'], 'Audit settings.tokens.properties'),
    colors: flag('colors'),
    px: flag('px'),
    remOutsideVariables: flag('remOutsideVariables'),
    sizes: flag('sizes'),
    allowed:
      value['allowed'] === undefined
        ? DEFAULT_TOKEN_SETTINGS.allowed
        : parseList(value['allowed'], 'Audit settings.tokens.allowed').map((item) => item.toLowerCase()),
    allowedUnits: value['allowedUnits'] === undefined ? DEFAULT_TOKEN_SETTINGS.allowedUnits : parseAllowedUnits(value['allowedUnits']),
  };
}

function parseAllowedUnits(input: unknown): readonly AuditAllowableUnit[] {
  const items = parseList(input, 'Audit settings.tokens.allowedUnits').map((item) => item.toLowerCase());
  const units = AUDIT_ALLOWABLE_UNITS.filter((unit) => items.includes(unit));
  assert(units.length <= items.length, 'parseAllowedUnits: never more units than were written');
  return units;
}

function parseList(input: unknown, where: string): readonly string[] {
  const list = toArray(input);
  if (list === undefined) {
    throw new Error(`${where}: expected an array`);
  }
  if (list.length > AUDIT_IGNORE_LIMITS.listItemsMax) {
    throw new Error(`${where}: more than ${AUDIT_IGNORE_LIMITS.listItemsMax} items`);
  }
  return list.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error(`${where}[${index}]: expected a non-empty string`);
    }
    if (item.length > AUDIT_IGNORE_LIMITS.listItemCharsMax) {
      throw new Error(`${where}[${index}]: longer than ${AUDIT_IGNORE_LIMITS.listItemCharsMax} characters`);
    }
    return item.trim();
  });
}

export function parseAuditIgnoresSource(source: string | undefined): AuditFile {
  if (source === undefined) {
    return EMPTY_AUDIT_IGNORES;
  }
  const input: unknown = JSON.parse(source);
  return parseAuditIgnores(input);
}

export function serializeAuditIgnores(value: AuditFile): string {
  assert(value.ignored.length <= AUDIT_IGNORE_LIMITS.entriesMax, 'serializeAuditIgnores: the list is bounded');
  const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
  const body = {
    version: 2,
    ignored: value.ignored.map((entry) => ({ id: entry.id, ...reasonField(entry.reason) })),
    ...(value.ignoredPages.length === 0 ? {} : { ignoredPages: value.ignoredPages.map((page) => ({ file: page.file, ...reasonField(page.reason) })) }),
    ...(Object.keys(value.checks).length === 0 ? {} : { checks: serializedChecks(value.checks) }),
    ...(same(value.tokens, DEFAULT_TOKEN_SETTINGS) ? {} : { tokens: serializedTokens(value.tokens) }),
    ...(same(value.placeholders, DEFAULT_PLACEHOLDERS) ? {} : { placeholders: value.placeholders }),
    ...(value.customAudits.length === 0 ? {} : { customAudits: serializedCustomAudits(value.customAudits) }),
  };
  const text = `${JSON.stringify(body, undefined, 2)}\n`;
  assert(parseAuditIgnoresSource(text).ignored.length === value.ignored.length, 'serializeAuditIgnores: what is written reads back');
  return text;
}

function reasonField(reason: string | undefined): { readonly reason?: string } {
  return reason === undefined ? {} : { reason };
}

function serializedTokens(
  tokens: AuditTokenSettings,
): Omit<AuditTokenSettings, 'allowedUnits' | 'sizes'> & { readonly sizes?: true; readonly allowedUnits?: readonly AuditAllowableUnit[] } {
  const { allowedUnits, sizes, ...rest } = tokens;
  return { ...rest, ...(sizes ? { sizes: true } : {}), ...(allowedUnits.length === 0 ? {} : { allowedUnits }) };
}

function serializedChecks(checks: Readonly<Record<string, AuditCheckSetting>>): Record<string, { enabled?: boolean; priority?: AuditSettingPriority }> {
  const out: Record<string, { enabled?: boolean; priority?: AuditSettingPriority }> = {};
  for (const [id, setting] of Object.entries(checks)) {
    out[id] = { ...(setting.enabled ? {} : { enabled: false }), ...(setting.priority === undefined ? {} : { priority: setting.priority }) };
  }
  return out;
}

export function withIgnore(value: AuditFile, entry: AuditIgnore): AuditFile {
  assert(entry.id.length > 0, 'withIgnore: an entry has an id');
  const kept = value.ignored.filter((existing) => existing.id !== entry.id);
  if (kept.length >= AUDIT_IGNORE_LIMITS.entriesMax) {
    throw new Error(`At most ${AUDIT_IGNORE_LIMITS.entriesMax} findings can be ignored`);
  }
  const next = { ...value, ignored: [...kept, { id: entry.id, reason: cleanReason(entry.reason) }] };
  assert(next.ignored.length <= value.ignored.length + 1, 'withIgnore: adds at most one entry');
  return next;
}

export function withIgnoredPage(value: AuditFile, entry: AuditIgnoredPage): AuditFile {
  assert(entry.file.length > 0, 'withIgnoredPage: an entry has a file');
  const kept = value.ignoredPages.filter((existing) => existing.file !== entry.file);
  if (kept.length >= AUDIT_IGNORE_LIMITS.pagesMax) {
    throw new Error(`At most ${AUDIT_IGNORE_LIMITS.pagesMax} pages can be ignored`);
  }
  const next = { ...value, ignoredPages: [...kept, { file: entry.file, reason: cleanReason(entry.reason) }] };
  assert(next.ignoredPages.length <= value.ignoredPages.length + 1, 'withIgnoredPage: adds at most one entry');
  return next;
}

function cleanReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim() ?? '';
  return trimmed.length === 0 ? undefined : trimmed.slice(0, AUDIT_IGNORE_LIMITS.reasonCharsMax);
}

export function withoutIgnoredPage(value: AuditFile, file: string): AuditFile {
  const ignoredPages = value.ignoredPages.filter((entry) => entry.file !== file);
  assert(ignoredPages.length >= value.ignoredPages.length - 1, 'withoutIgnoredPage: removes at most one entry');
  return { ...value, ignoredPages };
}

export function withoutAnyIgnores(value: AuditFile): AuditFile {
  return { ...value, ignored: [], ignoredPages: [] };
}

export function withoutIgnore(value: AuditFile, id: string): AuditFile {
  const ignored = value.ignored.filter((entry) => entry.id !== id);
  assert(ignored.length >= value.ignored.length - 1, 'withoutIgnore: removes at most one entry');
  return { ...value, ignored };
}

export function withCheckSetting(value: AuditFile, id: string, setting: AuditCheckSetting): AuditFile {
  assert(/^[a-z0-9-]{1,40}$/.test(id), 'withCheckSetting: a check id');
  const checks = { ...value.checks };
  if (setting.enabled && setting.priority === undefined) {
    delete checks[id];
  } else {
    checks[id] = setting;
  }
  assert(Object.keys(checks).length <= AUDIT_IGNORE_LIMITS.checksMax, 'withCheckSetting: bounded');
  return { ...value, checks };
}

export function tokenProperty(settings: Pick<AuditTokenSettings, 'properties'>, property: string): boolean {
  const name = property.toLowerCase();
  return settings.properties.some((pattern) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern.toLowerCase()));
}
