
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

const BINDING = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d{1,6}\])*$/;

const LITERAL_WORDS: ReadonlySet<string> = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this']);

export function pureBindingPath(expression: string): string | undefined {
  assert(expression.length <= LIMITS.nodeValueCharsMax, 'pureBindingPath: the expression is inside its bound');
  const match = /^\{\s*([^{}]*?)\s*\}$/.exec(expression);
  const path = match?.[1];
  if (path === undefined || !BINDING.test(path)) {
    return undefined;
  }
  const head = /^[A-Za-z_$][\w$]*/.exec(path)?.[0];
  assert(head !== undefined, 'pureBindingPath: a path starts with a name');
  return LITERAL_WORDS.has(head) ? undefined : path;
}
