
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { isDateValue, isDocumentId, isFieldPath, ITEM_FIELD, LOOP_QUERY_LIMITS } from './loopQuery';
import type { LoopCondition, LoopFieldKind, LoopLiteral, LoopSource } from './loopQuery';
import { namePath, textOf, type Js } from './loopSyntax';

export type FieldKindOf = (source: LoopSource, path: string) => LoopFieldKind | undefined;

export interface ConditionContext {
  readonly source: string;
  readonly base: readonly string[];
  readonly collection: LoopSource;
  readonly fieldKind: FieldKindOf | undefined;
}

const COMPARISONS: Readonly<Record<string, 'greater' | 'less' | 'atLeast' | 'atMost'>> = { '>': 'greater', '<': 'less', '>=': 'atLeast', '<=': 'atMost' };
const MIRRORED: Readonly<Record<string, string>> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=', '===': '===', '==': '==', '!==': '!==', '!=': '!=' };

export function conditionOf(node: Js, context: ConditionContext): LoopCondition {
  const custom: LoopCondition = { kind: 'custom', code: textOf(context, node) };
  const recognised = recognisedCondition(node, context);
  return recognised ?? custom;
}

function recognisedCondition(node: Js, context: ConditionContext): LoopCondition | undefined {
  if (node.kind === 'unary' && node.operator === '!') {
    const field = fieldOf(node.value, context);
    return field !== undefined && truthyField(field, context) ? { kind: 'test', field, operator: 'isFalse' } : undefined;
  }
  const bare = fieldOf(node, context);
  if (bare !== undefined) {
    return truthyField(bare, context) ? { kind: 'test', field: bare, operator: 'isTrue' } : undefined;
  }
  if (node.kind === 'call') {
    return callCondition(node, context);
  }
  if (node.kind !== 'binary') {
    return undefined;
  }
  const leftField = valueField(node.left, context);
  const field = leftField ?? valueField(node.right, context);
  const operator = leftField !== undefined ? node.operator : MIRRORED[node.operator];
  const other = leftField !== undefined ? node.right : node.left;
  if (field === undefined || operator === undefined) {
    return undefined;
  }
  return binaryCondition(field, operator, other, context);
}

interface FieldValue {
  readonly path: string;
  readonly date: boolean;
  readonly referenceId: boolean;
}

function valueField(node: Js, context: ConditionContext): FieldValue | undefined {
  let current = node;
  let date = false;
  for (let depth = 0; depth < 4; depth++) {
    if (current.kind === 'new' && isName(current.callee, 'Date') && current.args.length === 1 && current.args[0]) {
      date = true;
      current = current.args[0];
    } else if (
      current.kind === 'call' &&
      current.callee.kind === 'member' &&
      ['valueOf', 'getTime'].includes(current.callee.property) &&
      current.args.length === 0
    ) {
      date = true;
      current = current.callee.object;
    } else {
      break;
    }
  }
  const either = referenceIdOf(current);
  if (either !== undefined) {
    const field = relativeField(either, context.base, itemSelf(context));
    return field === undefined || date ? undefined : { path: field, date, referenceId: true };
  }
  const path = namePath(current);
  if (path === undefined) {
    return undefined;
  }
  const field = relativeField(path, context.base, itemSelf(context));
  if (field === undefined) {
    return undefined;
  }
  if (field.endsWith('.id') && context.fieldKind?.(context.collection, field.slice(0, -3)) === 'reference') {
    return { path: field.slice(0, -3), date, referenceId: true };
  }
  return { path: field, date, referenceId: false };
}

function referenceIdOf(node: Js): readonly string[] | undefined {
  if (node.kind !== 'binary' || node.operator !== '??') {
    return undefined;
  }
  const left = namePath(node.left);
  const right = namePath(node.right);
  if (left === undefined || right === undefined || left[left.length - 1] !== 'id' || left.length !== right.length + 1) {
    return undefined;
  }
  return right.every((segment, index) => left[index] === segment) ? right : undefined;
}

