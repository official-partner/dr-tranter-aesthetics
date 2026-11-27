
import { assert } from '../../../../shared/core/assert';
import { variableEdit } from '../../../ipc/variableEditBridge';

export const COMPONENT_SOURCES_MAX = 32;

type Entry = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly code: string } | { readonly kind: 'failed' };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

export function componentSource(path: string): string | undefined {
  assert(path.length > 0, 'componentSource: a path is never empty');
  const key = keyOf(path);
  const entry = entries.get(key);
  if (entry === undefined) {
    store(key, { kind: 'loading' });
    void variableEdit('readStyleFile', path).then(
      (result) => store(key, result.ok ? { kind: 'ready', code: result.css ?? '' } : { kind: 'failed' }),
      () => store(key, { kind: 'failed' }),
    );
    return undefined;
  }
  return entry.kind === 'ready' ? entry.code : undefined;
}

export function componentSourcePending(path: string): boolean {
  const known = componentSource(path) !== undefined;
  if (known) {
    return false;
  }
  return entries.get(keyOf(path))?.kind === 'loading';
}

export function prefetchComponentSources(paths: readonly string[]): void {
  for (const path of paths.slice(0, COMPONENT_SOURCES_MAX)) {
    if (path.length > 0) {
      componentSource(path);
    }
  }
}

export function rememberComponentSource(path: string, code: string): void {
  store(keyOf(path), { kind: 'ready', code });
}

export function forgetComponentSources(paths: readonly string[]): void {
  if (paths.length === 0) {
    if (entries.size > 0) {
      entries.clear();
      announce();
    }
    return;
  }
  let dropped = false;
  for (const path of paths) {
    dropped = entries.delete(keyOf(path)) || dropped;
  }
  if (dropped) {
    announce();
  }
}

export function componentSourceVersion(): number {
  return version;
}

export function onComponentSourceChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function store(key: string, entry: Entry): void {
  if (!entries.has(key) && entries.size >= COMPONENT_SOURCES_MAX) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) {
      entries.delete(oldest);
    }
  }
  entries.set(key, entry);
  assert(entries.size <= COMPONENT_SOURCES_MAX, 'componentSourceCache: bounded by COMPONENT_SOURCES_MAX');
  if (entry.kind !== 'loading') {
    announce();
  }
}

function announce(): void {
  version += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

function keyOf(path: string): string {
  return path.replaceAll('\\', '/');
}
