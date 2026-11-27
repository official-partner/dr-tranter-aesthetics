
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

export interface TopLevelScan {
  readonly ors: readonly number[];
  readonly ands: readonly number[];
  readonly loose: boolean;
}

type Closer = ')' | ']' | '}' | 'template';

const VALUE_STARTS_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '<', '>', '+', '-', '*', '%', '~', '^']);

export function scanTopLevel(code: string): TopLevelScan | undefined {
  if (code.length > LIMITS.attrCharsMax) {
    return undefined;
  }
  const ors: number[] = [];
  const ands: number[] = [];
  let loose = false;
  const closers: Closer[] = [];
  let previous = '';
  let index = 0;
  for (let turn = 0; index < code.length && turn <= code.length; turn += 1) {
    const start = index;
    const character = code.charAt(index);
    const next = code.charAt(index + 1);
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      const end = code.indexOf('\n', index);
      index = end < 0 ? code.length : end;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = code.indexOf('*/', index + 2);
      if (end < 0) {
        return undefined;
      }
      index = end + 2;
      continue;
    }
    if (character === '/' && VALUE_STARTS_AFTER.has(previous)) {
      return undefined;
    }
    if (character === '"' || character === "'") {
      const end = quotedEnd(code, index, character);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      previous = character;
      continue;
    }
    if (character === '`') {
      const end = templateEnd(code, index + 1, closers);
      if (end === undefined) {
        return undefined;
      }
      index = end;
      previous = end > 0 && code.charAt(end - 1) === '`' ? '`' : '{';
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      closers.push(character === '(' ? ')' : character === '[' ? ']' : '}');
      index += 1;
      previous = character;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      const expected = closers.pop();
      if (expected === 'template' && character === '}') {
        const end = templateEnd(code, index + 1, closers);
        if (end === undefined) {
          return undefined;
        }
        index = end;
        previous = code.charAt(end - 1) === '`' ? '`' : '{';
        continue;
      }
      if (expected !== character) {
        return undefined;
      }
      index += 1;
      previous = character;
      continue;
    }
    if (closers.length === 0) {
      const step = topLevelOperator(code, index);
      if (step.kind === 'or') {
        ors.push(index);
      } else if (step.kind === 'and') {
        ands.push(index);
      } else if (step.kind === 'loose') {
        loose = true;
      }
      index += step.length;
    } else {
      index += nestedOperatorLength(code, index);
    }
    previous = code.charAt(index - 1);
    assert(index > start, 'scanTopLevel: every turn moves forward');
  }
  if (index < code.length || closers.length > 0) {
    return undefined;
  }
  return { ors, ands, loose };
}

type OperatorStep = { readonly kind: 'or' | 'and' | 'loose' | 'other'; readonly length: number };

function topLevelOperator(code: string, index: number): OperatorStep {
  const rest = code.slice(index, index + 4);
  if (rest.startsWith('||=') || rest.startsWith('&&=') || rest.startsWith('??=')) {
    return { kind: 'loose', length: 3 };
  }
  if (rest.startsWith('||')) {
    return { kind: 'or', length: 2 };
  }
  if (rest.startsWith('&&')) {
    return { kind: 'and', length: 2 };
  }
  if (rest.startsWith('??')) {
    return { kind: 'loose', length: 2 };
  }
  if (rest.startsWith('?.') && !/\d/.test(rest.charAt(2))) {
    return { kind: 'other', length: 2 };
  }
  if (rest.startsWith('?') || rest.startsWith(',') || rest.startsWith('=>')) {
    return { kind: 'loose', length: rest.startsWith('=>') ? 2 : 1 };
  }
  const comparison = ['===', '!==', '==', '!=', '<=', '>='].find((candidate) => rest.startsWith(candidate));
  if (comparison !== undefined) {
    return { kind: 'other', length: comparison.length };
  }
  if (rest.startsWith('=') || /^(?:\+|-|\*|\/|%|\*\*|<<|>>|>>>|&|\||\^)=/.test(rest)) {
    return { kind: 'loose', length: 1 };
  }
  return { kind: 'other', length: wordLength(code, index) };
}

function nestedOperatorLength(code: string, index: number): number {
  return wordLength(code, index);
}

function wordLength(code: string, index: number): number {
  const word = /^[\w$]+/.exec(code.slice(index, index + LIMITS.attrCharsMax));
  return word === null ? 1 : word[0].length;
}

function quotedEnd(code: string, start: number, quote: string): number | undefined {
  for (let index = start + 1; index < code.length; index += 1) {
    const character = code.charAt(index);
    if (character === '\\') {
      index += 1;
    } else if (character === quote) {
      return index + 1;
    } else if (character === '\n') {
      return undefined;
    }
  }
  return undefined;
}

function templateEnd(code: string, from: number, closers: Closer[]): number | undefined {
  for (let index = from; index < code.length; index += 1) {
    const character = code.charAt(index);
    if (character === '\\') {
      index += 1;
    } else if (character === '`') {
      return index + 1;
    } else if (character === '$' && code.charAt(index + 1) === '{') {
      if (closers.length >= LIMITS.treeDepthMax) {
        return undefined;
      }
      closers.push('template');
      return index + 2;
    }
  }
  return undefined;
}

export function cutAt(code: string, at: readonly number[], width: number): readonly string[] {
  const pieces: string[] = [];
  let from = 0;
  for (const cut of at) {
    assert(cut >= from, 'cutAt: the cuts are in order');
    pieces.push(code.slice(from, cut).trim());
    from = cut + width;
  }
  pieces.push(code.slice(from).trim());
  assert(pieces.length === at.length + 1, 'cutAt: one piece more than cuts');
  return pieces;
}

export function withoutOuterParentheses(code: string): string {
  let text = code.trim();
  for (let round = 0; round < LIMITS.treeDepthMax && text.startsWith('(') && text.endsWith(')'); round += 1) {
    const inner = text.slice(1, -1);
    if (scanTopLevel(inner) === undefined) {
      break;
    }
    text = inner.trim();
  }
  return text;
}

export function needsParentheses(code: string): boolean {
  const scan = scanTopLevel(code);
  if (scan === undefined) {
    return true;
  }
  return scan.loose || scan.ors.length > 0 || scan.ands.length > 0;
}
