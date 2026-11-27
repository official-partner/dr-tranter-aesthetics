import { useStableStyleValue } from './useStableStyleValue';

import { createContext, useContext, useEffect, useState } from 'react';
import { hasCanvas, onCanvasReady, queryCanvas } from '../../../editor/canvasQuery';
import { getHost, onHostChange } from './host';
import { createQueryCache } from './queryCache';
import { textStyleContext } from './styleQuery';
import { declaredValues, literalColorOf, parseComputedColor, rootColorQuery, type RootColorQuery } from './rootColors';
import type { ProjectVariable } from './webflow';

export function needsPage(value: string): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes('var(') ||
    normalized.includes('color-mix(') ||
    normalized.includes('light-dark(') ||
    normalized.includes('currentcolor') ||
    normalized.startsWith('--')
  );
}

const cache = createQueryCache(async (path, values) => {
  const answer = await queryCanvas(path, [], values, [], textStyleContext(path, getHost().selectedId));
  return answer?.computed;
});

const ROOT_PATH = '';
const rootCache = createQueryCache(rootColorQuery((values) => queryCanvas(ROOT_PATH, [], values, []).then((answer) => answer?.computed)));

export function forgetComputedColors(): void {
  cache.clear();
  rootCache.clear();
}
onCanvasReady(forgetComputedColors);

function pathOfSelection(): string {
  const host = getHost();
  return (host.selectedId ? host.pathOf?.(host.selectedId) : undefined) ?? '';
}

export type SwatchScope = { readonly on: 'selection' } | { readonly on: 'root'; readonly literal: (value: string) => string | undefined };

export function rootSwatchScope(variables: readonly ProjectVariable[]): SwatchScope {
  const declared = declaredValues(variables);
  return { on: 'root', literal: (value) => literalColorOf(value, declared) };
}

export const SwatchScopeContext = createContext<SwatchScope>({ on: 'selection' });

function rootScope(): readonly unknown[] {
  const host = getHost();
  return [host.projectPath, host.openFilePath, host.nodes, host.device, host.historyTick];
}

export function rootColorNow(value: string): string | undefined {
  const raw = value.trim();
  if (!needsPage(raw) || !hasCanvas()) {
    return undefined;
  }
  rootCache.setScope(rootScope());
  const cached = rootCache.read(ROOT_PATH, raw);
  if (cached.kind === 'pending') {
    void rootCache.request(ROOT_PATH, raw);
    return undefined;
  }
  return parseComputedColor(cached.answer);
}

export function subscribeRootColors(listener: () => void): () => void {
  return rootCache.subscribe(listener);
}

export function useResolvedColor(value: string): string {
  const raw = String(value ?? '').trim();
  const [, bump] = useState(0);
  const host = getHost();
  const scope = useContext(SwatchScopeContext);
  const store: RootColorQuery | typeof cache = scope.on === 'root' ? rootCache : cache;
  store.setScope(scope.on === 'root' ? rootScope() : [host.projectPath, host.openFilePath, host.nodes, host.selectedId, host.device, host.historyTick]);
  const path = scope.on === 'root' ? ROOT_PATH : pathOfSelection();
  const pageDependent = needsPage(raw);
  const enabled = pageDependent && hasCanvas();
  const cached = enabled ? store.read(path, raw) : undefined;

  useEffect(() => {
    if (!pageDependent) {
      return undefined;
    }
    const sync = () => bump((count) => count + 1);
    const offCache = store.subscribe(sync);
    const offHost = onHostChange(sync);
    return () => {
      offCache();
      offHost();
    };
  }, [pageDependent, store]);

  useEffect(() => {
    if (cached?.kind === 'pending') {
      void store.request(path, raw);
    }
  });

  const settled = cached?.kind === 'settled' ? cached.answer : undefined;
  const resolved = scope.on === 'root' ? parseComputedColor(settled) : settled;
  const fallback = scope.on === 'root' ? (scope.literal(raw) ?? raw) : raw;
  return useStableStyleValue(resolved || fallback, { pending: cached?.kind === 'pending' }, [host.projectPath, host.openFilePath, host.selectedId, path, raw]);
}
