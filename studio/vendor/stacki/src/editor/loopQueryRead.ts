
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { readGroq } from './groqSyntax';
import { listCollectionOf, readOptionsQuery, type OptionsHome } from './optionsQuery';
import { chainOf, conditionOf } from './loopConditionRead';
import { curatedSelection, entriesSelection, pickedIds } from './loopSelectionRead';
import { readComparator } from './loopSortRead';
import { LOOP_QUERY_LIMITS, assertLoopQuery, chainableListCode, emptyQuery, isFieldPath, isItemId, listExpressionProblem } from './loopQuery';
import type { AstroItemParameter, LoopCondition, LoopFieldKind, LoopQuery, LoopSort, LoopSortOrder, LoopSource } from './loopQuery';
import { namePath, parseExpression, parseFrontmatter, textOf, type Js, type ParsedFrontmatter } from './loopSyntax';
import { issue, type Issue } from './issue';
import { listPropOf } from './propDeclaration';

export interface LoopImport {
  readonly name: string;
  readonly path: string;
  readonly imported?: string | undefined;
}

export interface LoopReadInput {
  readonly frontmatter: string;
  readonly imports: readonly LoopImport[];
  readonly data: string;
  readonly calls?: 'traced' | 'list' | undefined;
  readonly unreadSteps?: 'partial' | 'kept' | undefined;
  readonly fieldKind?: ((source: LoopSource, path: string) => LoopFieldKind | undefined) | undefined;
}

export type LoopValueOrigin =
  | { readonly kind: 'frontmatter' }
  | { readonly kind: 'call'; readonly exportName: string; readonly spec: string }
  | { readonly kind: 'import'; readonly spec: string }
  | { readonly kind: 'scope' };

export type LoopReading =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'query';
      readonly query: LoopQuery;
      readonly chain: readonly string[];
      readonly client: string | undefined;
      readonly home?: QueryHome | undefined;
    }
  | { readonly kind: 'partial'; readonly source: LoopSource; readonly chain: readonly string[]; readonly reason: string; readonly reasonIssue: Issue }
  | { readonly kind: 'value'; readonly root: string; readonly origin: LoopValueOrigin; readonly chain: readonly string[] }
  | { readonly kind: 'code' };

export type QueryHome = OptionsHome | { readonly kind: 'chain'; readonly list: string; readonly itemPath: readonly string[] };

export function readingChain(reading: LoopReading): readonly string[] {
  return reading.kind === 'query' || reading.kind === 'partial' || reading.kind === 'value' ? reading.chain : [];
}

const CHAIN_STEPS_MAX = 8;
const STEPS_MAX = 16;

export function readLoop(input: LoopReadInput): LoopReading {
  const reading = readLoopAsWritten(input);
  if (reading.kind !== 'partial' || input.unreadSteps !== 'kept') {
    return reading;
  }
  return keptReading(input, reading.chain) ?? reading;
}

function keptReading(input: LoopReadInput, chain: readonly string[]): LoopReading | undefined {
  const data = input.data.trim();
  const parsed = parseExpression(data);
  if (parsed === undefined || listExpressionProblem(data) !== undefined) {
    return undefined;
  }
  const context: Context = { input, frontmatter: parseFrontmatter(input.frontmatter) };
  return stepsReading({ source: { kind: 'list', collection: data }, steps: [], chain, filter: undefined, itemPath: [] }, context);
}

function readLoopAsWritten(input: LoopReadInput): LoopReading {
  const data = input.data.trim();
  if (data === '' || data === '[]') {
    return { kind: 'empty' };
  }
  const parsed = parseExpression(data);
  if (!parsed) {
    return { kind: 'code' };
  }
  const frontmatter = parseFrontmatter(input.frontmatter);
  const context: Context = { input, frontmatter };
  const pipeline = pipelineOf({ source: parsed.source, node: parsed.expression }, context, []);
  if (pipeline.kind === 'value' || pipeline.kind === 'unknown') {
    const picked = pickedListReading({ source: parsed.source, node: parsed.expression });
    if (picked !== undefined) {
      return picked;
    }
  }
  if (pipeline.kind === 'value') {
    const origin = originOf(pipeline.root, context);
    const held = listPropReading(pipeline, context);
    if (held !== undefined) {
      return held;
    }
    const headed =
      origin.kind === 'call' && input.calls !== 'list'
        ? undefined
        : headListReading({ source: parsed.source, node: parsed.expression }, context, pipeline.chain);
    return headed ?? { kind: 'value', root: pipeline.root, origin, chain: pipeline.chain };
  }
  if (pipeline.kind === 'unknown') {
    return headListReading({ source: parsed.source, node: parsed.expression }, context, []) ?? { kind: 'code' };
  }
  if (pipeline.kind === 'options') {
    return { kind: 'query', query: pipeline.query, chain: pipeline.chain, client: undefined, home: pipeline.home };
  }
  const reading = queryOf(pipeline, context);
  assert(reading.kind === 'query' || reading.kind === 'partial', 'A collection pipeline reads as a query or partly');
  return reading;
}

