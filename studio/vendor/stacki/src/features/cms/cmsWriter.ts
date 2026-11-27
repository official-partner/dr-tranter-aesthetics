import type { Collection } from './cmsSchema';
import { reassemble } from './cmsSchema';
import { writeCms } from './cmsBridge';
import { assert } from '../../../shared/core/assert';
import { BOUNDARY_LIMITS } from '../../../shared/core/boundary';
import { createCoalescedRun } from '../../lib/coalescedRun';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';

export interface CmsUndo {
  readonly label: string;
  readonly coalesceKey: string;
  readonly undo: () => Promise<void>;
  readonly redo: () => Promise<void>;
}
interface WriterOptions {
  readonly projectPath: string;
  readonly rel: string;
  readonly report: (message: string) => void;
  readonly refresh: () => Promise<void>;
  readonly saved: () => void;
  readonly record: (command: CmsUndo) => void;
  readonly translate?: Translator | undefined;
}
type Snapshot =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly collection: Collection;
      readonly data: unknown;
    };
type QueuedWrite =
  { readonly kind: 'items'; readonly items: readonly unknown[] } | { readonly kind: 'data'; readonly data: unknown; readonly expected: unknown };
type WriteState =
  { readonly kind: 'idle' } | { readonly kind: 'queued'; readonly write: QueuedWrite } | { readonly kind: 'writing'; pending: QueuedWrite | undefined };
const SAVE_DELAY_MS = 400;

export function createCmsWriter(options: WriterOptions) {
  return new CmsWriter(options);
}

class CmsWriter {
  private snapshot: Snapshot = { kind: 'empty' };
  private state: WriteState = { kind: 'idle' };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private editRevision = 0;
  private readonly writes = createCoalescedRun(() => this.writeQueued());
  constructor(private readonly options: WriterOptions) {}

  accept(collection: Collection, data: unknown): void {
    assert(this.state.kind === 'idle', 'CMS load: cannot replace unsaved data');
    assert(collection.rel === this.options.rel, 'CMS load: snapshot belongs to another file');
    this.snapshot = { kind: 'ready', collection, data };
  }
  revision(): number {
    return this.editRevision;
  }
  queue(items: readonly unknown[]): void {
    assert(this.snapshot.kind === 'ready', 'CMS edit: a loaded snapshot is required');
    assert(items.length <= BOUNDARY_LIMITS.itemsMax, 'CMS edit: item limit exceeded');
    this.editRevision++;
    assert(Number.isSafeInteger(this.editRevision), 'CMS edit: revision limit exceeded');
    this.enqueue({ kind: 'items', items });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, SAVE_DELAY_MS);
  }
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.state.kind === 'idle') {
      return Promise.resolve(true);
    }
    return this.writes.request();
  }
  private enqueue(write: QueuedWrite): void {
    if (this.state.kind === 'writing') {
      this.state.pending = write;
    } else {
      this.state = { kind: 'queued', write };
    }
  }
  private async writeQueued(): Promise<boolean> {
    if (this.state.kind === 'idle') {
      return true;
    }
    assert(this.state.kind === 'queued', 'CMS save: writes run one at a time');
    assert(this.snapshot.kind === 'ready', 'CMS save: a loaded snapshot is required');
    const write = this.state.write;
    const before = this.snapshot.data;
    const after = write.kind === 'items' ? reassemble(this.snapshot.collection, write.items) : write.data;
    this.state = { kind: 'writing', pending: undefined };
    const result = await writeCms(this.options.projectPath, this.options.rel, after, write.kind === 'data' ? write.expected : undefined);
    assert(this.state.kind === 'writing', 'CMS save: active write lost its state');
    const pending = this.state.pending;
    if (!result.ok) {
      this.state = { kind: 'queued', write: pending ?? write };
      this.report(result.error);
      return false;
    }
    this.state = pending === undefined ? { kind: 'idle' } : { kind: 'queued', write: pending };
    this.snapshot = { ...this.snapshot, data: after };
    if (write.kind === 'items') {
      this.record(before, after);
      this.options.saved();
    }
    return true;
  }
  private record(before: unknown, after: unknown): void {
    this.options.record({
      label: (this.options.translate ?? ENGLISH_TRANSLATE)('cms.undo.edit'),
      coalesceKey: `cms:${this.options.rel}`,
      undo: () => this.restore(before, after),
      redo: () => this.restore(after, before),
    });
  }
  private async restore(value: unknown, expected: unknown): Promise<void> {
    if (!(await this.flush())) {
      return;
    }
    this.enqueue({ kind: 'data', data: value, expected });
    if (!(await this.flush())) {
      return;
    }
    await this.options.refresh();
    this.options.saved();
  }
  private report(error: string): void {
    if (!/no longer exists/.test(error)) {
      this.options.report(error);
    }
  }
}
