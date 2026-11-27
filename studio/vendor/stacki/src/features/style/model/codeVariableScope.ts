import { assert } from '../../../../shared/core/assert';
import { typedVariableAt, type TypedVariable } from './typedVariable';
import { SLOT_MARK, slotOfMarked, type ValueSlot } from '../../../../shared/properties/valueSlot';


export type CodeVariableScope = { readonly kind: 'value'; readonly prop: string } | { readonly kind: 'declarations' };

export interface CodeTypedVariable {
  readonly typed: TypedVariable;
  readonly prop: string | undefined;
}

export const DECLARATION_CHARS_MAX = 4_096;

const PROPERTY_NAME = /^-{0,2}[a-z][a-z0-9-]*$/i;

export function codeTypedVariableAt(text: string, caret: number, scope: CodeVariableScope): CodeTypedVariable | undefined {
  assert(Number.isSafeInteger(caret), 'codeTypedVariableAt: the caret is a whole offset');
  assert(caret >= 0, 'codeTypedVariableAt: the caret is not before the text');
  const typed = typedVariableAt(text, caret);
  if (typed === undefined) {
    return undefined;
  }
  switch (scope.kind) {
    case 'value':
      return { typed, prop: scope.prop };
    case 'declarations': {
      const prop = declarationPropertyAt(text, typed);
      if (prop === undefined) {
        return undefined;
      }
      return { typed, prop: prop.startsWith('--') ? undefined : prop };
    }
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

function declarationPropertyAt(text: string, typed: TypedVariable): string | undefined {
  assert(typed.start <= typed.end, 'declarationPropertyAt: the fragment does not end before it starts');
  assert(typed.end <= text.length, 'declarationPropertyAt: the fragment lies inside the text');
  const windowStart = Math.max(0, typed.start - DECLARATION_CHARS_MAX);
  const before = text.slice(windowStart, typed.start);
  const declaration = declarationTextBefore(before);
  const colon = declaration.indexOf(':');
  if (colon < 0) {
    return undefined;
  }
  const after = text.slice(typed.end, typed.end + DECLARATION_CHARS_MAX);
  const closer = after.search(/[;{}]/);
  if (closer >= 0 && after[closer] === '{') {
    return undefined;
  }
  const property = declaration.slice(0, colon).trim().toLowerCase();
  if (PROPERTY_NAME.test(property)) {
    return property;
  }
  return undefined;
}

const DECLARATION_LINE = /^[ \t]*-{0,2}[a-z][a-z0-9-]*[ \t]*:/i;

export function declarationTextBefore(before: string): string {
  const opener = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
  const declaration = before.slice(opener + 1);
  let lineStart = declaration.length;
  for (let steps = 0; steps <= declaration.length && lineStart > 0; steps++) {
    const lineBreak = declaration.lastIndexOf('\n', lineStart - 1);
    const line = declaration.slice(lineBreak + 1);
    if (DECLARATION_LINE.test(line)) {
      assert(declaration.endsWith(line), "declarationTextBefore: the line is the declaration's tail");
      return line;
    }
    if (lineBreak < 0) {
      return declaration;
    }
    lineStart = lineBreak;
  }
  return declaration;
}

export function codeSlotAt(text: string, variable: CodeTypedVariable, scope: CodeVariableScope): ValueSlot | undefined {
  const { start, end } = variable.typed;
  assert(start <= end, 'codeSlotAt: the fragment does not end before it starts');
  assert(end <= text.length, 'codeSlotAt: the fragment lies inside the text');
  if (variable.prop === undefined) {
    return undefined;
  }
  if (scope.kind === 'value') {
    return slotOfMarked(`${text.slice(0, start)}${SLOT_MARK}${text.slice(end)}`);
  }
  const value = declarationValueAround(text, variable, SLOT_MARK);
  return value === undefined ? undefined : slotOfMarked(value);
}

export function declarationValueWith(text: string, variable: CodeTypedVariable, replacement: string): string | undefined {
  assert(replacement.length > 0, 'declarationValueWith: a replacement is never empty');
  return declarationValueAround(text, variable, replacement);
}

function declarationValueAround(text: string, variable: CodeTypedVariable, between: string): string | undefined {
  const { start, end } = variable.typed;
  assert(start <= end, 'declarationValueAround: the fragment does not end before it starts');
  assert(end <= text.length, 'declarationValueAround: the fragment lies inside the text');
  const before = text.slice(Math.max(0, start - DECLARATION_CHARS_MAX), start);
  const declaration = declarationTextBefore(before);
  const colon = declaration.indexOf(':');
  if (colon < 0) {
    return undefined;
  }
  const ahead = text.slice(end, end + DECLARATION_CHARS_MAX);
  const closer = ahead.search(/[;}]/);
  const valueAfter = closer < 0 ? ahead : ahead.slice(0, closer);
  return `${declaration.slice(colon + 1).trimStart()}${between}${valueAfter}`;
}