export type StepPlace = 'head' | 'frontmatter';

export interface PipelineStep {
  readonly place: StepPlace;
  readonly source: string;
  readonly call: Js;
}

export interface PipelineFilterArgument {
  readonly place: StepPlace;
  readonly code: string;
  readonly from: number;
  readonly to: number;
}

export interface LoopPipeline {
  readonly source: LoopSource;
  readonly base: string;
  readonly steps: readonly PipelineStep[];
  readonly filterArgument: PipelineFilterArgument | undefined;
  readonly itemPath: ItemPath;
  readonly chain: readonly string[];
  readonly headOffset: number;
}

export function readPipeline(input: LoopReadInput): LoopPipeline | undefined {
  const data = input.data.trim();
  const parsed = data === '' ? undefined : parseExpression(data);
  if (parsed === undefined) {
    return undefined;
  }
  const frontmatter = parseFrontmatter(input.frontmatter);
  const context: Context = { input, frontmatter };
  const pipeline = pipelineOf({ source: parsed.source, node: parsed.expression }, context, []);
  const headOffset = parsed.source.indexOf(data);
  assert(headOffset >= 0, 'A parsed expression holds its own text');
  if (input.unreadSteps === 'kept') {
    const written = readLoopAsWritten(input);
    if (written.kind === 'partial') {
      return {
        source: { kind: 'list', collection: data },
        base: chainableListCode(data),
        steps: [],
        filterArgument: undefined,
        itemPath: [],
        chain: written.chain,
        headOffset,
      };
    }
  }
  const placed = (step: Step): PipelineStep => ({
    place: step.call.source === parsed.source ? 'head' : 'frontmatter',
    source: step.call.source,
    call: step.call.node,
  });
  if ((pipeline.kind === 'unknown' || pipeline.kind === 'value') && pickedListOf({ source: parsed.source, node: parsed.expression }) !== undefined) {
    return undefined;
  }
  if (pipeline.kind === 'unknown') {
    return headListPipeline({ source: parsed.source, node: parsed.expression }, context, { chain: [], headOffset });
  }
  if (pipeline.kind === 'value') {
    const reading = listPropReading(pipeline, context);
    if (reading === undefined) {
      const called = originOf(pipeline.root, context).kind === 'call' && input.calls !== 'list';
      return called ? undefined : headListPipeline({ source: parsed.source, node: parsed.expression }, context, { chain: pipeline.chain, headOffset });
    }
    const source: LoopSource = { kind: 'list', collection: pipeline.root };
    return {
      source,
      base: pipeline.root,
      steps: (pipeline.steps ?? []).map(placed),
      filterArgument: undefined,
      itemPath: [],
      chain: readingChain(reading),
      headOffset,
    };
  }
  if (pipeline.kind !== 'collection' || pipeline.base.kind !== 'astro') {
    return undefined;
  }
  const base = pipeline.base;
  if (base.selection !== undefined || !COLLECTION_NAME.test(base.collection)) {
    return undefined;
  }
  if (base.filter === undefined && base.list === undefined && pickedSteps(pipeline.steps) !== undefined) {
    return undefined;
  }
  const list = base.list?.text ?? astroBaseCode(base);
  if (list === undefined) {
    return undefined;
  }
  return {
    source: { kind: 'astro', collection: base.collection },
    base: list,
    steps: pipeline.steps.map(placed),
    filterArgument: filterArgumentOf(base, parsed.source),
    itemPath: base.list?.itemPath ?? ['data'],
    chain: pipeline.chain,
    headOffset,
  };
}

interface PickedList {
  readonly list: Located;
  readonly picks: readonly string[];
  readonly field: string | undefined;
}

function pickedListOf(start: Located): PickedList | undefined {
  const node = start.node;
  const filtered =
    node.kind === 'call' && node.callee.kind === 'member' && node.callee.property === 'filter' && node.args.length === 1 && node.args[0]?.kind === 'name';
  if (!filtered || node.kind !== 'call' || node.callee.kind !== 'member' || node.args[0]?.kind !== 'name' || node.args[0].name !== 'Boolean') {
    return undefined;
  }
  const mapped = node.callee.object;
  if (mapped.kind !== 'call' || mapped.callee.kind !== 'member' || mapped.callee.property !== 'map' || mapped.args.length !== 1) {
    return undefined;
  }
  const picks = mapped.callee.object;
  const callback = mapped.args[0];
  if (picks.kind !== 'array' || picks.items.length > LOOP_QUERY_LIMITS.selectionMax || callback?.kind !== 'function') {
    return undefined;
  }
  const parameter = callback.parameters[0];
  const body = callback.body;
  if (parameter?.kind !== 'name' || callback.parameters.length !== 1 || body === undefined) {
    return undefined;
  }
  if (body.kind === 'index' && body.index.kind === 'name' && body.index.name === parameter.name) {
    const positions = picks.items.flatMap((item) =>
      item.kind === 'number' && Number.isSafeInteger(item.value) && item.value >= 0 ? [String(item.value)] : [],
    );
    return positions.length === picks.items.length ? { list: { source: start.source, node: body.object }, picks: positions, field: undefined } : undefined;
  }
  const field = findField(body, parameter.name);
  const keys = picks.items.flatMap((item) => (item.kind === 'string' && isItemId(item.value) ? [item.value] : []));
  if (field === undefined || keys.length !== picks.items.length) {
    return undefined;
  }
  return { list: { source: start.source, node: field.list }, picks: keys, field: field.path };
}

