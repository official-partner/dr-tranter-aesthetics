
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../shared/properties/i18n/messageRef';
import { isLinkName, isMediaName } from './fieldNames';

export const ITEM_FIELD_KINDS = [
  'text',
  'longText',
  'richText',
  'number',
  'switch',
  'image',
  'video',
  'file',
  'link',
  'email',
  'phone',
  'color',
  'date',
  'option',
  'list',
  'group',
] as const;
export type ItemFieldKind = (typeof ITEM_FIELD_KINDS)[number];

export const STRING_FIELD_KINDS = ['text', 'longText', 'richText', 'image', 'video', 'file', 'link', 'email', 'phone', 'color', 'date'] as const;
export type StringFieldKind = (typeof STRING_FIELD_KINDS)[number];

export type PlainFieldKind = StringFieldKind | 'number' | 'switch';

export type StructureFieldKind = 'list' | 'group';

interface FieldBase {
  readonly name: string;
}

export type ItemFieldDeclaration =
  | (FieldBase & { readonly kind: PlainFieldKind })
  | (FieldBase & { readonly kind: 'option'; readonly options: readonly string[] })
  | (FieldBase & { readonly kind: StructureFieldKind; readonly fields: readonly ItemFieldDeclaration[] });

export type ListItemValues = Readonly<Record<string, string>>;

export const ITEM_FIELD_TITLE_KEYS: Readonly<Record<ItemFieldKind, MessageKey>> = {
  text: 'editor.itemFields.kind.text',
  longText: 'editor.itemFields.kind.longText',
  richText: 'editor.itemFields.kind.richText',
  number: 'editor.itemFields.kind.number',
  switch: 'editor.itemFields.kind.switch',
  image: 'editor.itemFields.kind.image',
  video: 'editor.itemFields.kind.video',
  file: 'editor.itemFields.kind.file',
  link: 'editor.itemFields.kind.link',
  email: 'editor.itemFields.kind.email',
  phone: 'editor.itemFields.kind.phone',
  color: 'editor.itemFields.kind.color',
  date: 'editor.itemFields.kind.date',
  option: 'editor.itemFields.kind.option',
  list: 'editor.itemFields.kind.list',
  group: 'editor.itemFields.kind.group',
};

export function itemFieldTitle(kind: ItemFieldKind, translate: Translator = ENGLISH_TRANSLATE): string {
  return translate(ITEM_FIELD_TITLE_KEYS[kind]);
}

export const ITEM_FIELD_TITLES: Readonly<Record<ItemFieldKind, string>> = {
  text: ENGLISH_TRANSLATE('editor.itemFields.kind.text'),
  longText: ENGLISH_TRANSLATE('editor.itemFields.kind.longText'),
  richText: ENGLISH_TRANSLATE('editor.itemFields.kind.richText'),
  number: ENGLISH_TRANSLATE('editor.itemFields.kind.number'),
  switch: ENGLISH_TRANSLATE('editor.itemFields.kind.switch'),
  image: ENGLISH_TRANSLATE('editor.itemFields.kind.image'),
  video: ENGLISH_TRANSLATE('editor.itemFields.kind.video'),
  file: ENGLISH_TRANSLATE('editor.itemFields.kind.file'),
  link: ENGLISH_TRANSLATE('editor.itemFields.kind.link'),
  email: ENGLISH_TRANSLATE('editor.itemFields.kind.email'),
  phone: ENGLISH_TRANSLATE('editor.itemFields.kind.phone'),
  color: ENGLISH_TRANSLATE('editor.itemFields.kind.color'),
  date: ENGLISH_TRANSLATE('editor.itemFields.kind.date'),
  option: ENGLISH_TRANSLATE('editor.itemFields.kind.option'),
  list: ENGLISH_TRANSLATE('editor.itemFields.kind.list'),
  group: ENGLISH_TRANSLATE('editor.itemFields.kind.group'),
};

export const FORMAT_WORDS: Readonly<Record<StringFieldKind, string>> = {
  text: 'text',
  longText: 'longtext',
  richText: 'richtext',
  image: 'image',
  video: 'video',
  file: 'file',
  link: 'link',
  email: 'email',
  phone: 'phone',
  color: 'color',
  date: 'date',
};

