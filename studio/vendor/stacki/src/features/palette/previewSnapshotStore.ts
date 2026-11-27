import { assert } from '../../../shared/core/assert';
import { ByteLru, PREVIEW_CACHE_BUDGETS } from '../../../shared/properties/previewLru';
import {
  cancelAll,
  EMPTY_PREVIEW_QUEUE,
  enqueue,
  finish,
  PREVIEW_QUEUE_LIMITS,
  reprioritize,
  startNext,
  type PreviewPriority,
  type PreviewQueue,
} from '../../../shared/properties/previewQueue';
import { PREVIEW_SNAPSHOT_LIMITS, type PreviewSnapshotMessage } from '../../../shared/properties/previewSnapshot';
import { nextTileState, readPageReason, TILE_IDLE, type TileEvent, type TileState, type TileUnavailable } from '../../../shared/properties/previewTile';
import { NO_PERSISTENCE, type HeldSnapshot, type SnapshotPersistence } from './snapshotPersistence';


export const ORIGIN_TOKEN = '__AVB_ORIGIN__';

export const REVALIDATE_AFTER_MS = 60_000;

export const RENDER_TIMEOUT_MS = 20_000;

export interface TileSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export type ProduceOutcome =
  | { readonly kind: 'snapshot'; readonly message: PreviewSnapshotMessage }
  | { readonly kind: 'unchanged'; readonly key: string }
  | { readonly kind: 'empty'; readonly reason: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unresolved' };

export type Producer = (source: TileSource, knownKey: string | undefined) => Promise<ProduceOutcome>;

export interface TileRequest {
  readonly source: TileSource;
  readonly priority: PreviewPriority;
  readonly order: number;
}

export interface StoreOptions {
  readonly persistence?: SnapshotPersistence;
  readonly now?: () => number;
  readonly concurrency?: number;
}

export class PreviewSnapshotStore {
  private readonly states = new Map<string, TileState>();
  private readonly held = new ByteLru<HeldSnapshot>(PREVIEW_CACHE_BUDGETS.memoryBytes);
  private readonly sources = new Map<string, TileSource>();
  private readonly listeners = new Set<() => void>();
  private readonly checkedAtMs = new Map<string, number>();
  private readonly reading = new Set<string>();
  private readonly sampleOnly = new Set<string>();
  private queue: PreviewQueue = EMPTY_PREVIEW_QUEUE;
  private version = 0;
  private closed = false;
  private readonly persistence: SnapshotPersistence;
  private readonly now: () => number;
  private readonly concurrency: number;

  constructor(
    private readonly projectKey: string,
    private readonly produce: Producer,
    options: StoreOptions = {},
  ) {
    this.persistence = options.persistence ?? NO_PERSISTENCE;
    this.now = options.now ?? Date.now;
    this.concurrency = options.concurrency ?? PREVIEW_QUEUE_LIMITS.concurrencyMax;
    assert(this.concurrency >= 1, 'The store renders at least one at a time');
    assert(this.concurrency <= PREVIEW_QUEUE_LIMITS.concurrencyMax, 'The store renders within the queue bound');
  }

  snapshotVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  tile(id: string): TileState {
    return this.states.get(id) ?? TILE_IDLE;
  }

  snapshot(id: string): HeldSnapshot | undefined {
    return this.held.peek(id);
  }

  request(requests: readonly TileRequest[]): void {
    if (this.closed) {
      return;
    }
    for (const { source, priority, order } of requests) {
      this.sources.set(source.id, source);
      const state = this.tile(source.id);
      if (state.kind === 'unavailable') {
        continue;
      }
      if (state.kind === 'idle' || (state.kind === 'ready' && this.held.peek(source.id) === undefined)) {
        this.load(source.id);
      }
      if (this.needsRender(source.id)) {
        const before = this.queue;
        this.queue = enqueue(this.queue, { id: source.id, priority, order });
        if (this.queue !== before && this.tile(source.id).kind === 'idle') {
          this.dispatch(source.id, { kind: 'enqueue' });
        }
      }
    }
    this.pump();
  }

  prioritize(priorities: ReadonlyMap<string, PreviewPriority>): void {
    this.queue = reprioritize(this.queue, priorities);
  }

  retry(id: string): void {
    const state = this.tile(id);
    const source = this.sources.get(id);
    if (state.kind !== 'unavailable' || source === undefined) {
      return;
    }
    this.sampleOnly.add(id);
    this.dispatch(id, { kind: 'retry' });
    this.queue = enqueue(this.queue, { id, priority: 'visible', order: -1 });
    this.pump();
  }

  cancelWaiting(): void {
    this.queue = cancelAll(this.queue);
    for (const [id, state] of this.states) {
      if (state.kind === 'queued') {
        this.states.set(id, TILE_IDLE);
      }
    }
    this.changed();
  }

  invalidateChecks(): void {
    this.checkedAtMs.clear();
    for (const [id, state] of this.states) {
      if (state.kind === 'unavailable') {
        this.states.set(id, TILE_IDLE);
      }
    }
    this.changed();
  }

  close(): void {
    this.closed = true;
    this.queue = cancelAll(this.queue);
    this.listeners.clear();
  }

  private needsRender(id: string): boolean {
    const state = this.tile(id);
    if (state.kind === 'rendering' || state.kind === 'queued') {
      return false;
    }
    if (state.kind === 'ready' && state.refreshing) {
      return false;
    }
    const checked = this.checkedAtMs.get(id);
    return checked === undefined || this.now() - checked > REVALIDATE_AFTER_MS;
  }

  private load(id: string): void {
    const inMemory = this.held.get(id);
    if (inMemory !== undefined) {
      this.dispatch(id, { kind: 'rendered', key: inMemory.key, attempt: inMemory.attempt });
      return;
    }
    if (this.reading.has(id)) {
      return;
    }
    this.reading.add(id);
    void this.persistence.read(`${this.projectKey}::${id}`).then((stored) => {
      this.reading.delete(id);
      if (this.closed || stored === undefined) {
        return;
      }
      if (this.held.peek(id) === undefined) {
        this.held.set(id, stored, stored.bytes);
      }
      if (this.tile(id).kind !== 'ready') {
        this.dispatch(id, { kind: 'rendered', key: stored.key, attempt: stored.attempt });
      }
    });
  }

  private pump(): void {
    const { queue, started } = startNext(this.queue, this.concurrency);
    this.queue = queue;
    for (const entry of started) {
      void this.run(entry.id);
    }
  }

  private async run(id: string): Promise<void> {
    const listed = this.sources.get(id);
    assert(listed !== undefined, 'A queued tile has a source');
    const source = this.sampleOnly.has(id) ? { ...listed, url: `${listed.url}&attempts=sample` } : listed;
    this.dispatch(id, { kind: 'start' });
    const known = this.held.peek(id)?.key;
    let outcome: ProduceOutcome;
    try {
      outcome = await this.produce(source, known);
    } catch (error: unknown) {
      outcome = { kind: 'empty', reason: 'Threw: ' + String(error) };
    }
    this.queue = finish(this.queue, id);
    if (!this.closed) {
      this.settle(id, outcome);
      this.pump();
    }
  }

  private settle(id: string, outcome: ProduceOutcome): void {
    switch (outcome.kind) {
      case 'snapshot': {
        const message = outcome.message;
        const held: HeldSnapshot = { key: message.key, html: message.html, box: message.box, attempt: message.attempt, bytes: message.html.length };
        assert(held.bytes <= PREVIEW_SNAPSHOT_LIMITS.htmlCharsMax, 'A parsed snapshot is within its bound');
        if (!this.held.set(id, held, held.bytes)) {
          this.dispatch(id, { kind: 'failed', reason: { kind: 'too-large' } });
          return;
        }
        this.checkedAtMs.set(id, this.now());
        this.dispatch(id, { kind: 'rendered', key: held.key, attempt: held.attempt });
        void this.persistence.write(`${this.projectKey}::${id}`, held);
        return;
      }
      case 'unchanged':
        this.checkedAtMs.set(id, this.now());
        this.dispatch(id, { kind: 'unchanged' });
        return;
      case 'empty':
        this.dispatch(id, { kind: 'failed', reason: readPageReason(outcome.reason) });
        return;
      case 'timeout':
        this.dispatch(id, { kind: 'failed', reason: { kind: 'timeout' } });
        return;
      case 'unresolved':
        this.dispatch(id, { kind: 'failed', reason: { kind: 'no-server' } });
        return;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  markUnavailable(id: string, reason: TileUnavailable): void {
    this.dispatch(id, { kind: 'failed', reason });
  }

  private dispatch(id: string, event: TileEvent): void {
    const before = this.tile(id);
    const after = nextTileState(before, event);
    if (after !== before) {
      this.states.set(id, after);
      this.changed();
    }
  }

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

const stores = new Map<string, PreviewSnapshotStore>();
const STORES_MAX = 8;

export function storeFor(projectKey: string, create: () => PreviewSnapshotStore): PreviewSnapshotStore {
  const existing = stores.get(projectKey);
  if (existing !== undefined) {
    return existing;
  }
  assert(stores.size < STORES_MAX + 1, 'Stores are bounded');
  if (stores.size >= STORES_MAX) {
    const oldest = stores.keys().next().value;
    if (oldest !== undefined) {
      stores.get(oldest)?.close();
      stores.delete(oldest);
    }
  }
  const created = create();
  stores.set(projectKey, created);
  return created;
}
