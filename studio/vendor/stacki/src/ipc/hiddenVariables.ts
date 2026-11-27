import { assert } from '../../shared/core/assert';
import { err, ok, type AppError, type Result } from '../../shared/core/result';
import {
  EMPTY_VARIABLE_VISIBILITY,
  hiddenNameSet,
  parseVariableVisibilitySource,
  serializeVariableVisibility,
  withHidden,
  withShown,
  type VariableVisibility,
} from '../../shared/properties/variableVisibility';
import { readMetadata, writeMetadata } from './projectMetadataBridge';
import { onWindowReturn } from '../lib/windowReturn';

export type HiddenVariablesState =
  | { readonly kind: 'loading'; readonly hidden: ReadonlySet<string> }
  | { readonly kind: 'ready'; readonly hidden: ReadonlySet<string>; readonly value: VariableVisibility; readonly source: string | undefined }
  | { readonly kind: 'blocked'; readonly hidden: ReadonlySet<string>; readonly message: string };

export interface VisibilityStorage {
  readonly read: () => Promise<{ readonly source?: string }>;
  readonly write: (write: { readonly source: string; readonly base?: string }) => Promise<{ readonly source?: string }>;
}

const STORES_MAX = 8;

const NOTHING_HIDDEN: ReadonlySet<string> = new Set();
const LOADING: HiddenVariablesState = { kind: 'loading', hidden: NOTHING_HIDDEN };

export function projectStorage(projectPath: string): VisibilityStorage {
  assert(projectPath.length > 0, 'projectStorage: a project is open');
  return {
    read: () => readMetadata(projectPath, 'variables'),
    write: ({ source, base }) => writeMetadata(projectPath, { kind: 'variables', source, ...(base === undefined ? {} : { base }) }),
  };
}

export class HiddenVariablesStore {
  private current: HiddenVariablesState = LOADING;
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private retainers = 0;
  private stopWatching: (() => void) | undefined;
  private started = false;

  constructor(private readonly storage: VisibilityStorage) {}

  getState = (): HiddenVariablesState => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  isRetained(): boolean {
    return this.retainers > 0;
  }

  retain(): () => void {
    this.retainers += 1;
    if (this.retainers === 1) {
      this.stopWatching = onWindowReturn(() => void this.load());
    }
    void this.load();
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.retainers -= 1;
        assert(this.retainers >= 0, 'HiddenVariablesStore: more releases than retains');
        if (this.retainers === 0) {
          this.stopWatching?.();
          this.stopWatching = undefined;
        }
      }
    };
  }

  load(): Promise<void> {
    this.started = true;
    return this.enqueue(() => this.refresh()).then(() => undefined);
  }

  hasStarted(): boolean {
    return this.started;
  }

  hide(name: string): Promise<Result<void>> {
    return this.enqueue(() => this.change(name, { hide: true }));
  }

  show(name: string): Promise<Result<void>> {
    return this.enqueue(() => this.change(name, { hide: false }));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private publish(next: HiddenVariablesState): void {
    const before = this.current;
    const same =
      before.kind === next.kind &&
      (before.kind === 'ready' && next.kind === 'ready'
        ? before.source === next.source && before.value.hiddenFromSuggestions.join('\n') === next.value.hiddenFromSuggestions.join('\n')
        : before.kind === 'blocked' && next.kind === 'blocked'
          ? before.message === next.message
          : true);
    if (!same) {
      this.current = next;
      for (const listener of [...this.listeners]) {
        listener();
      }
    }
  }

  private async refresh(): Promise<Result<Extract<HiddenVariablesState, { kind: 'ready' }>, AppError>> {
    let source: string | undefined;
    try {
      source = (await this.storage.read()).source;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publish({ kind: 'blocked', hidden: NOTHING_HIDDEN, message });
      return err({ code: 'variables-visibility-unreadable', message });
    }
    const parsed = parseVariableVisibilitySource(source);
    if (!parsed.ok) {
      this.publish({ kind: 'blocked', hidden: NOTHING_HIDDEN, message: parsed.error.message });
      return parsed;
    }
    const ready = { kind: 'ready', hidden: hiddenNameSet(parsed.value), value: parsed.value, source } as const;
    this.publish(ready);
    return ok(ready);
  }

  private async change(name: string, change: { readonly hide: boolean }): Promise<Result<void>> {
    assert(name.length > 0, 'HiddenVariablesStore.change: a name');
    let base = this.current.kind === 'ready' ? this.current : undefined;
    if (base === undefined) {
      const read = await this.refresh();
      if (!read.ok) {
        return read;
      }
      base = read.value;
    }
    const first = await this.write(base, name, change);
    if (first.ok || first.error.code !== 'variables-visibility-write') {
      return first;
    }
    const reread = await this.refresh();
    if (!reread.ok) {
      return reread;
    }
    return this.write(reread.value, name, change);
  }

  private async write(base: Extract<HiddenVariablesState, { kind: 'ready' }>, name: string, change: { readonly hide: boolean }): Promise<Result<void>> {
    const next = change.hide ? withHidden(base.value, name) : withShown(base.value, name);
    if (!next.ok) {
      return next;
    }
    if (base.source === undefined && next.value.hiddenFromSuggestions.length === 0) {
      return ok(undefined);
    }
    if (next.value.hiddenFromSuggestions.join('\n') === base.value.hiddenFromSuggestions.join('\n') && base.source !== undefined) {
      return ok(undefined);
    }
    this.publish({ kind: 'ready', hidden: hiddenNameSet(next.value), value: next.value, source: base.source });
    const text = serializeVariableVisibility(next.value);
    try {
      const saved = await this.storage.write({ source: text, ...(base.source === undefined ? {} : { base: base.source }) });
      assert(saved.source === text, 'HiddenVariablesStore.write: the file holds what was written');
      this.publish({ kind: 'ready', hidden: hiddenNameSet(next.value), value: next.value, source: saved.source });
      return ok(undefined);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AssertionError') {
        throw error;
      }
      this.publish({ kind: 'ready', hidden: hiddenNameSet(base.value), value: base.value, source: base.source });
      return err({ code: 'variables-visibility-write', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

const stores = new Map<string, HiddenVariablesStore>();

export function hiddenVariablesStore(projectPath: string, storage?: VisibilityStorage): HiddenVariablesStore {
  assert(projectPath.length > 0, 'hiddenVariablesStore: a project is open');
  const kept = stores.get(projectPath);
  if (kept !== undefined && storage === undefined) {
    stores.delete(projectPath);
    stores.set(projectPath, kept);
    return kept;
  }
  const made = new HiddenVariablesStore(storage ?? projectStorage(projectPath));
  stores.set(projectPath, made);
  for (const [key, store] of stores) {
    if (stores.size <= STORES_MAX) {
      break;
    }
    if (key !== projectPath && !store.isRetained()) {
      stores.delete(key);
    }
  }
  return made;
}

export function getHiddenVariables(projectPath: string | undefined): ReadonlySet<string> {
  if (projectPath === undefined || projectPath.length === 0) {
    return NOTHING_HIDDEN;
  }
  const store = hiddenVariablesStore(projectPath);
  if (!store.hasStarted()) {
    void store.load();
  }
  return store.getState().hidden;
}

export function forgetHiddenVariables(): void {
  stores.clear();
}

export { EMPTY_VARIABLE_VISIBILITY };
