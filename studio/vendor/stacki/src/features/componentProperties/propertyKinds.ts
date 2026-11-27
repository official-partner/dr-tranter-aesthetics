
import { assert } from '../../../shared/core/assert';
import type { MessageKey } from '../../lib/i18n/localeContext';
import type { ComponentProperty } from '../../../shared/properties/propertyEditing';
import { literalOptions } from '../../../shared/properties/propertyOptions';
import { SETTING_PROP_TYPES } from '../../editor/optionsBinding';
import { tagValue, withTag } from './settingTags';
import { LIST_STARTER_FIELDS, listTypeText } from '../../editor/listPropType';

export const KIND_SECTIONS = ['basic', 'media', 'structure', 'element', 'collection', 'advanced'] as const;
export type KindSection = (typeof KIND_SECTIONS)[number];

export const KIND_SECTION_LABELS: Readonly<Record<KindSection, MessageKey>> = {
  basic: 'componentProps.kindSection.basic',
  media: 'componentProps.kindSection.media',
  structure: 'componentProps.kindSection.structure',
  element: 'componentProps.kindSection.element',
  collection: 'componentProps.kindSection.collection',
  advanced: 'componentProps.kindSection.advanced',
};

export type PropertyKind =
  | 'text'
  | 'number'
  | 'switch'
  | 'choice'
  | 'link'
  | 'image'
  | 'color'
  | 'date'
  | 'list'
  | 'group'
  | 'record'
  | 'attributes'
  | 'filter'
  | 'sort'
  | 'curated'
  | 'code';

export interface KindChoice {
  readonly kind: PropertyKind;
  readonly label: MessageKey;
  readonly section: KindSection;
  readonly hint: string | MessageKey;
}

export interface CodeTypeChoice {
  readonly type: string;
  readonly label: string;
}

export const UNION_TYPE = '"Option 1" | "Option 2"';
const IMAGE_TYPE = 'ImageMetadata | string';
const IMAGE_TYPE_INLINE = 'import("astro").ImageMetadata | string';

export const KIND_CHOICES: readonly KindChoice[] = [
  { kind: 'text', label: 'componentProps.kind.text', section: 'basic', hint: 'string' },
  { kind: 'number', label: 'componentProps.kind.number', section: 'basic', hint: 'number' },
  { kind: 'switch', label: 'componentProps.kind.switch', section: 'basic', hint: 'boolean' },
  { kind: 'choice', label: 'componentProps.kind.choice', section: 'basic', hint: 'componentProps.kindHint.choice' },
  { kind: 'link', label: 'componentProps.kind.link', section: 'media', hint: 'string, @format uri' },
  { kind: 'image', label: 'componentProps.kind.image', section: 'media', hint: IMAGE_TYPE },
  { kind: 'color', label: 'componentProps.kind.color', section: 'media', hint: 'string, @format color' },
  { kind: 'date', label: 'componentProps.kind.date', section: 'media', hint: 'Date' },
  { kind: 'list', label: 'componentProps.kind.list', section: 'structure', hint: 'componentProps.kindHint.list' },
  { kind: 'group', label: 'componentProps.kind.group', section: 'structure', hint: 'componentProps.kindHint.group' },
  { kind: 'record', label: 'componentProps.kind.record', section: 'structure', hint: 'Record<string, string>' },
  { kind: 'attributes', label: 'componentProps.kind.attributes', section: 'element', hint: 'componentProps.kindHint.attributes' },
  { kind: 'filter', label: 'componentProps.kind.filter', section: 'collection', hint: 'componentProps.kindHint.filter' },
  { kind: 'sort', label: 'componentProps.kind.sort', section: 'collection', hint: 'componentProps.kindHint.sort' },
  { kind: 'curated', label: 'componentProps.kind.curated', section: 'collection', hint: 'componentProps.kindHint.curated' },
  { kind: 'code', label: 'componentProps.kind.code', section: 'advanced', hint: 'componentProps.kindHint.code' },
];

export const CODE_TYPE_CHOICES: readonly CodeTypeChoice[] = [
  { type: 'readonly [string, number]', label: 'Tuple' },
  { type: 'object', label: 'object' },
  { type: '(value: string) => void', label: 'Function' },
  { type: 'Promise<string>', label: 'Promise' },
  { type: 'bigint', label: 'bigint' },
  { type: 'symbol', label: 'symbol' },
  { type: 'null', label: 'null' },
  { type: 'undefined', label: 'undefined' },
  { type: 'unknown', label: 'unknown' },
  { type: 'never', label: 'never' },
  { type: 'void', label: 'void' },
  { type: 'any', label: 'any' },
];

