
import { count, object, optional, text } from '../core/boundary';
import { LIMITS } from '../core/limits';

export const parseWinningDeclaration = object({
  expression: text,
  selector: text,
  file: optional(text),
  depth: count,
  ancestor: text,
});
export type WinningDeclarationText = ReturnType<typeof parseWinningDeclaration>;

export const WINNING_NAMES_MAX = 512;

export function sameExpression(first: string, second: string): boolean {
  assertBounded(first);
  assertBounded(second);
  return first.replace(/\s+/g, ' ').trim() === second.replace(/\s+/g, ' ').trim();
}

function assertBounded(value: string): void {
  if (value.length > LIMITS.attrCharsMax) {
    throw new Error('sameExpression: the expression exceeds the attribute limit');
  }
}
