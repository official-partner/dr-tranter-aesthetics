
import { issue, type Issue } from './issue';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import {
  emptyQuery,
  isDateValue,
  isFieldPath,
  isItemId,
  LOOP_QUERY_LIMITS,
  type LoopCondition,
  type LoopFieldKind,
  type LoopLiteral,
  type LoopQuery,
  type LoopSort,
  type LoopSource,
} from './loopQuery';
import { destructuredDefault, parseExpression, type Js, type JsEntry, type ParsedFrontmatter } from './loopSyntax';
import { propNamed } from './loopProps';

export const LOOP_SETTINGS = ['filter', 'sort', 'limit', 'offset', 'curated'] as const;
export type LoopSetting = (typeof LOOP_SETTINGS)[number];

export type SettingHome =
  { readonly kind: 'inline' } | { readonly kind: 'prop'; readonly key: string; readonly local: string; readonly literal: Span } | { readonly kind: 'none' };

export interface OptionsHome {
  readonly kind: 'options';
  readonly reader: string;
  readonly options: Span;
  readonly settings: Readonly<Record<LoopSetting, SettingHome>>;
  readonly itemPath: readonly string[];
}

interface Span {
  readonly from: number;
  readonly to: number;
}

const OPTION_KEYS = new Set(['sort', 'filter', 'limit', 'offset', 'skip', 'curated', 'curatedItemIds']);
const COLLECTION_STEPS_MAX = 12;

type Lookup = (name: string) => Js | undefined;

export function readOptionsQuery(
  init: Js,
  context: {
    readonly frontmatter: ParsedFrontmatter;
    readonly importedFrom: (local: string, spec: string) => string | undefined;
    readonly fieldKind?: ((source: LoopSource, path: string) => LoopFieldKind | undefined) | undefined;
  },
): { readonly query: LoopQuery; readonly home: OptionsHome } | undefined {
  const call = init.kind === 'await' ? init.value : init;
  if (call.kind !== 'call' || call.callee.kind !== 'name') {
    return undefined;
  }
  const [list, options] = call.args;
  if (list === undefined || options?.kind !== 'object' || !options.entries.some((entry) => entry.key !== undefined && OPTION_KEYS.has(entry.key))) {
    return undefined;
  }
  const lookup: Lookup = (name) => context.frontmatter.declarations.get(name)?.init;
  const listed = listCollectionOf(list, { lookup, importedFrom: context.importedFrom });
  if (listed === undefined) {
    return undefined;
  }
  const source: LoopSource = { kind: 'astro', collection: listed.collection };
  const kind = (path: string): LoopFieldKind | undefined => context.fieldKind?.(source, path);
  const settings = settingsOf(options.entries, context.frontmatter.source);
  if (settings === undefined) {
    return undefined;
  }
  const filter = filterOf(settings.values.filter, context.frontmatter.source, kind);
  if (filter === undefined) {
    return undefined;
  }
  const home: OptionsHome = {
    kind: 'options',
    reader: call.callee.name,
    options: { from: options.from, to: options.to },
    settings: settings.homes,
    itemPath: listed.itemPath,
  };
  const picked = curatedOf(settings.values.curated, entryValue(options.entries, 'curatedItemIds'));
  const selection = picked ?? (settings.homes.curated.kind === 'prop' ? [] : undefined);
  if (selection !== undefined) {
    return { query: { ...emptyQuery(source), selection }, home };
  }
  const query = dynamicQuery(settings.values, { source, filter, kind });
  return query === undefined ? undefined : { query, home };
}

export function settingEntry(entries: readonly JsEntry[], setting: LoopSetting): JsEntry | undefined {
  return entries.find((entry) => entry.key === setting) ?? (setting === 'offset' ? entries.find((entry) => entry.key === 'skip') : undefined);
}

