
import { assert } from '../../../shared/core/assert';
import { err, ok, type Result } from '../../../shared/core/result';
import { VARIANT_LIMITS, VARIANT_RULE_STATES, type VariantGroup, type VariantRuleState, type VisibilityRule } from '../../../shared/properties/variantRules';
import { CONDITIONAL_LIMITS, parseConditionalValue, type Condition, type ConditionGroup, type ConditionalValue } from '../../editor/conditionalValue';

export interface VisibilityController {
  readonly name: string;
  readonly options: readonly string[];
  readonly kind: 'string' | 'boolean';
}

export type VisibilityProblem = { readonly kind: 'shape' } | { readonly kind: 'subject'; readonly name: string } | { readonly kind: 'combination' };

const COMBINATIONS_MAX = 4096;

const SEVERITY: Readonly<Record<VariantRuleState, number>> = { optional: 0, required: 1, forbidden: 2 };

export function visibilityConditional(rules: readonly VisibilityRule[], controllers: readonly VisibilityController[]): ConditionalValue {
  assert(rules.length <= VARIANT_LIMITS.groupsMax, 'visibilityConditional: the rules are bounded');
  const shown = showFirst(rules, controllers);
  if (shown !== undefined) {
    return shown;
  }
  const groups: ConditionGroup[] = [];
  for (const state of ['forbidden', 'required'] as const) {
    for (const rule of rules) {
      const options = rule.states.filter((entry) => entry.state === state).map((entry) => entry.option);
      const controller = controllers.find((candidate) => candidate.name === rule.controller);
      if (options.length > 0 && controller !== undefined) {
        groups.push({ match: 'all', conditions: [conditionOf(controller, options)], value: { kind: 'text', text: state } });
      }
    }
  }
  const parsed = parseConditionalValue({ groups: groups.slice(0, CONDITIONAL_LIMITS.groupsMax), otherwise: { kind: 'text', text: 'optional' } });
  assert(parsed.ok, 'visibilityConditional: the rules make a valid model');
  return parsed.value;
}

function showFirst(rules: readonly VisibilityRule[], controllers: readonly VisibilityController[]): ConditionalValue | undefined {
  const [rule] = rules;
  if (rule === undefined || rules.length !== 1) {
    return undefined;
  }
  const controller = controllers.find((candidate) => candidate.name === rule.controller);
  if (controller === undefined) {
    return undefined;
  }
  const named = rule.states.map((entry) => entry.option);
  if (named.length !== controller.options.length || !controller.options.every((option) => named.includes(option))) {
    return undefined;
  }
  if (rule.states.some((entry) => entry.state === 'required')) {
    return undefined;
  }
  const visible = rule.states.filter((entry) => entry.state === 'optional').map((entry) => entry.option);
  const hidden = rule.states.filter((entry) => entry.state === 'forbidden').map((entry) => entry.option);
  if (visible.length === 0) {
    return undefined;
  }
  if (hidden.length === 0) {
    return undefined;
  }
  assert(visible.length + hidden.length === controller.options.length, 'showFirst: every option is shown or hidden');
  const condition: Condition =
    hidden.length < visible.length && controller.kind === 'string'
      ? { kind: 'compare', subject: controller.name, operator: 'notIn', values: hidden.map((value) => ({ kind: 'string', value })) }
      : conditionOf(controller, visible);
  const parsed = parseConditionalValue({
    groups: [{ match: 'all', conditions: [condition], value: { kind: 'text', text: 'optional' } }],
    otherwise: { kind: 'text', text: 'forbidden' },
  });
  assert(parsed.ok, 'showFirst: the rule makes a valid model');
  return parsed.value;
}

export function visibilityRules(model: ConditionalValue, controllers: readonly VisibilityController[]): Result<readonly VisibilityRule[], VisibilityProblem> {
  assert(controllers.length <= VARIANT_LIMITS.propsMax, 'visibilityRules: the controllers are bounded');
  const otherwise = stateOf(model.otherwise);
  if (otherwise === undefined) {
    return err({ kind: 'shape' });
  }
  const parts: { readonly controller: VisibilityController; readonly holds: (option: string) => boolean; readonly state: VariantRuleState }[] = [];
  for (const group of model.groups) {
    const state = stateOf(group.value);
    const [condition] = group.conditions;
    if (state === undefined || condition === undefined || group.conditions.length !== 1) {
      return err({ kind: 'shape' });
    }
    if (!('subject' in condition)) {
      return err({ kind: 'shape' });
    }
    const controller = controllers.find((candidate) => candidate.name === condition.subject);
    if (controller === undefined) {
      return err({ kind: 'subject', name: condition.subject });
    }
    const holds = holdsFor(condition, controller);
    if (holds === undefined) {
      return err({ kind: 'shape' });
    }
    parts.push({ controller, holds, state });
  }
  const named = [...new Set(parts.map((part) => part.controller))];
  const ruleOf = (controller: VisibilityController, option: string): VariantRuleState =>
    parts.find((part) => part.controller === controller && part.holds(option))?.state ?? otherwise;
  const count = named.reduce((product, controller) => product * Math.max(1, controller.options.length), 1);
  if (count > COMBINATIONS_MAX) {
    return err({ kind: 'combination' });
  }
  for (let index = 0; index < count; index += 1) {
    let rest = index;
    const chosen = new Map<VisibilityController, string>();
    for (const controller of named) {
      const option = controller.options[rest % controller.options.length];
      assert(option !== undefined, 'visibilityRules: each controller has an option at each step');
      chosen.set(controller, option);
      rest = Math.floor(rest / controller.options.length);
    }
    const conditions = parts.find((part) => part.holds(chosen.get(part.controller) ?? ''))?.state ?? otherwise;
    const strictest = named.reduce<VariantRuleState>(
      (state, controller) => stricter(state, ruleOf(controller, chosen.get(controller) ?? '')),
      named.length === 0 ? otherwise : 'optional',
    );
    if (conditions !== strictest) {
      return err({ kind: 'combination' });
    }
  }
  const rules = named.map((controller) => ({
    controller: controller.name,
    states: controller.options.map((option) => ({ option, state: ruleOf(controller, option) })),
  }));
  const kept = rules.filter((rule) => rule.states.some((entry) => entry.state !== 'optional'));
  assert(kept.length <= named.length, 'visibilityRules: one rule per controller at most');
  return ok(kept);
}

