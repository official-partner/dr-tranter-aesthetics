
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { ImportDecl } from '../../shared/page/pageNode';
import { astroQueryCode, assertLoopQuery, chainQueryCode, listQueryCode, sanityQueryCode, type LoopField, type LoopQuery, type LoopSource } from './loopQuery';
import { readingChain, readLoop, type LoopReading } from './loopQueryRead';
import { reboundItem, type ItemShape } from './loopRebind';
import { issue, type Issue } from './issue';
import { appliedEdits, sectionCodeIssue, sectionEdits, type LoopSection } from './loopSections';
import { parseExpression, parseFrontmatter, type ParsedFrontmatter } from './loopSyntax';
import { dataFormProblem, optionsLiteral, rewrittenOptions } from './optionsQuery';
import { LIST_ITEMS_HELPER, LIST_ITEMS_NAME, listItemsNeed } from './listItemsHelper';
import type { ImportNeed } from './dataSample';
import { withDataImport } from './frontmatterAdditions';
import type { ItemSamples } from './loopRemove';
import { indentUnitOf, withIndentUnit } from '../../shared/core/indent';
import { reboundOptions, type BindingChange } from './optionsBinding';
import { fieldListCode, type FieldList } from './loopFieldList';
import { splitDestructuredHead, splitMapHead, type LoopHead } from './loopBindings';
import { autoQueryName, QUERY_MARK } from './dataScope';
import type { EditorModel, EditorNode } from './pageView';

export type LoopTarget =
  | {
      readonly kind: 'query';
      readonly query: LoopQuery;
      readonly fields: readonly LoopField[];
      readonly form?: 'code' | 'data' | undefined;
    }
  | {
      readonly kind: 'value';
      readonly data: string;
      readonly import?: ImportNeed | undefined;
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'remove'; readonly samples: ItemSamples }
  | { readonly kind: 'binding'; readonly change: BindingChange }
  | { readonly kind: 'field'; readonly list: FieldList }
  | { readonly kind: 'section'; readonly section: LoopSection; readonly code: string };

export interface LoopPlanInput {
  readonly model: Pick<EditorModel, 'extraFrontmatter' | 'imports' | 'nodes'>;
  readonly loop: Extract<EditorNode, { readonly kind: 'map' }>;
  readonly target: LoopTarget;
  readonly sanityClient: 'available' | 'unavailable';
  readonly restore?: readonly EditorNode[] | undefined;
}

export interface LoopPlan {
  readonly extraFrontmatter: string;
  readonly imports: readonly ImportDecl[];
  readonly loop: Extract<EditorNode, { readonly kind: 'map' }>;
  readonly unbound: number;
  readonly lost: readonly string[];
  readonly previous: string | undefined;
  readonly restored: boolean;
}

export type LoopPlanResult = { readonly ok: true; readonly plan: LoopPlan } | ({ readonly ok: false } & Issue);

const DEFAULT_SANITY_CLIENT = 'sanityClient';
const CLEANUP_PASSES_MAX = 16;

