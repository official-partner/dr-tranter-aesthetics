
import { type AtRule } from 'postcss';
import type { StyleRegion } from './styleTypes';


export function atRuleQueryText(at: AtRule): string {
  return `@${at.name} ${at.params}`.trim();
}

export function queryKey(query: string): string {
  return query
    .trim()
    .replace(/\s+/g, '')
    .replace(/^@([a-zA-Z-]+)/, (_all, name: string) => `@${name.toLowerCase()}`);
}

export function splitQuery(query: string): { name: string; params: string } | undefined {
  const match = /^@([a-zA-Z-]+)\s*([\s\S]*)$/.exec(query.trim());
  if (!match) {
    return undefined;
  }
  return { name: match[1] ?? '', params: (match[2] ?? '').trim() };
}

export function countAtRuleQuery(region: StyleRegion, query: string): number {
  if (!region.root) {
    return 0;
  }
  const want = queryKey(query);
  let count = 0;
  region.root.walkAtRules((at) => {
    if (queryKey(atRuleQueryText(at)) === want) {
      count += 1;
    }
  });
  return count;
}

export function renameAtRuleQuery(region: StyleRegion, from: string, to: string): number {
  if (!region.root) {
    return 0;
  }
  const next = splitQuery(to);
  if (!next) {
    return 0;
  }
  const want = queryKey(from);
  let count = 0;
  region.root.walkAtRules((at) => {
    if (queryKey(atRuleQueryText(at)) !== want) {
      return;
    }
    at.assign({ name: next.name, params: next.params });
    count += 1;
  });
  return count;
}
