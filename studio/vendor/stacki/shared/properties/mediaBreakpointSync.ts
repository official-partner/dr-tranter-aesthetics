import { assert } from '../core/assert';
import { PLATFORM_LIMITS } from '../core/limits';
import { SYNC_RECORD_LIMITS } from './breakpointSyncRecord';
import { BREAKPOINT_LIMITS, boundaryPx, type Breakpoint, type BreakpointSetting } from './projectBreakpoints';

export const MEDIA_SYNC_LIMITS = {
  textCharsMax: SYNC_RECORD_LIMITS.textCharsMax,
  mediaRulesMax: PLATFORM_LIMITS.arrayLengthMax,
  preludeTokensMax: 256,
  previewCharsMax: 96,
  remDecimalsMax: 4,
} as const satisfies Record<string, number>;

export interface CssSyntax {
  readonly lineComments: boolean;
}

export type BoundSide = 'upper' | 'lower';
export type BoundMatch = 'exact' | 'inclusive' | 'exclusive';

export interface WidthBound {
  readonly start: number;
  readonly end: number;
  readonly value: number;
  readonly unit: 'px' | 'rem';
  readonly side: BoundSide;
  readonly inclusive: boolean;
  readonly preludeStart: number;
  readonly preludeEnd: number;
  readonly locator: string;
}

interface Token {
  readonly kind: 'open' | 'close' | 'comma' | 'colon' | 'operator' | 'ident' | 'dimension' | 'other';
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly value?: number;
  readonly unit?: string;
}

export function findWidthBounds(css: string, options: CssSyntax): readonly WidthBound[] {
  assert(css.length <= MEDIA_SYNC_LIMITS.textCharsMax, 'findWidthBounds: the text is within the bound');
  const bounds: WidthBound[] = [];
  const seen = new Map<string, number>();
  let rules = 0;
  let index = 0;
  while (index < css.length) {
    const skipped = skipNonCode(css, index, options);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    if (css[index] === '@' && isMediaKeyword(css, index)) {
      rules += 1;
      if (rules > MEDIA_SYNC_LIMITS.mediaRulesMax) {
        break;
      }
      const preludeStart = index + '@media'.length;
      const preludeEnd = preludeEndFrom(css, preludeStart, options);
      collectBounds(css, preludeStart, preludeEnd, options, seen, bounds);
      index = preludeEnd;
      continue;
    }
    index += 1;
  }
  return bounds;
}

export function classifyBound(
  bound: Pick<WidthBound, 'value' | 'unit' | 'side' | 'inclusive'>,
  old: Pick<Breakpoint, 'direction' | 'setting'>,
): BoundMatch | undefined {
  const boundPx = bound.unit === 'rem' ? bound.value * BREAKPOINT_LIMITS.remPx : bound.value;
  const oldPx = boundaryPx(old.setting);
  if (near(boundPx, oldPx)) {
    return old.direction === 'up' && bound.side === 'lower' && !bound.inclusive ? 'exclusive' : 'exact';
  }
  const inclusiveForm = (bound.side === 'upper' && bound.inclusive) || (bound.side === 'lower' && !bound.inclusive);
  if (inclusiveForm && near(boundPx, oldPx - 1)) {
    return 'inclusive';
  }
  return undefined;
}

export function replacementText(match: BoundMatch, bound: Pick<WidthBound, 'unit'>, next: BreakpointSetting, options: { readonly lumos: boolean }): string {
  const nextPx = boundaryPx(next);
  assert(nextPx > 0, 'replacementText: the new boundary is positive');
  if (match === 'exact' || match === 'exclusive') {
    if (next.unit === 'rem') {
      return `${formatNumber(next.value)}rem`;
    }
    return options.lumos ? `${formatNumber(nextPx / BREAKPOINT_LIMITS.remPx)}rem` : `${formatNumber(next.value)}px`;
  }
  const targetPx = nextPx - 1;
  if (bound.unit === 'px' && !options.lumos) {
    return `${formatNumber(targetPx)}px`;
  }
  return `${formatNumber(targetPx / BREAKPOINT_LIMITS.remPx)}rem`;
}