export interface VisibilityDeclaration {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export function visibilityCode(declaration: VisibilityDeclaration, groups: readonly VariantGroup[]): string {
  assert(declaration.name !== '', 'visibilityCode: the prop has a name');
  assert(groups.length <= VARIANT_LIMITS.groupsMax, 'visibilityCode: the groups are bounded');
  const ruling = groups.filter((group) => group.editing.kind !== 'candidate' && group.props.includes(declaration.name));
  if (ruling.length === 0) {
    return `${memberDeclaration(declaration.name, declaration.required ? 'required' : 'optional', declaration.type)};`;
  }
  const unions = ruling.map((group) => {
    const index = group.props.indexOf(declaration.name);
    assert(index >= 0, 'visibilityCode: a ruling group names the prop');
    const members = group.options.map((option) => {
      const rule = option.rules[index];
      const key = `${group.controller}${option.fallback ? '?' : ''}: ${optionLiteral(option.value, group.optionKind)}`;
      const type = rule === undefined || rule.type === '' ? declaration.type : rule.type;
      return `  | { ${key}; ${memberDeclaration(declaration.name, rule?.state ?? 'optional', type)} }`;
    });
    return [`// By ${group.controller}`, ...members].join('\n');
  });
  return unions.join('\n\n');
}

export interface TooltipDeclaration extends VisibilityDeclaration {
  readonly description: string;
}

const COMMENT_LINES_MAX = 64;

export function tooltipCode(declaration: TooltipDeclaration, group: VariantGroup | undefined): string {
  assert(declaration.name !== '', 'tooltipCode: the prop has a name');
  if (group === undefined) {
    const own = memberDeclaration(declaration.name, declaration.required ? 'required' : 'optional', declaration.type);
    return `${documentComment(declaration.description, 'block')}${own};`;
  }
  const index = group.props.indexOf(declaration.name);
  assert(index >= 0, 'tooltipCode: the group names the prop');
  assert(group.options.length <= VARIANT_LIMITS.optionsMax, 'tooltipCode: the options are bounded');
  const members = group.options.map((option) => {
    const rule = option.rules[index];
    const state = rule?.state ?? 'optional';
    const key = `${group.controller}${option.fallback ? '?' : ''}: ${optionLiteral(option.value, group.optionKind)}`;
    const type = rule === undefined || rule.type === '' ? declaration.type : rule.type;
    const comment = state === 'forbidden' ? '' : documentComment(rule?.description ?? '', 'inline');
    return `  | { ${key}; ${comment}${memberDeclaration(declaration.name, state, type)} }`;
  });
  return [`// By ${group.controller}`, ...members].join('\n');
}

function documentComment(text: string, layout: 'block' | 'inline'): string {
  const lines = text.trim() === '' ? [] : text.trim().split('\n').slice(0, COMMENT_LINES_MAX);
  if (lines.length === 0) {
    return '';
  }
  if (layout === 'inline') {
    return `/** ${lines.map((line) => line.trim()).join(' ')} */ `;
  }
  if (lines.length === 1) {
    return `/** ${lines[0]?.trim() ?? ''} */\n`;
  }
  return ['/**', ...lines.map((line) => ` * ${line.trim()}`.trimEnd()), ' */', ''].join('\n');
}

function memberDeclaration(name: string, state: VariantRuleState, type: string): string {
  const written = type.trim() === '' ? 'unknown' : type.trim();
  switch (state) {
    case 'optional':
      return `${name}?: ${written}`;
    case 'required':
      return `${name}: ${written}`;
    case 'forbidden':
      return `${name}?: never`;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function optionLiteral(value: string, kind: VariantGroup['optionKind']): string {
  return kind === 'boolean' ? value : JSON.stringify(value);
}

export function stateOf(result: ConditionalValue['otherwise']): VariantRuleState | undefined {
  return result.kind === 'text' ? VARIANT_RULE_STATES.find((state) => state === result.text) : undefined;
}

function stricter(left: VariantRuleState, right: VariantRuleState): VariantRuleState {
  return SEVERITY[left] >= SEVERITY[right] ? left : right;
}

function conditionOf(controller: VisibilityController, options: readonly string[]): Condition {
  if (controller.kind === 'boolean' && options.length === 1) {
    return { kind: 'test', subject: controller.name, operator: options[0] === 'true' ? 'truthy' : 'falsy' };
  }
  return { kind: 'compare', subject: controller.name, operator: 'in', values: options.map((value) => ({ kind: 'string', value })) };
}

type SubjectCondition = Extract<Condition, { readonly subject: string }>;

function holdsFor(condition: SubjectCondition, controller: VisibilityController): ((option: string) => boolean) | undefined {
  if (condition.kind === 'test') {
    if (controller.kind !== 'boolean') {
      return undefined;
    }
    return condition.operator === 'truthy' ? (option) => option === 'true' : (option) => option === 'false';
  }
  const values = condition.values.map((value) => String(value.value));
  if (!values.every((value) => controller.options.includes(value))) {
    return undefined;
  }
  return condition.operator === 'in' ? (option) => values.includes(option) : (option) => !values.includes(option);
}
