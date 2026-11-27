
import { assert } from '../../shared/core/assert';
import { type Rule } from './cssVarRead';

export const titleize = (text: unknown): string =>
  String(text)
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());

export function labelForRule(rule: Rule): string {
  const candidates = rule.selectors.length ? rule.selectors : [rule.selector];
  const simpleClass = candidates.find((selector) => /^\.[a-z0-9_-]+$/i.test(selector.trim()));
  const chosen = simpleClass || candidates[0] || rule.selector;
  const cleaned = String(chosen).trim();
  if (cleaned === ':root') {
    return ':root';
  }
  if (/^\.[a-z0-9_-]+$/i.test(cleaned)) {
    return titleize(cleaned.slice(1));
  }
  return cleaned;
}

export function commonStem(labels: readonly string[]): string {
  if (!labels.length) {
    return '';
  }
  const words = labels.map((label) => label.split(/\s+/));
  const stem: string[] = [];
  for (let i = 0; i < (words[0]?.length ?? 0); i++) {
    const word = words[0]?.[i];
    if (!word || !words.every((labelWords) => labelWords[i] === word)) {
      break;
    }
    stem.push(word);
  }
  return stem.join(' ');
}


export const namesOf = (rule: Rule): string[] => rule.entries.filter((entry) => entry.kind === 'var').map((entry) => entry.name);

export const overlap = (left: readonly string[], right: readonly string[]): number => {
  const rightSet = new Set(right);
  const shared = left.filter((name) => rightSet.has(name)).length;
  return shared / Math.max(left.length, right.length);
};

export const MERGE_THRESHOLD = 0.6;

export function groupRules(rules: readonly Rule[]): Rule[][] {
  const groups: Rule[][] = [];
  const taken = new Set<number>();

  rules.forEach((rule, index) => {
    if (taken.has(index)) {
      return;
    }
    const names = namesOf(rule);
    const members: Rule[] = [rule];
    taken.add(index);

    for (let other = index + 1; other < rules.length; other++) {
      if (taken.has(other)) {
        continue;
      }
      const candidate = rules[other];
      if (!candidate || candidate.context.join('|') !== rule.context.join('|')) {
        continue;
      }
      const otherNames = namesOf(candidate);
      const same = overlap(names, otherNames);
      const enough = names.length > 1 ? same >= MERGE_THRESHOLD : same === 1 && otherNames.length === names.length;
      if (enough) {
        members.push(candidate);
        taken.add(other);
      }
    }
    groups.push(members);
  });

  return groups;
}


export function splits(name: string): { prefix: string; suffix: string }[] {
  const body = name.replace(/^--/, '');
  const parts = body.split('-');
  const out: { prefix: string; suffix: string }[] = [];
  for (let at = 1; at < parts.length; at++) {
    out.push({ prefix: parts.slice(0, at).join('-'), suffix: parts.slice(at).join('-') });
  }
  return out;
}

export interface Family {
  prefixes: string[];
  rows: string[];
  self: boolean;
}

export const FAMILIES_MAX = 25;

export function findFamilies(names: readonly string[]): { families: Family[]; used: Set<string> } {
  const bySuffix = new Map<string, Set<string>>();
  const byPrefix = new Map<string, string[]>();
  for (const name of names) {
    for (const { prefix, suffix } of splits(name)) {
      const owners = bySuffix.get(suffix);
      if (owners) {
        owners.add(prefix);
      } else {
        bySuffix.set(suffix, new Set([prefix]));
      }
      const suffixes = byPrefix.get(prefix);
      if (suffixes) {
        suffixes.push(suffix);
      } else {
        byPrefix.set(prefix, [suffix]);
      }
    }
  }

  const nameSet = new Set(names);
  const families: Family[] = [];
  const used = new Set<string>();

  while (families.length < FAMILIES_MAX) {
    const best = bestFamilySeed(bySuffix, byPrefix, nameSet, used);
    if (best === undefined) {
      break;
    }
    const family = familyFrom(best, names, nameSet);
    assert(family.prefixes.length >= 2, 'findFamilies: a family has at least two columns');
    const sizeBefore = used.size;
    if (family.self) {
      for (const prefix of family.prefixes) {
        used.add(`--${prefix}`);
      }
    }
    for (const suffix of family.rows) {
      for (const prefix of family.prefixes) {
        used.add(`--${prefix}-${suffix}`);
      }
    }
    assert(used.size > sizeBefore, 'findFamilies: a family claims new names');
    families.push(family);
  }

  return { families, used };
}

