import { assert } from '../../../../shared/core/assert';


export interface TypedVariable {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export const TYPED_VARIABLE_CHARS_MAX = 256;

const NAME_CHARS = /^[A-Za-z0-9_-]*/;
const TYPED_BEFORE_CARET = /(?:^|[^A-Za-z0-9_-])(?:(var\(\s*)(?:--([A-Za-z0-9_-]*))?|--([A-Za-z0-9_-]*))$/;

export function typedVariableAt(value: string, caret: number): TypedVariable | undefined {
  assert(Number.isSafeInteger(caret), 'typedVariableAt: the caret is a whole offset');
  assert(caret >= 0, 'typedVariableAt: the caret is not before the value');
  if (caret > value.length) {
    return undefined;
  }
  const windowStart = Math.max(0, caret - TYPED_VARIABLE_CHARS_MAX);
  const before = value.slice(windowStart, caret);
  const match = TYPED_BEFORE_CARET.exec(before);
  if (match === null) {
    return undefined;
  }
  const opener = match[1];
  const name = opener === undefined ? (match[3] ?? '') : (match[2] ?? '');
  const fragmentLength = (opener ?? '').length + (opener === undefined || match[2] !== undefined ? 2 : 0) + name.length;
  const start = caret - fragmentLength;
  assert(start >= windowStart, 'typedVariableAt: the fragment lies inside the scanned window');
  const after = value.slice(caret);
  const rest = NAME_CHARS.exec(after)?.[0] ?? '';
  const closer = opener === undefined ? undefined : /^\s*\)/.exec(after.slice(rest.length))?.[0];
  const end = caret + rest.length + (closer ?? '').length;
  assert(end <= value.length, 'typedVariableAt: the fragment ends inside the value');
  return { start, end, query: (name + rest).toLowerCase() };
}

export function completeTypedVariable(value: string, typed: TypedVariable, binding: string): { readonly value: string; readonly caret: number } {
  assert(typed.start <= typed.end, 'completeTypedVariable: the fragment does not end before it starts');
  assert(typed.end <= value.length, 'completeTypedVariable: the fragment lies inside the value');
  const next = value.slice(0, typed.start) + binding + value.slice(typed.end);
  return { value: next, caret: typed.start + binding.length };
}

const VARIABLE_REFERENCES = /var\(\s*--[A-Za-z0-9_-]+[^)]*\)/gi;

export function replaceVariableAt(value: string, index: number, binding: string): string {
  assert(Number.isSafeInteger(index), 'replaceVariableAt: the chip index is whole');
  assert(index >= 0, 'replaceVariableAt: the chip index is not negative');
  const references = [...value.matchAll(VARIABLE_REFERENCES)];
  if (references.length === 0) {
    return binding;
  }
  const reference = references[index];
  if (reference === undefined) {
    return value;
  }
  const start = reference.index;
  return value.slice(0, start) + binding + value.slice(start + reference[0].length);
}

export function fieldOffsetOf(value: string, at: number): number {
  assert(at >= 0, 'fieldOffsetOf: the offset is not negative');
  assert(at <= value.length, 'fieldOffsetOf: the offset lies inside the value');
  let removed = 0;
  for (const reference of value.matchAll(VARIABLE_REFERENCES)) {
    const start = reference.index;
    if (start >= at) {
      break;
    }
    const end = start + reference[0].length;
    if (end <= at) {
      removed += reference[0].length - 1;
    } else {
      return start + 1 - removed;
    }
  }
  return at - removed;
}
