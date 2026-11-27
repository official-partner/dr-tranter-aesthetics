
import { splitTopLevelSpaces } from './background';
import { assert } from '../../../../shared/core/assert';

export type RawLayer = { readonly type: 'raw'; readonly text: string };

export const rawLayer = (text: string): RawLayer => ({ type: 'raw', text });

const WHOLE_VALUE_KEYWORDS = new Set(['', 'none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

export function splitFunctionList(value: string): string[] {
  const trimmed = value.trim();
  if (WHOLE_VALUE_KEYWORDS.has(trimmed.toLowerCase())) {
    return [];
  }
  const parts: string[] = [];
  let wordsOpen = false;
  for (const token of splitTopLevelSpaces(trimmed).flatMap(splitJoinedCalls)) {
    const isCall = token.includes('(');
    if (!isCall && wordsOpen) {
      parts[parts.length - 1] = `${parts[parts.length - 1] ?? ''} ${token}`;
    } else {
      parts.push(token);
    }
    wordsOpen = !isCall;
  }
  assert(parts.length <= trimmed.length, 'splitFunctionList: at most one part per character');
  return parts;
}

function splitJoinedCalls(token: string): string[] {
  const calls: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token.charAt(i);
    if (ch === '\\') {
      i += 1;
    } else if (quote !== '') {
      quote = ch === quote ? '' : quote;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        calls.push(token.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  if (start < token.length) {
    calls.push(token.slice(start));
  }
  return calls;
}