function settingsOf(
  entries: readonly JsEntry[],
  frontmatter: string,
): { readonly values: Readonly<Record<LoopSetting, Js | undefined>>; readonly homes: Readonly<Record<LoopSetting, SettingHome>> } | undefined {
  const values: Record<LoopSetting, Js | undefined> = { filter: undefined, sort: undefined, limit: undefined, offset: undefined, curated: undefined };
  const homes: Record<LoopSetting, SettingHome> = {
    filter: { kind: 'none' },
    sort: { kind: 'none' },
    limit: { kind: 'none' },
    offset: { kind: 'none' },
    curated: { kind: 'none' },
  };
  for (const setting of LOOP_SETTINGS) {
    const value = settingEntry(entries, setting)?.value;
    if (value === undefined) {
      continue;
    }
    if (value.kind === 'name') {
      const prop = propNamed(frontmatter, value.name);
      const fallback = destructuredDefault(frontmatter, value.name);
      if (prop === undefined || prop.defaultValue === undefined || fallback === undefined) {
        return undefined;
      }
      assert(fallback.from === prop.defaultValue.from, 'A prop default is read where the destructure says');
      values[setting] = fallback;
      homes[setting] = { kind: 'prop', key: prop.key, local: prop.local, literal: prop.defaultValue };
    } else {
      values[setting] = value;
      homes[setting] = { kind: 'inline' };
    }
  }
  assert(Object.keys(homes).length === LOOP_SETTINGS.length, 'Every setting has a home');
  return { values, homes };
}

function dynamicQuery(
  values: Readonly<Record<LoopSetting, Js | undefined>>,
  read: { readonly source: LoopSource; readonly filter: FilterReading; readonly kind: (path: string) => LoopFieldKind | undefined },
): LoopQuery | undefined {
  const sorts = sortsOf(values.sort, read.kind);
  const offset = wholeOf(values.offset) ?? 0;
  const limit = wholeOf(values.limit);
  if (sorts === undefined || offset > LOOP_QUERY_LIMITS.offsetMax || (limit !== undefined && limit > LOOP_QUERY_LIMITS.limitMax)) {
    return undefined;
  }
  const query: LoopQuery = {
    source: read.source,
    match: read.filter.match,
    conditions: read.filter.conditions,
    sorts,
    random: false,
    offset,
    limit: limit === 0 ? undefined : limit,
    projection: undefined,
    parameter: { kind: 'data' },
  };
  assert(query.conditions.length <= LOOP_QUERY_LIMITS.conditionsMax, 'An options query has bounded conditions');
  return query;
}

export function listCollectionOf(
  start: Js,
  context: { readonly lookup: (name: string) => Js | undefined; readonly importedFrom: (local: string, spec: string) => string | undefined },
): { readonly collection: string; readonly itemPath: readonly string[] } | undefined {
  let current: Js | undefined = start;
  const keys: string[] = [];
  let itemPath: readonly string[] | undefined;
  for (let step = 0; current !== undefined && step < COLLECTION_STEPS_MAX; step++) {
    const node: Js = current;
    if (node.kind === 'binary' && (node.operator === '||' || node.operator === '??')) {
      current = node.left;
    } else if (node.kind === 'await') {
      current = node.value;
    } else if (node.kind === 'member') {
      keys.push(node.property);
      current = node.object;
    } else if (node.kind === 'name') {
      current = context.lookup(node.name);
    } else if (node.kind === 'object') {
      const key = keys.pop();
      current = key === undefined ? undefined : entryValue(node.entries, key);
    } else if (node.kind === 'call' && node.callee.kind === 'name' && context.importedFrom(node.callee.name, 'astro:content') === 'getCollection') {
      const first = node.args[0];
      return first?.kind === 'string' ? { collection: first.value, itemPath: itemPath ?? ['data'] } : undefined;
    } else if (node.kind === 'call' && node.callee.kind === 'member') {
      if (node.callee.property === 'map' && itemPath === undefined) {
        const shaped = shapeOf(node.args[0]);
        if (shaped === undefined) {
          return undefined;
        }
        itemPath = shaped;
      }
      current = node.callee.object;
    } else {
      return undefined;
    }
  }
  return undefined;
}

function shapeOf(callback: Js | undefined): readonly string[] | undefined {
  const body = callback?.kind === 'function' ? callback.body : undefined;
  if (body?.kind !== 'object') {
    return undefined;
  }
  if (body.entries.some((entry) => entry.key === 'fields')) {
    return ['fields'];
  }
  return body.entries.some((entry) => entry.key === 'data') ? ['data'] : undefined;
}

function curatedOf(curated: Js | undefined, flat: Js | undefined): readonly string[] | undefined {
  const list = curated?.kind === 'object' ? entryValue(curated.entries, 'itemIds') : flat;
  if (list?.kind !== 'array' || list.items.length === 0 || list.items.length > LOOP_QUERY_LIMITS.selectionMax) {
    return undefined;
  }
  const ids = list.items.flatMap((item) => (item.kind === 'string' && isItemId(item.value) ? [item.value] : []));
  return ids.length === list.items.length ? ids : undefined;
}