export function planLoop(requested: LoopPlanInput): LoopPlanResult {
  const input = withProjectImport(requested);
  const split = splitMapHead(input.loop.head);
  const destructured = split === undefined ? splitDestructuredHead(input.loop.head) : undefined;
  const head: LoopHead | undefined = split ?? (destructured === undefined ? undefined : { data: destructured.data, item: '', index: destructured.index });
  if (head === undefined) {
    return { ok: false, ...issue('editor.loopPlan.customCode') };
  }
  if (destructured !== undefined && input.target.kind === 'query' && input.target.query.source.kind === 'list') {
    return { ok: false, ...issue('editor.loopPlan.customCode') };
  }
  const before = parseFrontmatter(input.model.extraFrontmatter);
  const reading = readLoop({ frontmatter: input.model.extraFrontmatter, imports: input.model.imports, data: head.data });
  if (input.target.kind === 'binding') {
    return bindingEdit(input, input.target.change, { reading, frontmatter: before, data: head.data });
  }
  if (input.target.kind === 'section') {
    return sectionEdit(input, input.target, { head, reading, frontmatter: before });
  }
  if (input.target.kind === 'query' && input.target.query.source.kind === 'list') {
    return { ok: true, plan: listEdit(input, input.target.query, head) };
  }
  const inPlace = optionsEdit(input, reading, before);
  if (inPlace !== undefined) {
    return inPlace;
  }
  const markup = markupWithout(input.model.nodes, input.loop.id);
  const holder = ownedHolder(head.data, reading, before, markup);
  const written = writtenTarget(input, holder, before);
  if (!written.ok) {
    return written;
  }
  const loopHead =
    destructured === undefined
      ? `${written.data}.map((${head.item}${head.index ? `, ${head.index}` : ''}) => (`
      : headWithData(input.loop.head, head.data, written.data);
  const markupAfter = `${markup}\n${loopHead}`;
  const removable = new Set(readingChain(reading).filter((name) => name !== written.name));
  const replaced = holder === undefined ? '' : input.model.extraFrontmatter.slice(holder.from, holder.to);
  for (const use of before.uses) {
    if (holder !== undefined && use.from >= holder.from && use.from < holder.to) {
      removable.add(use.name);
    }
  }
  const cleaned = cleanedUp({ frontmatter: written.frontmatter, imports: written.imports, removed: replaced }, removable, markupAfter);
  const restoring = input.restore !== undefined && readingKeyOf(reading, head.data) !== targetKey(input.target);
  const rebound =
    destructured === undefined ? reboundChildren(input, { reading, item: head.item, restoring }) : { nodes: input.loop.children ?? [], unbound: 0, lost: [] };
  const loop = { ...input.loop, head: loopHead, children: rebound.nodes };
  assert(loop.id === input.loop.id, 'A planned loop keeps its id');
  assert(headDataOf(loop.head) !== undefined, 'A planned head is one the loop editor reads back');
  return {
    ok: true,
    plan: {
      extraFrontmatter: cleaned.frontmatter,
      imports: cleaned.imports,
      loop,
      unbound: rebound.unbound,
      lost: rebound.lost,
      previous: readingKeyOf(reading, head.data),
      restored: restoring,
    },
  };
}

function withProjectImport(input: LoopPlanInput): LoopPlanInput {
  const target = input.target;
  if (target.kind !== 'value' || target.import === undefined) {
    return input;
  }
  const need = target.import;
  const data = target.data.trim();
  assert(
    data === need.name || data.startsWith(need.name + '.') || data.startsWith(need.name + '['),
    'A project export is looped by the name it is imported as',
  );
  const added = withDataImport(input.model, need);
  const rebased = added.name + data.slice(need.name.length);
  assert(added.model.imports.length >= input.model.imports.length, 'Importing a project export only adds');
  return { ...input, model: added.model, target: { kind: 'value', data: rebased } };
}

function listEdit(input: LoopPlanInput, query: LoopQuery, head: LoopHead): LoopPlan {
  const loopHead = `${listQueryCode(itemNamedQuery(query, head.item))}.map((${head.item}${head.index ? `, ${head.index}` : ''}) => (`;
  const loop = { ...input.loop, head: loopHead };
  assert(splitMapHead(loop.head)?.item === head.item, 'A list prop’s head is one the loop editor reads back');
  return { ...inPlacePlan(input, input.model.extraFrontmatter, sourceKeyOf(query.source)), loop };
}

function itemNamedQuery(query: LoopQuery, item: string): LoopQuery {
  assert(query.source.kind === 'list', 'Only a list’s filter is named in the loop’s head');
  const parameter = query.parameter;
  if (parameter.kind !== 'entry' || parameter.name !== DEFAULT_ITEM_NAME || item === query.source.collection) {
    return query;
  }
  if (!ITEM_NAME.test(item) || query.conditions.some((condition) => condition.kind === 'custom')) {
    return query;
  }
  const named: LoopQuery = { ...query, parameter: { kind: 'entry', name: item } };
  assertLoopQuery(named);
  return named;
}

