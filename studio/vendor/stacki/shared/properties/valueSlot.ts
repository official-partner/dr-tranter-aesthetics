
import { assert } from '../core/assert';
import { valuePredicateFor } from './propertyValueAccepts';

export const SLOT_MARK = '\u0000';

export interface ValueSlot {
  readonly before: string;
  readonly after: string;
}

export type Supports = (property: string, value: string) => boolean;

export const VALUE_SLOT_LIMITS = {
  checksPerPassMax: 2_000,
  cacheEntriesMax: 4_096,
  expressionCharsMax: 8_192,
} as const;

export function slotOfMarked(marked: string): ValueSlot | undefined {
  const index = marked.indexOf(SLOT_MARK);
  if (index < 0) {
    return undefined;
  }
  assert(marked.indexOf(SLOT_MARK, index + 1) < 0, 'slotOfMarked: one insertion point');
  return { before: marked.slice(0, index), after: marked.slice(index + 1) };
}

export function isWholeSlot(slot: ValueSlot | undefined): boolean {
  if (slot === undefined) {
    return true;
  }
  return slot.before.trim() === '' && /^\s*(?:!\s*important)?\s*$/i.test(slot.after);
}

export function slotAccepts(property: string | undefined, slot: ValueSlot | undefined, computed: string | undefined, supports: Supports): boolean {
  if (property === undefined || property.startsWith('--')) {
    return true;
  }
  if (computed === undefined || computed.trim() === '') {
    return false;
  }
  const value = computed.trim();
  if (isWholeSlot(slot)) {
    if (!supports(property, value)) {
      return false;
    }
    const curated = valuePredicateFor(property);
    return curated === undefined ? true : curated(value);
  }
  assert(slot !== undefined, 'slotAccepts: a partial slot exists');
  const expression = slot.before + value + slot.after;
  if (expression.length > VALUE_SLOT_LIMITS.expressionCharsMax) {
    return supports(property, value);
  }
  return supports(property, expression);
}

export class VerdictCache {
  readonly #entries = new Map<string, boolean>();
  readonly #max: number;
  constructor(max: number = VALUE_SLOT_LIMITS.cacheEntriesMax) {
    assert(Number.isSafeInteger(max), 'VerdictCache: the bound is a positive whole number');
    assert(max >= 1, 'VerdictCache: the bound is a positive whole number');
    this.#max = max;
  }
  get size(): number {
    return this.#entries.size;
  }
  verdict(key: string, compute: () => boolean): boolean {
    const known = this.#entries.get(key);
    if (known !== undefined) {
      return known;
    }
    const fresh = compute();
    if (this.#entries.size >= this.#max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done !== true) {
        this.#entries.delete(oldest.value);
      }
    }
    this.#entries.set(key, fresh);
    assert(this.#entries.size <= this.#max, 'VerdictCache: stays within its bound');
    return fresh;
  }
  clear(): void {
    this.#entries.clear();
  }
}

export interface SlotCandidate<T> {
  readonly item: T;
  readonly computed: string | undefined;
  readonly keep: boolean;
}

export function filterBySlot<T>(
  candidates: readonly SlotCandidate<T>[],
  property: string | undefined,
  slot: ValueSlot | undefined,
  supports: Supports,
  cache: VerdictCache,
): readonly T[] {
  const judge = (activeSlot: ValueSlot | undefined): { readonly items: readonly T[]; readonly passed: number } => {
    let asked = 0;
    let passed = 0;
    const items: T[] = [];
    for (const candidate of candidates) {
      if (asked >= VALUE_SLOT_LIMITS.checksPerPassMax && !candidate.keep) {
        items.push(candidate.item);
        passed += 1;
        continue;
      }
      asked += 1;
      const key = `${property ?? ''}\u0001${activeSlot?.before ?? ''}\u0001${activeSlot?.after ?? ''}\u0001${candidate.computed ?? ''}`;
      const fits = cache.verdict(key, () => slotAccepts(property, activeSlot, candidate.computed, supports));
      if (candidate.keep || fits) {
        items.push(candidate.item);
      }
      if (fits) {
        passed += 1;
      }
    }
    return { items, passed };
  };
  const inSlot = judge(slot);
  if (candidates.length > 0 && inSlot.passed === 0 && !isWholeSlot(slot)) {
    return judge(undefined).items;
  }
  return inSlot.items;
}