export function formatNumber(value: number): string {
  assert(Number.isFinite(value), 'formatNumber: a finite number');
  const fixed = value.toFixed(MEDIA_SYNC_LIMITS.remDecimalsMax);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

export interface TextReplacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function applyReplacements(text: string, replacements: readonly TextReplacement[]): string {
  const ordered = [...replacements].sort((first, second) => first.start - second.start);
  let cursor = 0;
  let result = '';
  for (const replacement of ordered) {
    assert(replacement.start >= cursor, 'applyReplacements: replacements do not overlap');
    assert(replacement.end >= replacement.start, 'applyReplacements: a replacement is a forward range');
    assert(replacement.end <= text.length, 'applyReplacements: a replacement is inside the text');
    result += text.slice(cursor, replacement.start) + replacement.text;
    cursor = replacement.end;
  }
  return result + text.slice(cursor);
}

export function previewAround(css: string, bound: WidthBound, token: string): string {
  const head = css.slice(bound.preludeStart, bound.start);
  const tail = css.slice(bound.end, bound.preludeEnd);
  const flat = (part: string): string => part.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ');
  const left = flat(head).trimStart();
  const right = flat(tail).trimEnd();
  const half = Math.floor(MEDIA_SYNC_LIMITS.previewCharsMax / 2);
  assert(bound.preludeStart <= bound.start, 'previewAround: the bound is inside its prelude');
  const clippedLeft = left.length > half ? `…${left.slice(left.length - half)}` : left;
  const clippedRight = right.length > half ? `${right.slice(0, half)}…` : right;
  return `@media${clippedLeft.startsWith(' ') ? '' : ' '}${clippedLeft}${token}${clippedRight}`;
}

function near(first: number, second: number): boolean {
  assert(!Number.isNaN(first), 'near: the first width is a number');
  assert(!Number.isNaN(second), 'near: the second width is a number');
  return Math.abs(first - second) < 1e-6;
}

function isMediaKeyword(css: string, at: number): boolean {
  assert(at >= 0, 'isMediaKeyword: a position inside the text');
  if (css.slice(at, at + 6).toLowerCase() !== '@media') {
    return false;
  }
  const after = css[at + 6];
  return after === undefined || !/[A-Za-z0-9_-]/.test(after);
}

function skipNonCode(css: string, index: number, syntax: CssSyntax): number {
  const char = css[index];
  const next = css[index + 1];
  if (char === '/' && next === '*') {
    const close = css.indexOf('*/', index + 2);
    return close === -1 ? css.length : close + 2;
  }
  if (syntax.lineComments && char === '/' && next === '/') {
    const close = css.indexOf('\n', index + 2);
    return close === -1 ? css.length : close;
  }
  if (char === '"' || char === "'") {
    return skipString(css, index);
  }
  return index;
}

function skipString(css: string, index: number): number {
  const quote = css[index];
  let cursor = index + 1;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === '\\') {
      cursor += 2;
    } else if (char === quote) {
      return cursor + 1;
    } else if (char === '\n') {
      return cursor;
    } else {
      cursor += 1;
    }
  }
  return css.length;
}

function preludeEndFrom(css: string, from: number, syntax: CssSyntax): number {
  let depth = 0;
  let index = from;
  while (index < css.length) {
    const skipped = skipNonCode(css, index, syntax);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    const char = css[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (char === '{' || char === ';')) {
      return index;
    }
    index += 1;
  }
  return css.length;
}