function entryValue(entries: readonly JsEntry[], key: string): Js | undefined {
  return entries.find((entry) => entry.key === key)?.value;
}

export interface FilterReading {
  readonly match: 'all' | 'any';
  readonly conditions: readonly LoopCondition[];
}

function filterOf(value: Js | undefined, frontmatter: string, kind: (path: string) => LoopFieldKind | undefined): FilterReading | undefined {
  if (value === undefined) {
    return { match: 'all', conditions: [] };
  }
  return value.kind === 'object' ? filterObject(value, frontmatter, kind) : undefined;
}

function filterObject(value: Extract<Js, { readonly kind: 'object' }>, frontmatter: string, kind: (path: string) => LoopFieldKind | undefined) {
  const filterFor = entryValue(value.entries, 'filterFor');
  const fields = entryValue(value.entries, 'fields');
  const match: 'all' | 'any' = filterFor?.kind === 'string' && filterFor.value.toUpperCase() === 'ANY' ? 'any' : 'all';
  if (fields !== undefined && fields.kind !== 'array') {
    return undefined;
  }
  const items = fields?.items ?? [];
  if (items.length > LOOP_QUERY_LIMITS.conditionsMax) {
    return undefined;
  }
  const conditions = items.map((item) => conditionOf(item, kind) ?? { kind: 'custom' as const, code: frontmatter.slice(item.from, item.to) });
  return { match, conditions };
}