export const ITEM_FIELD_LIMITS = {
  fieldsPerLevelMax: LIMITS.listFieldsPerLevelMax,
  fieldsTotalMax: LIMITS.listFieldsTotalMax,
  depthMax: LIMITS.listFieldDepthMax,
  optionsMax: LIMITS.listOptionsMax,
  optionCharsMax: 64,
  nameCharsMax: 64,
  walkDepthMax: LIMITS.listFieldDepthMax + 1,
} as const satisfies Record<string, number>;

const RESERVED_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function fieldNameProblem(name: string, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (name === '') {
    return translate('editor.itemFields.name.empty');
  }
  if (name.length > ITEM_FIELD_LIMITS.nameCharsMax) {
    return translate('editor.itemFields.name.tooLong');
  }
  if (!IDENTIFIER.test(name)) {
    return translate('editor.itemFields.name.invalid', { name });
  }
  return RESERVED_NAMES.has(name) ? translate('editor.itemFields.name.reserved', { name }) : undefined;
}

export function isPlainKind(kind: ItemFieldKind): kind is PlainFieldKind {
  return kind !== 'option' && kind !== 'list' && kind !== 'group';
}

export function isStringKind(kind: ItemFieldKind): kind is StringFieldKind {
  return STRING_FIELD_KINDS.some((candidate) => candidate === kind);
}

export function fieldsOf(field: ItemFieldDeclaration): readonly ItemFieldDeclaration[] {
  return field.kind === 'list' || field.kind === 'group' ? field.fields : [];
}

export function impliedKind(name: string): 'text' | 'image' | 'link' {
  if (isMediaName(name)) {
    return 'image';
  }
  return isLinkName(name) ? 'link' : 'text';
}

export function kindOfFormat(word: string | undefined): StringFieldKind | undefined {
  return STRING_FIELD_KINDS.find((kind) => FORMAT_WORDS[kind] === word);
}

export function fieldTypeText(field: ItemFieldDeclaration): string {
  switch (field.kind) {
    case 'number':
      return 'number';
    case 'switch':
      return 'boolean';
    case 'option':
      return field.options.map((option) => JSON.stringify(option)).join(' | ');
    case 'list':
      return `readonly ${objectTypeText(field.fields)}[]`;
    case 'group':
      return objectTypeText(field.fields);
    case 'text':
    case 'longText':
    case 'richText':
    case 'image':
    case 'video':
    case 'file':
    case 'link':
    case 'email':
    case 'phone':
    case 'color':
    case 'date':
      return 'string';
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

export function objectTypeText(fields: readonly ItemFieldDeclaration[]): string {
  assert(fields.length > 0, 'objectTypeText: an object has a field');
  assert(fields.length <= ITEM_FIELD_LIMITS.fieldsPerLevelMax, 'objectTypeText: the fields are bounded');
  return `{ ${fields.map(memberText).join('; ')} }`;
}

function memberText(field: ItemFieldDeclaration): string {
  const tag = isStringKind(field.kind) && impliedKind(field.name) !== field.kind ? `/** @format ${FORMAT_WORDS[field.kind]} */ ` : '';
  return `${tag}${field.name}: ${fieldTypeText(field)}`;
}

export function sameFields(left: readonly ItemFieldDeclaration[], right: readonly ItemFieldDeclaration[], depth = 1): boolean {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'sameFields: the levels are bounded');
  if (left.length !== right.length) {
    return false;
  }
  return left.every((field, at) => {
    const other = right[at];
    if (other === undefined || field.name !== other.name || field.kind !== other.kind) {
      return false;
    }
    if (field.kind === 'option' && other.kind === 'option') {
      return field.options.length === other.options.length && field.options.every((option, index) => option === other.options[index]);
    }
    return sameFields(fieldsOf(field), fieldsOf(other), depth + 1);
  });
}

export function fieldCount(fields: readonly ItemFieldDeclaration[], depth = 1): number {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'fieldCount: the levels are bounded');
  let count = fields.length;
  for (const field of fields) {
    count += fieldCount(fieldsOf(field), depth + 1);
  }
  return count;
}

