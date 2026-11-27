
import { assert } from '../../shared/core/assert';
import { autoQueryName, namesInScope, queriesInScope, QUERY_MARK } from './dataScope';
import type { ImportNeed } from './dataSample';
import type { EditorModel } from './pageView';

export type FrontmatterPart = Pick<EditorModel, 'imports' | 'extraFrontmatter'>;

export interface FrontmatterAddition<M extends FrontmatterPart> {
  readonly model: M;
  readonly name: string;
}

const ALIAS_SUFFIX_MAX = 100;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function withCollectionQuery<M extends FrontmatterPart>(model: M, collection: string): FrontmatterAddition<M> {
  assert(/^[A-Za-z0-9_$-]+$/.test(collection), 'withCollectionQuery: a collection name');
  const fm = model.extraFrontmatter || '';
  const existing = queriesInScope(fm).get(collection);
  if (existing !== undefined) {
    return { model, name: existing };
  }
  const name = autoQueryName(collection, namesInScope(fm, model.imports));
  const reads = model.imports.some((entry) => entry.name === 'getCollection' && entry.path === 'astro:content');
  const entry = { name: 'getCollection', imported: 'getCollection', path: 'astro:content', quote: "'", named: true };
  const gap = fm && !fm.endsWith('\n') ? '\n' : '';
  const query = `const ${name} = await getCollection('${collection}'); // ${QUERY_MARK}`;
  const imports = reads ? model.imports : [...model.imports, entry];
  const next = { ...model, imports, extraFrontmatter: `${fm}${gap}${query}` };
  assert(queriesInScope(next.extraFrontmatter).get(collection) === name, 'withCollectionQuery: the query reads the collection under its name');
  return { model: next, name };
}

export function withDataImport<M extends FrontmatterPart>(model: M, need: ImportNeed): FrontmatterAddition<M> {
  assert(need.spec.length > 0, 'withDataImport: the module is named');
  assert(IDENTIFIER.test(need.name), 'withDataImport: the local name is an identifier');
  const named = need.exported !== 'default';
  const existing = model.imports.find((entry) => entry.path === need.spec && sameExport(entry, need.exported));
  if (existing !== undefined) {
    return { model, name: existing.name };
  }
  const taken = namesInScope(model.extraFrontmatter || '', model.imports);
  const name = freeName(need.name, taken);
  const quote = (model.imports.find((entry) => entry.path === need.spec) ?? model.imports[0])?.quote === '"' ? '"' : "'";
  const entry = named ? { name, imported: need.exported, path: need.spec, quote, named: true } : { name, path: need.spec, quote };
  const next = { ...model, imports: [...model.imports, entry] };
  assert(next.imports.length === model.imports.length + 1, 'withDataImport: one import is added');
  return { model: next, name };
}

function sameExport(entry: FrontmatterPart['imports'][number], exported: string): boolean {
  if (entry.typeOnly === true) {
    return false;
  }
  if (exported !== 'default') {
    return entry.named === true && (entry.imported ?? entry.name) === exported;
  }
  return entry.named !== true;
}

export function freeName(wanted: string, taken: ReadonlySet<string>): string {
  assert(IDENTIFIER.test(wanted), 'freeName: the name is an identifier');
  if (!taken.has(wanted)) {
    return wanted;
  }
  for (let suffix = 2; suffix <= ALIAS_SUFFIX_MAX; suffix++) {
    const candidate = `${wanted}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No free name for ${wanted}: ${wanted}2 to ${wanted}${ALIAS_SUFFIX_MAX} are all taken`);
}
