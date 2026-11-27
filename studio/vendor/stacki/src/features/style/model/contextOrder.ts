
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';
import { compileSelectorList } from './selectorParse';
import { propText, walkNodes, type HostNode } from './host';

export const CONTEXT_ORDER_LIMITS = {
  contextsMax: 1_024,
  relativeAncestorsMax: 8,
  relativeDescendantDepthMax: 3,
  relativeDescendantsMax: 48,
  indexEntriesMax: 20_000,
} as const satisfies Record<string, number>;

export type IndexedRule = {
  readonly atContext: readonly string[];
  readonly selectors: ReadonlyArray<{ readonly text: string }>;
  readonly declarations: readonly unknown[];
};

export type QueryIndexEntry = {
  readonly classes: readonly string[];
  readonly contextKey: string;
};

export type QueryIndex = ReadonlyMap<string, readonly QueryIndexEntry[]>;

export type Relative = {
  readonly classes: readonly string[];
  readonly distance: number;
};

export function orderContexts<T extends { readonly key: string }>(contexts: readonly T[], own: ReadonlySet<string>, relatives: readonly string[]): T[] {
  assert(contexts.length <= CONTEXT_ORDER_LIMITS.contextsMax, 'orderContexts: more contexts than the limit');
  assert(relatives.length <= CONTEXT_ORDER_LIMITS.contextsMax, 'orderContexts: more relative contexts than the limit');
  const relativeRank = new Map<string, number>();
  relatives.forEach((key, rank) => {
    if (!relativeRank.has(key)) {
      relativeRank.set(key, rank);
    }
  });
  const base: T[] = [];
  const owned: T[] = [];
  const related: Array<{ readonly context: T; readonly rank: number }> = [];
  const rest: T[] = [];
  const seen = new Set<string>();
  for (const context of contexts) {
    if (seen.has(context.key)) {
      continue;
    }
    seen.add(context.key);
    const rank = relativeRank.get(context.key);
    if (context.key === '') {
      base.push(context);
    } else if (own.has(context.key)) {
      owned.push(context);
    } else if (rank === undefined) {
      rest.push(context);
    } else {
      related.push({ context, rank });
    }
  }
  related.sort((left, right) => left.rank - right.rank);
  const ordered = [...base, ...owned, ...related.map((entry) => entry.context), ...rest];
  assert(ordered.length === seen.size, 'orderContexts: every row is placed once');
  assert(base.length <= 1, 'orderContexts: one Base row');
  return ordered;
}

export function indexQueriesByClass<R extends IndexedRule>(rules: readonly R[], keyOf: (atContext: string, rule: R) => string): QueryIndex {
  const index = new Map<string, QueryIndexEntry[]>();
  let entryCount = 0;
  for (const rule of rules) {
    if (rule.atContext.length === 0) {
      continue;
    }
    if (rule.declarations.length === 0) {
      continue;
    }
    const contextKey = keyOf(rule.atContext.join(' › '), rule);
    for (const selector of rule.selectors) {
      for (const compiled of compileSelectorList(selector.text)) {
        const subject = compiled.compounds[compiled.compounds.length - 1];
        if (subject === undefined || subject.classes.length === 0) {
          continue;
        }
        if (entryCount < CONTEXT_ORDER_LIMITS.indexEntriesMax) {
          entryCount += 1;
          fileEntry(index, { classes: [...subject.classes], contextKey });
        } else {
          return index;
        }
      }
    }
  }
  assert(entryCount <= CONTEXT_ORDER_LIMITS.indexEntriesMax, 'indexQueriesByClass: entries within the limit');
  return index;
}

export function relativesOf(nodes: readonly HostNode[], selectedId: string | undefined): Relative[] {
  if (selectedId === undefined) {
    return [];
  }
  const parents = new Map<string, HostNode>();
  let selected: HostNode | undefined;
  walkNodes(nodes, (node, parent) => {
    if (node.id === selectedId) {
      selected = node;
    }
    if (parent !== undefined) {
      parents.set(node.id, parent);
    }
  });
  if (selected === undefined) {
    return [];
  }
  const ancestors = ancestorsOf(parents, selectedId);
  const descendants = descendantsOf(selected);
  const relatives = [...ancestors, ...descendants].filter((relative) => relative.classes.length > 0);
  relatives.sort((left, right) => left.distance - right.distance);
  assert(ancestors.length <= CONTEXT_ORDER_LIMITS.relativeAncestorsMax, 'relativesOf: ancestors within the limit');
  assert(descendants.length <= CONTEXT_ORDER_LIMITS.relativeDescendantsMax, 'relativesOf: descendants within the limit');
  return relatives;
}

export function relativeContexts(relatives: readonly Relative[], index: QueryIndex): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const relative of relatives) {
    const classes = new Set(relative.classes);
    for (const name of classes) {
      for (const entry of index.get(name) ?? []) {
        if (seen.has(entry.contextKey)) {
          continue;
        }
        if (entry.classes.every((entryClass) => classes.has(entryClass))) {
          seen.add(entry.contextKey);
          keys.push(entry.contextKey);
        }
      }
    }
  }
  assert(keys.length === seen.size, 'relativeContexts: each key once');
  return keys;
}

function fileEntry(index: Map<string, QueryIndexEntry[]>, entry: QueryIndexEntry): void {
  for (const name of new Set(entry.classes)) {
    const list = index.get(name);
    if (list === undefined) {
      index.set(name, [entry]);
    } else {
      list.push(entry);
    }
  }
}

function classesOf(node: HostNode): string[] {
  return propText(node, 'class').trim().split(/\s+/).filter(Boolean);
}

function ancestorsOf(parents: ReadonlyMap<string, HostNode>, selectedId: string): Relative[] {
  const ancestors: Relative[] = [];
  let current = parents.get(selectedId);
  for (let distance = 1; current !== undefined && distance <= CONTEXT_ORDER_LIMITS.relativeAncestorsMax; distance++) {
    ancestors.push({ classes: classesOf(current), distance });
    current = parents.get(current.id);
  }
  return ancestors;
}

function descendantsOf(selected: HostNode): Relative[] {
  assert(CONTEXT_ORDER_LIMITS.relativeDescendantDepthMax <= LIMITS.treeDepthMax, 'descendantsOf: depth within the tree limit');
  const descendants: Relative[] = [];
  let level: readonly HostNode[] = selected.children ?? [];
  for (let distance = 1; distance <= CONTEXT_ORDER_LIMITS.relativeDescendantDepthMax; distance++) {
    const next: HostNode[] = [];
    for (const node of level) {
      if (descendants.length < CONTEXT_ORDER_LIMITS.relativeDescendantsMax) {
        descendants.push({ classes: classesOf(node), distance });
        next.push(...(node.children ?? []));
      } else {
        return descendants;
      }
    }
    level = next;
  }
  return descendants;
}