const FORMATS = { link: 'uri', color: 'color' } as const;

export function propertyKind(property: Pick<ComponentProperty, 'type' | 'description'>): PropertyKind {
  const type = property.type.trim();
  switch (type) {
    case 'string':
      return stringKind(tagValue(property.description, 'format'));
    case 'number':
      return 'number';
    case 'boolean':
      return 'switch';
    case 'Date':
      return 'date';
    case SETTING_PROP_TYPES.filter:
      return 'filter';
    case SETTING_PROP_TYPES.sort:
      return 'sort';
    case SETTING_PROP_TYPES.curated:
      return 'curated';
    default:
      return structuredKind(type);
  }
}

export function withKind(
  property: Pick<ComponentProperty, 'type' | 'description'>,
  kind: Exclude<PropertyKind, 'attributes' | 'code'>,
  frontmatter: string,
): Pick<ComponentProperty, 'type' | 'description'> {
  const current = propertyKind(property);
  const type = current === kind ? property.type : kindType(kind, frontmatter);
  const format = kind === 'link' || kind === 'color' ? FORMATS[kind] : undefined;
  const description = tagValue(property.description, 'format') === format ? property.description : withTag(property.description, 'format', format);
  const out = { type, description };
  assert(propertyKind(out) === kind, 'withKind: the property reads back as the kind picked');
  return out;
}

export function kindType(kind: Exclude<PropertyKind, 'attributes' | 'code'>, frontmatter: string): string {
  switch (kind) {
    case 'text':
    case 'link':
    case 'color':
      return 'string';
    case 'number':
      return 'number';
    case 'switch':
      return 'boolean';
    case 'choice':
      return UNION_TYPE;
    case 'image':
      return /\bImageMetadata\b/.test(frontmatter) ? IMAGE_TYPE : IMAGE_TYPE_INLINE;
    case 'date':
      return 'Date';
    case 'list':
      return listTypeText(frontmatter, LIST_STARTER_FIELDS);
    case 'group':
      return '{ label: string }';
    case 'record':
      return 'Record<string, string>';
    case 'filter':
    case 'sort':
    case 'curated':
      return SETTING_PROP_TYPES[kind];
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function carriedDefault(defaultValue: string, kind: PropertyKind, type: string): string {
  const value = defaultValue.trim();
  if (value === '') {
    return '';
  }
  const text = quotedText(value);
  switch (kind) {
    case 'text':
    case 'link':
    case 'color':
      if (text !== undefined) {
        return value;
      }
      return /^-?\d+(\.\d+)?$/.test(value) || value === 'true' || value === 'false' ? JSON.stringify(value) : '';
    case 'number':
      if (/^-?\d+(\.\d+)?$/.test(value)) {
        return value;
      }
      return text !== undefined && /^-?\d+(\.\d+)?$/.test(text.trim()) ? text.trim() : '';
    case 'switch':
      if (value === 'true' || value === 'false') {
        return value;
      }
      return text === 'true' || text === 'false' ? text : '';
    case 'choice': {
      const options = literalOptions(type) ?? [];
      return options.includes(value) || options.some((option) => quotedText(option) !== undefined && quotedText(option) === text) ? value : '';
    }
    case 'image':
    case 'date':
    case 'list':
    case 'group':
    case 'record':
    case 'attributes':
    case 'filter':
    case 'sort':
    case 'curated':
    case 'code':
      return value;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function stringKind(format: string | undefined): PropertyKind {
  if (format === FORMATS.link) {
    return 'link';
  }
  if (format === FORMATS.color) {
    return 'color';
  }
  return 'text';
}

function structuredKind(type: string): PropertyKind {
  if (literalOptions(type) !== undefined) {
    return 'choice';
  }
  if (/\bImageMetadata\b/.test(type)) {
    return 'image';
  }
  if (/^Record\s*<\s*string\s*,/.test(type)) {
    return 'record';
  }
  if (/^\{[\s\S]*\}$/.test(type)) {
    return 'group';
  }
  if (/\[\]$/.test(type) || /^(readonly\s+)?(Readonly)?Array\s*</.test(type)) {
    return 'list';
  }
  return 'code';
}

function quotedText(value: string): string | undefined {
  if (/^'[^'\\]*'$/.test(value)) {
    return value.slice(1, -1);
  }
  if (/^"([^"\\]|\\.)*"$/.test(value)) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