const DEFAULT_ITEM_NAME = 'item';
const ITEM_NAME = /^[A-Za-z_$][\w$]*$/;

function headWithData(loopHead: string, before: string, after: string): string {
  const at = loopHead.indexOf(before);
  assert(at >= 0, 'A loop’s head holds its data expression');
  return `${loopHead.slice(0, at)}${after}${loopHead.slice(at + before.length)}`;
}

function headDataOf(loopHead: string): string | undefined {
  return (splitMapHead(loopHead) ?? splitDestructuredHead(loopHead))?.data;
}

function sectionEdit(
  input: LoopPlanInput,
  target: Extract<LoopTarget, { readonly kind: 'section' }>,
  read: { readonly head: LoopHead; readonly reading: LoopReading; readonly frontmatter: ParsedFrontmatter },
): LoopPlanResult {
  const { head, frontmatter } = read;
  const problem = sectionCodeIssue(target.section, target.code);
  if (problem !== undefined) {
    return { ok: false, ...problem };
  }
  const code = { frontmatter: input.model.extraFrontmatter, imports: input.model.imports, data: head.data };
  const shared = sharedAt(frontmatter, readingChain(read.reading), markupWithout(input.model.nodes, input.loop.id));
  const written = sectionEdits(code, target.section, target.code, shared);
  if (!written.ok) {
    return written;
  }
  const data = appliedEdits(
    head.data,
    written.edits.filter((edit) => edit.place === 'head'),
  );
  const extraFrontmatter = appliedEdits(
    input.model.extraFrontmatter,
    written.edits.filter((edit) => edit.place === 'frontmatter'),
  );
  const at = input.loop.head.indexOf(head.data);
  assert(at >= 0, 'A loop’s head holds its data expression');
  const loopHead = `${input.loop.head.slice(0, at)}${data}${input.loop.head.slice(at + head.data.length)}`;
  if (
    headDataOf(loopHead) !== data.trim() ||
    parseExpression(data) === undefined ||
    parseFrontmatter(extraFrontmatter).declarations.size !== frontmatter.declarations.size
  ) {
    return { ok: false, ...issue('editor.loopPlan.wouldBreak') };
  }
  const loop = { ...input.loop, head: loopHead };
  assert(loop.id === input.loop.id, 'A planned loop keeps its id');
  return { ok: true, plan: { ...inPlacePlan(input, extraFrontmatter, ''), loop, previous: readingKeyOf(read.reading, head.data) } };
}

function sharedAt(frontmatter: ParsedFrontmatter, chain: readonly string[], markup: string): (position: number) => boolean {
  const spans = chain.flatMap((name) => {
    const declaration = frontmatter.declarations.get(name);
    return declaration === undefined ? [] : [{ name, statement: declaration.statement }];
  });
  const own = (position: number): boolean => spans.some(({ statement }) => position >= statement.from && position < statement.to);
  return (position) => {
    const holder = spans.find(({ statement }) => position >= statement.from && position <= statement.to);
    if (holder === undefined) {
      return true;
    }
    const readElsewhere = frontmatter.uses.some((use) => use.name === holder.name && !own(use.from));
    return readElsewhere || exported(frontmatter, holder.statement.from) || mentions(markup, holder.name);
  };
}

function reboundChildren(
  input: LoopPlanInput,
  read: { readonly reading: LoopReading; readonly item: string; readonly restoring: boolean },
): { readonly nodes: readonly EditorNode[]; readonly unbound: number; readonly lost: readonly string[] } {
  const children = input.loop.children ?? [];
  const shape = itemShape(input.target);
  if (read.restoring && input.restore !== undefined) {
    return { nodes: withoutSourceSpans(input.restore, 0), unbound: 0, lost: [] };
  }
  if (shape === undefined || !shapeChanged(read.reading, input.target)) {
    return { nodes: children, unbound: 0, lost: [] };
  }
  return reboundItem(children, read.item, shape);
}

