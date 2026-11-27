
import { assert } from '../../shared/core/assert';
import { parseExpression } from './loopSyntax';

export const LOOP_QUERY_LIMITS = {
  conditionsMax: 12,
  sortsMax: 3,
  limitMax: 10_000,
  offsetMax: 100_000,
  valueCharsMax: 500,
  fieldPathCharsMax: 128,
  projectionCharsMax: 20_000,
  collectionCharsMax: 128,
  selectionMax: 200,
  customCodeCharsMax: 2_000,
  itemIdCharsMax: 256,
} as const;

export type LoopSourceKind = 'astro' | 'sanity' | 'list';

export interface LoopSource {
  readonly kind: LoopSourceKind;
  readonly collection: string;
}

export type LoopFieldKind = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'reference' | 'image' | 'other';

export interface LoopFieldOption {
  readonly title: string;
  readonly value: string;
}

export interface LoopField {
  readonly path: string;
  readonly title: string;
  readonly kind: LoopFieldKind;
  readonly options: readonly LoopFieldOption[];
}

export type LoopOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'has'
  | 'isSet'
  | 'isEmpty'
  | 'isTrue'
  | 'isFalse'
  | 'greater'
  | 'less'
  | 'atLeast'
  | 'atMost'
  | 'before'
  | 'after'
  | 'inPast'
  | 'inFuture';

export type LoopLiteral =
  { readonly kind: 'text'; readonly text: string } | { readonly kind: 'number'; readonly number: number } | { readonly kind: 'reference'; readonly id: string };

export type LoopCondition =
  | { readonly kind: 'test'; readonly field: string; readonly operator: 'isSet' | 'isEmpty' | 'isTrue' | 'isFalse' | 'inPast' | 'inFuture' }
  | { readonly kind: 'test'; readonly field: string; readonly operator: 'is' | 'isNot'; readonly value: LoopLiteral }
  | { readonly kind: 'test'; readonly field: string; readonly operator: 'contains'; readonly value: string }
  | { readonly kind: 'test'; readonly field: string; readonly operator: 'has'; readonly value: LoopLiteral }
  | { readonly kind: 'test'; readonly field: string; readonly operator: 'greater' | 'less' | 'atLeast' | 'atMost'; readonly value: number }
  | { readonly kind: 'test'; readonly field: string; readonly operator: 'before' | 'after'; readonly value: string }
  | { readonly kind: 'custom'; readonly code: string };

export type LoopTestCondition = Extract<LoopCondition, { readonly kind: 'test' }>;

export type LoopSortOrder = 'text' | 'number' | 'date' | 'boolean' | 'natural' | 'length' | 'count' | 'fileSize';

const GROQ_ORDERS: readonly LoopSortOrder[] = ['text', 'number', 'date', 'boolean'];

export interface LoopSort {
  readonly field: string;
  readonly direction: 'ascending' | 'descending';
  readonly order: LoopSortOrder;
}

export type AstroItemParameter = { readonly kind: 'data' } | { readonly kind: 'entry'; readonly name: string };

export interface LoopQuery {
  readonly source: LoopSource;
  readonly match: 'all' | 'any';
  readonly conditions: readonly LoopCondition[];
  readonly sorts: readonly LoopSort[];
  readonly offset: number;
  readonly limit: number | undefined;
  readonly random: boolean;
  readonly projection: string | undefined;
  readonly parameter: AstroItemParameter;
  readonly selection?: readonly string[] | undefined;
  readonly selectionField?: string | undefined;
  readonly customSort?: string | undefined;
}

const FIELD_SEGMENT = /^[A-Za-z_$][\w$-]*$/;

export const ITEM_FIELD = '$item';
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const COLLECTION_NAME = /^[A-Za-z0-9_][\w.-]*$/;
const PARAMETER_NAME = /^[A-Za-z_$][\w$]*$/;

export const VALUELESS_OPERATORS = ['isSet', 'isEmpty', 'isTrue', 'isFalse', 'inPast', 'inFuture'] as const;