function findField(body: Js, key: string): { readonly list: Js; readonly path: string } | undefined {
  if (body.kind !== 'call' || body.callee.kind !== 'member' || body.callee.property !== 'find' || body.args.length !== 1) {
    return undefined;
  }
  const finder = body.args[0];
  const item = finder?.kind === 'function' ? finder.parameters[0] : undefined;
  const test = finder?.kind === 'function' ? finder.body : undefined;
  if (item?.kind !== 'name' || test?.kind !== 'binary' || test.operator !== '===') {
    return undefined;
  }
  const [read, compared] = test.right.kind === 'name' ? [test.left, test.right] : [test.right, test.left];
  const path = namePath(read);
  if (compared.kind !== 'name' || compared.name !== key || path?.[0] !== item.name || path.length < 2) {
    return undefined;
  }
  const field = path.slice(1).join('.');
  return isFieldPath(field) ? { list: body.callee.object, path: field } : undefined;
}

function pickedListReading(start: Located): LoopReading | undefined {
  const picked = pickedListOf(start);
  if (picked === undefined) {
    return undefined;
  }
  const text = textOf(picked.list, picked.list.node);
  if (listExpressionProblem(text) !== undefined) {
    return undefined;
  }
  const source: LoopSource = { kind: 'list', collection: text };
  const query: LoopQuery = { ...emptyQuery(source), selection: picked.picks, selectionField: picked.field };
  return checked(query, { chain: [] }, undefined);
}

interface HeadList {
  readonly base: Located;
  readonly steps: readonly Step[];
}

function headListOf(start: Located): HeadList | undefined {
  const peeled: Step[] = [];
  let current = start;
  for (let pass = 0; pass <= STEPS_MAX; pass++) {
    const step = stepOf(current);
    if (step === undefined || !isSettingStep(step.step) || isOptionalCall(current.node)) {
      const text = textOf(current, current.node);
      return listExpressionProblem(text) === undefined ? { base: current, steps: peeled.reverse() } : undefined;
    }
    peeled.push(step.step);
    current = step.from;
  }
  return undefined;
}

function isSettingStep(step: Step): boolean {
  return step.kind !== 'other' || METHOD_STEPS.has(step.name);
}

function isOptionalCall(node: Js): boolean {
  return node.kind === 'call' && node.callee.kind === 'member' && node.callee.optional;
}

function headListReading(start: Located, context: Context, chain: readonly string[]): LoopReading | undefined {
  const head = headListOf(start);
  if (head === undefined) {
    return undefined;
  }
  const source: LoopSource = { kind: 'list', collection: textOf(head.base, head.base.node) };
  const reading = stepsReading({ source, steps: head.steps, chain, filter: undefined, itemPath: [] }, context);
  assert(reading.kind === 'query' || reading.kind === 'partial', 'A head list’s steps read as a query or partly');
  return reading;
}

function headListPipeline(
  start: Located,
  context: Context,
  held: { readonly chain: readonly string[]; readonly headOffset: number },
): LoopPipeline | undefined {
  const head = headListOf(start);
  if (head === undefined) {
    return undefined;
  }
  void context;
  const text = textOf(head.base, head.base.node);
  return {
    source: { kind: 'list', collection: text },
    base: chainableListCode(text),
    steps: head.steps.map((step) => ({ place: 'head' as const, source: step.call.source, call: step.call.node })),
    filterArgument: undefined,
    itemPath: [],
    chain: held.chain,
    headOffset: held.headOffset,
  };
}

function astroBaseCode(base: Extract<Base, { readonly kind: 'astro' }>): string | undefined {
  const call = base.call?.node;
  if (call?.kind !== 'call' || call.callee.kind !== 'name') {
    return undefined;
  }
  return `(await ${call.callee.name}(${JSON.stringify(base.collection)}))`;
}

function filterArgumentOf(base: Extract<Base, { readonly kind: 'astro' }>, headSource: string): PipelineFilterArgument | undefined {
  const located = base.call;
  const name = located?.node.kind === 'call' ? located.node.args[0] : undefined;
  if (located === undefined || base.filter === undefined || name === undefined) {
    return undefined;
  }
  const to = located.node.to - 1;
  assert(name.to <= to, 'A filter follows the collection’s name');
  return { place: located.source === headSource ? 'head' : 'frontmatter', code: textOf(base.filter, base.filter.node), from: name.to, to };
}

