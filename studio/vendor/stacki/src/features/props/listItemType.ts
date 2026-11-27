
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { PropField, PropItemKind } from '../../../shared/properties/propSchema';
import { itemHoldsCode, type Item } from './arrayValue';
import { itemFieldDefinition, type ItemShapeField } from './listItemShape';
import type { FieldDefinition } from './propRules';

export type ListItemKind = PropItemKind | 'object' | 'mixed';

export interface DeclaredItemType {
  readonly kind: PropItemKind;
  readonly options?: readonly string[] | undefined;
  readonly numeric?: boolean | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
}

export interface ItemControl {
  readonly control: 'text' | 'number' | 'toggle' | 'dropdown' | 'fields' | 'generic';
  readonly fieldType: 'string' | 'number' | 'boolean' | 'enum' | 'other';
}

export function declaredItemTypeOf(field: Pick<PropField, 'itemKind' | 'options' | 'numeric' | 'min' | 'max' | 'step'>): DeclaredItemType | undefined {
  if (field.itemKind === undefined) {
    return undefined;
  }
  return { kind: field.itemKind, options: field.options, numeric: field.numeric, min: field.min, max: field.max, step: field.step };
}

export function kindOfItem(item: Item): PropItemKind {
  if (item.fields !== undefined) {
    return 'text';
  }
  if (item.quote !== undefined) {
    return 'text';
  }
  if (item.text === 'true' || item.text === 'false') {
    return 'switch';
  }
  return itemHoldsCode(item) ? 'text' : 'number';
}

export function listItemKindOf(declared: DeclaredItemType | undefined, items: readonly Item[], shape: readonly ItemShapeField[] | undefined): ListItemKind {
  assert(items.length <= LIMITS.scanEntriesMax, 'listItemKindOf: the items are bounded');
  if (declared !== undefined) {
    return declared.kind;
  }
  if (shape !== undefined && shape.length > 0) {
    return 'object';
  }
  let objects = 0;
  const kinds = new Set<PropItemKind>();
  for (const item of items) {
    if (item.fields !== undefined) {
      objects += 1;
    } else if (!itemHoldsCode(item)) {
      kinds.add(kindOfItem(item));
    }
  }
  if (objects > 0) {
    return objects === items.length ? 'object' : 'mixed';
  }
  const [only] = kinds;
  return kinds.size === 1 && only !== undefined ? only : 'mixed';
}

export function controlOfItemKind(kind: ListItemKind): ItemControl {
  switch (kind) {
    case 'text':
      return { control: 'text', fieldType: 'string' };
    case 'number':
      return { control: 'number', fieldType: 'number' };
    case 'switch':
      return { control: 'toggle', fieldType: 'boolean' };
    case 'choice':
      return { control: 'dropdown', fieldType: 'enum' };
    case 'object':
      return { control: 'fields', fieldType: 'other' };
    case 'mixed':
      return { control: 'generic', fieldType: 'other' };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function itemRowField(kind: PropItemKind, name: string, declared: DeclaredItemType | undefined): FieldDefinition {
  assert(name.length > 0, 'itemRowField: a row field is named');
  const base = itemFieldDefinition(name, itemRowDeclaration(kind, name, declared));
  if (kind === 'choice') {
    return declared?.numeric === true ? { ...base, numeric: true } : base;
  }
  if (kind !== 'number') {
    return base;
  }
  return {
    ...base,
    ...(declared?.min === undefined ? {} : { min: declared.min }),
    ...(declared?.max === undefined ? {} : { max: declared.max }),
    ...(declared?.step === undefined ? {} : { step: declared.step }),
  };
}

export function defaultItemOf(kind: ListItemKind, declared: DeclaredItemType | undefined, quote: string): Item {
  assert(quote === '"' || quote === "'" || quote === '`', 'defaultItemOf: a quote is one');
  switch (kind) {
    case 'number': {
      const start = Math.min(declared?.max ?? Number.POSITIVE_INFINITY, Math.max(declared?.min ?? Number.NEGATIVE_INFINITY, 0));
      assert(Number.isFinite(start), 'defaultItemOf: a number item starts at a finite number');
      return { text: String(start), quote: undefined };
    }
    case 'switch':
      return { text: 'false', quote: undefined };
    case 'choice':
      return { text: declared?.options?.[0] ?? '', quote };
    case 'text':
    case 'object':
    case 'mixed':
      return { text: '', quote };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function itemRowDeclaration(kind: PropItemKind, name: string, declared: DeclaredItemType | undefined): ItemShapeField {
  switch (kind) {
    case 'text':
      return { name, kind: 'text' };
    case 'number':
      return { name, kind: 'number' };
    case 'switch':
      return { name, kind: 'switch' };
    case 'choice':
      return { name, kind: 'option', options: declared?.options ?? [] };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
