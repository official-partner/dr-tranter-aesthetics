
import { parseDeclarations, type ImportLike, parseDestructures, looksCallable, collectionCallIn } from './dataSource';
import type { ImportedValue } from './importedValues';
import type { TreeNode } from './dataSample';
import type { LoopCopy } from './loopSelection';

export const COLLECTION_NAME_ATTEMPTS_MAX = 50;

export const QUERY_MARK = 'stacki:query';

export interface MarkedQuery {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export function markedQueries(frontmatter: string | undefined): MarkedQuery[] {
  const out: MarkedQuery[] = [];
  const re = new RegExp(`^[ \\t]*(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^\\n]*?//\\s*${QUERY_MARK}[ \\t]*$`, 'gm');
  let match;
  while ((match = re.exec(frontmatter ?? '')) !== null) {
    const name = match[1];
    if (name !== undefined) {
      out.push({ name, start: match.index, end: match.index + match[0].length });
    }
  }
  return out;
}

export function removeMarkedQuery(frontmatter: string, name: string): string {
  const found = markedQueries(frontmatter).find((query) => query.name === name);
  if (!found) {
    return frontmatter;
  }
  const source = String(frontmatter);
  let { start, end } = found;
  if (start > 0 && source.charAt(start - 1) === '\n') {
    start -= 1;
  } else if (source.charAt(end) === '\n') {
    end += 1;
  }
  return source.slice(0, start) + source.slice(end);
}

export function queriesInScope(frontmatter: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of parseDeclarations(frontmatter ?? '')) {
    if (looksCallable(value)) {
      continue;
    }
    const call = collectionCallIn(value);
    if (call?.fn === 'getCollection' && !out.has(call.name)) {
      out.set(call.name, name);
    }
  }
  return out;
}

export function namesInScope(frontmatter: string | undefined, imports: readonly ImportLike[] | undefined): Set<string> {
  const taken = new Set<string>();
  for (const [name] of parseDeclarations(frontmatter ?? '')) {
    taken.add(name);
  }
  for (const destructure of parseDestructures(frontmatter ?? '')) {
    taken.add(destructure.name);
  }
  for (const i of imports ?? []) {
    if (i.name !== undefined) {
      taken.add(i.name);
    }
  }
  return taken;
}

export interface DataContext {
  readonly frontmatter?: string;
  readonly imports?: readonly ImportLike[];
  readonly ancestorHeads?: readonly string[];
  readonly propsSample?: unknown;
  readonly propsInstance?: { readonly passed: readonly string[] };
  readonly propsSchema?: readonly SchemaField[];
  readonly collectionSamples?: Record<string, unknown>;
  readonly collections?: readonly { readonly name: string; readonly count?: number }[];
  readonly itemIndex?: Record<string, number>;
  readonly selectedCopy?: LoopCopy | undefined;
  readonly selectedItems?: readonly (number | undefined)[] | undefined;
  readonly valueSamples?: Record<string, unknown>;
  readonly importedValues?: Readonly<Record<string, ImportedValue>>;
  readonly collectionReader?: CollectionReader;
  readonly projectSources?: readonly TreeNode[];
  readonly projectModules?: Readonly<Record<string, string>>;
}

export interface CollectionReader {
  readonly listOf: (
    name: string,
    frontmatter: string,
    imports: readonly ImportLike[],
  ) => { readonly collection: string; readonly itemPath: readonly string[] } | undefined;
  readonly keysOf: (value: string) => readonly string[] | undefined;
}

export interface ShapeMember {
  readonly name: string;
  readonly type?: string;
  readonly format?: string;
  readonly options?: readonly string[];
  readonly shape?: readonly ShapeMember[];
  readonly shapeIsList?: boolean;
}

export interface SchemaField {
  readonly name: string;
  readonly type?: string;
  readonly options?: readonly string[];
  readonly default?: unknown;
  readonly shape?: readonly ShapeMember[];
  readonly shapeIsList?: boolean;
}

export interface ScopeChip {
  readonly from: number;
  readonly to: number;
  readonly path: string;
}

export const TYPE_OPERATORS = new Set(['as', 'satisfies']);

export function isTypeSyntaxIdentifier(source: string, from: number, root: string): boolean {
  if (TYPE_OPERATORS.has(root)) {
    return true;
  }
  const before = source.slice(0, from).trimEnd();
  return /(?:^|[^\w$])(?:as|satisfies)$/.test(before);
}

