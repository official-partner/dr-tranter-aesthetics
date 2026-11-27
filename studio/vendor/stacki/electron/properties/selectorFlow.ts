import * as path from 'node:path';
import { assert } from '../../shared/core/assert';

export const FLOW_LIMITS = {
  filesMax: 3_000,
} as const satisfies Record<string, number>;

export interface FlowText {
  readonly rel: string;
  readonly text: string;
}

const IMPORT = /^\s*import\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gm;
const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx', 'jsx', 'astro', 'vue', 'svelte', 'mdx']);
const EXTENSIONS = ['', '.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.mts', '.cts', '.astro', '.vue', '.svelte', '.mdx', '/index.ts', '/index.js'];

export function linkedSites(
  texts: readonly FlowText[],
  from: readonly string[],
  to: readonly string[],
): { readonly from: string; readonly to: string } | undefined {
  if (from.length === 0 || to.length === 0) {
    return undefined;
  }
  if (texts.length > FLOW_LIMITS.filesMax) {
    return { from: from[0] ?? '', to: to[0] ?? '' };
  }
  const graph = importGraph(texts);
  const fromSet = new Set(from);
  const toSet = new Set(to);
  for (const text of texts) {
    const reached = reach(text.rel, graph);
    const source = reached === 'everything' ? from[0] : [...reached].find((rel) => fromSet.has(rel));
    const target = reached === 'everything' ? to[0] : [...reached].find((rel) => toSet.has(rel));
    if (source !== undefined) {
      if (target !== undefined) {
        return { from: source, to: target };
      }
    }
  }
  return undefined;
}

type ImportGraph = ReadonlyMap<string, readonly string[] | 'everything'>;

function importGraph(texts: readonly FlowText[]): ImportGraph {
  const files = new Set(texts.map((text) => text.rel));
  const graph = new Map<string, readonly string[] | 'everything'>();
  for (const text of texts) {
    const targets: string[] = [];
    let unresolved = false;
    IMPORT.lastIndex = 0;
    for (let match = IMPORT.exec(text.text); match !== null; match = IMPORT.exec(text.text)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? '';
      const resolved = resolveImport(text.rel, specifier, files);
      if (resolved === 'package') {
        continue;
      }
      if (resolved === undefined) {
        unresolved = true;
      } else {
        targets.push(resolved);
      }
    }
    graph.set(text.rel, unresolved ? 'everything' : targets);
  }
  return graph;
}

function resolveImport(from: string, specifier: string, files: ReadonlySet<string>): string | 'package' | undefined {
  let base: string;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.posix.join(path.posix.dirname(from), specifier);
  } else if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
    base = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith('/')) {
    base = specifier.slice(1);
  } else {
    return 'package';
  }
  if (/\?(?:url|raw|inline)\b/.test(base)) {
    return 'package';
  }
  const clean = base.replace(/\?.*$/, '');
  for (const extension of EXTENSIONS) {
    if (files.has(clean + extension)) {
      return clean + extension;
    }
  }
  const extension = /\.([A-Za-z0-9]+)$/.exec(path.posix.basename(clean))?.[1]?.toLowerCase();
  if (extension !== undefined && !CODE_EXTENSIONS.has(extension)) {
    return 'package';
  }
  return undefined;
}

function reach(start: string, graph: ImportGraph): ReadonlySet<string> | 'everything' {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const next = queue.pop();
    assert(next !== undefined, 'reach: the queue was not empty');
    assert(seen.size <= FLOW_LIMITS.filesMax, 'reach: a walk visits each file once');
    const targets = graph.get(next) ?? [];
    if (targets === 'everything') {
      return 'everything';
    }
    for (const target of targets) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}