function optionsEdit(input: LoopPlanInput, reading: LoopReading, frontmatter: ParsedFrontmatter): LoopPlanResult | undefined {
  const target = input.target;
  if (reading.kind !== 'query' || reading.home === undefined || target.kind !== 'query') {
    return undefined;
  }
  if (targetKey(target) !== sourceKeyOf(reading.query.source)) {
    return undefined;
  }
  const holder = reading.chain[reading.chain.length - 1];
  const declaration = holder === undefined ? undefined : frontmatter.declarations.get(holder);
  const init = declaration?.init;
  const query = target.query;
  const home = reading.home;
  if (init === undefined) {
    return { ok: false, ...issue('editor.loopPlan.settingsChanged') };
  }
  if (home.kind === 'chain') {
    return {
      ok: true,
      plan: inPlacePlan(input, chainEdit(input.model.extraFrontmatter, init, chainQueryCode(query, home.list, home.itemPath)), targetKey(target)),
    };
  }

  const call = init.kind === 'await' ? init.value : init;
  const options = call.kind === 'call' ? call.args[1] : undefined;
  if (options?.kind !== 'object' || options.from !== home.options.from) {
    return { ok: false, ...issue('editor.loopPlan.settingsChanged') };
  }
  const unsupported =
    query.random || query.conditions.some((condition) => condition.kind === 'test' && (condition.operator === 'inPast' || condition.operator === 'inFuture'));
  if (unsupported) {
    return { ok: false, ...issue('editor.loopPlan.noShuffleOrDate') };
  }
  const extraFrontmatter = rewrittenOptions(input.model.extraFrontmatter, home, options, query);
  assert(extraFrontmatter !== '', 'Rewritten settings leave a frontmatter');
  return { ok: true, plan: inPlacePlan(input, extraFrontmatter, targetKey(target)) };
}

function bindingEdit(
  input: LoopPlanInput,
  change: BindingChange,
  read: { readonly reading: LoopReading; readonly frontmatter: ParsedFrontmatter; readonly data: string },
): LoopPlanResult {
  const { reading, frontmatter } = read;
  if (reading.kind === 'query' && reading.home === undefined && reading.query.source.kind !== 'list' && change.kind !== 'unbind') {
    return convertedBinding(input, reading.query, change);
  }
  if (reading.kind !== 'query' || reading.home?.kind !== 'options') {
    return { ok: false, ...issue('editor.loopPlan.onlyData') };
  }
  const holder = reading.chain[reading.chain.length - 1];
  const declaration = holder === undefined ? undefined : frontmatter.declarations.get(holder);
  const init = declaration?.init;
  const call = init?.kind === 'await' ? init.value : init;
  const options = call?.kind === 'call' ? call.args[1] : undefined;
  if (declaration === undefined || options?.kind !== 'object' || options.from !== reading.home.options.from) {
    return { ok: false, ...issue('editor.loopPlan.settingsChanged') };
  }
  const result = reboundOptions(
    input.model.extraFrontmatter,
    { home: reading.home, options, statementFrom: declaration.statement.from, taken: frontmatter.bound },
    change,
  );
  if (!result.ok) {
    return result;
  }
  const key = readingKeyOf(reading, read.data);
  assert(key !== undefined, 'A list with settings has a key');
  return { ok: true, plan: inPlacePlan(input, result.frontmatter, key) };
}

