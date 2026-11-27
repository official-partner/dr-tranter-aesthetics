
import { record, text } from '../core/boundary';
import { assert } from '../core/assert';
import { described, type Described } from './i18n/messageRef';
import { parseFieldChecks, parseFieldDefault, parseFieldOptions, type FieldChecks, type FieldDefault } from './fieldChecks';

export const COLLECTION_SETTINGS_LIMITS = {
  fieldsMax: 200,
  membersMax: 50,
  memberDepthMax: 3,
  descriptionCharsMax: 500,
  fieldNameCharsMax: 64,
} as const;

export const SETTINGS_FIELD_KINDS = [
  'text',
  'richText',
  'image',
  'multiImage',
  'videoLink',
  'link',
  'email',
  'phone',
  'number',
  'date',
  'switch',
  'color',
  'option',
  'file',
  'reference',
  'multiReference',
  'list',
  'repeater',
  'group',
  'keyValue',
  'constant',
  'any',
  'other',
] as const;
export type SettingsFieldKind = (typeof SETTINGS_FIELD_KINDS)[number];

export const MEMBER_KINDS = [
  'text',
  'richText',
  'image',
  'multiImage',
  'videoLink',
  'link',
  'email',
  'phone',
  'number',
  'date',
  'switch',
  'color',
  'option',
  'file',
  'list',
  'repeater',
  'group',
  'keyValue',
  'constant',
  'any',
] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

export function holdsMembers(kind: SettingsFieldKind): boolean {
  return kind === 'group' || kind === 'repeater';
}

export interface SettingsMember {
  readonly name: string;
  readonly kind: SettingsFieldKind;
  readonly required: boolean;
  readonly from: string | undefined;
  readonly editable: boolean;
  readonly description?: string | undefined;
  readonly checks?: FieldChecks | undefined;
  readonly options?: readonly string[] | undefined;
  readonly defaultValue?: FieldDefault | undefined;
  readonly members?: readonly SettingsMember[] | undefined;
  readonly itemKind?: ItemKind | 'other' | undefined;
}

export function memberAsField(member: SettingsMember): SettingsField {
  const starting = newFieldSettings(newKindOf(member.kind));
  return {
    name: member.name,
    kind: member.kind,
    description: member.description,
    required: member.required,
    checks: member.checks ?? starting.checks,
    options: member.options ?? starting.options,
    defaultValue: member.defaultValue,
    editable: member.editable,
    members: member.members,
    itemKind: member.itemKind,
  };
}

export function fieldAsMember(field: SettingsField, member: Pick<SettingsMember, 'from' | 'editable'>): SettingsMember {
  return {
    name: field.name,
    kind: field.kind,
    required: field.required,
    from: member.from,
    editable: member.editable,
    description: field.description,
    checks: field.checks,
    options: field.options,
    defaultValue: field.defaultValue,
    members: field.members,
    itemKind: field.itemKind,
  };
}

export function memberSettings(member: SettingsMember): FieldSettings {
  const starting = newFieldSettings(newKindOf(member.kind));
  return {
    description: member.description?.trim() || undefined,
    required: member.required,
    checks: member.checks ?? starting.checks,
    options: member.options ?? starting.options,
    defaultValue: member.required ? undefined : member.defaultValue,
  };
}

function newKindOf(kind: SettingsFieldKind): NewFieldKind {
  return kind === 'other' ? 'any' : kind;
}

