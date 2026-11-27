
import { assert } from '../../../shared/core/assert';
import type { PropShapeField } from '../../../shared/properties/propSchema';
import { LIMITS } from '../../../shared/core/limits';
import {
  impliedKind,
  ITEM_FIELD_LIMITS,
  kindOfFormat,
  FORMAT_WORDS,
  type ItemFieldDeclaration,
  type ItemFieldKind,
  type ListItemValues,
} from '../../editor/itemFields';
import type { ShapeMember } from '../../editor/dataScope';
import { LIST_LIMITS } from '../../editor/listPropType';
import type { Attr } from '../../../shared/page/pageNode';
import { arrayItems, arrayText, fieldHoldsCode, nestedItems, type Item, type ItemField } from './arrayValue';
import { isExpression } from './jsCheck';
import type { FieldDefinition } from './propRules';

export type ItemShapeField = ItemFieldDeclaration;

export function itemShapeOf(shape: readonly ShapeMember[] | undefined, depth = 1): readonly ItemShapeField[] | undefined {
  if (shape === undefined || shape.length === 0) {
    return undefined;
  }
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'itemShapeOf: the shape nests within its bound');
  assert(shape.length <= LIMITS.propSchemaFieldsMax, 'itemShapeOf: a shape is bounded');
  const out = shape.map((member) => declaredField(member, depth));
  assert(out.length === shape.length, 'itemShapeOf: every member is a field');
  return out;
}

function declaredField(member: ShapeMember, depth: number): ItemShapeField {
  const { name } = member;
  const nested = member.shape !== undefined && member.shape.length > 0 && depth < ITEM_FIELD_LIMITS.depthMax;
  if (nested) {
    const fields = itemShapeOf(member.shape, depth + 1) ?? [];
    return { name, kind: member.shapeIsList === true ? 'list' : 'group', fields };
  }
  if (member.type === 'number') {
    return { name, kind: 'number' };
  }
  if (member.type === 'boolean') {
    return { name, kind: 'switch' };
  }
  if (member.type === 'enum' && member.options !== undefined && member.options.length >= 2) {
    return { name, kind: 'option', options: member.options };
  }
  return { name, kind: kindOfFormat(member.format) ?? impliedKind(name) };
}

export function shapeMembersOf(fields: readonly ItemFieldDeclaration[], depth = 1): readonly PropShapeField[] {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'shapeMembersOf: the fields nest within their bound');
  return fields.map((field): PropShapeField => {
    switch (field.kind) {
      case 'number':
        return { name: field.name, type: 'number' };
      case 'switch':
        return { name: field.name, type: 'boolean' };
      case 'option':
        return { name: field.name, type: 'enum', options: field.options };
      case 'list':
      case 'group':
        return { name: field.name, type: 'code', shape: shapeMembersOf(field.fields, depth + 1), shapeIsList: field.kind === 'list' };
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
        return { name: field.name, type: 'string', format: FORMAT_WORDS[field.kind] };
      default: {
        const exhaustive: never = field;
        return exhaustive;
      }
    }
  });
}

export function inferredField(field: ItemField, depth = 1): ItemShapeField {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'inferredField: the value nests within its bound');
  const { key: name } = field;
  if (field.quote === undefined && (field.text.startsWith('[') || field.text.startsWith('{'))) {
    const first = nestedItems(field.text)?.[0]?.fields ?? [];
    const fields = depth < ITEM_FIELD_LIMITS.depthMax ? first.map((inner) => inferredField(inner, depth + 1)) : [];
    return { name, kind: field.text.startsWith('[') ? 'list' : 'group', fields };
  }
  if (field.quote === undefined && !fieldHoldsCode(field)) {
    return { name, kind: field.text === 'true' || field.text === 'false' ? 'switch' : 'number' };
  }
  return { name, kind: impliedKind(name) };
}

export function itemFieldKind(field: ItemField, shape: readonly ItemShapeField[] | undefined): ItemFieldKind {
  return itemFieldDeclaration(field, shape).kind;
}

export function itemFieldDeclaration(field: ItemField, shape: readonly ItemShapeField[] | undefined): ItemShapeField {
  return shape?.find((entry) => entry.name === field.key) ?? inferredField(field);
}