function fieldOf(node: Js, context: ConditionContext): string | undefined {
  const path = namePath(node);
  return path === undefined ? undefined : relativeField(path, context.base, itemSelf(context));
}

export type ItemSelf = 'field' | 'not-field';

function itemSelf(context: ConditionContext): ItemSelf {
  return context.collection.kind === 'list' ? 'field' : 'not-field';
}

export function relativeField(path: readonly string[], base: readonly string[], self: ItemSelf): string | undefined {
  if (path.length < base.length || base.some((segment, index) => path[index] !== segment)) {
    return undefined;
  }
  if (path.length === base.length) {
    assert(
      path.every((segment, index) => segment === base[index]),
      'A whole item is its base',
    );
    return self === 'field' ? ITEM_FIELD : undefined;
  }
  const field = path.slice(base.length).join('.');
  return isFieldPath(field) && field !== ITEM_FIELD ? field : undefined;
}

function truthyField(field: string, context: ConditionContext): boolean {
  const kind = context.fieldKind?.(context.collection, field);
  return kind === undefined || kind === 'boolean';
}

function binaryCondition(field: FieldValue, operator: string, other: Js, context: ConditionContext): LoopCondition | undefined {
  const equality = operator === '===' || operator === '==' ? 'is' : operator === '!==' || operator === '!=' ? 'isNot' : undefined;
  if (equality !== undefined) {
    return equalityCondition(field, equality, operator, other, context);
  }
  const comparison = COMPARISONS[operator];
  if (comparison === undefined) {
    return undefined;
  }
  if (isNow(other) || (other.kind === 'string' && /^0 days? in the (?:past|future)$/i.test(other.value.trim()))) {
    return comparison === 'less' || comparison === 'atMost'
      ? { kind: 'test', field: field.path, operator: 'inPast' }
      : { kind: 'test', field: field.path, operator: 'inFuture' };
  }
  const date = dateLiteral(other);
  if (date !== undefined) {
    if (comparison === 'less') {
      return { kind: 'test', field: field.path, operator: 'before', value: date };
    }
    return comparison === 'greater' ? { kind: 'test', field: field.path, operator: 'after', value: date } : undefined;
  }
  return other.kind === 'number' && !field.date ? { kind: 'test', field: field.path, operator: comparison, value: other.value } : undefined;
}

function equalityCondition(field: FieldValue, equality: 'is' | 'isNot', operator: string, other: Js, context: ConditionContext): LoopCondition | undefined {
  if (field.date) {
    return undefined;
  }
  const loose = operator === '==' || operator === '!=';
  if ((other.kind === 'name' && other.name === 'undefined' && loose) || (other.kind === 'null' && loose)) {
    return { kind: 'test', field: field.path, operator: equality === 'is' ? 'isEmpty' : 'isSet' };
  }
  if (other.kind === 'boolean') {
    if (!other.value) {
      return undefined;
    }
    return { kind: 'test', field: field.path, operator: equality === 'is' ? 'isTrue' : 'isFalse' };
  }
  const literal = literalOf(other, field, context);
  return literal === undefined ? undefined : { kind: 'test', field: field.path, operator: equality, value: literal };
}

function literalOf(node: Js, field: FieldValue, context: ConditionContext): LoopLiteral | undefined {
  if (node.kind === 'number') {
    return field.referenceId ? undefined : { kind: 'number', number: node.value };
  }
  if (node.kind !== 'string' || node.value.length > LOOP_QUERY_LIMITS.valueCharsMax) {
    return undefined;
  }
  if (field.referenceId) {
    return isDocumentId(node.value) ? { kind: 'reference', id: node.value } : undefined;
  }
  assert(context.base.length > 0, 'A literal is compared with a field under a base');
  return { kind: 'text', text: node.value };
}

