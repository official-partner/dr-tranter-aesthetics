
import { assert } from '../../shared/core/assert';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../shared/properties/i18n/messageRef';
import { readGroq } from './groqSyntax';
import { issue, spoken, type Issue } from './issue';
import {
  LOOP_QUERY_LIMITS,
  assertLoopQuery,
  emptyQuery,
  filterFunctionCode,
  groqFilterText,
  groqOrderText,
  groqSliceText,
  sliceCode,
  sortFunctionCode,
  type LoopQuery,
} from './loopQuery';
import { readLoop, readPipeline, type LoopPipeline, type LoopReadInput, type PipelineStep, type StepPlace } from './loopQueryRead';
import { parseExpression, textOf, type Js } from './loopSyntax';

export const LOOP_SECTIONS = ['filter', 'sort', 'limit'] as const;
export type LoopSection = (typeof LOOP_SECTIONS)[number];

const SECTION_RANK: Readonly<Record<LoopSection, number>> = { filter: 0, sort: 1, limit: 2 };

const CHAIN_STEPS_MAX = 16;
const WHITESPACE_CHARS_MAX = 256;

export interface SectionReading {
  readonly code: string;
  readonly custom: string | undefined;
  readonly customIssue: Issue | undefined;
}

function customOf(reason: Issue | undefined): Pick<SectionReading, 'custom' | 'customIssue'> {
  return { custom: reason?.message, customIssue: reason };
}

export interface LoopSections {
  readonly store: 'steps' | 'groq';
  readonly query: LoopQuery;
  readonly itemPath: readonly string[];
  readonly filter: SectionReading;
  readonly sort: SectionReading;
  readonly limit: SectionReading;
}

export function readSections(input: LoopReadInput): LoopSections | undefined {
  const reading = readLoop(input);
  if (reading.kind === 'query' && reading.query.source.kind === 'sanity') {
    return reading.query.selection === undefined ? groqSections(reading.query) : undefined;
  }
  if (reading.kind !== 'query' && reading.kind !== 'partial') {
    return undefined;
  }
  const split = splitPipeline(input);
  if (split === undefined) {
    return undefined;
  }
  const sections = {
    filter: sectionReading(split, 'filter', input),
    sort: sectionReading(split, 'sort', input),
    limit: sectionReading(split, 'limit', input),
  };
  const query = reading.kind === 'query' ? reading.query : mergedQuery(split, input, sections);
  assertLoopQuery(query);
  return { store: 'steps', query, itemPath: split.pipeline.itemPath, ...sections };
}

export function sectionRefusal(input: LoopReadInput, section: LoopSection, code: string, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const reason = sectionRefusalIssue(input, section, code);
  return reason === undefined ? undefined : spoken(reason, translate);
}

export function sectionRefusalIssue(input: LoopReadInput, section: LoopSection, code: string): Issue | undefined {
  const split = splitPipeline(input);
  if (split === undefined) {
    return undefined;
  }
  const text = code.trim();
  if (text === '') {
    return undefined;
  }
  const late = lateReason(split, section);
  if (late !== undefined) {
    return late;
  }
  return sectionQuery(split.pipeline, stepsCode(section, text, sortMethodOf(split, section)), input) === undefined ? shapeReason(section) : undefined;
}

export function sectionCodeProblem(section: LoopSection, code: string, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const problem = sectionCodeIssue(section, code);
  return problem === undefined ? undefined : spoken(problem, translate);
}

export function sectionCodeIssue(section: LoopSection, code: string): Issue | undefined {
  const text = code.trim();
  if (text === '') {
    return undefined;
  }
  if (text.length > LOOP_QUERY_LIMITS.customCodeCharsMax) {
    return issue('editor.loopSections.codeTooLong');
  }
  return text.startsWith('.') ? chainProblem(section, text) : shortFormProblem(section, text);
}

export function groqSectionProblem(section: LoopSection, code: string, query: LoopQuery, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  const problem = groqSectionIssue(section, code, query);
  return problem === undefined ? undefined : spoken(problem, translate);
}

export function groqSectionIssue(section: LoopSection, code: string, query: LoopQuery): Issue | undefined {
  const text = code.trim();
  if (text === '') {
    return undefined;
  }
  if (text.length > LOOP_QUERY_LIMITS.customCodeCharsMax) {
    return issue('editor.loopSections.codeTooLong');
  }
  return groqSectionQuery(section, text, query) === undefined ? groqProblem(section) : undefined;
}

