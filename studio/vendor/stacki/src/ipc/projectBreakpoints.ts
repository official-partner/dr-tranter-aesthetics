import { assert } from '../../shared/core/assert';
import { err, ok, type AppError, type Result } from '../../shared/core/result';
import {
  BREAKPOINT_DEFAULT_CONFIG,
  breakpointsEqual,
  checkedConfig,
  parseBreakpointsSource,
  resolveBreakpoints,
  serializeBreakpoints,
  type BreakpointConfig,
  type ResolvedBreakpoint,
} from '../../shared/properties/projectBreakpoints';
import { readMetadata, writeMetadata } from './projectMetadataBridge';
import { onWindowReturn } from '../lib/windowReturn';

export type BreakpointsState =
  | { readonly kind: 'loading'; readonly config: BreakpointConfig; readonly list: BreakpointConfig['list']; readonly resolved: readonly ResolvedBreakpoint[] }
  | {
      readonly kind: 'ready';
      readonly config: BreakpointConfig;
      readonly list: BreakpointConfig['list'];
      readonly resolved: readonly ResolvedBreakpoint[];
      readonly source: string | undefined;
    }
  | {
      readonly kind: 'blocked';
      readonly config: BreakpointConfig;
      readonly list: BreakpointConfig['list'];
      readonly resolved: readonly ResolvedBreakpoint[];
      readonly message: string;
    };

export interface BreakpointsStorage {
  readonly read: () => Promise<{ readonly source?: string }>;
  readonly write: (write: { readonly source: string; readonly base?: string }) => Promise<{ readonly source?: string }>;
}

const STORES_MAX = 8;

const DEFAULT_RESOLVED = resolveBreakpoints(BREAKPOINT_DEFAULT_CONFIG.list);
const LOADING: BreakpointsState = { kind: 'loading', config: BREAKPOINT_DEFAULT_CONFIG, list: BREAKPOINT_DEFAULT_CONFIG.list, resolved: DEFAULT_RESOLVED };

export function projectBreakpointsStorage(projectPath: string): BreakpointsStorage {
  assert(projectPath.length > 0, 'projectBreakpointsStorage: a project is open');
  return {
    read: () => readMetadata(projectPath, 'breakpoints'),
    write: ({ source, base }) => writeMetadata(projectPath, { kind: 'breakpoints', source, ...(base === undefined ? {} : { base }) }),
  };
}

export class BreakpointsStore {
  private current: BreakpointsState = LOADING;
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private retainers = 0;
  private stopWatching: (() => void) | undefined;

  constructor(private readonly storage: BreakpointsStorage) {}

  getState = (): BreakpointsState => this.current;

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
        assert(this.retainers >= 0, 'BreakpointsStore: more releases than retains');
        if (this.retainers === 0) {
          this.stopWatching?.();
          this.stopWatching = undefined;
        }
      }
    };
  }

  load(): Promise<void> {
    return this.enqueue(() => this.refresh()).then(() => undefined);
  }

  save(config: BreakpointConfig): Promise<Result<void>> {
    return this.enqueue(() => this.change(config));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private publish(next: BreakpointsState): void {
    const before = this.current;
    const same =
      before.kind === next.kind &&
      breakpointsEqual(before.config, next.config) &&
      (before.kind === 'ready' && next.kind === 'ready'
        ? before.source === next.source
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

  private async refresh(): Promise<Result<Extract<BreakpointsState, { kind: 'ready' }>, AppError>> {
    let source: string | undefined;
    try {
      source = (await this.storage.read()).source;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publish({ kind: 'blocked', config: BREAKPOINT_DEFAULT_CONFIG, list: BREAKPOINT_DEFAULT_CONFIG.list, resolved: DEFAULT_RESOLVED, message });
      return err({ code: 'breakpoints-unreadable', message });
    }
    const parsed = parseBreakpointsSource(source);
    if (!parsed.ok) {
      this.publish({
        kind: 'blocked',
        config: BREAKPOINT_DEFAULT_CONFIG,
        list: BREAKPOINT_DEFAULT_CONFIG.list,
        resolved: DEFAULT_RESOLVED,
        message: parsed.error.message,
      });
      return parsed;
    }
    const ready = { kind: 'ready', config: parsed.value, list: parsed.value.list, resolved: resolveBreakpoints(parsed.value.list), source } as const;
    this.publish(ready);
    return ok(ready);
  }

  private async change(config: BreakpointConfig): Promise<Result<void>> {
    const checked = checkedConfig(config);
    if (!checked.ok) {
      return checked;
    }
    let base = this.current.kind === 'ready' ? this.current : undefined;
    if (base === undefined) {
      const read = await this.refresh();
      if (!read.ok) {
        return read;
      }
      base = read.value;
    }
    const first = await this.write(base, checked.value);
    if (first.ok || first.error.code !== 'breakpoints-write') {
      return first;
    }
    const reread = await this.refresh();
    if (!reread.ok) {
      return reread;
    }
    return this.write(reread.value, checked.value);
  }

  private async write(base: Extract<BreakpointsState, { kind: 'ready' }>, config: BreakpointConfig): Promise<Result<void>> {
    const text = serializeBreakpoints(config);
    if (base.source === undefined) {
      if (breakpointsEqual(config, BREAKPOINT_DEFAULT_CONFIG)) {
        return ok(undefined);
      }
    } else if (base.source === text) {
      return ok(undefined);
    }
    this.publish({ kind: 'ready', config, list: config.list, resolved: resolveBreakpoints(config.list), source: base.source });
    try {
      const saved = await this.storage.write({ source: text, ...(base.source === undefined ? {} : { base: base.source }) });
      assert(saved.source === text, 'BreakpointsStore.write: the file holds what was written');
      this.publish({ kind: 'ready', config, list: config.list, resolved: resolveBreakpoints(config.list), source: saved.source });
      return ok(undefined);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AssertionError') {
        throw error;
      }
      this.publish({ kind: 'ready', config: base.config, list: base.list, resolved: base.resolved, source: base.source });
      return err({ code: 'breakpoints-write', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

const stores = new Map<string, BreakpointsStore>();

export function breakpointsStore(projectPath: string, storage?: BreakpointsStorage): BreakpointsStore {
  assert(projectPath.length > 0, 'breakpointsStore: a project is open');
  const kept = stores.get(projectPath);
  if (kept !== undefined && storage === undefined) {
    stores.delete(projectPath);
    stores.set(projectPath, kept);
    return kept;
  }
  const made = new BreakpointsStore(storage ?? projectBreakpointsStorage(projectPath));
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

export function forgetBreakpointStores(): void {
  stores.clear();
}
