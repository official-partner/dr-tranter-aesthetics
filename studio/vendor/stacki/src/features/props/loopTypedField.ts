
import { assert } from '../../../shared/core/assert';
import { isFieldPath, ITEM_FIELD, type LoopFieldKind, type LoopQuery, type LoopSort, type LoopTestCondition } from '../../editor/loopQuery';
import { titled, type CatalogField } from './loopCatalog';

export const TYPED_KINDS = ['text', 'number', 'date', 'boolean'] as const satisfies readonly LoopFieldKind[];
export type TypedKind = (typeof TYPED_KINDS)[number];

const TYPED_FIELDS_MAX = 16;

export type TypedPath = { readonly ok: true; readonly path: string } | { readonly ok: false };

export function typedPathOf(text: string, item: string | undefined): TypedPath {
  const trimmed = text.trim();
  if (item !== undefined && trimmed === item) {
    return { ok: true, path: ITEM_FIELD };
  }
  const path = item !== undefined && trimmed.startsWith(`${item}.`) ? trimmed.slice(item.length + 1) : trimmed;
  return isFieldPath(path) ? { ok: true, path } : { ok: false };
}

export function typedField(path: string, kind: TypedKind): CatalogField {
  assert(isFieldPath(path) || path === ITEM_FIELD, 'A typed field names a path');
  return { path, title: titled(path), kind, options: [], references: [] };
}

export function kindOfCondition(condition: LoopTestCondition): TypedKind {
  const operator = condition.operator;
  switch (operator) {
    case 'greater':
    case 'less':
    case 'atLeast':
    case 'atMost':
      return 'number';
    case 'before':
    case 'after':
    case 'inPast':
    case 'inFuture':
      return 'date';
    case 'isTrue':
    case 'isFalse':
      return 'boolean';
    case 'is':
    case 'isNot':
      return 'value' in condition && typeof condition.value !== 'string' && condition.value.kind === 'number' ? 'number' : 'text';
    case 'contains':
    case 'has':
    case 'isSet':
    case 'isEmpty':
      return 'text';
    default: {
      const exhaustive: never = operator;
      return exhaustive;
    }
  }
}

function kindOfSort(sort: LoopSort): TypedKind {
  switch (sort.order) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'boolean':
      return 'boolean';
    case 'text':
    case 'natural':
    case 'length':
    case 'count':
    case 'fileSize':
      return 'text';
    default: {
      const exhaustive: never = sort.order;
      return exhaustive;
    }
  }
}

export function withTypedFields(fields: readonly CatalogField[] | undefined, query: LoopQuery): readonly CatalogField[] | undefined {
  if (query.source.kind !== 'list') {
    return fields;
  }
  const known = fields ?? [];
  const added = new Map<string, CatalogField>();
  const note = (path: string, kind: TypedKind): void => {
    if (!known.some((field) => field.path === path) && !added.has(path) && added.size < TYPED_FIELDS_MAX) {
      added.set(path, typedField(path, kind));
    }
  };
  for (const condition of query.conditions) {
    if (condition.kind === 'test') {
      note(condition.field, kindOfCondition(condition));
    }
  }
  for (const sort of query.sorts) {
    note(sort.field, kindOfSort(sort));
  }
  return added.size === 0 ? fields : [...known, ...added.values()];
}