export function fieldDepth(fields: readonly ItemFieldDeclaration[], depth = 1): number {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'fieldDepth: the levels are bounded');
  let deepest = depth;
  for (const field of fields) {
    const inner = fieldsOf(field);
    if (inner.length > 0) {
      deepest = Math.max(deepest, fieldDepth(inner, depth + 1));
    }
  }
  return deepest;
}

export function fieldsProblem(fields: readonly ItemFieldDeclaration[], depth = 1, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  assert(depth >= 1, 'fieldsProblem: levels count from 1');
  if (depth > ITEM_FIELD_LIMITS.depthMax) {
    return translate('editor.itemFields.fields.tooDeep', { depth: ITEM_FIELD_LIMITS.depthMax });
  }
  if (fields.length === 0) {
    return translate('editor.itemFields.fields.none');
  }
  if (fields.length > ITEM_FIELD_LIMITS.fieldsPerLevelMax) {
    return translate('editor.itemFields.fields.tooMany');
  }
  const names = fields.map((field) => field.name);
  for (const name of names) {
    const problem = fieldNameProblem(name, translate);
    if (problem !== undefined) {
      return problem;
    }
  }
  if (new Set(names).size !== names.length) {
    return translate('editor.itemFields.fields.duplicateName');
  }
  for (const field of fields) {
    const problem = fieldProblem(field, depth, translate);
    if (problem !== undefined) {
      return problem;
    }
  }
  if (depth === 1 && fieldCount(fields) > ITEM_FIELD_LIMITS.fieldsTotalMax) {
    return translate('editor.itemFields.fields.tooManyInAll');
  }
  return undefined;
}

function fieldProblem(field: ItemFieldDeclaration, depth: number, translate: Translator): string | undefined {
  switch (field.kind) {
    case 'option':
      return optionsProblem(field, translate);
    case 'list':
    case 'group':
      return fieldsProblem(field.fields, depth + 1, translate);
    case 'text':
    case 'longText':
    case 'richText':
    case 'number':
    case 'switch':
    case 'image':
    case 'video':
    case 'file':
    case 'link':
    case 'email':
    case 'phone':
    case 'color':
    case 'date':
      return undefined;
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

function optionsProblem(field: Extract<ItemFieldDeclaration, { kind: 'option' }>, translate: Translator): string | undefined {
  const { options } = field;
  if (options.length < 2) {
    return translate('editor.itemFields.options.tooFew', { name: field.name });
  }
  if (options.length > ITEM_FIELD_LIMITS.optionsMax) {
    return translate('editor.itemFields.options.tooMany', { name: field.name });
  }
  if (options.some((option) => option.trim() === '')) {
    return translate('editor.itemFields.options.empty', { name: field.name });
  }
  if (options.some((option) => option.length > ITEM_FIELD_LIMITS.optionCharsMax)) {
    return translate('editor.itemFields.options.tooLong', { name: field.name });
  }
  return new Set(options).size === options.length ? undefined : translate('editor.itemFields.options.duplicate', { name: field.name });
}

export const NESTED_STARTER_FIELDS: readonly ItemFieldDeclaration[] = [{ name: 'title', kind: 'text' }];

export const OPTION_STARTER_OPTIONS: readonly string[] = ['Option 1', 'Option 2'];

export function retypedField(field: ItemFieldDeclaration, kind: ItemFieldKind): ItemFieldDeclaration {
  if (kind === 'option') {
    return { name: field.name, kind, options: field.kind === 'option' ? field.options : OPTION_STARTER_OPTIONS };
  }
  if (kind === 'list' || kind === 'group') {
    const kept = fieldsOf(field);
    return { name: field.name, kind, fields: kept.length > 0 ? kept : NESTED_STARTER_FIELDS };
  }
  assert(isPlainKind(kind), 'retypedField: the remaining kinds hold one value');
  return { name: field.name, kind };
}

export function withNestedFields(field: ItemFieldDeclaration, fields: readonly ItemFieldDeclaration[]): ItemFieldDeclaration {
  return field.kind === 'list' || field.kind === 'group' ? { ...field, fields } : field;
}