export interface FamilySeed {
  readonly score: number;
  readonly prefixes: readonly string[];
  readonly rows: string[];
}

export function bestFamilySeed(
  bySuffix: ReadonlyMap<string, ReadonlySet<string>>,
  byPrefix: ReadonlyMap<string, readonly string[]>,
  nameSet: ReadonlySet<string>,
  used: ReadonlySet<string>,
): FamilySeed | undefined {
  let best: FamilySeed | undefined = undefined;
  for (const [suffix, prefixes] of bySuffix) {
    const seed = [...prefixes].filter((prefix) => !used.has(`--${prefix}-${suffix}`));
    if (seed.length < 2) {
      continue;
    }
    for (const candidate of signatureGroups(seed, byPrefix, nameSet, used)) {
      if (candidate.prefixes.length < 2) {
        continue;
      }
      const height = candidate.rows.length + (candidate.self ? 1 : 0);
      if (height < 2) {
        continue;
      }
      const score = candidate.prefixes.length * height;
      if (!best || score > best.score) {
        best = { score, prefixes: candidate.prefixes, rows: candidate.rows };
      }
    }
  }
  return best;
}

interface SignatureGroup {
  readonly prefixes: string[];
  readonly rows: string[];
  readonly self: boolean;
}

function signatureGroups(
  seed: readonly string[],
  byPrefix: ReadonlyMap<string, readonly string[]>,
  nameSet: ReadonlySet<string>,
  used: ReadonlySet<string>,
): SignatureGroup[] {
  assert(seed.length >= 2, 'signatureGroups: a seed has at least two prefixes');
  const groups = new Map<string, SignatureGroup>();
  for (const prefix of seed) {
    const rows = [...new Set(byPrefix.get(prefix) ?? [])].filter((suffix) => !used.has(`--${prefix}-${suffix}`));
    assert(rows.length > 0, 'signatureGroups: a seed prefix declares its seed suffix');
    const self = nameSet.has(`--${prefix}`) && !used.has(`--${prefix}`);
    const key = `${self ? 'self' : 'none'}\n${[...rows].sort().join('\n')}`;
    const group = groups.get(key);
    if (group) {
      group.prefixes.push(prefix);
    } else {
      groups.set(key, { prefixes: [prefix], rows, self });
    }
  }
  return [...groups.values()];
}

export function familyFrom(best: FamilySeed, names: readonly string[], nameSet: ReadonlySet<string>): Family {
  const { prefixes } = best;
  const order = new Map<string, number>();
  names.forEach((name, index) => {
    for (const { prefix, suffix } of splits(name)) {
      if (prefixes.includes(prefix) && !order.has(suffix)) {
        order.set(suffix, index);
      }
    }
  });
  const rows = [...best.rows].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));

  const columnOrder = new Map<string, number>();
  names.forEach((name, index) => {
    const body = name.replace(/^--/, '');
    for (const prefix of prefixes) {
      if ((body === prefix || body.startsWith(`${prefix}-`)) && !columnOrder.has(prefix)) {
        columnOrder.set(prefix, index);
      }
    }
  });
  const columns = [...prefixes].sort((left, right) => (columnOrder.get(left) ?? 0) - (columnOrder.get(right) ?? 0));
  const self = columns.some((prefix) => nameSet.has(`--${prefix}`));
  return { prefixes: columns, rows, self };
}

export { prefixSections } from '../../shared/properties/variableGroups';
