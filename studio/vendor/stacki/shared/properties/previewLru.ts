
import { assert } from '../core/assert';

export const PREVIEW_CACHE_BUDGETS = {
  memoryBytes: 24 * 1024 * 1024,
  diskBytes: 96 * 1024 * 1024,
} as const;

export interface CacheEntryInfo {
  readonly id: string;
  readonly bytes: number;
  readonly usedAtMs: number;
}

export function evictionOrder(entries: readonly CacheEntryInfo[], budgetBytes: number): readonly string[] {
  assert(budgetBytes >= 0, 'A cache budget is not negative');
  const dropped: string[] = [];
  const kept = entries.filter((entry) => {
    if (entry.bytes > budgetBytes) {
      dropped.push(entry.id);
      return false;
    }
    return true;
  });
  let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
  const oldestFirst = [...kept].sort((left, right) => left.usedAtMs - right.usedAtMs || (left.id < right.id ? -1 : 1));
  for (const entry of oldestFirst) {
    if (total <= budgetBytes) {
      break;
    }
    dropped.push(entry.id);
    total -= entry.bytes;
  }
  assert(total <= budgetBytes, 'Eviction leaves the cache within its budget');
  return dropped;
}

export class ByteLru<V> {
  private readonly entries = new Map<string, { readonly value: V; readonly bytes: number }>();
  private totalBytes = 0;

  constructor(private readonly budgetBytes: number) {
    assert(budgetBytes > 0, 'A cache budget is positive');
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get(id: string): V | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.value;
  }

  peek(id: string): V | undefined {
    return this.entries.get(id)?.value;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  set(id: string, value: V, bytes: number): boolean {
    assert(bytes >= 0, 'An entry has a size');
    this.delete(id);
    if (bytes > this.budgetBytes) {
      return false;
    }
    this.entries.set(id, { value, bytes });
    this.totalBytes += bytes;
    for (const [oldest, entry] of this.entries) {
      if (this.totalBytes <= this.budgetBytes) {
        break;
      }
      this.entries.delete(oldest);
      this.totalBytes -= entry.bytes;
    }
    assert(this.totalBytes <= this.budgetBytes, 'The cache stays within its budget');
    assert(this.entries.has(id), 'The entry just stored is the most recent and survives');
    return true;
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (entry !== undefined) {
      this.entries.delete(id);
      this.totalBytes -= entry.bytes;
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  keys(): readonly string[] {
    return [...this.entries.keys()];
  }
}