type ItemPath = readonly string[];

interface Context {
  readonly input: LoopReadInput;
  readonly frontmatter: ParsedFrontmatter;
}

interface Located {
  readonly source: string;
  readonly node: Js;
}

type StepBody =
  | { readonly kind: 'filter'; readonly function: Located }
  | { readonly kind: 'sort'; readonly function: Located | undefined }
  | { readonly kind: 'slice'; readonly start: number; readonly end: number | undefined }
  | { readonly kind: 'reverse' }
  | { readonly kind: 'other'; readonly name: string };

type Step = StepBody & { readonly call: Located };

type Base =
  | {
      readonly kind: 'astro';
      readonly collection: string;
      readonly filter: Located | undefined;
      readonly call?: Located;
      readonly list?: { readonly text: string; readonly itemPath: ItemPath };
      readonly selection?: readonly string[];
    }
  | { readonly kind: 'sanity'; readonly groq: string; readonly client: string };

type Pipeline =
  | { readonly kind: 'collection'; readonly base: Base; readonly steps: readonly Step[]; readonly chain: readonly string[] }
  | {
      readonly kind: 'value';
      readonly root: string;
      readonly chain: readonly string[];
      readonly steps?: readonly Step[];
      readonly held?: 'array';
    }
  | { readonly kind: 'options'; readonly query: LoopQuery; readonly home: OptionsHome; readonly chain: readonly string[] }
  | { readonly kind: 'unknown' };

const COLLECTION_NAME = /^[A-Za-z0-9_][\w.-]*$/;
const METHOD_STEPS = new Set(['filter', 'sort', 'toSorted', 'slice', 'reverse', 'toReversed']);

function pipelineOf(start: Located, context: Context, chainStart: readonly string[]): Pipeline {
  const steps: Step[] = [];
  const chain = [...chainStart];
  let current = start;
  for (let pass = 0; pass < STEPS_MAX + CHAIN_STEPS_MAX; pass++) {
    const node = unwrapAwait(current.node);
    const base = baseOf({ source: current.source, node }, context) ?? (steps.length === 0 ? curatedOf(node, context, current.source) : undefined);
    if (base) {
      return { kind: 'collection', base, steps: steps.reverse(), chain };
    }
    if (node.kind === 'name') {
      const declaration = context.frontmatter.declarations.get(node.name);
      if (!declaration?.init || chain.includes(node.name) || chain.length >= CHAIN_STEPS_MAX) {
        return { kind: 'value', root: node.name, chain, steps: [...steps].reverse() };
      }
      if (chain.length === 0 && unwrapAwait(declaration.init).kind === 'array') {
        return { kind: 'value', root: node.name, chain: [node.name], steps: [...steps].reverse(), held: 'array' };
      }
      chain.push(node.name);
      const options = steps.length === 0 ? readOptionsQuery(declaration.init, { ...optionsContext(context) }) : undefined;
      if (options !== undefined) {
        return { kind: 'options', query: options.query, home: options.home, chain };
      }
      current = { source: context.frontmatter.source, node: declaration.init };
      continue;
    }
    const step = stepOf({ source: current.source, node });
    if (step) {
      steps.push(step.step);
      current = step.from;
      continue;
    }
    const listed = listCollectionOf(node, {
      lookup: (name) => context.frontmatter.declarations.get(name)?.init,
      importedFrom: (local, spec) => importedFrom(context, local, spec),
    });
    if (listed !== undefined) {
      const list = { text: textOf(current, node), itemPath: listed.itemPath };
      return { kind: 'collection', base: { kind: 'astro', collection: listed.collection, filter: undefined, list }, steps: steps.reverse(), chain };
    }
    const path = namePath(node);
    if (path?.[0] !== undefined) {
      return { kind: 'value', root: path[0], chain };
    }
    const held = chain[chain.length - 1];
    return held === undefined ? { kind: 'unknown' } : { kind: 'value', root: held, chain };
  }
  return { kind: 'unknown' };
}

function optionsContext(context: Context) {
  return {
    frontmatter: context.frontmatter,
    importedFrom: (local: string, spec: string) => importedFrom(context, local, spec),
    fieldKind: context.input.fieldKind,
  };
}

function unwrapAwait(node: Js): Js {
  return node.kind === 'await' ? node.value : node;
}

function stepOf(located: Located): { readonly step: Step; readonly from: Located } | undefined {
  const node = located.node;
  if (node.kind !== 'call' || node.callee.kind !== 'member') {
    return undefined;
  }
  const method = node.callee.property;
  const from = { source: located.source, node: node.callee.object };
  if (!METHOD_STEPS.has(method)) {
    return namePath(node.callee) === undefined ? { step: { kind: 'other', name: method, call: located }, from } : undefined;
  }
  return { step: { ...stepBodyOf(method, node.args, located.source), call: located }, from };
}

