
import { assert } from '../../../shared/core/assert';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import { LIMITS } from '../../../shared/core/limits';
import type { Attr } from '../../../shared/page/pageNode';
import type { SchemaField } from '../../editor/dataScope';
import { readPropsDestructure } from '../../editor/loopProps';
import {
  CONDITIONAL_LIMITS,
  conditionalAttr,
  isReferencePath,
  parseConditionalValue,
  readConditionalExpression,
  sameLiteral,
  type Condition,
  type ConditionLiteral,
  type PropCondition,
  type ReadOptions,
  type ConditionalResult,
  type ConditionalValue,
  type GroupMatch,
  type TemplatePart,
  type WriteOptions,
  type ClassListValue,
  CLASS_LIST_LIMITS,
  emitClassListExpression,
  parseClassListValue,
  isConditionalShaped,
  quoteOf,
  readConditionTest,
  readClassListExpression,
} from '../../editor/conditionalValue';
import { titled } from './loopCatalog';

export type ConditionPropKind = 'option' | 'switch' | 'text' | 'number';

export interface ConditionProp {
  readonly name: string;
  readonly label: string;
  readonly kind: ConditionPropKind;
  readonly options: readonly string[];
  readonly computed?: ComputedDefinition | undefined;
}

export interface ComputedDefinition {
  readonly code: string;
  readonly equivalent: Condition | undefined;
}

export type ConditionReach = 'props' | 'template';

const COMPUTED_LOCALS_MAX = 64;
const CONST_LINE = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+?)\s*;?\s*$/;

export type ConditionSchemaField = Pick<SchemaField, 'name' | 'type' | 'options'>;

export function conditionProps(frontmatter: string, schema: readonly ConditionSchemaField[], reach: ConditionReach = 'props'): readonly ConditionProp[] {
  assert(schema.length <= LIMITS.propSchemaFieldsMax, 'conditionProps: the schema is bounded');
  const entries = readPropsDestructure(frontmatter)?.entries ?? [];
  const out: ConditionProp[] = [];
  const seen = new Set<string>();
  const add = (key: string, local: string): void => {
    const field = schema.find((candidate) => candidate.name === key);
    const kind = kindOf(field);
    if (kind === undefined || seen.has(local) || !isReferencePath(local)) {
      return;
    }
    seen.add(local);
    out.push({ name: local, label: titled(local), kind, options: kind === 'option' ? (field?.options ?? []) : [] });
  };
  for (const entry of entries) {
    add(entry.key, entry.local);
  }
  const aliased = new Set(entries.map((entry) => entry.key));
  for (const field of schema) {
    if (!aliased.has(field.name)) {
      add(field.name, field.name);
    }
  }
  assert(out.length <= entries.length + schema.length, 'conditionProps: one entry per prop at most');
  return reach === 'template' ? [...out, ...computedLocals(frontmatter, out)] : out;
}

export function computedLocals(frontmatter: string, props: readonly ConditionProp[]): readonly ConditionProp[] {
  const out: ConditionProp[] = [];
  for (const line of frontmatter.split('\n')) {
    if (out.length === COMPUTED_LOCALS_MAX) {
      break;
    }
    const match = CONST_LINE.exec(line);
    const name = match?.[1];
    const code = match?.[2];
    if (name === undefined || code === undefined || props.some((prop) => prop.name === name) || !isReferencePath(name)) {
      continue;
    }
    const test = readConditionTest(code);
    if (test === undefined || !test.conditions.some((condition) => condition.kind === 'compare' || condition.operator === 'falsy')) {
      continue;
    }
    out.push({ name, label: titled(name), kind: 'switch', options: [], computed: { code, equivalent: equivalentOf(test, props) } });
  }
  assert(out.length <= COMPUTED_LOCALS_MAX, 'computedLocals: the values are bounded');
  return out;
}

