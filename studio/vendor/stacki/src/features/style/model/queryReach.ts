
import { assert } from '../../../../shared/core/assert';
import { matchSelectorList, type MatchTarget } from './selectors';
import { selectorListLayers, selectorListMembers } from './selectorParse';
import { queryPlacementOf } from './queryWrapper';
import type { PanelLayer } from './resolved';
import type { ParsedRule } from './styleTypes';

export type WrapperReach = { readonly kind: 'reaches' } | { readonly kind: 'misses' } | { readonly kind: 'unknown' };

export const QUERY_REACH_LIMITS = {
  wrapperMembersMax: 64,
  wrappersMax: 256,
} as const satisfies Record<string, number>;

export function wrapperProbes(wrapper: string): string[] {
  const members = selectorListMembers(wrapper)
    .map((member) => member.text.trim())
    .filter((member) => member.length > 0);
  if (members.length > QUERY_REACH_LIMITS.wrapperMembersMax) {
    return [];
  }
  const probes = members.flatMap((member) => [member, `${member} *`]);
  assert(probes.length === members.length * 2, 'wrapperProbes: the element itself and its ancestors, per member');
  return probes;
}

export function wrapperOnLayer(wrapper: string, layer: PanelLayer): boolean {
  if (layer === 'every') {
    return true;
  }
  const layers = selectorListLayers(wrapper);
  return layers.length === 0 || layers.includes('') || layers.includes(layer);
}

export function nestedWrappersOf(rules: readonly ParsedRule[]): string[] {
  const wrappers = new Set<string>();
  for (const rule of rules) {
    if (wrappers.size >= QUERY_REACH_LIMITS.wrappersMax) {
      break;
    }
    if (rule.atContext.length === 0) {
      continue;
    }
    const placement = queryPlacementOf(rule);
    if (placement.kind === 'nested') {
      wrappers.add(placement.wrapper);
    }
  }
  assert(wrappers.size <= QUERY_REACH_LIMITS.wrappersMax, 'nestedWrappersOf: bounded');
  return [...wrappers];
}

export async function reachOfWrapper(wrapper: string, target: MatchTarget | undefined): Promise<WrapperReach> {
  if (target === undefined) {
    return { kind: 'unknown' };
  }
  const probes = wrapperProbes(wrapper);
  if (probes.length === 0) {
    return { kind: 'unknown' };
  }
  let pageAnsweredAll = true;
  for (const probe of probes) {
    const hit = target.domMatched?.get(probe);
    if (hit === true) {
      return { kind: 'reaches' };
    }
    if (hit === undefined) {
      pageAnsweredAll = false;
    }
  }
  if (pageAnsweredAll) {
    return { kind: 'misses' };
  }
  if (wrapper.includes(':')) {
    return { kind: 'unknown' };
  }
  for (const probe of probes) {
    const results = await matchSelectorList(probe, target);
    if (results.some((result) => result.matched)) {
      return { kind: 'reaches' };
    }
  }
  if (target.view.truncated) {
    return { kind: 'unknown' };
  }
  return { kind: 'misses' };
}