const CHIP_STEP = /^(?:\.[A-Za-z_$][\w$]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\])/;

export function scopeChips(text: unknown, names: Iterable<string> | Set<string> | undefined): ScopeChip[] {
  const source = String(text ?? '');
  const inScope = names instanceof Set ? names : new Set(names ?? []);
  if (!inScope.size) {
    return [];
  }
  const out: ScopeChip[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < source.length && source.charAt(i) !== ch) {
        i += source.charAt(i) === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }
    if (!/[A-Za-z_$]/.test(ch)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < source.length && /[\w$]/.test(source.charAt(j))) {
      j += 1;
    }
    for (let step = CHIP_STEP.exec(source.slice(j)); step !== null; step = CHIP_STEP.exec(source.slice(j))) {
      j += step[0].length;
    }
    let path = source.slice(i, j);
    let end = j;
    if (source.slice(j).trimStart().startsWith('(')) {
      const cut = path.lastIndexOf('.');
      if (cut <= 0) {
        i = j;
        continue;
      }
      end = i + cut;
      path = path.slice(0, cut);
    }
    const before = source.slice(0, i).trimEnd();
    const root = path.split(/[.[]/)[0] ?? '';
    if (!before.endsWith('.') && inScope.has(root) && !isTypeSyntaxIdentifier(source, i, root)) {
      out.push({ from: i, to: end, path });
    }
    i = j;
  }
  return out;
}

export function autoQueryName(collection: string, taken: ReadonlySet<string> = new Set()): string {
  const camel = String(collection)
    .replace(/[^A-Za-z0-9]+(.)?/g, (_whole: string, letter?: string) => (letter ? letter.toUpperCase() : ''))
    .replace(/^[0-9]+/, '');
  const base = `${camel || 'collection'}Entries`;
  if (!taken.has(base)) {
    return base;
  }
  for (let i = 2; i < COLLECTION_NAME_ATTEMPTS_MAX; i++) {
    if (!taken.has(`${base}${i}`)) {
      return `${base}${i}`;
    }
  }
  return `${base}X`;
}

export interface ImportedCall {
  readonly name: string;
  readonly exportName: string;
  readonly spec: string;
}

const IMPORTED_CALL = /^await\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?$/;

export function importedCallsInScope(frontmatter: string | undefined, imports: readonly ImportLike[]): ImportedCall[] {
  const calls: ImportedCall[] = [];
  for (const [name, value] of parseDeclarations(frontmatter ?? '')) {
    const exportName = IMPORTED_CALL.exec(value.trim())?.[1];
    const spec = imports.find((entry) => entry.name !== undefined && entry.name === exportName)?.path;
    if (exportName !== undefined && spec !== undefined) {
      calls.push({ name, exportName, spec });
    }
  }
  return calls;
}

export interface SanityFetch {
  readonly name: string;
  readonly type: string;
}

const SANITY_FETCH = /^\(?\s*await\s+([A-Za-z_$][\w$]*)\.fetch\(\s*(['"`])\*\[\s*_type\s*==\s*(['"])([A-Za-z_][\w.-]*)\3/;

export function sanityFetchesInScope(frontmatter: string | undefined, imports: readonly ImportLike[]): SanityFetch[] {
  const clients = new Set(imports.filter((entry) => entry.path === 'sanity:client' && entry.name !== undefined).map((entry) => entry.name));
  const fetches: SanityFetch[] = [];
  for (const [name, value] of parseDeclarations(frontmatter ?? '')) {
    const match = SANITY_FETCH.exec(value.trim());
    const client = match?.[1];
    const type = match?.[4];
    if (client !== undefined && type !== undefined && clients.has(client)) {
      fetches.push({ name, type });
    }
  }
  return fetches;
}

export function collectionsInScope(frontmatter: string | undefined): string[] {
  const out = new Set<string>();
  for (const [, value] of parseDeclarations(frontmatter ?? '')) {
    const call = collectionCallIn(value);
    if (call) {
      out.add(call.name);
    }
  }
  for (const destructure of parseDestructures(frontmatter ?? '')) {
    const call = collectionCallIn(destructure.from);
    if (call) {
      out.add(call.name);
    }
  }
  return [...out];
}
