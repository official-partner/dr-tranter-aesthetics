
import { assert } from '../../../shared/core/assert';
import { err, ok, type Result } from '../../../shared/core/result';
import type { ComponentProperty } from '../../../shared/properties/propertyEditing';
import { literalOptions } from '../../../shared/properties/propertyOptions';
import type { VariantDefault, VariantDefaultEntry } from '../../../shared/properties/variantRules';
import { VARIANT_LIMITS } from '../../../shared/properties/variantRules';
import {
  CONDITIONAL_LIMITS,
  emitConditionalExpression,
  parseConditionalValue,
  readConditionalExpression,
  type Condition,
  type ConditionGroup,
  type ConditionalResult,
  type ConditionalValue,
  type WriteOptions,
} from '../../editor/conditionalValue';
import { resultOfAttr, type ConditionSchemaField } from './conditionalModel';

function optionValueOf(literal: string): string {
  const quoted = /^(["'`])(.*)\1$/s.exec(literal.trim());
  return quoted?.[2] ?? literal.trim();
}

export type TableDefault = Extract<VariantDefault, { readonly kind: 'table' }>;

const NO_VALUE: ConditionalResult = { kind: 'none', word: 'undefined' };

export function conditionSchema(properties: readonly ComponentProperty[]): readonly ConditionSchemaField[] {
  assert(properties.length <= VARIANT_LIMITS.propsMax, 'conditionSchema: the props are bounded');
  return properties.map((property): ConditionSchemaField => {
    const options = literalOptions(property.type.trim());
    if (options !== undefined && options.length > 0) {
      return { name: property.name, type: 'enum', options: options.map(optionValueOf) };
    }
    const type = property.type.trim();
    if (type === 'boolean' || type === 'number') {
      return { name: property.name, type };
    }
    return { name: property.name, type: 'string' };
  });
}

export function conditionalOfDefault(defaultValue: string): ConditionalValue | undefined {
  const code = defaultValue.trim();
  return code === '' ? undefined : readConditionalExpression(code);
}

export function defaultOfConditional(model: ConditionalValue, options: WriteOptions): string {
  if (model.groups.length > 0) {
    return emitConditionalExpression(model, options);
  }
  return entryCode(model.otherwise, options) ?? '';
}

export function tableConditional(table: TableDefault): ConditionalValue | undefined {
  assert(table.entries.length <= VARIANT_LIMITS.optionsMax, 'tableConditional: the entries are bounded');
  const groups: ConditionGroup[] = [];
  for (const entry of table.entries) {
    const read = entryModel(entry.code);
    if (read === undefined) {
      return undefined;
    }
    const key = keyCondition(table.key, entry.option);
    for (const group of read.groups) {
      if (group.match === 'any' && group.conditions.length > 1) {
        return undefined;
      }
      if (group.conditions.length + 1 > CONDITIONAL_LIMITS.conditionsPerGroupMax) {
        return undefined;
      }
      groups.push({ match: 'all', conditions: [key, ...group.conditions], value: group.value });
    }
    if (read.otherwise.kind !== 'none') {
      groups.push({ match: 'all', conditions: [key], value: read.otherwise });
    }
  }
  if (groups.length > CONDITIONAL_LIMITS.groupsMax) {
    return undefined;
  }
  const parsed = parseConditionalValue({ groups, otherwise: NO_VALUE });
  return parsed.ok ? parsed.value : undefined;
}

export function tableEntries(model: ConditionalValue, table: TableDefault, options: WriteOptions): Result<readonly VariantDefaultEntry[], 'perOption'> {
  if (model.otherwise.kind !== 'none') {
    return err('perOption');
  }
  const order: string[] = [];
  const byOption = new Map<string, { groups: ConditionGroup[]; otherwise: ConditionalResult | undefined }>();
  for (const group of model.groups) {
    const option = keyOption(group, table.key);
    if (option === undefined) {
      return err('perOption');
    }
    const slot = byOption.get(option) ?? { groups: [], otherwise: undefined };
    if (!byOption.has(option)) {
      order.push(option);
      byOption.set(option, slot);
    }
    const rest = group.conditions.slice(1);
    if (slot.otherwise !== undefined) {
      continue;
    }
    if (rest.length === 0) {
      slot.otherwise = group.value;
    } else {
      slot.groups.push({ match: 'all', conditions: rest, value: group.value });
    }
  }
  const entries: VariantDefaultEntry[] = [];
  for (const option of order) {
    const slot = byOption.get(option);
    assert(slot !== undefined, 'tableEntries: every ordered option has its groups');
    const sub: ConditionalValue = { groups: slot.groups, otherwise: slot.otherwise ?? NO_VALUE };
    const before = table.entries.find((entry) => entry.option === option);
    const same = before !== undefined && sameModel(entryModel(before.code), sub);
    const code = same ? before.code : sub.groups.length > 0 ? emitConditionalExpression(sub, options) : entryCode(sub.otherwise, options);
    if (code !== undefined) {
      entries.push({ option, code });
    }
  }
  assert(entries.length <= order.length, 'tableEntries: at most one entry per option');
  return ok(entries);
}

function entryModel(code: string): ConditionalValue | undefined {
  const chain = readConditionalExpression(code);
  if (chain !== undefined) {
    return chain;
  }
  const plain = resultOfAttr({ type: 'expr', value: code });
  return plain === undefined ? undefined : { groups: [], otherwise: plain };
}

function entryCode(result: ConditionalResult, options: WriteOptions): string | undefined {
  return result.kind === 'none' ? undefined : emitConditionalExpression({ groups: [], otherwise: result }, options);
}

function keyCondition(key: string, option: string): Condition {
  return { kind: 'compare', subject: key, operator: 'in', values: [{ kind: 'string', value: option }] };
}

function keyOption(group: ConditionGroup, key: string): string | undefined {
  const [first] = group.conditions;
  if (first === undefined || first.kind !== 'compare' || first.subject !== key || first.operator !== 'in') {
    return undefined;
  }
  if (group.match === 'any' && group.conditions.length > 1) {
    return undefined;
  }
  const [value] = first.values;
  return first.values.length === 1 && value?.kind === 'string' ? value.value : undefined;
}

function sameModel(left: ConditionalValue | undefined, right: ConditionalValue): boolean {
  return left !== undefined && JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function normalized(model: ConditionalValue): ConditionalValue {
  return {
    groups: model.groups.map((group) => ({ ...group, match: group.conditions.length === 1 ? 'all' : group.match })),
    otherwise: model.otherwise.kind === 'none' ? NO_VALUE : model.otherwise,
  };
}

export function optionDefaultStart(model: ConditionalValue, key: string, option: string): ConditionalValue {
  if (model.groups.some((group) => group.conditions.some((condition) => testsOption(condition, key, option)))) {
    return model;
  }
  if (model.groups.length >= CONDITIONAL_LIMITS.groupsMax) {
    return model;
  }
  const added: ConditionGroup = { match: 'all', conditions: [keyCondition(key, option)], value: NO_VALUE };
  const next = { ...model, groups: [...model.groups, added] };
  assert(next.groups.length <= CONDITIONAL_LIMITS.groupsMax, 'optionDefaultStart: the groups stay bounded');
  return next;
}

function testsOption(condition: Condition, key: string, option: string): boolean {
  if (condition.kind !== 'compare' || condition.subject !== key || condition.operator !== 'in') {
    return false;
  }
  return condition.values.some((value) => value.kind === 'string' && value.value === option);
}

export interface OptionTooltip {
  readonly option: string;
  readonly description: string;
}

export function tooltipConditional(controller: string, tooltips: readonly OptionTooltip[]): ConditionalValue {
  assert(tooltips.length <= VARIANT_LIMITS.optionsMax, 'tooltipConditional: the options are bounded');
  const counts = new Map<string, number>();
  for (const tooltip of tooltips) {
    counts.set(tooltip.description, (counts.get(tooltip.description) ?? 0) + 1);
  }
  const [shared] = [...counts].sort((left, right) => right[1] - left[1]);
  const base = shared !== undefined && shared[1] > 1 ? shared[0] : '';
  const groups: ConditionGroup[] = [];
  for (const description of counts.keys()) {
    if (description !== base) {
      const values = tooltips.filter((tooltip) => tooltip.description === description).map((tooltip) => ({ kind: 'string' as const, value: tooltip.option }));
      const value: ConditionalResult = description === '' ? NO_VALUE : { kind: 'text', text: description };
      groups.push({ match: 'all', conditions: [{ kind: 'compare', subject: controller, operator: 'in', values }], value });
    }
  }
  const parsed = parseConditionalValue({ groups, otherwise: base === '' ? NO_VALUE : { kind: 'text', text: base } });
  assert(parsed.ok, 'tooltipConditional: the tooltips make a valid model');
  return parsed.value;
}

export function tooltipEntries(model: ConditionalValue, controller: string, options: readonly string[]): Result<readonly OptionTooltip[], 'perOption'> {
  assert(options.length <= VARIANT_LIMITS.optionsMax, 'tooltipEntries: the options are bounded');
  const fallback = plainWords(model.otherwise);
  if (fallback === undefined) {
    return err('perOption');
  }
  const given = new Map<string, string>();
  for (const group of model.groups) {
    const option = optionsOf(group, controller);
    const text = plainWords(group.value);
    if (option === undefined || text === undefined) {
      return err('perOption');
    }
    for (const value of option) {
      if (options.includes(value) && !given.has(value)) {
        given.set(value, text);
      }
    }
  }
  const entries = options.map((option) => ({ option, description: given.get(option) ?? fallback }));
  assert(entries.length === options.length, 'tooltipEntries: one tooltip per option');
  return ok(entries);
}

function plainWords(result: ConditionalResult): string | undefined {
  if (result.kind === 'none') {
    return '';
  }
  return result.kind === 'text' ? result.text.trim() : undefined;
}

function optionsOf(group: ConditionGroup, controller: string): readonly string[] | undefined {
  const [only] = group.conditions;
  if (group.conditions.length !== 1 || only === undefined || only.kind !== 'compare' || only.operator !== 'in' || only.subject !== controller) {
    return undefined;
  }
  return only.values.flatMap((value) => (value.kind === 'string' ? [value.value] : []));
}