function stepBodyOf(method: string, args: readonly Js[], source: string): StepBody {
  const argument = args[0];
  switch (method) {
    case 'filter':
      return argument?.kind === 'function' && args.length === 1 ? { kind: 'filter', function: { source, node: argument } } : { kind: 'other', name: method };
    case 'sort':
    case 'toSorted':
      if (args.length === 0) {
        return { kind: 'sort', function: undefined };
      }
      return argument?.kind === 'function' && args.length === 1 ? { kind: 'sort', function: { source, node: argument } } : { kind: 'other', name: method };
    case 'slice':
      return sliceStep(args);
    case 'reverse':
    case 'toReversed':
      return { kind: 'reverse' };
    default:
      return { kind: 'other', name: method };
  }
}

function sliceStep(args: readonly Js[]): StepBody {
  const [first, second] = args;
  const start = first === undefined ? 0 : wholeNumber(first);
  const end = second === undefined ? undefined : wholeNumber(second);
  if (start === undefined || args.length > 2 || (second !== undefined && end === undefined)) {
    return { kind: 'other', name: 'slice' };
  }
  return { kind: 'slice', start, end };
}

function wholeNumber(node: Js): number | undefined {
  return node.kind === 'number' && Number.isSafeInteger(node.value) && node.value >= 0 ? node.value : undefined;
}

function baseOf(located: Located, context: Context): Base | undefined {
  const node = located.node;
  if (node.kind !== 'call') {
    return undefined;
  }
  if (node.callee.kind === 'name' && importedFrom(context, node.callee.name, 'astro:content') === 'getCollection') {
    const [name, filter] = node.args;
    if (name?.kind !== 'string' || node.args.length > 2) {
      return undefined;
    }
    return { kind: 'astro', collection: name.value, filter: filter ? { source: located.source, node: filter } : undefined, call: located };
  }
  if (node.callee.kind === 'name' && importedFrom(context, node.callee.name, 'astro:content') === 'getEntries') {
    const entries = entriesSelection(node.args);
    return entries === undefined ? undefined : { kind: 'astro', collection: entries.collection, filter: undefined, selection: entries.ids };
  }
  if (node.callee.kind === 'member' && node.callee.property === 'fetch' && node.callee.object.kind === 'name' && node.args.length === 1) {
    const argument = node.args[0];
    const groq = argument === undefined ? undefined : groqText(argument, context, 0);
    return groq === undefined ? undefined : { kind: 'sanity', groq, client: node.callee.object.name };
  }
  return undefined;
}

function curatedOf(node: Js, context: Context, source: string): Base | undefined {
  const lookup = (name: string): Js | undefined => context.frontmatter.declarations.get(name)?.init;
  const curated = curatedSelection(node, { lookup, importedFrom: (local, spec) => importedFrom(context, local, spec) }, source);
  return curated === undefined ? undefined : { kind: 'astro', collection: curated.collection, filter: undefined, list: curated.list, selection: curated.ids };
}

function pickedSteps(steps: readonly Step[]): readonly string[] | undefined {
  const [filter, sort] = steps;
  if (filter?.kind !== 'filter' || steps.length > 2 || (sort !== undefined && sort.kind !== 'sort')) {
    return undefined;
  }
  return pickedIds(filter.function.node, sort?.kind === 'sort' ? sort.function?.node : undefined);
}

function groqText(node: Js, context: Context, depth: number): string | undefined {
  if (depth > CHAIN_STEPS_MAX || depth > LIMITS.treeDepthMax) {
    return undefined;
  }
  if (node.kind === 'string') {
    return node.value.trim().startsWith('*') ? node.value : undefined;
  }
  if (node.kind === 'call' && node.callee.kind === 'name' && node.args.length === 1 && node.args[0]) {
    return groqText(node.args[0], context, depth + 1);
  }
  if (node.kind === 'name') {
    const init = context.frontmatter.declarations.get(node.name)?.init;
    return init === undefined ? undefined : groqText(init, context, depth + 1);
  }
  return undefined;
}

function importedFrom(context: Context, local: string, spec: string): string | undefined {
  const entry = context.input.imports.find((candidate) => candidate.name === local && candidate.path === spec);
  return entry === undefined ? undefined : (entry.imported ?? entry.name);
}

function originOf(root: string, context: Context): LoopValueOrigin {
  const declaration = context.frontmatter.declarations.get(root);
  if (declaration) {
    const init = declaration.init === undefined ? undefined : unwrapAwait(declaration.init);
    if (init?.kind === 'call' && init.callee.kind === 'name') {
      const exportName = init.callee.name;
      const spec = context.input.imports.find((entry) => entry.name === exportName)?.path;
      if (spec !== undefined) {
        return { kind: 'call', exportName, spec };
      }
    }
    return { kind: 'frontmatter' };
  }
  const imported = context.input.imports.find((entry) => entry.name === root);
  return imported ? { kind: 'import', spec: imported.path } : { kind: 'scope' };
}