function convertedBinding(input: LoopPlanInput, query: LoopQuery, change: BindingChange): LoopPlanResult {
  const problem = dataFormProblem(query);
  if (problem !== undefined) {
    return { ok: false, ...problem };
  }
  const converted = planLoop({ ...input, target: { kind: 'query', query, fields: [], form: 'data' }, restore: undefined });
  if (!converted.ok) {
    return converted;
  }
  const model = { ...input.model, extraFrontmatter: converted.plan.extraFrontmatter, imports: converted.plan.imports };
  const bound = planLoop({ ...input, model, loop: converted.plan.loop, target: { kind: 'binding', change }, restore: undefined });
  if (!bound.ok) {
    return bound;
  }
  assert(bound.plan.loop === converted.plan.loop, 'Linking leaves the converted loop as it is');
  assert(converted.plan.unbound === 0, 'Rewriting a list as data keeps its items as they were');
  return { ok: true, plan: { ...converted.plan, extraFrontmatter: bound.plan.extraFrontmatter } };
}

function chainEdit(frontmatter: string, init: { readonly from: number; readonly to: number }, code: string): string {
  assert(init.from < init.to, 'A holder has a value to rewrite');
  assert(init.to <= frontmatter.length, 'A holder is inside the frontmatter');
  return `${frontmatter.slice(0, init.from)}${code}${frontmatter.slice(init.to)}`;
}

function inPlacePlan(input: LoopPlanInput, extraFrontmatter: string, previous: string): LoopPlan {
  return { extraFrontmatter, imports: input.model.imports, loop: input.loop, unbound: 0, lost: [], previous, restored: false };
}


interface Written {
  readonly ok: true;
  readonly frontmatter: string;
  readonly imports: readonly ImportDecl[];
  readonly data: string;
  readonly name: string | undefined;
}

