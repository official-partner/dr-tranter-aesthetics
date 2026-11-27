
import { assert } from '../../../../shared/core/assert';
import type { ResolvedBreakpoint } from '../../../../shared/properties/projectBreakpoints';
import type { StyleContext } from '../model/resolved';
import { describeCondition, orderByBar } from './contextRows';

export const CONTEXT_GROUP_ENTRIES_MAX = 512;

export interface ContextGroupKey {
  readonly source: string | undefined;
  readonly wrapper: string | undefined;
}

export type ContextGroup<T> =
  | { readonly kind: 'base'; readonly item: T }
  | { readonly kind: 'group'; readonly key: ContextGroupKey; readonly items: readonly T[] }
  | { readonly kind: 'loose'; readonly item: T }
  | { readonly kind: 'other'; readonly items: readonly T[] };

export function groupContexts<T extends { readonly context: StyleContext; readonly wrapper: string | undefined }>(
  items: readonly T[],
  resolved: readonly ResolvedBreakpoint[],
): ContextGroup<T>[] {
  assert(items.length <= CONTEXT_GROUP_ENTRIES_MAX, 'groupContexts: a context list is bounded');
  const result: ContextGroup<T>[] = [];
  const groups = new Map<string, { key: ContextGroupKey; items: T[] }>();
  const loose: T[] = [];
  const other: T[] = [];
  let base: T | undefined;
  for (const item of items) {
    if (item.context.key === '') {
      assert(base === undefined, 'groupContexts: one Base');
      base = item;
      continue;
    }
    const atContext = item.context.embedAtContext ?? '';
    if (atContext !== '' && describeCondition(atContext, resolved).kind === 'other') {
      other.push(item);
      continue;
    }
    const source = item.context.source;
    if (source === undefined) {
      loose.push(item);
      continue;
    }
    const id = `${source}\u0000${item.wrapper ?? ''}`;
    const found = groups.get(id);
    if (found === undefined) {
      groups.set(id, { key: { source, wrapper: item.wrapper }, items: [item] });
    } else {
      found.items.push(item);
    }
  }
  if (base !== undefined) {
    result.push({ kind: 'base', item: base });
  }
  for (const group of groups.values()) {
    result.push({ kind: 'group', key: group.key, items: byWidth(group.items, resolved) });
  }
  for (const item of loose) {
    result.push({ kind: 'loose', item });
  }
  if (other.length > 0) {
    result.push({ kind: 'other', items: other });
  }
  return result;
}

function byWidth<T extends { readonly context: StyleContext }>(items: readonly T[], resolved: readonly ResolvedBreakpoint[]): T[] {
  const described = items.map((item, index) => ({ item, index, condition: describeCondition(item.context.embedAtContext ?? '', resolved) }));
  const ordered = orderByBar(described).map((entry) => entry.item);
  const rest = described.filter((entry) => entry.condition.kind !== 'width').map((entry) => entry.item);
  return [...ordered, ...rest];
}