function groqProblem(section: LoopSection): Issue {
  switch (section) {
    case 'filter':
      return issue('editor.loopSections.groq.filter');
    case 'sort':
      return issue('editor.loopSections.groq.sort');
    case 'limit':
      return issue('editor.loopSections.groq.limit');
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

export function groqSectionQuery(section: LoopSection, code: string, query: LoopQuery): LoopQuery | undefined {
  const next = groqSectionRead(section, code.trim(), query);
  return next !== undefined && withinQueryBounds(next) ? next : undefined;
}

function withinQueryBounds(query: LoopQuery): boolean {
  if (query.conditions.length > LOOP_QUERY_LIMITS.conditionsMax || query.offset > LOOP_QUERY_LIMITS.offsetMax) {
    return false;
  }
  return query.limit === undefined || (query.limit >= 1 && query.limit <= LOOP_QUERY_LIMITS.limitMax);
}

function groqSectionRead(section: LoopSection, text: string, query: LoopQuery): LoopQuery | undefined {
  const type = `_type == ${JSON.stringify(query.source.collection)}`;
  switch (section) {
    case 'filter': {
      const read = text === '' ? { match: 'all' as const, conditions: [] } : readGroq(`*[${type} && (${text})]`);
      return read === undefined ? undefined : { ...query, match: read.match, conditions: read.conditions };
    }
    case 'sort':
      return groqSortQuery(text, type, query);
    case 'limit': {
      const read = text === '' ? { offset: 0, limit: undefined } : readGroq(`*[${type}] ${text}`);
      return read === undefined ? undefined : { ...query, offset: read.offset, limit: read.limit };
    }
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function groqSortQuery(text: string, type: string, query: LoopQuery): LoopQuery | undefined {
  const unsorted: LoopQuery = { ...query, sorts: [], random: false, customSort: undefined };
  if (text === '') {
    return unsorted;
  }
  if (text.startsWith('order(')) {
    const read = readGroq(`*[${type}] | ${text}`);
    return read === undefined || read.sorts.length === 0 || read.sorts.length > LOOP_QUERY_LIMITS.sortsMax ? undefined : { ...unsorted, sorts: read.sorts };
  }
  return shortFormProblem('sort', text) === undefined ? { ...unsorted, customSort: text } : undefined;
}

function groqSections(query: LoopQuery): LoopSections {
  assert(query.source.kind === 'sanity', 'Only a Sanity list keeps its sections as GROQ');
  const fetched = query.random || query.customSort !== undefined;
  const sort = fetched ? (sortFunctionCode(query, []) ?? '') : groqOrderText(query.sorts);
  const section = (code: string): SectionReading => ({ code, ...customOf(undefined) });
  return {
    store: 'groq',
    query,
    itemPath: [],
    filter: section(groqFilterText(query)),
    sort: section(sort),
    limit: section(groqSliceText(query.offset, query.limit)),
  };
}

export function sectionCodeOf(query: LoopQuery, section: LoopSection, itemPath: readonly string[]): string {
  switch (section) {
    case 'filter':
      return filterFunctionCode(query, itemPath) ?? '';
    case 'sort':
      return sortFunctionCode(query, itemPath) ?? '';
    case 'limit':
      return query.offset === 0 && query.limit !== undefined ? String(query.limit) : sliceCode(query.offset, query.limit);
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

export function changedSection(before: LoopQuery, after: LoopQuery): LoopSection | undefined {
  const parts = (query: LoopQuery): Readonly<Record<LoopSection, string>> => ({
    filter: JSON.stringify([query.match, query.conditions]),
    sort: JSON.stringify([query.sorts, query.random, query.customSort]),
    limit: JSON.stringify([query.offset, query.limit]),
  });
  const left = parts(before);
  const right = parts(after);
  return LOOP_SECTIONS.find((section) => left[section] !== right[section]);
}


export interface TextEdit {
  readonly place: StepPlace;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export type SectionWrite = { readonly ok: true; readonly edits: readonly TextEdit[] } | ({ readonly ok: false } & Issue);

export function sectionEdits(input: LoopReadInput, section: LoopSection, code: string, shared: (position: number) => boolean): SectionWrite {
  const split = splitPipeline(input);
  if (split === undefined) {
    return { ok: false, ...issue('editor.loopPlan.settingsChanged') };
  }
  const steps = sectionSteps(split, section);
  const argument = section === 'filter' ? split.pipeline.filterArgument : undefined;
  const taken = (place: StepPlace, position: number): boolean => place === 'frontmatter' && shared(position);
  if (steps.some((step) => taken(step.step.place, step.from)) || (argument !== undefined && taken(argument.place, argument.from))) {
    return { ok: false, ...issue('editor.loopSections.sharedStep', { names: split.pipeline.chain.join(', ') }) };
  }
  const chain = stepsCode(section, code.trim(), sortMethodOf(split, section));
  const edits: TextEdit[] = [];
  if (argument !== undefined) {
    const single = steps.length === 0 ? singleArgument(chain) : undefined;
    if (steps.length === 0 && chain !== '' && single === undefined) {
      return { ok: false, ...issue('editor.loopSections.oneFunction') };
    }
    edits.push({ place: argument.place, from: argument.from, to: argument.to, text: single === undefined ? '' : `, ${single}` });
  }
  const [first, ...rest] = steps;
  if (first !== undefined) {
    const at = chain === '' ? withLeadingSpace(first) : first;
    edits.push({ place: first.step.place, from: at.from, to: at.to, text: chain });
    edits.push(...rest.map((step) => ({ place: step.step.place, ...spanOf(withLeadingSpace(step)), text: '' })));
  } else if (argument === undefined && chain !== '') {
    edits.push({ ...insertionPoint(split, section, input, taken), text: chain });
  }
  const offset = split.pipeline.headOffset;
  const local = edits.map((edit) => (edit.place === 'head' ? { ...edit, from: edit.from - offset, to: edit.to - offset } : edit));
  assert(
    local.every((edit) => edit.from >= 0),
    'A section is rewritten inside its text',
  );
  return { ok: true, edits: local };
}

export function appliedEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    assert(edit.from <= edit.to, 'A replaced span is ordered');
    assert(edit.to <= out.length, 'A replaced span is inside its text');
    out = `${out.slice(0, edit.from)}${edit.text}${out.slice(edit.to)}`;
  }
  return out;
}

function spanOf(step: { readonly from: number; readonly to: number }): { readonly from: number; readonly to: number } {
  return { from: step.from, to: step.to };
}


interface SplitStep {
  readonly step: PipelineStep;
  readonly section: LoopSection;
  readonly method: string;
  readonly from: number;
  readonly to: number;
}

interface SplitPipeline {
  readonly pipeline: LoopPipeline;
  readonly steps: readonly SplitStep[];
}

function splitPipeline(input: LoopReadInput): SplitPipeline | undefined {
  const pipeline = readPipeline(input);
  if (pipeline === undefined) {
    return undefined;
  }
  const steps: SplitStep[] = [];
  for (const step of pipeline.steps) {
    const split = splitStep(step);
    if (split === undefined) {
      return undefined;
    }
    steps.push(split);
  }
  const split: SplitPipeline = { pipeline, steps };
  return LOOP_SECTIONS.every((section) => contiguous(split, section)) ? split : undefined;
}

function splitStep(step: PipelineStep): SplitStep | undefined {
  const call = step.call;
  if (call.kind !== 'call' || call.callee.kind !== 'member') {
    return undefined;
  }
  const method = call.callee.property;
  const section = sectionOfMethod(method);
  const from = dotBefore(step.source, call.callee.to - method.length);
  if (section === undefined || from === undefined || step.source.slice(from).startsWith('?.')) {
    return undefined;
  }
  return { step, section, method, from, to: call.to };
}

function sectionOfMethod(method: string): LoopSection | undefined {
  switch (method) {
    case 'filter':
      return 'filter';
    case 'sort':
    case 'toSorted':
    case 'reverse':
    case 'toReversed':
      return 'sort';
    case 'slice':
      return 'limit';
    default:
      return undefined;
  }
}

function dotBefore(source: string, propertyFrom: number): number | undefined {
  let at = propertyFrom - 1;
  for (let count = 0; count < WHITESPACE_CHARS_MAX && at >= 0; count++) {
    const character = source[at];
    if (character === '.') {
      return source[at - 1] === '?' ? at - 1 : at;
    }
    if (character === undefined || character.trim() !== '') {
      return undefined;
    }
    at -= 1;
  }
  return undefined;
}

function contiguous(split: SplitPipeline, section: LoopSection): boolean {
  const indexes = split.steps.flatMap((step, index) => (step.section === section ? [index] : []));
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  if (first === undefined || last === undefined) {
    return true;
  }
  if (section === 'filter' && split.pipeline.filterArgument !== undefined && first !== 0) {
    return false;
  }
  return last - first + 1 === indexes.length;
}

function sectionSteps(split: SplitPipeline, section: LoopSection): readonly SplitStep[] {
  return split.steps.filter((step) => step.section === section);
}

function stepText(step: SplitStep): string {
  return step.step.source.slice(step.from, step.to);
}

function sectionReading(split: SplitPipeline, section: LoopSection, input: LoopReadInput): SectionReading {
  const steps = sectionSteps(split, section);
  const argument = section === 'filter' ? split.pipeline.filterArgument : undefined;
  const chain = `${argument === undefined ? '' : `.filter(${argument.code})`}${steps.map(stepText).join('')}`;
  if (chain === '') {
    return { code: '', ...customOf(undefined) };
  }
  const code = shortFormOf(section, steps, argument?.code) ?? chain;
  const late = lateReason(split, section);
  if (late !== undefined) {
    return { code, ...customOf(late) };
  }
  return { code, ...customOf(sectionQuery(split.pipeline, chain, input) === undefined ? shapeReason(section) : undefined) };
}

function shortFormOf(section: LoopSection, steps: readonly SplitStep[], argument: string | undefined): string | undefined {
  if (argument !== undefined) {
    return steps.length === 0 ? argument : undefined;
  }
  const step = steps[0];
  const call = step?.step.call;
  if (step === undefined || steps.length !== 1 || call?.kind !== 'call') {
    return undefined;
  }
  const [first, second] = call.args;
  const text = (node: Js): string => textOf(step.step, node);
  switch (section) {
    case 'filter':
      return call.args.length === 1 && first !== undefined ? text(first) : undefined;
    case 'sort':
      return call.args.length === 1 && first !== undefined && (step.method === 'sort' || step.method === 'toSorted') ? text(first) : undefined;
    case 'limit':
      return call.args.length === 2 && first?.kind === 'number' && first.value === 0 && second !== undefined ? text(second) : undefined;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function lateReason(split: SplitPipeline, section: LoopSection): Issue | undefined {
  const first = split.steps.findIndex((step) => step.section === section);
  const earlier = split.steps.slice(0, Math.max(first, 0)).find((step) => SECTION_RANK[step.section] > SECTION_RANK[section]);
  if (earlier === undefined) {
    return undefined;
  }
  switch (section) {
    case 'filter':
      return earlier.section === 'sort' ? issue('editor.loopSections.late.filterAfterSort') : issue('editor.loopSections.late.filterAfterLimit');
    case 'sort':
      return issue('editor.loopSections.late.sortAfterLimit');
    case 'limit':
      assert(false, 'lateReason: no step ranks after the limit');
      return issue('editor.loopSections.late.sortAfterLimit');
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function shapeReason(section: LoopSection): Issue {
  switch (section) {
    case 'filter':
      return issue('editor.loopSections.shape.filter');
    case 'sort':
      return issue('editor.loopSections.shape.sort');
    case 'limit':
      return issue('editor.loopSections.shape.limit');
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function sectionQuery(pipeline: LoopPipeline, chain: string, input: LoopReadInput): LoopQuery | undefined {
  const reading = readLoop({ ...input, data: `${pipeline.base}${chain}` });
  return reading.kind === 'query' && reading.query.selection === undefined ? reading.query : undefined;
}

function mergedQuery(split: SplitPipeline, input: LoopReadInput, sections: Pick<LoopSections, LoopSection>): LoopQuery {
  const pipeline = split.pipeline;
  const shown = (section: LoopSection): LoopQuery | undefined => {
    const reading = sections[section];
    if (reading.code === '' || reading.custom !== undefined) {
      return undefined;
    }
    return sectionQuery(pipeline, stepsCode(section, reading.code, sortMethodOf(split, section)), input);
  };
  const filter = shown('filter');
  const sort = shown('sort');
  const limit = shown('limit');
  const empty = emptyQuery(pipeline.source);
  const query: LoopQuery = {
    ...empty,
    ...(filter === undefined ? {} : { match: filter.match, conditions: filter.conditions, parameter: filter.parameter }),
    ...(sort === undefined ? {} : { sorts: sort.sorts, random: sort.random, ...(sort.customSort === undefined ? {} : { customSort: sort.customSort }) }),
    ...(limit === undefined ? {} : { offset: limit.offset, limit: limit.limit }),
  };
  assert(query.source === empty.source, 'A merged query reads the list it was split from');
  return query;
}

function stepsCode(section: LoopSection, code: string, sortMethod: string): string {
  if (code === '' || code.startsWith('.')) {
    return code;
  }
  switch (section) {
    case 'filter':
      return `.filter(${code})`;
    case 'sort':
      return `.${sortMethod}(${code})`;
    case 'limit':
      return `.slice(0, ${code})`;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function sortMethodOf(split: SplitPipeline, section: LoopSection): string {
  const written = sectionSteps(split, section).find((step) => step.method === 'sort' || step.method === 'toSorted');
  return written?.method ?? (split.pipeline.source.kind === 'list' ? 'toSorted' : 'sort');
}

function insertionPoint(
  split: SplitPipeline,
  section: LoopSection,
  input: LoopReadInput,
  taken: (place: StepPlace, position: number) => boolean,
): Pick<TextEdit, 'place' | 'from' | 'to'> {
  const next = split.steps.find((step) => SECTION_RANK[step.section] > SECTION_RANK[section]);
  if (next !== undefined && !taken(next.step.place, next.from)) {
    return { place: next.step.place, from: next.from, to: next.from };
  }
  const last = split.steps[split.steps.length - 1];
  if (last !== undefined && !taken(last.step.place, last.to)) {
    return { place: last.step.place, from: last.to, to: last.to };
  }
  const end = input.data.trim().length + split.pipeline.headOffset;
  return { place: 'head', from: end, to: end };
}

function withLeadingSpace(step: SplitStep): SplitStep {
  let from = step.from;
  for (let count = 0; count < WHITESPACE_CHARS_MAX && from > 0; count++) {
    const character = step.step.source[from - 1];
    if (character === undefined || character.trim() !== '') {
      break;
    }
    from -= 1;
  }
  return { ...step, from };
}


const LIST_NAME = 'list';

function shortFormProblem(section: LoopSection, text: string): Issue | undefined {
  const parsed = parseExpression(`${LIST_NAME}${stepsCode(section, text, 'sort')}`);
  const call = parsed?.expression;
  if (call?.kind !== 'call') {
    return issue('editor.loopSections.notExpression');
  }
  const argument = call.args[section === 'limit' ? 1 : 0];
  if (argument === undefined || call.args.length !== (section === 'limit' ? 2 : 1)) {
    return issue('editor.loopSections.notExpression');
  }
  return section === 'limit' ? amountProblem(argument) : functionProblem(section, argument);
}

function functionProblem(section: 'filter' | 'sort', node: Js): Issue | undefined {
  const example = section === 'filter' ? issue('editor.loopSections.filterIsFunction') : issue('editor.loopSections.sortIsFunction');
  switch (node.kind) {
    case 'function':
      return section === 'sort' && node.parameters.length > 2 ? issue('editor.loopSections.sortTwoItems') : undefined;
    case 'name':
    case 'member':
    case 'index':
    case 'call':
    case 'conditional':
    case 'other':
      return undefined;
    case 'new':
    case 'await':
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'unary':
    case 'binary':
    case 'object':
    case 'array':
      return example;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function amountProblem(node: Js): Issue | undefined {
  switch (node.kind) {
    case 'string':
    case 'boolean':
    case 'null':
    case 'function':
    case 'object':
    case 'array':
      return issue('editor.loopSections.limitIsNumber');
    case 'name':
    case 'member':
    case 'index':
    case 'call':
    case 'new':
    case 'await':
    case 'number':
    case 'unary':
    case 'binary':
    case 'conditional':
    case 'other':
      return undefined;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function chainProblem(section: LoopSection, text: string): Issue | undefined {
  const parsed = parseExpression(`${LIST_NAME}${text}`);
  if (parsed === undefined) {
    return issue('editor.loopSections.notExpression');
  }
  let node = parsed.expression;
  for (let count = 0; count <= CHAIN_STEPS_MAX; count++) {
    if (node.kind === 'name' && node.name === LIST_NAME) {
      return undefined;
    }
    if (node.kind !== 'call' || node.callee.kind !== 'member' || sectionOfMethod(node.callee.property) !== section) {
      return issue(CHAIN_ONLY_KEYS[section], { example: chainExample(section) });
    }
    node = node.callee.object;
  }
  return issue('editor.loopSections.chainTooLong');
}

const CHAIN_ONLY_KEYS: Readonly<Record<LoopSection, MessageKey>> = {
  filter: 'editor.loopSections.chainOnly.filter',
  sort: 'editor.loopSections.chainOnly.sort',
  limit: 'editor.loopSections.chainOnly.limit',
};

function chainExample(section: LoopSection): string {
  switch (section) {
    case 'filter':
      return '.filter(…)';
    case 'sort':
      return '.sort(…), .toSorted(…) or .reverse()';
    case 'limit':
      return '.slice(…)';
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function singleArgument(chain: string): string | undefined {
  const parsed = chain === '' ? undefined : parseExpression(`${LIST_NAME}${chain}`);
  const call = parsed?.expression;
  if (parsed === undefined || call?.kind !== 'call' || call.callee.kind !== 'member' || call.callee.object.kind !== 'name') {
    return undefined;
  }
  const argument = call.args[0];
  return call.args.length === 1 && argument !== undefined ? textOf(parsed, argument) : undefined;
}