function writtenTarget(input: LoopPlanInput, holder: Holder | undefined, before: ParsedFrontmatter): Written | ({ readonly ok: false } & Issue) {
  const target = input.target;
  const frontmatter = input.model.extraFrontmatter;
  switch (target.kind) {
    case 'empty':
      return { ok: true, frontmatter: holder ? spliced(frontmatter, holder, '') : frontmatter, imports: input.model.imports, data: '[]', name: undefined };
    case 'value':
      return {
        ok: true,
        frontmatter: holder ? spliced(frontmatter, holder, '') : frontmatter,
        imports: input.model.imports,
        data: target.data,
        name: undefined,
      };
    case 'query':
      return writtenQuery(input, target, holder, before);
    case 'field':
      return writtenFieldList(input, target.list, holder, before);
    case 'binding':
      assert(false, 'A binding change is planned in place');
      return { ok: false, ...issue('editor.loopPlan.bindingInPlace') };
    case 'section':
      assert(false, 'A section is planned in place');
      return { ok: false, ...issue('editor.loopPlan.sectionInPlace') };
    case 'remove':
      assert(false, 'A removed loop is applied by the page');
      return { ok: false, ...issue('editor.loopPlan.sectionInPlace') };
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

function writtenQuery(
  input: LoopPlanInput,
  target: Extract<LoopTarget, { readonly kind: 'query' }>,
  holder: Holder | undefined,
  before: ParsedFrontmatter,
): Written | ({ readonly ok: false } & Issue) {
  const query = target.query;
  assertLoopQuery(query);
  assert(query.source.kind !== 'list', 'A list prop’s settings are written in the loop’s head');
  let imports = input.model.imports;
  let code: string;
  if (query.source.kind === 'astro') {
    const reader = importedName(imports, 'astro:content', 'getCollection');
    if (reader === undefined) {
      imports = [...imports, newImport('getCollection', 'astro:content')];
    }
    code =
      target.form === 'data'
        ? `${LIST_ITEMS_NAME}(await ${reader ?? 'getCollection'}(${JSON.stringify(query.source.collection)}), ${optionsLiteral(query)})`
        : astroQueryCode(query, reader ?? 'getCollection');
  } else {
    const client = importedName(imports, 'sanity:client', 'sanityClient');
    if (client === undefined && input.sanityClient === 'unavailable') {
      return { ok: false, ...issue('editor.loopPlan.needSanity') };
    }
    if (client === undefined) {
      imports = [...imports, newImport(DEFAULT_SANITY_CLIENT, 'sanity:client')];
    }
    code = sanityQueryCode(query, target.fields, client ?? DEFAULT_SANITY_CLIENT);
  }
  const taken = new Set(before.bound);
  if (holder !== undefined) {
    taken.delete(holder.name);
  }
  for (const entry of imports) {
    taken.add(entry.name);
  }
  const keep = holder !== undefined && holder.collection === query.source.collection;
  const name = keep ? holder.name : autoQueryName(query.source.collection, taken);
  const statement = `const ${name} = ${code}; // ${QUERY_MARK}`;
  assert(!statement.includes('\n'), 'A query is written on one line');
  const need = target.form === 'data' ? listItemsNeed(before) : { kind: 'present' as const };
  if (need.kind === 'taken') {
    return { ok: false, ...issue('editor.loopPlan.helperTaken', { name: LIST_ITEMS_NAME }) };
  }
  const helper = withIndentUnit(LIST_ITEMS_HELPER, indentUnitOf(input.model.extraFrontmatter));
  const written = need.kind === 'add' ? `${helper}\n${statement}` : statement;
  const frontmatter = holder ? spliced(input.model.extraFrontmatter, holder, `${written}\n`) : appended(input.model.extraFrontmatter, written);
  return { ok: true, frontmatter, imports, data: name, name };
}

function writtenFieldList(
  input: LoopPlanInput,
  list: FieldList,
  holder: Holder | undefined,
  before: ParsedFrontmatter,
): Written | ({ readonly ok: false } & Issue) {
  const astro = list.source.kind === 'astro';
  const [path, exported, fallback] = astro
    ? (['astro:content', 'getCollection', 'getCollection'] as const)
    : (['sanity:client', 'sanityClient', DEFAULT_SANITY_CLIENT] as const);
  const reader = importedName(input.model.imports, path, exported);
  if (reader === undefined && !astro && input.sanityClient === 'unavailable') {
    return { ok: false, ...issue('editor.loopPlan.needSanity') };
  }
  const imports = reader === undefined ? [...input.model.imports, newImport(fallback, path)] : input.model.imports;
  const taken = new Set(before.bound);
  if (holder !== undefined) {
    taken.delete(holder.name);
  }
  for (const entry of imports) {
    taken.add(entry.name);
  }
  const field = list.path[list.path.length - 1];
  assert(field !== undefined, 'A field list names a field');
  const name = fieldListName(`${list.source.collection}-${field}`, taken);
  assert(!taken.has(name), 'A field list gets a name of its own');
  const statement = `const ${name} = ${fieldListCode(list, reader ?? fallback)}; // ${QUERY_MARK}`;
  assert(!statement.includes('\n'), 'A field list is written on one line');
  const frontmatter = holder ? spliced(input.model.extraFrontmatter, holder, `${statement}\n`) : appended(input.model.extraFrontmatter, statement);
  return { ok: true, frontmatter, imports, data: name, name };
}

const FIELD_LIST_NAMES_MAX = 100;
function fieldListName(words: string, taken: ReadonlySet<string>): string {
  const camel = words.replace(/[^A-Za-z0-9]+(.)?/g, (_whole: string, letter?: string) => (letter ? letter.toUpperCase() : '')).replace(/^[0-9]+/, '');
  const base = camel === '' ? 'items' : camel;
  for (let suffix = 1; suffix <= FIELD_LIST_NAMES_MAX; suffix++) {
    const name = suffix === 1 ? base : `${base}${suffix}`;
    if (!taken.has(name)) {
      return name;
    }
  }
  assert(false, 'A free name is found within the suffix bound');
  return base;
}

function importedName(imports: readonly ImportDecl[], path: string, exported: string): string | undefined {
  const entry = imports.find((candidate) => candidate.path === path && (candidate.imported ?? candidate.name) === exported && candidate.typeOnly !== true);
  return entry?.name;
}

function newImport(name: string, path: string): ImportDecl {
  return { name, imported: name, path, quote: "'", named: true };
}

function appended(frontmatter: string, statement: string): string {
  const gap = frontmatter !== '' && !frontmatter.endsWith('\n') ? '\n' : '';
  return `${frontmatter}${gap}${statement}`;
}


interface Holder {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly collection: string | undefined;
}

function ownedHolder(data: string, reading: LoopReading, frontmatter: ParsedFrontmatter, markup: string): Holder | undefined {
  const name = readingChain(reading)[0];
  if (name === undefined || data.trim() !== name) {
    return undefined;
  }
  const declaration = frontmatter.declarations.get(name);
  if (declaration === undefined || !declaration.alone || exported(frontmatter, declaration.statement.from)) {
    return undefined;
  }
  if (readsOutside(frontmatter, name, declaration.statement) > 0 || mentions(markup, name)) {
    return undefined;
  }
  const collection = reading.kind === 'query' ? reading.query.source.collection : reading.kind === 'partial' ? reading.source.collection : undefined;
  return { name, from: declaration.statement.from, to: declaration.statement.to, collection };
}

function spliced(frontmatter: string, holder: Pick<Holder, 'from' | 'to'>, text: string): string {
  assert(holder.from <= holder.to, 'A replaced span is ordered');
  assert(holder.to <= frontmatter.length, 'A replaced span is inside the frontmatter');
  const next = `${frontmatter.slice(0, holder.from)}${text}${frontmatter.slice(holder.to)}`;
  return text === '' || holder.to < frontmatter.length ? next : next.replace(/\n$/, '');
}

function cleanedUp(
  start: { readonly frontmatter: string; readonly imports: readonly ImportDecl[]; readonly removed: string },
  candidates: ReadonlySet<string>,
  markup: string,
): { readonly frontmatter: string; readonly imports: readonly ImportDecl[] } {
  let code = start.frontmatter;
  const imports = start.imports;
  const pending = new Set(candidates);
  const removedText: string[] = [start.removed];
  for (let pass = 0; pass < CLEANUP_PASSES_MAX && pending.size > 0; pass++) {
    const parsed = parseFrontmatter(code);
    const dead = [...pending].find((name) => {
      const declaration = parsed.declarations.get(name);
      return (
        declaration !== undefined &&
        declaration.alone &&
        !exported(parsed, declaration.statement.from) &&
        readsOutside(parsed, name, declaration.statement) === 0 &&
        !mentions(markup, name)
      );
    });
    if (dead === undefined) {
      break;
    }
    const declaration = parsed.declarations.get(dead);
    assert(declaration !== undefined, 'A dead declaration was found by name');
    const text = code.slice(declaration.statement.from, declaration.statement.to);
    removedText.push(text);
    for (const use of parsed.uses) {
      if (use.from >= declaration.statement.from && use.from < declaration.statement.to) {
        pending.add(use.name);
      }
    }
    pending.delete(dead);
    code = spliced(code, declaration.statement, '');
  }
  const after = parseFrontmatter(code);
  const readNames = new Set(after.uses.map((use) => use.name));
  const removed = removedText.join('\n');
  const kept = imports.filter((entry) => {
    const wasRead = mentions(removed, entry.name);
    return !wasRead || readNames.has(entry.name) || mentions(markup, entry.name);
  });
  assert(kept.length <= imports.length, 'Clean-up never adds an import');
  return { frontmatter: code, imports: kept };
}

function readsOutside(frontmatter: ParsedFrontmatter, name: string, span: { readonly from: number; readonly to: number }): number {
  let count = 0;
  for (const use of frontmatter.uses) {
    if (use.name === name && (use.from < span.from || use.from >= span.to)) {
      count++;
    }
  }
  return count;
}

function exported(frontmatter: ParsedFrontmatter, from: number): boolean {
  return /^\s*export\b/.test(frontmatter.source.slice(from, from + 16));
}

function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[$]/g, '\\$');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

function markupWithout(nodes: readonly EditorNode[], loopId: string): string {
  const text = JSON.stringify(nodes);
  assert(text.length <= LIMITS.ipcFieldCharsMax, 'The page markup is bounded');
  const loop = findLoop(nodes, loopId);
  if (loop === undefined) {
    return text;
  }
  const head = JSON.stringify(loop.head);
  const at = text.indexOf(`"head":${head}`);
  return at < 0 ? text : `${text.slice(0, at)}${text.slice(at + head.length + 7)}`;
}

function findLoop(nodes: readonly EditorNode[], id: string): Extract<EditorNode, { readonly kind: 'map' }> | undefined {
  const pending = [...nodes];
  for (let count = 0; pending.length > 0 && count < LIMITS.treeNodesMax; count++) {
    const node = pending.pop();
    if (node?.id === id && node.kind === 'map') {
      return node;
    }
    pending.push(...(node?.children ?? []));
  }
  return undefined;
}

const SOURCE_KEYS = new Set(['id', 'start', 'end', 'at', 'attrSpans', 'headSource']);

export function childrenFingerprint(nodes: readonly EditorNode[]): string {
  const text = JSON.stringify(nodes, (key: string, value: unknown) => (SOURCE_KEYS.has(key) ? undefined : value));
  assert(text.length <= LIMITS.ipcFieldCharsMax, 'A loop body is bounded');
  return text;
}

function withoutSourceSpans(nodes: readonly EditorNode[], depth: number): readonly EditorNode[] {
  assert(depth <= LIMITS.treeDepthMax, `withoutSourceSpans: depth ${depth} exceeds the tree cap`);
  return nodes.map((node) => {
    const { attrSpans: staleSpans, ...rest } = node;
    void staleSpans;
    const children = rest.children === undefined ? undefined : withoutSourceSpans(rest.children, depth + 1);
    return Object.assign({}, rest, children === undefined ? {} : { children });
  });
}

function sourceKeyOf(source: LoopSource): string {
  return source.kind === 'list' ? `value:${source.collection}` : `${source.kind}:${source.collection}`;
}

export function targetKey(target: LoopTarget): string {
  switch (target.kind) {
    case 'query':
      return sourceKeyOf(target.query.source);
    case 'value':
      return `value:${target.data.trim()}`;
    case 'empty':
      return 'empty';
    case 'remove':
      return 'remove';
    case 'binding':
      return `binding:${target.change.setting}`;
    case 'section':
      return `section:${target.section}`;
    case 'field':
      return `field:${target.list.source.kind}:${target.list.source.collection}:${target.list.path.join('.')}`;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

function readingKeyOf(reading: LoopReading, data: string): string | undefined {
  switch (reading.kind) {
    case 'query':
      return sourceKeyOf(reading.query.source);
    case 'partial':
      return sourceKeyOf(reading.source);
    case 'value':
      return `value:${data.trim()}`;
    case 'empty':
      return 'empty';
    case 'code':
      return undefined;
    default: {
      const exhaustive: never = reading;
      return exhaustive;
    }
  }
}


function itemShape(target: LoopTarget): ItemShape | undefined {
  if (target.kind !== 'query' || target.fields.length === 0) {
    return undefined;
  }
  const fields = new Set(target.fields.map((field) => field.path.split('.')[0] ?? field.path));
  return { kind: target.query.source.kind, fields };
}

function shapeChanged(reading: LoopReading, target: LoopTarget): boolean {
  if (target.kind !== 'query') {
    return false;
  }
  const source = reading.kind === 'query' ? reading.query.source : reading.kind === 'partial' ? reading.source : undefined;
  if (source === undefined) {
    return reading.kind !== 'empty';
  }
  return source.kind !== target.query.source.kind || source.collection !== target.query.source.collection;
}