export function itemFieldDefinition(key: string, declaration: ItemShapeField | ItemFieldKind): FieldDefinition {
  const field: ItemShapeField = typeof declaration === 'string' ? plainDeclaration(key, declaration) : declaration;
  const base = { name: key, optional: true };
  switch (field.kind) {
    case 'number':
      return { ...base, type: 'number' };
    case 'switch':
      return { ...base, type: 'boolean' };
    case 'option':
      return { ...base, type: 'enum', options: field.options };
    case 'list':
    case 'group':
      return { ...base, type: 'code', shape: shapeMembersOf(field.fields), shapeIsList: field.kind === 'list' };
    case 'longText':
    case 'richText':
      return { ...base, type: 'text', doc: `@format ${FORMAT_WORDS[field.kind]}` };
    case 'text':
    case 'image':
    case 'video':
    case 'file':
    case 'link':
    case 'email':
    case 'phone':
    case 'color':
    case 'date':
      return { ...base, type: 'string', doc: `@format ${FORMAT_WORDS[field.kind]}` };
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

function plainDeclaration(name: string, kind: ItemFieldKind): ItemShapeField {
  if (kind === 'option') {
    return { name, kind, options: [] };
  }
  if (kind === 'list' || kind === 'group') {
    return { name, kind, fields: [] };
  }
  return { name, kind };
}

export function itemFieldValue(field: ItemField): Attr | undefined {
  if (field.quote === undefined) {
    return { type: 'expr', value: field.text };
  }
  return field.text === '' ? undefined : { type: 'string', value: field.text };
}

export function itemFieldOf(field: ItemField, value: Attr | undefined, declaration: ItemShapeField | ItemFieldKind, quote: string): ItemField | undefined {
  if (value === undefined) {
    const blank = typeof declaration === 'string' ? plainDeclaration(field.key, declaration) : declaration;
    return { ...blankField(blank, quote, 1), keyQuote: field.keyQuote };
  }
  switch (value.type) {
    case 'string':
      return { ...field, text: value.value, quote: field.quote ?? quote };
    case 'bare':
      return { ...field, text: 'true', quote: undefined };
    case 'expr': {
      const next = { ...field, text: value.value.trim(), quote: undefined };
      if (!isExpression(next.text)) {
        return undefined;
      }
      const read = arrayItems(arrayText([{ fields: [next] }]))?.[0]?.fields;
      return read?.length === 1 ? next : undefined;
    }
    case 'spread':
      assert(false, 'itemFieldOf: an item field is not a spread');
      return undefined;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function blankItemOf(shape: readonly ItemShapeField[], quote: string): Item {
  assert(shape.length > 0, 'blankItemOf: an item has a field');
  assert(quote === '"' || quote === "'" || quote === '`', 'blankItemOf: a quote is one');
  return { fields: shape.map((field) => blankField(field, quote, 1)) };
}

function blankField(field: ItemShapeField, quote: string, depth: number): ItemField {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'blankField: the fields nest within their bound');
  const key = field.name;
  switch (field.kind) {
    case 'number':
      return { key, keyQuote: undefined, text: '0', quote: undefined };
    case 'switch':
      return { key, keyQuote: undefined, text: 'false', quote: undefined };
    case 'option':
      return { key, keyQuote: undefined, text: field.options[0] ?? '', quote };
    case 'list':
      return { key, keyQuote: undefined, text: '[]', quote: undefined };
    case 'group': {
      const inner = field.fields.map((nested) => blankField(nested, quote, depth + 1));
      return { key, keyQuote: undefined, text: arrayText([{ fields: inner }]).slice(1, -1), quote: undefined };
    }
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
      return { key, keyQuote: undefined, text: '', quote };
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

export function conformedItem(item: Item, shape: readonly ItemShapeField[] | undefined, quote: string): Item {
  if (shape === undefined || shape.length === 0 || item.fields === undefined) {
    return item;
  }
  const own = item.fields;
  const declared = shape.map((entry) => own.find((field) => field.key === entry.name) ?? blankField(entry, quote, 1));
  const extra = own.filter((field) => !shape.some((entry) => entry.name === field.key));
  const out: Item = { fields: [...declared, ...extra] };
  assert(out.fields.length >= own.length, 'conformedItem: no field is dropped');
  return out;
}

export function itemValuesOf(items: readonly Item[]): readonly ListItemValues[] {
  assert(items.length <= LIST_LIMITS.itemsMax * 4, 'itemValuesOf: the items are bounded');
  return items.map((item) => Object.fromEntries((item.fields ?? []).map((field) => [field.key, field.text])));
}

export function renamedItemField(items: readonly Item[], from: string, to: string): readonly Item[] {
  if (from === to) {
    return items;
  }
  return items.map((item) => (item.fields === undefined ? item : { fields: item.fields.map((field) => (field.key === from ? { ...field, key: to } : field)) }));
}