function listPropReading(pipeline: Extract<Pipeline, { readonly kind: 'value' }>, context: Context): LoopReading | undefined {
  const steps = pipeline.steps;
  if (steps === undefined || !COLLECTION_NAME.test(pipeline.root)) {
    return undefined;
  }
  const chain = heldListChain(pipeline, context);
  if (chain === undefined) {
    return undefined;
  }
  const reading = stepsReading({ source: { kind: 'list', collection: pipeline.root }, steps, chain, filter: undefined, itemPath: [] }, context);
  assert(reading.kind === 'query' || reading.kind === 'partial', 'A list prop’s steps read as a query or partly');
  assert(reading.chain.length <= 1, 'A list read where the loop reads it passes through one declaration at most');
  return reading;
}

function heldListChain(pipeline: Extract<Pipeline, { readonly kind: 'value' }>, context: Context): readonly string[] | undefined {
  if (pipeline.held === 'array') {
    assert(pipeline.chain.length === 1, 'A written-out list is held in one constant');
    assert(pipeline.chain[0] === pipeline.root, 'A written-out list is named for its constant');
    return pipeline.chain;
  }
  if (pipeline.chain.length > 0) {
    return undefined;
  }
  if (listPropOf(context.input.frontmatter, pipeline.root) !== undefined) {
    return [];
  }
  return importsProjectData(context.input.imports, pipeline.root) ? [] : undefined;
}

const PROJECT_SPECIFIER = /^(?:\.{1,2}\/|@\/|~\/)/;
function importsProjectData(imports: readonly LoopImport[], name: string): boolean {
  return imports.some((entry) => entry.name === name && PROJECT_SPECIFIER.test(entry.path));
}


function queryOf(pipeline: Extract<Pipeline, { readonly kind: 'collection' }>, context: Context): LoopReading {
  const base = pipeline.base;
  const source: LoopSource = base.kind === 'astro' ? { kind: 'astro', collection: base.collection } : { kind: 'sanity', collection: '' };
  if (base.kind === 'sanity') {
    return sanityQueryOf(base, pipeline, context);
  }
  if (!COLLECTION_NAME.test(source.collection)) {
    return partial(source, pipeline, issue('editor.loopRead.collectionNamed'));
  }
  if (base.selection !== undefined) {
    return selectedOf(base, pipeline);
  }
  const picked = base.filter === undefined && base.list === undefined ? pickedSteps(pipeline.steps) : undefined;
  if (picked !== undefined) {
    return selectedOf({ ...base, selection: picked }, { ...pipeline, steps: [] });
  }
  const itemPath = base.list?.itemPath ?? ['data'];
  const read = stepsReading({ source, steps: pipeline.steps, chain: pipeline.chain, filter: base.filter, itemPath }, context);
  if (read.kind === 'query' && base.list !== undefined) {
    return { ...read, home: { kind: 'chain', list: base.list.text, itemPath: base.list.itemPath } };
  }
  return read;
}

function stepsReading(
  list: {
    readonly source: LoopSource;
    readonly steps: readonly Step[];
    readonly chain: readonly string[];
    readonly filter: Located | undefined;
    readonly itemPath: ItemPath;
  },
  context: Context,
): LoopReading {
  const { source, itemPath } = list;
  const pipeline = { chain: list.chain };
  const order = stepOrder(list.steps);
  if (order === undefined) {
    return partial(source, pipeline, issue('editor.loopRead.itemsChanged'));
  }
  const filters = [...(list.filter ? [list.filter] : []), ...order.filters];
  const conditions = astroConditions(filters, source, context, itemPath);
  if (conditions === undefined) {
    return partial(source, pipeline, issue('editor.loopRead.filterShape'));
  }
  const sorting =
    order.sort === undefined ? { sorts: [], random: false } : readComparator(order.sort, itemPath, source.kind === 'list' ? 'field' : 'not-field');
  const customSort = sorting === undefined && order.sort !== undefined ? customSortOf(order.sort) : undefined;
  if (sorting === undefined && customSort === undefined) {
    return partial(source, pipeline, issue('editor.loopRead.sortComputed'));
  }
  if (order.reversed && customSort !== undefined) {
    return partial(source, pipeline, issue('editor.loopRead.sortComputedReversed'));
  }
  const typed = (sorting?.sorts ?? []).map((sort) => withOrder(sort, source, context.input.fieldKind));
  const sorts = order.reversed ? typed.map(flipped) : typed;
  const random = sorting?.random === true;
  if (order.reversed && sorts.length === 0 && !random) {
    return partial(source, pipeline, source.kind === 'list' ? issue('editor.loopRead.reversedList') : issue('editor.loopRead.reversedCollection'));
  }
  const query: LoopQuery = {
    source,
    ...conditions,
    sorts,
    random,
    offset: order.offset,
    limit: order.limit,
    projection: undefined,
    ...(customSort === undefined ? {} : { customSort }),
  };
  return checked(query, pipeline, undefined) ?? partial(source, pipeline, issue('editor.loopRead.settingsOutside'));
}