function tokenize(css: string, from: number, to: number, syntax: CssSyntax): readonly Token[] {
  const tokens: Token[] = [];
  let index = from;
  while (index < to && tokens.length < MEDIA_SYNC_LIMITS.preludeTokensMax) {
    const char = css[index] ?? '';
    const skipped = skipNonCode(css, index, syntax);
    if (skipped > index) {
      index = Math.min(skipped, to);
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === '(') {
      tokens.push({ kind: 'open', start: index, end: index + 1, text: char });
      index += 1;
    } else if (char === ')') {
      tokens.push({ kind: 'close', start: index, end: index + 1, text: char });
      index += 1;
    } else if (char === ',') {
      tokens.push({ kind: 'comma', start: index, end: index + 1, text: char });
      index += 1;
    } else if (char === ':') {
      tokens.push({ kind: 'colon', start: index, end: index + 1, text: char });
      index += 1;
    } else if (char === '<' || char === '>' || char === '=') {
      const length = css[index + 1] === '=' && char !== '=' ? 2 : 1;
      tokens.push({ kind: 'operator', start: index, end: index + length, text: css.slice(index, index + length) });
      index += length;
    } else if (isDigit(char) || (char === '.' && isDigit(css[index + 1] ?? ''))) {
      const token = readDimension(css, index, to);
      tokens.push(token);
      index = token.end;
    } else {
      let end = index + 1;
      while (end < to && !/[\s(),:<>=/'"]/.test(css[end] ?? ' ')) {
        end += 1;
      }
      const text = css.slice(index, end);
      tokens.push({ kind: /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(text) ? 'ident' : 'other', start: index, end, text });
      index = end;
    }
  }
  return tokens;
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function readDimension(css: string, from: number, to: number): Token {
  assert(from <= to, 'readDimension: a forward range');
  assert(to <= css.length, 'readDimension: the range is inside the text');
  let index = from;
  while (index < to && isDigit(css[index] ?? '')) {
    index += 1;
  }
  if (css[index] === '.') {
    index += 1;
    while (index < to && isDigit(css[index] ?? '')) {
      index += 1;
    }
  }
  const numberEnd = index;
  while (index < to && /[A-Za-z%]/.test(css[index] ?? '')) {
    index += 1;
  }
  const number = Number(css.slice(from, numberEnd));
  const unit = css.slice(numberEnd, index).toLowerCase();
  if (!Number.isFinite(number) || number <= 0 || (unit !== 'px' && unit !== 'rem')) {
    return { kind: 'other', start: from, end: Math.max(index, from + 1), text: css.slice(from, Math.max(index, from + 1)) };
  }
  return { kind: 'dimension', start: from, end: index, text: css.slice(from, index), value: number, unit };
}

function collectBounds(css: string, preludeStart: number, preludeEnd: number, syntax: CssSyntax, seen: Map<string, number>, bounds: WidthBound[]): void {
  const tokens = tokenize(css, preludeStart, preludeEnd, syntax);
  let open = -1;
  for (const [position, token] of tokens.entries()) {
    if (token.kind === 'open') {
      open = position;
    } else if (token.kind === 'close' && open !== -1) {
      const group = tokens.slice(open + 1, position);
      for (const found of boundsOfGroup(group)) {
        bounds.push(located(css, preludeStart, preludeEnd, syntax, found, seen));
      }
      open = -1;
    }
  }
}

interface RawBound {
  readonly token: Token;
  readonly side: BoundSide;
  readonly inclusive: boolean;
}

function boundsOfGroup(group: readonly Token[]): readonly RawBound[] {
  const found: RawBound[] = [];
  const [first, second, third] = group;
  if (group.length === 3 && first?.kind === 'ident' && second?.kind === 'colon' && third?.kind === 'dimension') {
    const name = first.text.toLowerCase();
    if (name === 'min-width') {
      found.push({ token: third, side: 'lower', inclusive: true });
    } else if (name === 'max-width') {
      found.push({ token: third, side: 'upper', inclusive: true });
    }
    return found;
  }
  const widthAt = group.findIndex((token) => token.kind === 'ident' && token.text.toLowerCase() === 'width');
  if (widthAt === -1) {
    return found;
  }
  const rightOperator = group[widthAt + 1];
  const rightValue = group[widthAt + 2];
  if (rightOperator?.kind === 'operator' && rightValue?.kind === 'dimension') {
    const side = sideOf(rightOperator.text, 'right');
    if (side !== undefined) {
      found.push({ token: rightValue, ...side });
    }
  }
  const leftOperator = group[widthAt - 1];
  const leftValue = group[widthAt - 2];
  if (leftOperator?.kind === 'operator' && leftValue?.kind === 'dimension') {
    const side = sideOf(leftOperator.text, 'left');
    if (side !== undefined) {
      found.push({ token: leftValue, ...side });
    }
  }
  return found;
}

function sideOf(operator: string, placement: 'left' | 'right'): { readonly side: BoundSide; readonly inclusive: boolean } | undefined {
  if (operator !== '<' && operator !== '<=' && operator !== '>' && operator !== '>=') {
    return undefined;
  }
  const less = operator.startsWith('<');
  const inclusive = operator.endsWith('=');
  const upper = placement === 'right' ? less : !less;
  return { side: upper ? 'upper' : 'lower', inclusive };
}

function located(css: string, preludeStart: number, preludeEnd: number, syntax: CssSyntax, raw: RawBound, seen: Map<string, number>): WidthBound {
  const masked = maskedPrelude(css, preludeStart, preludeEnd, raw.token, syntax);
  const hash = hashText(masked);
  const ordinal = seen.get(`${hash}`) ?? 0;
  seen.set(`${hash}`, ordinal + 1);
  assert(raw.token.value !== undefined, 'located: a dimension token carries its number');
  assert(raw.token.unit === 'px' || raw.token.unit === 'rem', 'located: a dimension token carries px or rem');
  return {
    start: raw.token.start,
    end: raw.token.end,
    value: raw.token.value,
    unit: raw.token.unit,
    side: raw.side,
    inclusive: raw.inclusive,
    preludeStart,
    preludeEnd,
    locator: `${hash}:${ordinal}`,
  };
}

function maskedPrelude(css: string, from: number, to: number, token: Token, syntax: CssSyntax): string {
  let text = '';
  let index = from;
  while (index < to) {
    if (index === token.start) {
      text += '@';
      index = token.end;
      continue;
    }
    const skipped = skipNonCode(css, index, syntax);
    if (skipped > index && css[index] !== '"' && css[index] !== "'") {
      text += ' ';
      index = Math.min(skipped, to);
      continue;
    }
    text += css[index] ?? '';
    index += 1;
  }
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ ?([(),:<>=]) ?/g, '$1')
    .trim();
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  assert(hex.length === 8, 'hashText: eight hex digits');
  return hex;
}