function callCondition(node: Extract<Js, { readonly kind: 'call' }>, context: ConditionContext): LoopCondition | undefined {
  if (node.callee.kind !== 'member' || node.args.length !== 1) {
    return undefined;
  }
  const method = node.callee.property;
  const argument = node.args[0];
  const target = unwrapFallback(node.callee.object);
  if (method === 'some' && argument?.kind === 'function') {
    return someReference(target, argument, context);
  }
  if (method !== 'includes' || argument === undefined) {
    return undefined;
  }
  const lowered = target.kind === 'call' && target.callee.kind === 'member' && target.callee.property === 'toLowerCase' && target.args.length === 0;
  const text = unwrapString(lowered && target.callee.kind === 'member' ? target.callee.object : target);
  const field = fieldOf(text, context);
  if (field === undefined) {
    return undefined;
  }
  const kind = context.fieldKind?.(context.collection, field);
  if (kind === 'list') {
    if (argument.kind === 'string') {
      return { kind: 'test', field, operator: 'has', value: { kind: 'text', text: argument.value } };
    }
    return argument.kind === 'number' ? { kind: 'test', field, operator: 'has', value: { kind: 'number', number: argument.value } } : undefined;
  }
  if (argument.kind !== 'string' || argument.value === '' || argument.value.length > LOOP_QUERY_LIMITS.valueCharsMax) {
    return undefined;
  }
  return { kind: 'test', field, operator: 'contains', value: argument.value };
}

function someReference(target: Js, callback: Extract<Js, { readonly kind: 'function' }>, context: ConditionContext): LoopCondition | undefined {
  const field = fieldOf(target, context);
  const parameter = callback.parameters[0];
  const body = callback.body;
  if (field === undefined || parameter?.kind !== 'name' || body?.kind !== 'binary' || (body.operator !== '===' && body.operator !== '==')) {
    return undefined;
  }
  const plain = namePath(body.left);
  const path = referenceIdOf(body.left) ?? (plain?.[plain.length - 1] === 'id' ? plain.slice(0, -1) : undefined);
  const id = body.right;
  const named = path?.length === 1 && path[0] === parameter.name;
  if (!named || id.kind !== 'string' || !isDocumentId(id.value)) {
    return undefined;
  }
  return { kind: 'test', field, operator: 'has', value: { kind: 'reference', id: id.value } };
}

function unwrapFallback(node: Js): Js {
  if (node.kind === 'binary' && (node.operator === '??' || node.operator === '||')) {
    return node.left;
  }
  return node;
}

function unwrapString(node: Js): Js {
  if (node.kind === 'call' && isName(node.callee, 'String') && node.args.length === 1 && node.args[0]) {
    return unwrapFallback(node.args[0]);
  }
  return unwrapFallback(node);
}

export function isName(node: Js, name: string): boolean {
  return node.kind === 'name' && node.name === name;
}

function isNow(node: Js): boolean {
  if (node.kind === 'new') {
    return isName(node.callee, 'Date') && node.args.length === 0;
  }
  return node.kind === 'call' && node.args.length === 0 && namePath(node.callee)?.join('.') === 'Date.now';
}

function dateLiteral(node: Js): string | undefined {
  const inner = node.kind === 'new' && isName(node.callee, 'Date') && node.args.length === 1 ? node.args[0] : node;
  if (inner?.kind !== 'string') {
    return undefined;
  }
  const day = inner.value.slice(0, 10);
  return isDateValue(day) ? day : undefined;
}

export function chainOf(node: Js, operator: '&&' | '||'): readonly Js[] {
  const out: Js[] = [];
  const pending: Js[] = [node];
  for (let count = 0; pending.length > 0 && count < LIMITS.treeNodesMax; count++) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    if (current.kind === 'binary' && current.operator === operator) {
      pending.push(current.right, current.left);
    } else {
      out.push(current);
    }
  }
  return out;
}