function selectedOf(base: Extract<Base, { readonly kind: 'astro' }>, pipeline: Extract<Pipeline, { readonly kind: 'collection' }>): LoopReading {
  const source: LoopSource = { kind: 'astro', collection: base.collection };
  if (pipeline.steps.some((step) => step.kind !== 'filter')) {
    return partial(source, pipeline, issue('editor.loopRead.pickedChanged'));
  }
  const query: LoopQuery = { ...emptyQuery(source), selection: base.selection };
  const read = checked(query, pipeline, undefined);
  assert(read?.kind === 'query', 'A selection within its bounds reads as a query');
  return base.list === undefined ? read : { ...read, home: { kind: 'chain', list: base.list.text, itemPath: base.list.itemPath } };
}

function sanityQueryOf(
  base: Extract<Base, { readonly kind: 'sanity' }>,
  pipeline: Extract<Pipeline, { readonly kind: 'collection' }>,
  context: Context,
): LoopReading {
  const groq = readGroq(base.groq);
  if (groq === undefined || !COLLECTION_NAME.test(groq.type)) {
    return { kind: 'value', root: pipeline.chain[0] ?? base.client, origin: { kind: 'frontmatter' }, chain: pipeline.chain };
  }
  const source: LoopSource = { kind: 'sanity', collection: groq.type };
  if (groq.selection !== undefined) {
    const reordered = pipeline.steps.length === 0 || (pipeline.steps.length === 1 && pipeline.steps[0]?.kind === 'sort');
    const picked: LoopQuery = { ...emptyQuery(source), selection: groq.selection, projection: groq.projection };
    return reordered
      ? (checked(picked, pipeline, base.client) ?? partial(source, pipeline, issue('editor.loopRead.pickedOutside')))
      : partial(source, pipeline, issue('editor.loopRead.pickedDocsChanged'));
  }
  const order = stepOrder(pipeline.steps);
  if (order === undefined || order.filters.length > 0 || order.reversed) {
    return partial(source, pipeline, issue('editor.loopRead.itemsChangedAfterFetch'));
  }
  const random = order.sort === undefined ? false : readComparator(order.sort, [], 'not-field')?.random === true;
  const customSort = order.sort !== undefined && !random ? customSortOf(order.sort) : undefined;
  if (order.sort !== undefined && !random && customSort === undefined) {
    return partial(source, pipeline, issue('editor.loopRead.sortedAfterFetch'));
  }
  const sliced = order.offset > 0 || order.limit !== undefined;
  const groqSliced = groq.offset > 0 || groq.limit !== undefined;
  if (sliced && groqSliced) {
    return partial(source, pipeline, issue('editor.loopRead.slicedTwice'));
  }
  if (customSort !== undefined && (groq.sorts.length > 0 || groqSliced)) {
    return partial(source, pipeline, issue('editor.loopRead.groqThenCode'));
  }
  const fieldKinds = context.input.fieldKind;
  const conditions = groq.conditions;
  const query: LoopQuery = {
    source,
    match: groq.match,
    conditions,
    sorts: random ? [] : groq.sorts.map((sort) => withOrder(sort, source, fieldKinds)),
    random,
    offset: sliced ? order.offset : groq.offset,
    limit: sliced ? order.limit : groq.limit,
    projection: groq.projection,
    parameter: { kind: 'data' },
    ...(customSort === undefined ? {} : { customSort }),
  };
  return checked(query, pipeline, base.client) ?? partial(source, pipeline, issue('editor.loopRead.settingsOutside'));
}

function checked(query: LoopQuery, pipeline: { readonly chain: readonly string[] }, client: string | undefined): LoopReading | undefined {
  if (!withinLimits(query)) {
    return undefined;
  }
  assertLoopQuery(query);
  return { kind: 'query', query, chain: pipeline.chain, client };
}

function withinLimits(query: LoopQuery): boolean {
  if (query.conditions.length > LOOP_QUERY_LIMITS.conditionsMax || query.sorts.length > LOOP_QUERY_LIMITS.sortsMax) {
    return false;
  }
  if (query.offset > LOOP_QUERY_LIMITS.offsetMax) {
    return false;
  }
  return query.limit === undefined || (query.limit >= 1 && query.limit <= LOOP_QUERY_LIMITS.limitMax);
}

function partial(source: LoopSource, pipeline: { readonly chain: readonly string[] }, reason: Issue): LoopReading {
  return { kind: 'partial', source, chain: pipeline.chain, reason: reason.message, reasonIssue: reason };
}

interface StepOrder {
  readonly filters: readonly Located[];
  readonly sort: Located | undefined;
  readonly reversed: boolean;
  readonly offset: number;
  readonly limit: number | undefined;
}