function equivalentOf(test: { readonly match: GroupMatch; readonly conditions: readonly Condition[] }, props: readonly ConditionProp[]): Condition | undefined {
  const [first] = test.conditions;
  if (first === undefined || first.kind === 'code' || !props.some((prop) => prop.name === first.subject && prop.computed === undefined)) {
    return undefined;
  }
  if (test.conditions.length === 1) {
    return first;
  }
  const operator = test.match === 'any' ? 'in' : 'notIn';
  const values: ConditionLiteral[] = [];
  for (const condition of test.conditions) {
    if (condition.kind !== 'compare' || condition.subject !== first.subject || condition.operator !== operator) {
      return undefined;
    }
    for (const value of condition.values) {
      if (!values.some((known) => sameLiteral(known, value)) && values.length < CONDITIONAL_LIMITS.valuesPerConditionMax) {
        values.push(value);
      }
    }
  }
  assert(values.length > 0, 'equivalentOf: a list of comparisons has values');
  return { kind: 'compare', subject: first.subject, operator, values };
}

export function negatedCondition(condition: Condition): Condition | undefined {
  switch (condition.kind) {
    case 'test':
      return { ...condition, operator: condition.operator === 'truthy' ? 'falsy' : 'truthy' };
    case 'compare':
      return { ...condition, operator: condition.operator === 'in' ? 'notIn' : 'in' };
    case 'code':
      return undefined;
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

export function plainerCondition(condition: ConditionDraft, catalog: readonly ConditionProp[]): ConditionDraft | undefined {
  const entry = condition.subject === undefined ? undefined : catalog.find((prop) => prop.name === condition.subject);
  const equivalent = entry?.computed?.equivalent;
  if (equivalent === undefined || condition.code !== undefined) {
    return undefined;
  }
  const meant = condition.operator === 'falsy' ? negatedCondition(equivalent) : condition.operator === 'truthy' ? equivalent : undefined;
  return meant === undefined ? undefined : conditionDraftOf(meant);
}

export function presentedModel(model: ConditionalValue): ConditionalValue {
  const [only] = model.groups;
  if (model.groups.length !== 1 || only === undefined || only.value.kind !== 'none' || model.otherwise.kind === 'none') {
    return model;
  }
  const negated: Condition[] = [];
  for (const condition of only.conditions) {
    const flipped = negatedCondition(condition);
    if (flipped === undefined) {
      return model;
    }
    negated.push(flipped);
  }
  const match: GroupMatch = only.conditions.length === 1 ? 'all' : only.match === 'all' ? 'any' : 'all';
  const presented = { groups: [{ match, conditions: negated, value: model.otherwise }], otherwise: only.value };
  const parsed = parseConditionalValue(presented);
  assert(parsed.ok, 'presentedModel: the flipped model is a valid model');
  return parsed.value;
}

export function draftUnchanged(draft: ConditionalDraft, opened: ConditionalDraft): boolean {
  return JSON.stringify(draft) === JSON.stringify(opened);
}

function kindOf(field: ConditionSchemaField | undefined): ConditionPropKind | undefined {
  const type = field?.type;
  if (type === undefined || type === 'string' || type === 'text' || type === 'prop' || type === 'other') {
    return 'text';
  }
  if (type === 'boolean') {
    return 'switch';
  }
  if (type === 'number') {
    return 'number';
  }
  if (type === 'enum') {
    return (field?.options?.length ?? 0) > 0 ? 'option' : 'text';
  }
  return undefined;
}

export function propOf(catalog: readonly ConditionProp[], subject: string): ConditionProp {
  const found = catalog.find((prop) => prop.name === subject);
  return found ?? { name: subject, label: titled(subject), kind: 'text', options: [] };
}


export type DraftOperator = PropCondition['operator'];

export function matchOptions(translate: Translator = ENGLISH_TRANSLATE): readonly { readonly value: GroupMatch; readonly label: string }[] {
  return [
    { value: 'all', label: translate('props.conditional.match.all') },
    { value: 'any', label: translate('props.conditional.match.any') },
  ];
}

export function operatorsFor(
  kind: ConditionPropKind,
  translate: Translator = ENGLISH_TRANSLATE,
): readonly { readonly value: DraftOperator; readonly label: string }[] {
  switch (kind) {
    case 'option':
      return [
        { value: 'in', label: translate('props.conditional.operator.isAny') },
        { value: 'notIn', label: translate('props.conditional.operator.isNotAny') },
        { value: 'truthy', label: translate('props.conditional.operator.isSet') },
        { value: 'falsy', label: translate('props.conditional.operator.isEmpty') },
      ];
    case 'switch':
      return [
        { value: 'truthy', label: translate('props.conditional.operator.isTrue') },
        { value: 'falsy', label: translate('props.conditional.operator.isFalse') },
      ];
    case 'text':
    case 'number':
      return [
        { value: 'in', label: translate('props.conditional.operator.equals') },
        { value: 'notIn', label: translate('props.conditional.operator.notEquals') },
        { value: 'truthy', label: translate('props.conditional.operator.isSet') },
        { value: 'falsy', label: translate('props.conditional.operator.isEmpty') },
      ];
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function takesValues(operator: DraftOperator): boolean {
  return operator === 'in' || operator === 'notIn';
}


export interface ConditionDraft {
  readonly subject: string | undefined;
  readonly operator: DraftOperator;
  readonly values: readonly ConditionLiteral[];
  readonly code?: string | undefined;
}

export function conditionDraftOf(condition: Condition): ConditionDraft {
  switch (condition.kind) {
    case 'code':
      return { subject: undefined, operator: 'truthy', values: [], code: condition.code };
    case 'test':
      return { subject: condition.subject, operator: condition.operator, values: [] };
    case 'compare':
      return { subject: condition.subject, operator: condition.operator, values: condition.values };
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

export interface GroupDraft {
  readonly match: GroupMatch;
  readonly conditions: readonly ConditionDraft[];
  readonly value: ConditionalResult;
}

export interface ConditionalDraft {
  readonly groups: readonly GroupDraft[];
  readonly otherwise: ConditionalResult;
}

export function draftOf(model: ConditionalValue): ConditionalDraft {
  return {
    otherwise: model.otherwise,
    groups: model.groups.map((group) => ({
      match: group.match,
      value: group.value,
      conditions: group.conditions.map(conditionDraftOf),
    })),
  };
}

export function modelOf(draft: ConditionalDraft): ConditionalValue {
  assert(draft.groups.length <= CONDITIONAL_LIMITS.groupsMax, 'modelOf: the groups are bounded');
  const groups = draft.groups
    .map((group) => ({ match: group.match, value: group.value, conditions: group.conditions.flatMap((condition) => completed(condition)) }))
    .filter((group) => group.conditions.length > 0);
  const parsed = parseConditionalValue({ groups, otherwise: draft.otherwise });
  assert(parsed.ok, `modelOf: a finished draft is a valid model (${parsed.ok ? '' : parsed.error})`);
  return parsed.value;
}

function completed(condition: ConditionDraft): readonly Condition[] {
  if (condition.code !== undefined) {
    return [{ kind: 'code', code: condition.code }];
  }
  const subject = condition.subject;
  if (subject === undefined) {
    return [];
  }
  switch (condition.operator) {
    case 'truthy':
    case 'falsy':
      return [{ kind: 'test', subject, operator: condition.operator }];
    case 'in':
    case 'notIn':
      return condition.values.length === 0 ? [] : [{ kind: 'compare', subject, operator: condition.operator, values: condition.values }];
    default: {
      const exhaustive: never = condition.operator;
      return exhaustive;
    }
  }
}

export function newCondition(catalog: readonly ConditionProp[]): ConditionDraft {
  const [first] = catalog;
  const [operator] = operatorsFor(first?.kind ?? 'text');
  assert(operator !== undefined, 'newCondition: every kind has an operator');
  return { subject: first?.name, operator: operator.value, values: [] };
}

export function newGroup(catalog: readonly ConditionProp[]): GroupDraft {
  return { match: 'all', conditions: [newCondition(catalog)], value: { kind: 'none', word: 'undefined' } };
}

export function withGroupAdded(draft: ConditionalDraft, catalog: readonly ConditionProp[]): ConditionalDraft {
  if (draft.groups.length >= CONDITIONAL_LIMITS.groupsMax) {
    return draft;
  }
  const next = { ...draft, groups: [...draft.groups, newGroup(catalog)] };
  assert(next.groups.length <= CONDITIONAL_LIMITS.groupsMax, 'withGroupAdded: the groups stay bounded');
  return next;
}

export function withGroupMoved(draft: ConditionalDraft, source: number, target: number): ConditionalDraft {
  assert(source >= 0, 'withGroupMoved: a moved group has a place');
  assert(source < draft.groups.length, 'withGroupMoved: the moved group exists');
  assert(target >= 0, 'withGroupMoved: a drop slot has a place');
  assert(target <= draft.groups.length, 'withGroupMoved: the drop slot is inside the list');
  const groups = [...draft.groups];
  const [group] = groups.splice(source, 1);
  assert(group !== undefined, 'withGroupMoved: the group was taken out');
  groups.splice(target > source ? target - 1 : target, 0, group);
  return { ...draft, groups };
}

export function withGroupRemoved(draft: ConditionalDraft, groupIndex: number): ConditionalDraft {
  assert(groupIndex >= 0, 'withGroupRemoved: an index is never negative');
  assert(groupIndex < draft.groups.length, 'withGroupRemoved: the group exists');
  return { ...draft, groups: draft.groups.filter((_, index) => index !== groupIndex) };
}

export function withGroup(draft: ConditionalDraft, groupIndex: number, change: (group: GroupDraft) => GroupDraft): ConditionalDraft {
  assert(groupIndex >= 0, 'withGroup: an index is never negative');
  assert(groupIndex < draft.groups.length, 'withGroup: the group exists');
  return { ...draft, groups: draft.groups.map((group, index) => (index === groupIndex ? change(group) : group)) };
}

export function withConditionAdded(group: GroupDraft, catalog: readonly ConditionProp[]): GroupDraft {
  if (group.conditions.length >= CONDITIONAL_LIMITS.conditionsPerGroupMax) {
    return group;
  }
  return { ...group, conditions: [...group.conditions, newCondition(catalog)] };
}

export function withConditionRemoved(group: GroupDraft, conditionIndex: number): GroupDraft {
  assert(conditionIndex >= 0, 'withConditionRemoved: an index is never negative');
  assert(conditionIndex < group.conditions.length, 'withConditionRemoved: the condition exists');
  return { ...group, conditions: group.conditions.filter((_, index) => index !== conditionIndex) };
}

export function withCondition(group: GroupDraft, conditionIndex: number, condition: ConditionDraft): GroupDraft {
  assert(conditionIndex >= 0, 'withCondition: an index is never negative');
  assert(conditionIndex < group.conditions.length, 'withCondition: the condition exists');
  return { ...group, conditions: group.conditions.map((current, index) => (index === conditionIndex ? condition : current)) };
}

export function withSubject(condition: ConditionDraft, catalog: readonly ConditionProp[], subject: string): ConditionDraft {
  const before = condition.subject === undefined ? undefined : propOf(catalog, condition.subject);
  const after = propOf(catalog, subject);
  const offered = operatorsFor(after.kind);
  const [first] = offered;
  assert(first !== undefined, 'withSubject: every kind has an operator');
  const operator = offered.some((option) => option.value === condition.operator) ? condition.operator : first.value;
  const values = before?.kind === after.kind && takesValues(operator) ? condition.values : [];
  return { subject, operator, values };
}

export function withValueAdded(condition: ConditionDraft, value: ConditionLiteral): ConditionDraft {
  if (condition.values.some((current) => sameLiteral(current, value))) {
    return condition;
  }
  if (condition.values.length >= CONDITIONAL_LIMITS.valuesPerConditionMax) {
    return condition;
  }
  return { ...condition, values: [...condition.values, value] };
}

export function literalOfInput(kind: ConditionPropKind, text: string): ConditionLiteral | undefined {
  const trimmed = text.trim();
  if (kind !== 'number') {
    return text.length === 0 || text.length > LIMITS.attrCharsMax ? undefined : { kind: 'string', value: text };
  }
  if (trimmed === '') {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? { kind: 'number', value } : undefined;
}


export const ATTRIBUTE_READING: ReadOptions = { shapes: 'rich' };

export function conditionalOfAttr(value: Attr | undefined): ConditionalValue | undefined {
  return value?.type === 'expr' ? readConditionalExpression(value.value, ATTRIBUTE_READING) : undefined;
}

export function computedOfAttr(value: Attr | undefined): string | undefined {
  if (value?.type !== 'expr') {
    return undefined;
  }
  const code = value.value.trim();
  if (!isConditionalShaped(code) || readConditionalExpression(code, ATTRIBUTE_READING) !== undefined || readClassListExpression(code) !== undefined) {
    return undefined;
  }
  return code;
}

export function resultOfAttr(value: Attr | undefined, options: ReadOptions = { shapes: 'plain' }): ConditionalResult | undefined {
  if (value === undefined) {
    return { kind: 'none', word: 'undefined' };
  }
  if (value.type === 'bare') {
    return { kind: 'text', text: '' };
  }
  switch (value.type) {
    case 'string':
      return { kind: 'text', text: value.value };
    case 'expr':
      return resultOfCode(value.value.trim(), options);
    case 'spread':
      return undefined;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function resultOfCode(code: string, options: ReadOptions): ConditionalResult | undefined {
  if (code === '') {
    return { kind: 'text', text: '' };
  }
  const read = readConditionalExpression(`x ? ${code} : ''`, options);
  const [only] = read?.groups ?? [];
  return read?.groups.length === 1 ? only?.value : undefined;
}

export function startingConditional(value: Attr | undefined, catalog: readonly ConditionProp[]): ConditionalDraft | undefined {
  const existing = conditionalOfAttr(value);
  if (existing !== undefined) {
    return draftOf(presentedModel(existing));
  }
  const current = resultOfAttr(value, ATTRIBUTE_READING);
  if (current === undefined) {
    return undefined;
  }
  return { groups: [{ ...newGroup(catalog), value: current }], otherwise: { kind: 'none', word: 'undefined' } };
}

export type AppliedValue = { readonly kind: 'unchanged' } | { readonly kind: 'write'; readonly value: Attr | undefined };

export function appliedAttr(draft: ConditionalDraft, before: Attr | undefined, options: WriteOptions = { quote: "'" }): AppliedValue {
  const next = conditionalAttr(modelOf(draft), options);
  return sameAttr(next, before) ? { kind: 'unchanged' } : { kind: 'write', value: next };
}

export function appliedStart(draft: ConditionalDraft, before: Attr | undefined, options: WriteOptions = { quote: "'" }): AppliedValue {
  return modelOf(draft).groups.length === 0 ? { kind: 'unchanged' } : appliedAttr(draft, before, options);
}

export function writeOptionsFor(before: Attr | undefined, frontmatter: string): WriteOptions {
  const own = before?.type === 'expr' ? quoteOf(before.value) : undefined;
  return { quote: own ?? quoteOf(frontmatter) ?? "'" };
}

export function attrOfResult(result: ConditionalResult): Attr | undefined {
  return conditionalAttr({ groups: [], otherwise: result });
}

function sameAttr(left: Attr | undefined, right: Attr | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.type === 'bare' || right.type === 'bare') {
    return left.type === right.type;
  }
  return left.type === right.type && left.value.trim() === right.value.trim();
}


export interface SummaryLine {
  readonly heading: string;
  readonly bullets: readonly string[];
  readonly value: ConditionalResult;
}

export function summaryLines(model: ConditionalValue, catalog: readonly ConditionProp[], translate: Translator = ENGLISH_TRANSLATE): readonly SummaryLine[] {
  const lines: SummaryLine[] = model.groups.map((group) => {
    const words = group.conditions.map((condition) => conditionWords(condition, catalog, translate));
    const [only] = words;
    if (words.length === 1 && only !== undefined) {
      return { heading: translate('props.conditional.summary.if', { condition: only }), bullets: [], value: group.value };
    }
    return {
      heading: group.match === 'all' ? translate('props.conditional.summary.allTrue') : translate('props.conditional.summary.anyTrue'),
      bullets: words,
      value: group.value,
    };
  });
  lines.push({ heading: translate('props.conditional.summary.else'), bullets: [], value: model.otherwise });
  assert(lines.length === model.groups.length + 1, 'summaryLines: one line per group and the Else');
  return lines;
}

export function conditionWords(condition: Condition, catalog: readonly ConditionProp[], translate: Translator = ENGLISH_TRANSLATE): string {
  if (condition.kind === 'code') {
    return condition.code;
  }
  const prop = propOf(catalog, condition.subject);
  switch (condition.kind) {
    case 'test':
      if (condition.operator === 'truthy') {
        return translate(prop.kind === 'switch' ? 'props.conditional.words.isTrue' : 'props.conditional.words.isSet', { subject: prop.label });
      }
      return translate(prop.kind === 'switch' ? 'props.conditional.words.isFalse' : 'props.conditional.words.isEmpty', { subject: prop.label });
    case 'compare': {
      const values = condition.values.map((value) => literalWords(value, prop.kind));
      const [only] = values;
      if (values.length === 1 && only !== undefined) {
        return translate(condition.operator === 'in' ? 'props.conditional.words.equals' : 'props.conditional.words.notEquals', {
          subject: prop.label,
          value: only,
        });
      }
      return translate(condition.operator === 'in' ? 'props.conditional.words.isAnyOf' : 'props.conditional.words.isNoneOf', {
        subject: prop.label,
        values: values.join(', '),
      });
    }
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

export type ValueLanguage = 'text' | 'css';

export function valueLanguageOf(name: string): ValueLanguage {
  return name.trim().toLowerCase() === 'style' ? 'css' : 'text';
}

export function bodyOfResult(result: ConditionalResult): string {
  switch (result.kind) {
    case 'text':
      return result.text;
    case 'reference':
      return `\${${result.path}}`;
    case 'template':
      return result.parts.map((part) => (part.kind === 'text' ? part.text : `\${${part.path}}`)).join('');
    case 'none':
      return '';
    case 'lookup':
    case 'computed':
    case 'fallback':
      return `\${${resultWords(result)}}`;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

const HOLE = /\$\{([^{}]*)\}/g;

export function resultOfBody(body: string): ConditionalResult | undefined {
  if (body.length > LIMITS.attrCharsMax) {
    return undefined;
  }
  const parts: TemplatePart[] = [];
  let at = 0;
  for (const match of body.matchAll(HOLE)) {
    const path = (match[1] ?? '').trim();
    if (!isReferencePath(path) || parts.length + 2 > CONDITIONAL_LIMITS.templatePartsMax) {
      return undefined;
    }
    if (match.index > at) {
      parts.push({ kind: 'text', text: body.slice(at, match.index) });
    }
    parts.push({ kind: 'reference', path });
    at = match.index + match[0].length;
  }
  if (at < body.length) {
    parts.push({ kind: 'text', text: body.slice(at) });
  }
  if (!parts.some((part) => part.kind === 'reference')) {
    return { kind: 'text', text: body };
  }
  const parsed = parseConditionalValue({ groups: [], otherwise: { kind: 'template', parts } });
  return parsed.ok ? parsed.value.otherwise : undefined;
}

export function resultWords(result: ConditionalResult): string {
  switch (result.kind) {
    case 'text':
      return result.text;
    case 'reference':
      return `{${result.path}}`;
    case 'template':
      return result.parts.map((part) => (part.kind === 'text' ? part.text : `{${part.path}}`)).join('');
    case 'none':
      return '(left out)';
    case 'lookup':
      return `${result.table}[${result.key}]`;
    case 'computed':
      return result.code;
    case 'fallback':
      return result.operands.map(resultWords).join(` ${result.operator} `);
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function literalWords(value: ConditionLiteral, kind: ConditionPropKind): string {
  if (value.kind === 'number') {
    return String(value.value);
  }
  return kind === 'option' ? titled(value.value) : value.value;
}


export interface ClassEntryDraft {
  readonly value: ConditionalResult;
  readonly match: GroupMatch;
  readonly when: readonly ConditionDraft[];
}

export interface ClassListDraft {
  readonly entries: readonly ClassEntryDraft[];
}

export function classListOfAttr(value: Attr | undefined): ClassListValue | undefined {
  return value?.type === 'expr' ? readClassListExpression(value.value) : undefined;
}

export function classDraftOf(model: ClassListValue): ClassListDraft {
  return {
    entries: model.entries.map((entry) => ({
      value: entry.value,
      match: entry.match,
      when: entry.when.map(conditionDraftOf),
    })),
  };
}

export function classModelOf(draft: ClassListDraft): ClassListValue {
  assert(draft.entries.length <= CLASS_LIST_LIMITS.entriesMax, 'classModelOf: the entries are bounded');
  const entries = draft.entries.flatMap((entry) =>
    entry.value.kind === 'none' || (entry.value.kind === 'text' && entry.value.text === '')
      ? []
      : [{ value: entry.value, match: entry.match, when: entry.when.flatMap((condition) => completed(condition)) }],
  );
  const parsed = parseClassListValue({ entries });
  assert(parsed.ok, `classModelOf: a finished draft is a valid class list (${parsed.ok ? '' : parsed.error})`);
  return parsed.value;
}

export function appliedClassList(draft: ClassListDraft, before: Attr | undefined, options: WriteOptions): AppliedValue {
  const model = classModelOf(draft);
  const next: Attr | undefined = model.entries.length === 0 ? undefined : { type: 'expr', value: emitClassListExpression(model, options) };
  return sameAttr(next, before) ? { kind: 'unchanged' } : { kind: 'write', value: next };
}

export function newClassEntry(): ClassEntryDraft {
  return { value: { kind: 'none', word: 'undefined' }, match: 'all', when: [] };
}

export function withClassEntryAdded(draft: ClassListDraft): ClassListDraft {
  if (draft.entries.length >= CLASS_LIST_LIMITS.entriesMax) {
    return draft;
  }
  return { entries: [...draft.entries, newClassEntry()] };
}

export function withClassEntry(draft: ClassListDraft, index: number, change: (entry: ClassEntryDraft) => ClassEntryDraft): ClassListDraft {
  assert(index >= 0, 'withClassEntry: an index is never negative');
  assert(index < draft.entries.length, 'withClassEntry: the entry exists');
  return { entries: draft.entries.map((entry, at) => (at === index ? change(entry) : entry)) };
}

export function withClassEntryRemoved(draft: ClassListDraft, index: number): ClassListDraft {
  assert(index >= 0, 'withClassEntryRemoved: an index is never negative');
  assert(index < draft.entries.length, 'withClassEntryRemoved: the entry exists');
  return { entries: draft.entries.filter((_, at) => at !== index) };
}

export function withClassEntryMoved(draft: ClassListDraft, source: number, target: number): ClassListDraft {
  assert(source >= 0, 'withClassEntryMoved: a moved entry has a place');
  assert(source < draft.entries.length, 'withClassEntryMoved: the moved entry exists');
  assert(target >= 0, 'withClassEntryMoved: a drop slot has a place');
  assert(target <= draft.entries.length, 'withClassEntryMoved: the drop slot is inside the list');
  const entries = [...draft.entries];
  const [entry] = entries.splice(source, 1);
  assert(entry !== undefined, 'withClassEntryMoved: the entry was taken out');
  entries.splice(target > source ? target - 1 : target, 0, entry);
  return { entries };
}

export function withWhenAdded(entry: ClassEntryDraft, catalog: readonly ConditionProp[]): ClassEntryDraft {
  if (entry.when.length >= CLASS_LIST_LIMITS.conditionsPerEntryMax) {
    return entry;
  }
  return { ...entry, when: [...entry.when, newCondition(catalog)] };
}

export function whenWords(
  when: readonly Condition[],
  match: GroupMatch,
  catalog: readonly ConditionProp[],
  translate: Translator = ENGLISH_TRANSLATE,
): string | undefined {
  if (when.length === 0) {
    return undefined;
  }
  const joinKey = match === 'all' ? 'props.conditional.joinAnd' : 'props.conditional.joinOr';
  const words = when.map((condition) => conditionWords(condition, catalog, translate));
  const joined = words.reduce((left, right) => translate(joinKey, { left, right }));
  return translate('props.conditional.when', { conditions: joined });
}