export function operatorsFor(kind: LoopFieldKind): readonly LoopOperator[] {
  switch (kind) {
    case 'text':
      return ['is', 'isNot', 'contains', 'isSet', 'isEmpty'];
    case 'number':
      return ['is', 'isNot', 'greater', 'less', 'atLeast', 'atMost', 'isSet', 'isEmpty'];
    case 'boolean':
      return ['isTrue', 'isFalse'];
    case 'date':
      return ['before', 'after', 'inPast', 'inFuture', 'isSet', 'isEmpty'];
    case 'list':
      return ['has', 'isSet', 'isEmpty'];
    case 'reference':
      return ['is', 'isNot', 'isSet', 'isEmpty'];
    case 'image':
    case 'other':
      return ['isSet', 'isEmpty'];
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function sortOrderFor(kind: LoopFieldKind, source: LoopSourceKind = 'astro'): LoopSortOrder | undefined {
  return sortOrdersFor(kind, source)[0];
}

export function sortOrdersFor(kind: LoopFieldKind, source: LoopSourceKind): readonly LoopSortOrder[] {
  const orders = ((): readonly LoopSortOrder[] => {
    switch (kind) {
      case 'text':
        return ['text', 'natural', 'length'];
      case 'number':
        return ['number'];
      case 'date':
        return ['date'];
      case 'boolean':
        return ['boolean'];
      case 'list':
        return ['count'];
      case 'image':
        return ['fileSize'];
      case 'reference':
      case 'other':
        return [];
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  })();
  const offered = ordersOffered(orders, source);
  assert(offered.length <= orders.length, 'A source offers a subset of the orders');
  return offered;
}

function ordersOffered(orders: readonly LoopSortOrder[], source: LoopSourceKind): readonly LoopSortOrder[] {
  switch (source) {
    case 'astro':
      return orders;
    case 'sanity':
      return orders.filter((order) => GROQ_ORDERS.includes(order));
    case 'list':
      return orders.filter((order) => order !== 'fileSize');
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

const LIST_ITEM_PARAMETER: AstroItemParameter = { kind: 'entry', name: 'item' };

export function listExpressionProblem(text: string): string | undefined {
  if (text.trim() === '') {
    return 'empty';
  }
  if (text.length > LOOP_QUERY_LIMITS.customCodeCharsMax) {
    return 'tooLong';
  }
  return parseExpression(text) === undefined ? 'unparseable' : undefined;
}

export function chainableListCode(expression: string): string {
  const parsed = parseExpression(expression);
  assert(parsed !== undefined, 'A list expression parses');
  switch (parsed.expression.kind) {
    case 'name':
    case 'member':
    case 'index':
    case 'call':
    case 'new':
    case 'array':
      return expression;
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
    case 'function':
    case 'await':
    case 'null':
    case 'unary':
    case 'binary':
    case 'conditional':
    case 'other':
      return `(${expression})`;
    default: {
      const exhaustive: never = parsed.expression;
      return exhaustive;
    }
  }
}

export function emptyQuery(source: LoopSource): LoopQuery {
  const query: LoopQuery = {
    source,
    match: 'all',
    conditions: [],
    sorts: [],
    random: false,
    offset: 0,
    limit: undefined,
    projection: undefined,
    parameter: source.kind === 'list' ? LIST_ITEM_PARAMETER : { kind: 'data' },
  };
  assertLoopQuery(query);
  assert(query.conditions.length === 0, 'An empty query has no conditions');
  return query;
}

export function assertLoopQuery(query: LoopQuery): void {
  assertSelection(query);
  if (query.source.kind === 'list') {
    assert(listExpressionProblem(query.source.collection) === undefined, 'A list source is an expression that parses');
  } else {
    assert(COLLECTION_NAME.test(query.source.collection), 'A loop source names a collection');
    assert(query.source.collection.length <= LOOP_QUERY_LIMITS.collectionCharsMax, 'A collection name is short');
  }
  assert(query.conditions.length <= LOOP_QUERY_LIMITS.conditionsMax, 'A loop has a bounded number of conditions');
  assert(query.sorts.length <= LOOP_QUERY_LIMITS.sortsMax, 'A loop has a bounded number of sort keys');
  assert(Number.isSafeInteger(query.offset), 'An offset is a whole number');
  assert(query.offset >= 0, 'An offset is never negative');
  assert(query.offset <= LOOP_QUERY_LIMITS.offsetMax, 'An offset is bounded');
  if (query.limit !== undefined) {
    assert(Number.isSafeInteger(query.limit), 'A limit is a whole number');
    assert(query.limit >= 1, 'A limit shows at least one item');
    assert(query.limit <= LOOP_QUERY_LIMITS.limitMax, 'A limit is bounded');
  }
  if (query.projection !== undefined) {
    assert(query.source.kind === 'sanity', 'Only a Sanity query has a projection');
    assert(query.projection.length <= LOOP_QUERY_LIMITS.projectionCharsMax, 'A projection is bounded');
  }
  if (query.parameter.kind === 'entry') {
    assert(PARAMETER_NAME.test(query.parameter.name), 'An entry parameter is a name');
  }
  if (query.source.kind !== 'list') {
    assert(!query.conditions.some((condition) => condition.kind === 'test' && condition.field === ITEM_FIELD), 'Only a list’s filter compares the item itself');
    assert(!query.sorts.some((sort) => sort.field === ITEM_FIELD), 'Only a list sorts by the item itself');
  }
  if (query.source.kind === 'list') {
    assert(query.parameter.kind === 'entry', 'A list prop’s filter names its item');
    assertListPicks(query);
  } else {
    assert(query.selectionField === undefined, 'Only a list picks by one of its fields');
  }
  for (const condition of query.conditions) {
    assertCondition(condition);
  }
  if (query.customSort !== undefined) {
    assert(query.customSort.trim().length > 0, 'A custom sort holds code');
    assert(query.customSort.length <= LOOP_QUERY_LIMITS.customCodeCharsMax, 'A custom sort is bounded');
    assert(query.sorts.length === 0, 'A custom sort replaces the sort keys');
    assert(!query.random, 'A custom sort is not a shuffle');
  }
  for (const sort of query.sorts) {
    assertFieldPath(sort.field);
    if (query.source.kind === 'sanity') {
      assert(GROQ_ORDERS.includes(sort.order), 'A Sanity query sorts by values GROQ compares');
    }
  }
}

function assertSelection(query: LoopQuery): void {
  const selection = query.selection;
  if (selection === undefined) {
    return;
  }
  assert(selection.length <= LOOP_QUERY_LIMITS.selectionMax, 'A selection is bounded');
  assert(query.conditions.length === 0, 'A selected list has no filters');
  assert(query.sorts.length === 0, 'A selected list has no sort');
  assert(!query.random, 'A selected list is not shuffled');
  assert(query.offset === 0, 'A selected list skips nothing');
  assert(query.limit === undefined, 'A selected list has no limit');
  assert(query.customSort === undefined, 'A selected list keeps its picked order');
  for (const id of selection) {
    assert(isItemId(id), 'A selected item is named by an id');
  }
}

function assertListPicks(query: LoopQuery): void {
  if (query.selection === undefined) {
    assert(query.selectionField === undefined, 'A list that picks nothing has no pick field');
    return;
  }
  if (query.selectionField === undefined) {
    for (const position of query.selection) {
      assert(/^\d{1,6}$/.test(position), 'A picked position is a whole number');
    }
    return;
  }
  assertFieldPath(query.selectionField);
  assert(query.selectionField !== ITEM_FIELD, 'A pick field is a field of the item');
}

export function isItemId(text: string): boolean {
  return text.length > 0 && text.length <= LOOP_QUERY_LIMITS.itemIdCharsMax && !/[\r\n]/.test(text);
}

function idsCode(ids: readonly string[]): string {
  return `[${ids.map(jsString).join(', ')}]`;
}

function assertCondition(condition: LoopCondition): void {
  if (condition.kind === 'custom') {
    assert(condition.code.trim().length > 0, 'A custom condition holds code');
    assert(condition.code.length <= LOOP_QUERY_LIMITS.customCodeCharsMax, 'A custom condition is bounded');
    return;
  }
  assertFieldPath(condition.field);
  switch (condition.operator) {
    case 'is':
    case 'isNot':
    case 'has':
      assertLiteral(condition.value);
      return;
    case 'contains':
      assert(condition.value.length > 0, 'A searched text is not empty');
      assert(condition.value.length <= LOOP_QUERY_LIMITS.valueCharsMax, 'A searched text is bounded');
      return;
    case 'greater':
    case 'less':
    case 'atLeast':
    case 'atMost':
      assert(Number.isFinite(condition.value), 'A compared number is finite');
      return;
    case 'before':
    case 'after':
      assert(DATE_VALUE.test(condition.value), 'A compared date is YYYY-MM-DD');
      return;
    case 'isSet':
    case 'isEmpty':
    case 'isTrue':
    case 'isFalse':
    case 'inPast':
    case 'inFuture':
      return;
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

const DOCUMENT_ID = /^[\w][\w.-]{0,127}$/;

function assertLiteral(value: LoopLiteral): void {
  switch (value.kind) {
    case 'number':
      assert(Number.isFinite(value.number), 'A compared number is finite');
      return;
    case 'text':
      assert(value.text.length <= LOOP_QUERY_LIMITS.valueCharsMax, 'A compared text is bounded');
      return;
    case 'reference':
      assert(DOCUMENT_ID.test(value.id), 'A referenced document is named by its id');
      return;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function isDocumentId(text: string): boolean {
  return DOCUMENT_ID.test(text);
}

function assertFieldPath(path: string): void {
  assert(path.length > 0, 'A field path names a field');
  assert(path.length <= LOOP_QUERY_LIMITS.fieldPathCharsMax, 'A field path is bounded');
  for (const segment of path.split('.')) {
    assert(FIELD_SEGMENT.test(segment), `A field path segment is a name: ${segment}`);
  }
}

export function isFieldPath(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  if (path.length > LOOP_QUERY_LIMITS.fieldPathCharsMax) {
    return false;
  }
  return path.split('.').every((segment) => FIELD_SEGMENT.test(segment));
}

export function isDateValue(text: string): boolean {
  return DATE_VALUE.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
}


export function astroQueryCode(query: LoopQuery, reader = 'getCollection'): string {
  assertLoopQuery(query);
  assert(query.source.kind === 'astro', 'An Astro query reads an Astro collection');
  assert(/^[A-Za-z_$][\w$]*$/.test(reader), 'getCollection is called by its imported name');
  if (query.selection !== undefined) {
    const ids = idsCode(query.selection);
    const read = `await ${reader}(${jsString(query.source.collection)})`;
    return `(${read}).filter((entry) => ${ids}.includes(entry.id)).sort((a, b) => ${ids}.indexOf(a.id) - ${ids}.indexOf(b.id))`;
  }
  const filter = astroFilterCode(query);
  const read = `await ${reader}(${jsString(query.source.collection)}${filter === undefined ? '' : `, ${filter}`})`;
  const sort = sortStepCode(query, ['data'], 'sort');
  const slice = sliceCode(query.offset, query.limit);
  const code = sort === '' && slice === '' ? read : `(${read})${sort}${slice}`;
  assert(code.startsWith('await') || code.startsWith('(await'), 'An Astro query awaits its collection');
  return code;
}

export function chainQueryCode(query: LoopQuery, list: string, itemPath: readonly string[]): string {
  assertLoopQuery(query);
  assert(list.trim().length > 0, 'A kept list is an expression');
  assert(
    itemPath.every((segment) => /^[A-Za-z_$][\w$]*$/.test(segment)),
    'An item path is names',
  );
  if (query.selection !== undefined) {
    return `${idsCode(query.selection)}.map((id) => ${list.trim()}.find((entry) => entry.id === id)).filter(Boolean)`;
  }
  const name = query.parameter.kind === 'entry' ? query.parameter.name : 'entry';
  const base = [name, ...itemPath].join('.');
  const joiner = query.match === 'all' ? ' && ' : ' || ';
  const filter =
    query.conditions.length === 0 ? '' : `.filter((${name}) => ${query.conditions.map((condition) => astroConditionCode(condition, base)).join(joiner)})`;
  const sort = sortStepCode(query, itemPath, 'sort');
  const code = `[...${list.trim()}]${filter}${sort}${sliceCode(query.offset, query.limit)}`;
  assert(code.startsWith('[...'), 'A kept list is copied');
  return code;
}

export function listQueryCode(query: LoopQuery): string {
  assertLoopQuery(query);
  assert(query.source.kind === 'list', 'A list query reads a List prop');
  assert(query.parameter.kind === 'entry', 'A list prop’s filter names its item');
  if (query.selection !== undefined) {
    return listPickedCode(query.source.collection, query.selection, query.selectionField);
  }
  const parameter = query.parameter.name;
  const joiner = query.match === 'all' ? ' && ' : ' || ';
  const clauses = query.conditions.map((condition) => astroConditionCode(condition, parameter));
  const filter = clauses.length === 0 ? '' : `.filter((${parameter}) => ${clauses.join(joiner)})`;
  const base = chainableListCode(query.source.collection);
  const code = `${base}${filter}${sortStepCode(query, [], 'toSorted')}${sliceCode(query.offset, query.limit)}`;
  assert(code.startsWith(base), 'A list query starts from its list');
  return code;
}

export function listPickedCode(list: string, picks: readonly string[], field: string | undefined): string {
  assert(listExpressionProblem(list) === undefined, 'A picked list is an expression');
  assert(picks.length <= LOOP_QUERY_LIMITS.selectionMax, 'A selection is bounded');
  const base = chainableListCode(list);
  if (field === undefined) {
    const positions = picks.map((position) => {
      assert(/^\d{1,6}$/.test(position), 'A picked position is a whole number');
      return String(Number(position));
    });
    return `[${positions.join(', ')}].map((index) => ${base}[index]).filter(Boolean)`;
  }
  assertFieldPath(field);
  return `${idsCode(picks)}.map((key) => ${base}.find((item) => ${fieldAccess('item', field)} === key)).filter(Boolean)`;
}

export function filterFunctionCode(query: LoopQuery, itemPath: readonly string[]): string | undefined {
  if (query.conditions.length === 0) {
    return undefined;
  }
  if (query.parameter.kind === 'data' && itemPath.length === 1 && itemPath[0] === 'data') {
    return astroFilterCode(query);
  }
  const name = query.parameter.kind === 'entry' ? query.parameter.name : 'entry';
  const base = [name, ...itemPath].join('.');
  const joiner = query.match === 'all' ? ' && ' : ' || ';
  const code = `(${name}) => ${query.conditions.map((condition) => astroConditionCode(condition, base)).join(joiner)}`;
  assert(code.includes('=>'), 'A filter is a function');
  return code;
}

function astroFilterCode(query: LoopQuery): string | undefined {
  if (query.conditions.length === 0) {
    return undefined;
  }
  const parameter = query.parameter;
  const head = parameter.kind === 'data' ? '({ data })' : `(${parameter.name})`;
  const base = parameter.kind === 'data' ? 'data' : `${parameter.name}.data`;
  const clauses = query.conditions.map((condition) => astroConditionCode(condition, base));
  const joiner = query.match === 'all' ? ' && ' : ' || ';
  return `${head} => ${clauses.join(joiner)}`;
}

export function astroConditionCode(condition: LoopCondition, base: string): string {
  if (condition.kind === 'custom') {
    return groupedCode(condition.code);
  }
  const field = fieldAccess(base, condition.field);
  switch (condition.operator) {
    case 'is':
      return condition.value.kind === 'reference'
        ? `${referenceId(field)} === ${jsString(condition.value.id)}`
        : `${field} === ${literalCode(condition.value)}`;
    case 'isNot':
      return condition.value.kind === 'reference'
        ? `${referenceId(field)} !== ${jsString(condition.value.id)}`
        : `${field} !== ${literalCode(condition.value)}`;
    case 'contains':
      return `String(${field} ?? '').toLowerCase().includes(${jsString(condition.value.toLowerCase())})`;
    case 'has':
      return condition.value.kind === 'reference'
        ? `(${field} ?? []).some((value) => ${referenceId('value')} === ${jsString(condition.value.id)})`
        : `(${field} ?? []).includes(${literalCode(condition.value)})`;
    case 'isSet':
      return `${field} != undefined`;
    case 'isEmpty':
      return `${field} == undefined`;
    case 'isTrue':
      return `${field} === true`;
    case 'isFalse':
      return `${field} !== true`;
    case 'greater':
      return `${field} > ${numberCode(condition.value)}`;
    case 'less':
      return `${field} < ${numberCode(condition.value)}`;
    case 'atLeast':
      return `${field} >= ${numberCode(condition.value)}`;
    case 'atMost':
      return `${field} <= ${numberCode(condition.value)}`;
    case 'before':
      return `new Date(${field}) < new Date(${jsString(condition.value)})`;
    case 'after':
      return `new Date(${field}) > new Date(${jsString(condition.value)})`;
    case 'inPast':
      return `new Date(${field}) <= new Date()`;
    case 'inFuture':
      return `new Date(${field}) > new Date()`;
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

function referenceId(field: string): string {
  return `(${field}?.id ?? ${field})`;
}

function groupedCode(code: string): string {
  const trimmed = code.trim();
  assert(trimmed.length > 0, 'Grouped code is not empty');
  return /\|\||&&|\?/.test(trimmed) ? `(${trimmed})` : trimmed;
}

function sortStepCode(query: LoopQuery, itemPath: readonly string[], method: 'sort' | 'toSorted'): string {
  const comparator = sortFunctionCode(query, itemPath);
  return comparator === undefined ? '' : `.${method}(${comparator})`;
}

export function sortFunctionCode(query: LoopQuery, itemPath: readonly string[]): string | undefined {
  if (query.random) {
    return '() => Math.random() - 0.5';
  }
  if (query.customSort !== undefined) {
    return query.customSort.trim();
  }
  return query.sorts.length > 0 ? astroComparatorCode(query.sorts, itemPath) : undefined;
}

export function astroComparatorCode(sorts: readonly LoopSort[], itemPath: readonly string[] = ['data']): string {
  assert(sorts.length > 0, 'A comparator compares by at least one key');
  const keys = sorts.map((sort) => {
    const [first, second] = sort.direction === 'ascending' ? ['a', 'b'] : ['b', 'a'];
    return comparison(sort, [first, ...itemPath].join('.'), [second, ...itemPath].join('.'));
  });
  const code = `(a, b) => ${keys.join(' || ')}`;
  assert(code.includes('=>'), 'A comparator is a function');
  return code;
}

function comparison(sort: LoopSort, left: string, right: string): string {
  const leftValue = fieldAccess(left, sort.field);
  const rightValue = fieldAccess(right, sort.field);
  switch (sort.order) {
    case 'text':
      return `String(${leftValue} ?? '').localeCompare(String(${rightValue} ?? ''))`;
    case 'number':
      return `(${leftValue} ?? 0) - (${rightValue} ?? 0)`;
    case 'date':
      return `new Date(${leftValue}).valueOf() - new Date(${rightValue}).valueOf()`;
    case 'boolean':
      return `Number(${leftValue} === true) - Number(${rightValue} === true)`;
    case 'natural':
      return `String(${leftValue} ?? '').localeCompare(String(${rightValue} ?? ''), undefined, { numeric: true, sensitivity: 'base' })`;
    case 'length':
      return `String(${leftValue} ?? '').length - String(${rightValue} ?? '').length`;
    case 'count':
      return `(${leftValue}?.length ?? 0) - (${rightValue}?.length ?? 0)`;
    case 'fileSize':
      return `${fileSizeCode(leftValue)} - ${fileSizeCode(rightValue)}`;
    default: {
      const exhaustive: never = sort.order;
      return exhaustive;
    }
  }
}

function fileSizeCode(image: string): string {
  const code = `(globalThis.process?.getBuiltinModule?.('node:fs')?.statSync(${image}?.fsPath ?? '', { throwIfNoEntry: false })?.size ?? 0)`;
  assert(code.includes(image), 'A file size is read from its image');
  return code;
}

export function sliceCode(offset: number, limit: number | undefined): string {
  if (limit !== undefined) {
    return `.slice(${offset}, ${offset + limit})`;
  }
  return offset > 0 ? `.slice(${offset})` : '';
}

export function fieldAccess(base: string, path: string): string {
  assertFieldPath(path);
  if (path === ITEM_FIELD) {
    return base;
  }
  let code = base;
  for (const [index, segment] of path.split('.').entries()) {
    const step = index === 0 ? '' : '?.';
    code += /^[A-Za-z_$][\w$]*$/.test(segment) ? `${index === 0 ? '.' : step}${segment}` : `${step}[${jsString(segment)}]`;
  }
  assert(code.startsWith(base), 'A field is read from its base');
  return code;
}

function literalCode(value: LoopLiteral): string {
  switch (value.kind) {
    case 'number':
      return numberCode(value.number);
    case 'text':
      return jsString(value.text);
    case 'reference':
      return jsString(value.id);
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function numberCode(value: number): string {
  assert(Number.isFinite(value), 'Only finite numbers are written');
  return Object.is(value, -0) ? '0' : String(value);
}

export function jsString(text: string): string {
  let out = "'";
  for (const character of text) {
    out += escapedCharacter(character);
  }
  out += "'";
  assert(out.length >= 2, 'A string literal has its quotes');
  return out;
}

function escapedCharacter(character: string): string {
  switch (character) {
    case '\\':
      return '\\\\';
    case "'":
      return "\\'";
    case '\n':
      return '\\n';
    case '\r':
      return '\\r';
    case '\t':
      return '\\t';
    case ' ':
      return '\\u2028';
    case ' ':
      return '\\u2029';
    default: {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : character;
    }
  }
}


export function groqQueryText(query: LoopQuery, fields: readonly LoopField[]): string {
  assertLoopQuery(query);
  assert(query.source.kind === 'sanity', 'A GROQ query reads a Sanity type');
  const type = `_type == ${groqString(query.source.collection)}`;
  if (query.selection !== undefined) {
    const projected = query.projection ?? defaultProjection(fields);
    const ids = `[${query.selection.map(groqString).join(', ')}]`;
    return `*[${type} && _id in ${ids}]${projected === '' ? '' : ` ${projected}`}`;
  }
  const clauses = query.conditions.map(groqConditionCode);
  const joiner = query.match === 'all' ? ' && ' : ' || ';
  const narrowed = clauses.length === 0 ? '' : clauses.length === 1 || query.match === 'all' ? ` && ${clauses.join(joiner)}` : ` && (${clauses.join(joiner)})`;
  const sorted = !query.random && query.sorts.length > 0;
  const order = sorted ? ` | ${groqOrderText(query.sorts)}` : '';
  const afterFetch = query.random || query.customSort !== undefined;
  const slice = afterFetch ? '' : groqSlice(query.offset, query.limit);
  const projection = query.projection ?? defaultProjection(fields);
  const text = `*[${type}${narrowed}]${order}${slice}${projection === '' ? '' : ` ${projection}`}`;
  assert(text.startsWith('*['), 'A GROQ query starts from every document');
  return text;
}

export function sanityQueryCode(query: LoopQuery, fields: readonly LoopField[], client: string): string {
  assert(/^[A-Za-z_$][\w$]*$/.test(client), 'A client is named by an identifier');
  const fetch = `await ${client}.fetch(${jsString(groqQueryText(query, fields))})`;
  if (query.selection !== undefined) {
    const ids = idsCode(query.selection);
    return `(${fetch}).sort((a, b) => ${ids}.indexOf(a._id) - ${ids}.indexOf(b._id))`;
  }
  const afterFetch = query.random || query.customSort !== undefined;
  const code = afterFetch ? `(${fetch})${sortStepCode(query, [], 'sort')}${sliceCode(query.offset, query.limit)}` : fetch;
  assert(code.includes(`${client}.fetch(`), 'A Sanity query fetches through its client');
  return code;
}

export function groqConditionCode(condition: LoopCondition): string {
  if (condition.kind === 'custom') {
    return groupedCode(condition.code);
  }
  const field = condition.field;
  switch (condition.operator) {
    case 'is':
      return condition.value.kind === 'reference' ? `${field}._ref == ${groqString(condition.value.id)}` : `${field} == ${groqLiteral(condition.value)}`;
    case 'isNot':
      return condition.value.kind === 'reference' ? `${field}._ref != ${groqString(condition.value.id)}` : `${field} != ${groqLiteral(condition.value)}`;
    case 'contains':
      return `${field} match ${groqString(`*${condition.value}*`)}`;
    case 'has':
      return condition.value.kind === 'reference' ? `${groqString(condition.value.id)} in ${field}[]._ref` : `${groqLiteral(condition.value)} in ${field}`;
    case 'isSet':
      return `defined(${field})`;
    case 'isEmpty':
      return `!defined(${field})`;
    case 'isTrue':
      return `${field} == true`;
    case 'isFalse':
      return `${field} != true`;
    case 'greater':
      return `${field} > ${numberCode(condition.value)}`;
    case 'less':
      return `${field} < ${numberCode(condition.value)}`;
    case 'atLeast':
      return `${field} >= ${numberCode(condition.value)}`;
    case 'atMost':
      return `${field} <= ${numberCode(condition.value)}`;
    case 'before':
      return `${field} < ${groqString(condition.value)}`;
    case 'after':
      return `${field} > ${groqString(condition.value)}`;
    case 'inPast':
      return `${field} <= now()`;
    case 'inFuture':
      return `${field} > now()`;
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

export function groqFilterText(query: LoopQuery): string {
  const clauses = query.conditions.map(groqConditionCode);
  return clauses.join(query.match === 'all' ? ' && ' : ' || ');
}

export function groqOrderText(sorts: readonly LoopSort[]): string {
  return sorts.length === 0 ? '' : `order(${sorts.map((sort) => `${sort.field} ${sort.direction === 'ascending' ? 'asc' : 'desc'}`).join(', ')})`;
}

export function groqSliceText(offset: number, limit: number | undefined): string {
  return groqSlice(offset, limit).trim();
}

function groqSlice(offset: number, limit: number | undefined): string {
  if (limit !== undefined) {
    return ` [${offset}...${offset + limit}]`;
  }
  return offset > 0 ? ` [${offset}...${LOOP_QUERY_LIMITS.offsetMax + LOOP_QUERY_LIMITS.limitMax}]` : '';
}

function groqLiteral(value: LoopLiteral): string {
  switch (value.kind) {
    case 'number':
      return numberCode(value.number);
    case 'text':
      return groqString(value.text);
    case 'reference':
      return groqString(value.id);
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function groqString(text: string): string {
  const out = JSON.stringify(text);
  assert(out.startsWith('"'), 'A GROQ string is double-quoted');
  return out;
}

export function defaultProjection(fields: readonly LoopField[]): string {
  const resolved: string[] = [];
  for (const field of fields) {
    if (field.path.includes('.')) {
      continue;
    }
    const name = groqString(field.path);
    if (field.kind === 'image') {
      resolved.push(`${name}: ${field.path}.asset->url`);
    } else if (field.kind === 'reference') {
      resolved.push(`${name}: ${field.path}->`);
    }
  }
  assert(resolved.length <= fields.length, 'One projection entry per field at most');
  return resolved.length === 0 ? '' : `{ ..., ${resolved.join(', ')} }`;
}