function conditionOf(item: Js, kind: (path: string) => LoopFieldKind | undefined): LoopCondition | undefined {
  if (item.kind !== 'object') {
    return undefined;
  }
  const path = entryValue(item.entries, 'fieldPath');
  const operator = entryValue(item.entries, 'operatorName');
  const value = entryValue(item.entries, 'value');
  if (path?.kind !== 'string' || operator?.kind !== 'string' || !isFieldPath(path.value)) {
    return undefined;
  }
  const field = path.value;
  const fieldKind = kind(field);
  switch (operator.value) {
    case 'exists':
      return { kind: 'test', field, operator: 'isSet' };
    case 'not-exists':
      return { kind: 'test', field, operator: 'isEmpty' };
    case 'eq':
    case 'ne':
      return equalityOf(field, operator.value, value, fieldKind);
    case 'contains': {
      const text = value?.kind === 'string' ? value.value : undefined;
      return text === undefined || text === '' ? undefined : { kind: 'test', field, operator: 'contains', value: text };
    }
    case 'idin': {
      const literal = literalOf(value, fieldKind);
      return literal === undefined ? undefined : { kind: 'test', field, operator: 'has', value: literal };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return comparisonOf(field, operator.value, value);
    default:
      return undefined;
  }
}

function equalityOf(field: string, operator: 'eq' | 'ne', value: Js | undefined, fieldKind: LoopFieldKind | undefined): LoopCondition | undefined {
  const switched =
    value?.kind === 'boolean'
      ? value.value
      : value?.kind === 'string' && (value.value === 'true' || value.value === 'false') && fieldKind === 'boolean'
        ? value.value === 'true'
        : undefined;
  if (switched !== undefined) {
    if (switched && operator === 'eq') {
      return { kind: 'test', field, operator: 'isTrue' };
    }
    return switched && operator === 'ne' ? { kind: 'test', field, operator: 'isFalse' } : undefined;
  }
  const literal = literalOf(value, fieldKind);
  return literal === undefined ? undefined : { kind: 'test', field, operator: operator === 'eq' ? 'is' : 'isNot', value: literal };
}

function literalOf(value: Js | undefined, fieldKind: LoopFieldKind | undefined): LoopLiteral | undefined {
  if (value?.kind === 'number') {
    return { kind: 'number', number: value.value };
  }
  if (value?.kind !== 'string' || value.value.length > LOOP_QUERY_LIMITS.valueCharsMax) {
    return undefined;
  }
  return fieldKind === 'number' && Number.isFinite(Number(value.value)) && value.value.trim() !== ''
    ? { kind: 'number', number: Number(value.value) }
    : { kind: 'text', text: value.value };
}

function comparisonOf(field: string, operator: 'gt' | 'gte' | 'lt' | 'lte', value: Js | undefined): LoopCondition | undefined {
  if (value?.kind === 'string' && isDateValue(value.value.slice(0, 10))) {
    if (operator === 'lt') {
      return { kind: 'test', field, operator: 'before', value: value.value.slice(0, 10) };
    }
    return operator === 'gt' ? { kind: 'test', field, operator: 'after', value: value.value.slice(0, 10) } : undefined;
  }
  const number = value?.kind === 'number' ? value.value : value?.kind === 'string' && value.value.trim() !== '' ? Number(value.value) : Number.NaN;
  if (!Number.isFinite(number)) {
    return undefined;
  }
  const named = { gt: 'greater', gte: 'atLeast', lt: 'less', lte: 'atMost' } as const;
  return { kind: 'test', field, operator: named[operator], value: number };
}

function sortsOf(value: Js | undefined, kind: (path: string) => LoopFieldKind | undefined): readonly LoopSort[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (value.kind !== 'array' || value.items.length > LOOP_QUERY_LIMITS.sortsMax) {
    return undefined;
  }
  const sorts: LoopSort[] = [];
  for (const item of value.items) {
    const field = item.kind === 'object' ? entryValue(item.entries, 'field') : undefined;
    const direction = item.kind === 'object' ? entryValue(item.entries, 'direction') : undefined;
    if (field?.kind !== 'string' || !isFieldPath(field.value)) {
      return undefined;
    }
    const fieldKind = kind(field.value);
    sorts.push({
      field: field.value,
      direction: direction?.kind === 'string' && direction.value === 'desc' ? 'descending' : 'ascending',
      order: fieldKind === 'number' ? 'number' : fieldKind === 'date' ? 'date' : fieldKind === 'boolean' ? 'boolean' : 'text',
    });
  }
  return sorts;
}

function wholeOf(value: Js | undefined): number | undefined {
  const number = value?.kind === 'number' ? value.value : value?.kind === 'string' && /^\d+$/.test(value.value) ? Number(value.value) : undefined;
  return number !== undefined && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

export function readFilterValue(text: string, kind: (path: string) => LoopFieldKind | undefined): FilterReading | undefined {
  const parsed = parseExpression(text);
  return parsed === undefined ? undefined : filterOf(parsed.expression, parsed.source, kind);
}

export function readSortValue(text: string, kind: (path: string) => LoopFieldKind | undefined): readonly LoopSort[] | undefined {
  const parsed = parseExpression(text);
  return parsed === undefined ? undefined : sortsOf(parsed.expression, kind);
}

export function optionsLiteral(query: LoopQuery): string {
  assert(dataFormProblem(query) === undefined, 'Only a query the data can say is written as data');
  const entries = [`"filter": ${filterText(query)}`, `"sort": ${sortText(query.sorts)}`];
  if (query.limit !== undefined) {
    entries.push(`"limit": ${query.limit}`);
  }
  if (query.offset > 0) {
    entries.push(`"offset": ${query.offset}`);
  }
  if (query.selection !== undefined) {
    entries.push(`"curated": ${curatedText(query.selection)}`);
  }
  return `{${entries.join(', ')}}`;
}

export function dataFormProblem(query: LoopQuery): Issue | undefined {
  if (query.source.kind !== 'astro') {
    return issue('editor.optionsQuery.onlyCollections');
  }
  if (query.random) {
    return issue('editor.optionsQuery.shuffled');
  }
  for (const condition of query.conditions) {
    if (condition.kind === 'custom') {
      return issue('editor.optionsQuery.customFilter');
    }
    if (condition.operator === 'inPast' || condition.operator === 'inFuture') {
      return issue('editor.optionsQuery.dateFilter');
    }
  }
  return undefined;
}

export function readCuratedValue(text: string): readonly string[] | undefined {
  const parsed = parseExpression(text);
  const value = parsed?.expression;
  const list = value?.kind === 'object' ? entryValue(value.entries, 'itemIds') : undefined;
  if (list?.kind === 'array' && list.items.length === 0) {
    return [];
  }
  return curatedOf(value, undefined);
}

export function filterValueText(query: Pick<LoopQuery, 'match' | 'conditions'>): string {
  return filterText(query);
}

export function sortValueText(sorts: readonly LoopSort[]): string {
  return sortText(sorts);
}


export function rewrittenOptions(frontmatter: string, home: OptionsHome, original: Extract<Js, { readonly kind: 'object' }>, query: LoopQuery): string {
  assert(original.from === home.options.from, 'The options rewritten are the ones read');
  assert(query.source.kind === 'astro', 'An options query reads an Astro collection');
  const filter = filterText(query);
  const texts: Readonly<Record<LoopSetting, string>> = {
    filter,
    sort: sortText(query.sorts),
    limit: String(query.limit ?? 0),
    offset: String(query.offset),
    curated: curatedText(query.selection ?? []),
  };
  const owned = new Map<string, string>();
  const edits: { readonly span: Span; readonly text: string }[] = [];
  for (const setting of LOOP_SETTINGS) {
    const settingHome = home.settings[setting];
    if (settingHome.kind === 'prop') {
      edits.push({ span: settingHome.literal, text: texts[setting] });
    } else {
      owned.set(setting, texts[setting]);
    }
  }
  const entries: string[] = [];
  const written = new Set<string>();
  for (const entry of original.entries) {
    const key = entry.key;
    const replacement = key === undefined ? undefined : owned.get(key === 'skip' ? 'offset' : key);
    const keyText = key === undefined ? undefined : JSON.stringify(key);
    if (key !== undefined && replacement !== undefined && keyText !== undefined) {
      entries.push(`${keyText}: ${replacement}`);
      written.add(key === 'skip' ? 'offset' : key);
    } else {
      entries.push(entryText(frontmatter, entry));
    }
  }
  for (const [key, value] of owned) {
    const unset =
      (key === 'limit' && query.limit === undefined) ||
      (key === 'offset' && query.offset === 0) ||
      (key === 'filter' && query.conditions.length === 0) ||
      (key === 'curated' && query.selection === undefined);
    if (!written.has(key) && !unset) {
      entries.push(`${JSON.stringify(key)}: ${value}`);
    }
  }
  const optionsText = `{${entries.join(', ')}}`;
  edits.push({ span: home.options, text: optionsText });
  edits.sort((left, right) => right.span.from - left.span.from);
  let out = frontmatter;
  for (const edit of edits) {
    out = `${out.slice(0, edit.span.from)}${edit.text}${out.slice(edit.span.to)}`;
  }
  assert(out.length <= LIMITS.ipcFieldCharsMax, 'Rewritten frontmatter is bounded');
  return out;
}

function entryText(frontmatter: string, entry: JsEntry): string {
  const value = frontmatter.slice(entry.value.from, entry.value.to);
  return entry.key === undefined ? value : `${JSON.stringify(entry.key)}: ${value}`;
}

export function curatedText(ids: readonly string[]): string {
  return `{"itemIds": ${JSON.stringify(ids)}}`;
}

function filterText(query: Pick<LoopQuery, 'match' | 'conditions'>): string {
  const fields = query.conditions.map(conditionText);
  return `{"filterFor": ${JSON.stringify(query.match === 'any' ? 'ANY' : 'ALL')}, "fields": [${fields.join(', ')}]}`;
}

function conditionText(condition: LoopCondition): string {
  if (condition.kind === 'custom') {
    return condition.code;
  }
  const entry = (operatorName: string, value: unknown): string =>
    `{"fieldPath": ${JSON.stringify(condition.field)}, "operatorName": ${JSON.stringify(operatorName)}, "value": ${JSON.stringify(value) ?? '""'}}`;
  switch (condition.operator) {
    case 'is':
      return entry('eq', literalValue(condition.value));
    case 'isNot':
      return entry('ne', literalValue(condition.value));
    case 'contains':
      return entry('contains', condition.value);
    case 'has':
      return entry('idin', literalValue(condition.value));
    case 'isSet':
      return entry('exists', '');
    case 'isEmpty':
      return entry('not-exists', '');
    case 'isTrue':
      return entry('eq', 'true');
    case 'isFalse':
      return entry('ne', 'true');
    case 'greater':
      return entry('gt', condition.value);
    case 'atLeast':
      return entry('gte', condition.value);
    case 'less':
      return entry('lt', condition.value);
    case 'atMost':
      return entry('lte', condition.value);
    case 'before':
      return entry('lt', condition.value);
    case 'after':
      return entry('gt', condition.value);
    case 'inPast':
    case 'inFuture':
      assert(false, `An options query cannot say ${condition.operator}`);
      return '';
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

function literalValue(value: LoopLiteral): string | number {
  switch (value.kind) {
    case 'text':
      return value.text;
    case 'number':
      return value.number;
    case 'reference':
      return value.id;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function sortText(sorts: readonly LoopSort[]): string {
  return `[${sorts.map((sort) => `{"field": ${JSON.stringify(sort.field)}, "direction": ${JSON.stringify(sort.direction === 'descending' ? 'desc' : 'asc')}}`).join(', ')}]`;
}