export const ITEM_KINDS = ['text', 'number', 'link', 'email', 'switch', 'date', 'group'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export function listKindOf(item: ItemKind): 'list' | 'repeater' {
  return item === 'group' ? 'repeater' : 'list';
}

export function itemKindOf(field: Pick<SettingsField, 'kind' | 'itemKind'>): ItemKind | 'other' | undefined {
  if (field.kind === 'repeater') {
    return 'group';
  }
  return field.kind === 'list' ? (field.itemKind ?? 'text') : undefined;
}

export function memberDepthOf(members: readonly SettingsMember[] | undefined, depth = 0): number {
  if (depth > COLLECTION_SETTINGS_LIMITS.memberDepthMax) {
    return depth;
  }
  let deepest = depth;
  for (const member of members ?? []) {
    deepest = Math.max(deepest, memberDepthOf(member.members, depth + 1));
  }
  return deepest;
}

export function newFieldMembers(kind: SettingsFieldKind): readonly SettingsMember[] | undefined {
  return holdsMembers(kind) ? [{ name: 'title', kind: 'text', required: false, from: undefined, editable: true }] : undefined;
}

export type NewFieldKind = Exclude<SettingsFieldKind, 'other'>;

export function pointsAtCollection(kind: SettingsFieldKind): boolean {
  return kind === 'reference' || kind === 'multiReference';
}

export interface SettingsField {
  readonly name: string;
  readonly kind: SettingsFieldKind;
  readonly description: string | undefined;
  readonly required: boolean;
  readonly checks: FieldChecks;
  readonly options: readonly string[] | undefined;
  readonly defaultValue: FieldDefault | undefined;
  readonly editable: boolean;
  readonly target?: string | undefined;
  readonly members?: readonly SettingsMember[] | undefined;
  readonly itemKind?: ItemKind | 'other' | undefined;
}

export interface CollectionSettings {
  readonly name: string;
  readonly source: string | undefined;
  readonly fields: readonly SettingsField[];
}

export interface FieldSettings {
  readonly description: string | undefined;
  readonly required: boolean;
  readonly checks: FieldChecks;
  readonly options: readonly string[] | undefined;
  readonly defaultValue: FieldDefault | undefined;
}

export interface FieldUpdate extends FieldSettings {
  readonly name: string;
  readonly members?: readonly SettingsMember[] | undefined;
  readonly itemKind?: ItemKind | undefined;
}

export type SettingsChange =
  | { readonly kind: 'renameCollection'; readonly to: string }
  | { readonly kind: 'reorder'; readonly order: readonly string[] }
  | { readonly kind: 'renameField'; readonly from: string; readonly to: string }
  | { readonly kind: 'updateField'; readonly update: FieldUpdate }
  | {
      readonly kind: 'addField';
      readonly name: string;
      readonly fieldKind: NewFieldKind;
      readonly target: string | undefined;
      readonly settings: FieldSettings;
      readonly members?: readonly SettingsMember[] | undefined;
      readonly itemKind?: ItemKind | undefined;
    }
  | { readonly kind: 'removeField'; readonly name: string }
  | { readonly kind: 'deleteCollection' };

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const NEW_KINDS: readonly NewFieldKind[] = SETTINGS_FIELD_KINDS.filter((kind): kind is NewFieldKind => kind !== 'other');

export function newFieldSettings(kind: NewFieldKind): FieldSettings {
  return {
    description: undefined,
    required: false,
    checks: kind === 'color' ? { pattern: '^#[0-9a-fA-F]{6}$' } : {},
    options: kind === 'option' ? ['Option 1', 'Option 2'] : undefined,
    defaultValue: undefined,
  };
}

export function parseSettingsFieldName(input: unknown): string {
  const name = text(input).trim();
  const refusal = fieldNameRefusal(name);
  if (refusal !== undefined) {
    throw new Error(refusal);
  }
  assert(name.length <= COLLECTION_SETTINGS_LIMITS.fieldNameCharsMax, 'A field name is short');
  return name;
}

export function fieldNameProblem(name: string): Described | undefined {
  if (name.length === 0) {
    return described('cmsBackend.fieldName.empty');
  }
  if (name.length > COLLECTION_SETTINGS_LIMITS.fieldNameCharsMax) {
    return described('cmsBackend.fieldName.tooLong', { count: COLLECTION_SETTINGS_LIMITS.fieldNameCharsMax });
  }
  return FIELD_NAME.test(name) ? undefined : described('cmsBackend.fieldName.invalid');
}

export function fieldNameRefusal(name: string): string | undefined {
  return fieldNameProblem(name)?.message;
}

export type TypedFieldName = { readonly kind: 'blank' } | ({ readonly kind: 'invalid' } & Described) | { readonly kind: 'key'; readonly key: string };

export function typedFieldName(typed: string): TypedFieldName {
  const trimmed = typed.trim();
  if (trimmed.length === 0) {
    return { kind: 'blank' };
  }
  const key = FIELD_NAME.test(trimmed) ? trimmed : dashedWords(trimmed);
  const refusal = fieldNameProblem(key === '' ? trimmed : key);
  return refusal === undefined ? { kind: 'key', key } : { kind: 'invalid', ...refusal };
}

export function parseSettingsChange(input: unknown): SettingsChange {
  const value = record(input);
  switch (value['kind']) {
    case 'renameCollection':
      return { kind: 'renameCollection', to: parseCollectionRename(value['to']) };
    case 'reorder':
      return { kind: 'reorder', order: parseOrder(value['order']) };
    case 'renameField': {
      const from = parseSettingsFieldName(value['from']);
      const to = parseSettingsFieldName(value['to']);
      if (from === to) {
        throw new Error('The field already has that name.');
      }
      return { kind: 'renameField', from, to };
    }
    case 'updateField':
      return { kind: 'updateField', update: parseFieldUpdate(value['update']) };
    case 'addField': {
      const fieldKind = parseNewKind(value['fieldKind']);
      const target = value['target'] === undefined ? undefined : text(value['target']);
      if (pointsAtCollection(fieldKind) && target === undefined) {
        throw new Error('Choose the collection the field refers to.');
      }
      if (target !== undefined && !/^[A-Za-z_][\w.-]{0,127}$/.test(target)) {
        throw new Error('Invalid collection name.');
      }
      return {
        kind: 'addField',
        name: parseSettingsFieldName(value['name']),
        fieldKind,
        target: pointsAtCollection(fieldKind) ? target : undefined,
        settings: parseFieldSettings(value['settings']),
        members: holdsMembers(fieldKind) ? parseMembers(value['members']) : undefined,
        itemKind: fieldKind === 'list' ? parseItemKind(value['itemKind']) : undefined,
      };
    }
    case 'removeField':
      return { kind: 'removeField', name: parseSettingsFieldName(value['name']) };
    case 'deleteCollection':
      return { kind: 'deleteCollection' };
    default:
      throw new Error('Unknown collection settings change.');
  }
}

export function parseFieldUpdate(input: unknown): FieldUpdate {
  const value = record(input);
  return {
    name: parseSettingsFieldName(value['name']),
    ...parseFieldSettings(input),
    members: parseMembers(value['members']),
    itemKind: parseItemKind(value['itemKind']),
  };
}

function parseStoredItemKind(input: unknown): ItemKind | 'other' | undefined {
  return input === 'other' ? 'other' : parseItemKind(input);
}

function parseItemKind(input: unknown): ItemKind | undefined {
  if (input === undefined) {
    return undefined;
  }
  const kind = ITEM_KINDS.find((candidate) => candidate === input);
  if (kind === undefined) {
    throw new Error('Unknown list item kind.');
  }
  return kind;
}

export function parseMembers(input: unknown, depth = 0): readonly SettingsMember[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (depth >= COLLECTION_SETTINGS_LIMITS.memberDepthMax) {
    throw new Error('Groups nest at most three deep.');
  }
  if (!Array.isArray(input) || input.length > COLLECTION_SETTINGS_LIMITS.membersMax) {
    throw new Error('Expected the group’s fields.');
  }
  const items: readonly unknown[] = input;
  const members = items.map((item) => parseMember(item, depth));
  if (new Set(members.map((member) => member.name)).size !== members.length) {
    throw new Error('A group’s fields have different names.');
  }
  assert(members.length <= COLLECTION_SETTINGS_LIMITS.membersMax, 'A group holds bounded fields');
  return members;
}

function parseMember(input: unknown, depth: number): SettingsMember {
  const value = record(input);
  const kind = SETTINGS_FIELD_KINDS.find((candidate) => candidate === value['kind']);
  const required = value['required'];
  const editable = value['editable'];
  if (kind === undefined || typeof required !== 'boolean' || typeof editable !== 'boolean') {
    throw new Error('Expected a group field’s settings.');
  }
  const from = value['from'] === undefined ? undefined : parseSettingsFieldName(value['from']);
  if (from === undefined && !MEMBER_KINDS.some((candidate) => candidate === kind)) {
    throw new Error('A new group field is a kind a group can hold.');
  }
  const description = value['description'] === undefined ? undefined : text(value['description']);
  if (description !== undefined && description.length > COLLECTION_SETTINGS_LIMITS.descriptionCharsMax) {
    throw new Error('Help text is at most 500 characters.');
  }
  return {
    name: parseSettingsFieldName(value['name']),
    kind,
    required,
    from,
    editable,
    description: description === undefined || description.trim() === '' ? undefined : description,
    checks: value['checks'] === undefined ? undefined : parseFieldChecks(value['checks']),
    options: parseFieldOptions(value['options']),
    defaultValue: parseFieldDefault(value['defaultValue']),
    members: holdsMembers(kind) ? parseMembers(value['members'], depth + 1) : undefined,
    itemKind: parseStoredItemKind(value['itemKind']),
  };
}

export function parseFieldSettings(input: unknown): FieldSettings {
  const value = record(input);
  const required = value['required'];
  if (typeof required !== 'boolean') {
    throw new Error('Say whether the field is required.');
  }
  const description = value['description'] === undefined ? undefined : text(value['description']);
  if (description !== undefined && description.length > COLLECTION_SETTINGS_LIMITS.descriptionCharsMax) {
    throw new Error('Help text is at most 500 characters.');
  }
  return {
    description: description === undefined || description.trim() === '' ? undefined : description,
    required,
    checks: parseFieldChecks(value['checks']),
    options: parseFieldOptions(value['options']),
    defaultValue: parseFieldDefault(value['defaultValue']),
  };
}

export function parseCollectionSettings(input: unknown): CollectionSettings {
  const value = record(input);
  const fields = value['fields'];
  if (!Array.isArray(fields) || fields.length > COLLECTION_SETTINGS_LIMITS.fieldsMax) {
    throw new Error('Expected the collection’s fields.');
  }
  const items: readonly unknown[] = fields;
  const parsed = items.map(parseSettingsField);
  assert(parsed.length <= COLLECTION_SETTINGS_LIMITS.fieldsMax, 'A collection has bounded fields');
  return {
    name: parseAstroCollectionNameOrStored(value['name']),
    source: value['source'] === undefined ? undefined : text(value['source']).slice(0, 1024),
    fields: parsed,
  };
}

function parseSettingsField(input: unknown): SettingsField {
  const value = record(input);
  const kind = SETTINGS_FIELD_KINDS.find((candidate) => candidate === value['kind']);
  if (kind === undefined) {
    throw new Error('Unknown field kind.');
  }
  const required = value['required'];
  const editable = value['editable'];
  if (typeof required !== 'boolean' || typeof editable !== 'boolean') {
    throw new Error('Expected a field’s settings.');
  }
  const description = value['description'] === undefined ? undefined : text(value['description']);
  return {
    name: parseSettingsFieldName(value['name']),
    kind,
    description: description?.slice(0, COLLECTION_SETTINGS_LIMITS.descriptionCharsMax),
    required,
    checks: parseFieldChecks(value['checks']),
    options: parseFieldOptions(value['options']),
    defaultValue: parseFieldDefault(value['defaultValue']),
    editable,
    target: optionalCollection(value['target']),
    members: parseMembers(value['members']),
    itemKind: parseStoredItemKind(value['itemKind']),
  };
}

function parseAstroCollectionNameOrStored(input: unknown): string {
  const name = text(input);
  if (!/^[A-Za-z_][\w.-]{0,127}$/.test(name)) {
    throw new Error('Invalid collection name.');
  }
  return name;
}

export function parseCollectionRename(input: unknown): string {
  const typed = text(input).trim();
  const name = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(typed) ? typed : dashedWords(typed);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new Error('A collection name starts with a letter and holds letters, digits, - and _.');
  }
  assert(name.length <= 64, 'A collection name is short');
  return name;
}

function dashedWords(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .join('-');
}

function parseOrder(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > COLLECTION_SETTINGS_LIMITS.fieldsMax) {
    throw new Error('Expected the fields in their new order.');
  }
  const items: readonly unknown[] = input;
  const order = items.map(parseSettingsFieldName);
  if (new Set(order).size !== order.length) {
    throw new Error('A field is named twice.');
  }
  assert(order.length <= COLLECTION_SETTINGS_LIMITS.fieldsMax, 'An order is bounded');
  return order;
}

function parseNewKind(input: unknown): NewFieldKind {
  const kind = NEW_KINDS.find((candidate) => candidate === input);
  if (kind === undefined) {
    throw new Error('Choose what kind of field to add.');
  }
  return kind;
}

function optionalCollection(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const name = text(input);
  if (!/^[A-Za-z_][\w.-]{0,127}$/.test(name)) {
    throw new Error('Invalid collection name.');
  }
  return name;
}
