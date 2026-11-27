
import type { Attr } from '../../../shared/page/pageNode';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { FieldDefinition } from './propRules';
import { valueFromExpr } from './propFieldModel';
import { plainTextOf, textValue } from './propLiteral';
import { optionAttr } from './propKinds';

export type NormalFieldDecision =
  { readonly kind: 'literal'; readonly value: Attr } | { readonly kind: 'replace'; readonly value: Attr | undefined } | { readonly kind: 'blocked' };

export interface NormalFieldInput {
  readonly field: FieldDefinition;
  readonly source: string;
  readonly required: boolean;
}

const NUMBER_LITERAL = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const BOOLEAN_LITERAL = /^(true|false)$/;

export function decideNormalField(input: NormalFieldInput): NormalFieldDecision {
  const source = input.source.trim();
  assert(source.length <= LIMITS.attrCharsMax, 'decideNormalField: source limit exceeded');
  assert(input.field.name.length > 0, 'decideNormalField: a field has a name');
  const kept = literalValue(input.field, source);
  if (kept !== undefined) {
    return { kind: 'literal', value: kept };
  }
  if (!input.required) {
    return { kind: 'replace', value: undefined };
  }
  const empty = requiredEmptyValue(input.field);
  return empty === undefined ? { kind: 'blocked' } : { kind: 'replace', value: empty };
}

function literalValue(field: FieldDefinition, source: string): Attr | undefined {
  const text = plainTextOf(source);
  if (text !== undefined) {
    return textValue(field, text);
  }
  const wordy = field.type === 'string' || field.type === 'other';
  if (wordy && (NUMBER_LITERAL.test(source) || BOOLEAN_LITERAL.test(source))) {
    return { type: 'string', value: source };
  }
  return valueFromExpr(field, source);
}

export function requiredEmptyValue(field: FieldDefinition): Attr | undefined {
  assert(field.name.length > 0, 'requiredEmptyValue: a field has a name');
  switch (field.type) {
    case 'string':
    case 'other':
      return { type: 'string', value: '' };
    case 'boolean':
      return { type: 'expr', value: 'false' };
    case 'number':
      return field.minExclusive === true || (field.max !== undefined && field.max < 0) ? undefined : { type: 'expr', value: String(field.min ?? 0) };
    case 'enum': {
      const first = field.options?.[0];
      return first === undefined ? undefined : optionAttr(field, first);
    }
    case 'code':
      return field.codeKind === undefined ? { type: 'expr', value: '[]' } : undefined;
    default:
      return undefined;
  }
}

export type ResetPlan =
  | { readonly kind: 'remove' }
  | { readonly kind: 'write'; readonly value: Attr }
  | { readonly kind: 'disabled'; readonly reason: 'already-default' | 'no-empty-value' };

export interface ResetInput {
  readonly field: FieldDefinition;
  readonly value: Attr | undefined;
  readonly required: boolean;
}

export function planReset(input: ResetInput): ResetPlan {
  const { field, value, required } = input;
  assert(field.name.length > 0, 'planReset: a field has a name');
  if (value === undefined) {
    return { kind: 'disabled', reason: 'already-default' };
  }
  if (!required) {
    return { kind: 'remove' };
  }
  const empty = requiredEmptyValue(field);
  if (empty === undefined) {
    return { kind: 'disabled', reason: 'no-empty-value' };
  }
  const same = empty.type !== 'bare' && value.type !== 'bare' && empty.type === value.type && empty.value === value.value;
  return same ? { kind: 'disabled', reason: 'already-default' } : { kind: 'write', value: empty };
}