function stepOrder(steps: readonly Step[]): StepOrder | undefined {
  const filters: Located[] = [];
  let sort: Located | undefined;
  let sorted = false;
  let reversed = false;
  let slice: Extract<Step, { readonly kind: 'slice' }> | undefined;
  for (const step of steps) {
    if (slice !== undefined) {
      return undefined;
    }
    switch (step.kind) {
      case 'filter':
        if (sorted || reversed) {
          return undefined;
        }
        filters.push(step.function);
        break;
      case 'sort':
        if (sorted || reversed || step.function === undefined) {
          return undefined;
        }
        sorted = true;
        sort = step.function;
        break;
      case 'reverse':
        if (reversed) {
          return undefined;
        }
        reversed = true;
        break;
      case 'slice':
        slice = step;
        break;
      case 'other':
        return undefined;
      default: {
        const exhaustive: never = step;
        return exhaustive;
      }
    }
  }
  if (slice?.end !== undefined && slice.end <= slice.start) {
    return undefined;
  }
  const offset = slice?.start ?? 0;
  const limit = slice?.end === undefined ? undefined : slice.end - offset;
  return { filters, sort, reversed, offset, limit };
}

function customSortOf(located: { readonly source: string; readonly node: Js }): string | undefined {
  const text = located.source.slice(located.node.from, located.node.to).trim();
  if (text === '' || text.length > LOOP_QUERY_LIMITS.customCodeCharsMax) {
    return undefined;
  }
  return text;
}

function flipped(sort: LoopSort): LoopSort {
  return { ...sort, direction: sort.direction === 'ascending' ? 'descending' : 'ascending' };
}

function withOrder(sort: LoopSort, source: LoopSource, fieldKind: LoopReadInput['fieldKind']): LoopSort {
  if (!['text', 'number', 'date', 'boolean'].includes(sort.order)) {
    return sort;
  }
  const kind = fieldKind?.(source, sort.field);
  const order: LoopSortOrder | undefined =
    kind === 'number' ? 'number' : kind === 'date' ? 'date' : kind === 'text' ? 'text' : kind === 'boolean' ? 'boolean' : undefined;
  return order === undefined ? sort : { ...sort, order };
}


interface AstroConditions {
  readonly match: 'all' | 'any';
  readonly conditions: readonly LoopCondition[];
  readonly parameter: AstroItemParameter;
}

function astroConditions(filters: readonly Located[], source: LoopSource, context: Context, itemPath: ItemPath): AstroConditions | undefined {
  if (filters.length === 0) {
    return { match: 'all', conditions: [], parameter: emptyQuery(source).parameter };
  }
  let parameter: AstroItemParameter | undefined;
  let match: 'all' | 'any' = 'all';
  const conditions: LoopCondition[] = [];
  for (const filter of filters) {
    const read = filterFunction(filter, source, context, itemPath);
    if (read === undefined) {
      return undefined;
    }
    if (parameter !== undefined && !sameParameter(parameter, read.parameter) && read.conditions.some((condition) => condition.kind === 'custom')) {
      return undefined;
    }
    parameter = parameter ?? read.parameter;
    if (read.match === 'any' && read.conditions.length > 1) {
      if (filters.length > 1) {
        return undefined;
      }
      match = 'any';
    }
    conditions.push(...read.conditions);
  }
  assert(parameter !== undefined, 'Every filter function names its entry');
  return { match, conditions, parameter };
}

function sameParameter(left: AstroItemParameter, right: AstroItemParameter): boolean {
  if (left.kind === 'data') {
    return right.kind === 'data';
  }
  return right.kind === 'entry' && right.name === left.name;
}

function filterFunction(filter: Located, source: LoopSource, context: Context, itemPath: ItemPath): AstroConditions | undefined {
  const node = filter.node;
  if (node.kind !== 'function' || node.body === undefined || node.parameters.length !== 1) {
    return undefined;
  }
  const parameter = node.parameters[0];
  let base: readonly string[];
  let itemParameter: AstroItemParameter;
  const field = itemPath[0];
  if (parameter?.kind === 'object' && field !== undefined && parameter.names.length === 1 && parameter.names[0] === field && itemPath.length === 1) {
    base = [field];
    itemParameter = { kind: 'data' };
  } else if (parameter?.kind === 'name') {
    base = [parameter.name, ...itemPath];
    itemParameter = { kind: 'entry', name: parameter.name };
  } else {
    return undefined;
  }
  const located = { source: filter.source, base, collection: source, fieldKind: context.input.fieldKind };
  const or = chainOf(node.body, '||');
  const and = chainOf(node.body, '&&');
  const read: AstroConditions =
    or.length > 1
      ? { match: 'any', conditions: or.map((clause) => conditionOf(clause, located)), parameter: itemParameter }
      : { match: 'all', conditions: and.map((clause) => conditionOf(clause, located)), parameter: itemParameter };
  if (read.conditions.length > LOOP_QUERY_LIMITS.conditionsMax) {
    return undefined;
  }
  if (node.substituted && read.conditions.some((condition) => condition.kind === 'custom')) {
    return undefined;
  }
  return read;
}
