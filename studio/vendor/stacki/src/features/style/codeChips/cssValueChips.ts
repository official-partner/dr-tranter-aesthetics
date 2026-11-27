import { assert } from '../../../../shared/core/assert';
import { isEasing } from '../model/transition';
import { gradientFitsEditor, parseGradient } from '../model/gradient';
import { CSS_COLOR_NAMES } from './cssColorNames';
import { isKeywordOf, isKeywordProperty, type KeywordPropertyName } from './keywordOptions';


export type CssChipText = 'stylesheet' | 'markup';

export interface CssChipRange {
  readonly from: number;
  readonly to: number;
}

export const LAYERED_PROPERTIES = ['transition', 'transform', 'filter', 'backdrop-filter', 'box-shadow', 'text-shadow', 'background-image'] as const;
export type LayeredProperty = (typeof LAYERED_PROPERTIES)[number];

export type CssValueChip =
  | (CssChipRange & {
      readonly kind: 'variable';
      readonly value: string;
      readonly property: string | undefined;
      readonly declaration: CssChipRange;
    })
  | (CssChipRange & { readonly kind: 'easing'; readonly value: string })
  | (CssChipRange & { readonly kind: 'clipPath'; readonly value: string })
  | (CssChipRange & { readonly kind: 'boxShadow'; readonly value: string })
  | (CssChipRange & { readonly kind: 'textShadow'; readonly value: string })
  | (CssChipRange & { readonly kind: 'gradient'; readonly value: string })
  | (CssChipRange & {
      readonly kind: 'color';
      readonly value: string;
      readonly variable: string | undefined;
    })
  | (CssChipRange & { readonly kind: 'keyword'; readonly value: string; readonly property: KeywordPropertyName })
  | (CssChipRange & { readonly kind: 'layers'; readonly value: string; readonly property: LayeredProperty });

export type CssValueChipKind = CssValueChip['kind'];

export const CHIP_TEXT_CHARS_MAX = 400_000;
export const CHIPS_MAX = 4_000;
export const STYLE_BLOCKS_MAX = 256;
const DECLARATION_START_CHARS_MAX = 128;

const PROPERTY_NAME = /^(?:--[\w -￿-]+|-?[a-z][a-z0-9_-]*)$/i;
const DECLARATION_START = /^\s*(?:--[\w -￿-]+|-?[a-z][a-z0-9_-]*)\s*:(?!:)/i;
const VENDOR_PREFIX = /^-(?:webkit|moz|ms|o)-/;
const WIDE_KEYWORDS = new Set(['none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const EASING_PROPERTIES = new Set(['transition', 'transition-timing-function', 'animation', 'animation-timing-function']);
const EASING_ONLY_PROPERTIES = new Set(['transition-timing-function', 'animation-timing-function']);
const EASING_CREATE_PROPERTIES = new Set(['transition-timing-function', 'animation-timing-function', 'animation']);
const CLIP_PATH_PROPERTIES = new Set(['clip-path']);
const GRADIENT_CREATE_PROPERTIES = new Set(['background']);
const LAYERED: ReadonlySet<string> = new Set(LAYERED_PROPERTIES);
const COLOR_PROPERTIES = new Set([
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-block-color',
  'border-block-start-color',
  'border-block-end-color',
  'border-inline-color',
  'border-inline-start-color',
  'border-inline-end-color',
  'outline-color',
  'text-decoration-color',
  'text-emphasis-color',
  'text-stroke-color',
  'column-rule-color',
  'caret-color',
  'accent-color',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
]);
const COLOR_SHORTHANDS = new Set([
  'background',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-block',
  'border-block-start',
  'border-block-end',
  'border-inline',
  'border-inline-start',
  'border-inline-end',
  'outline',
  'text-decoration',
  'text-emphasis',
  'text-stroke',
  'column-rule',
]);
const VARIABLE_START = /^var\(\s*--[A-Za-z0-9_-]/i;
const GRADIENT_START = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const WHOLE_VARIABLE = /^var\(\s*--[A-Za-z0-9_-]+\s*\)$/i;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const UNFINISHED_WORD = /^#?[a-z0-9-]+$/i;
const COLOR_KEYWORDS = new Set(['currentcolor', 'none', 'auto', ...WIDE_KEYWORDS]);

export function cssValueChips(text: string, kind: CssChipText): readonly CssValueChip[] {
  if (text.length > CHIP_TEXT_CHARS_MAX) {
    return [];
  }
  const chips: CssValueChip[] = [];
  const regions = kind === 'stylesheet' ? [{ from: 0, to: text.length }] : styleBlocks(text);
  for (const region of regions) {
    scanDeclarations(text, region, (declaration) => declarationChips(text, declaration, chips));
    if (chips.length >= CHIPS_MAX) {
      break;
    }
  }
  const own = chips.filter((chip) => chip.kind !== 'variable' || !chip.value.includes('${'));
  const kept = own.slice(0, CHIPS_MAX).sort((left, right) => left.from - right.from);
  for (const chip of kept) {
    assert(chip.from <= chip.to, 'cssValueChips: a chip keeps its order');
    assert(text.slice(chip.from, chip.to) === chip.value, 'cssValueChips: a chip is the text it covers');
    if (chip.kind === 'variable') {
      assert(chip.from < chip.to, 'cssValueChips: a variable chip covers its reference');
    }
  }
  return kept;
}

export function styleBlocks(text: string): readonly CssChipRange[] {
  const blocks: CssChipRange[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  for (let count = 0; count < STYLE_BLOCKS_MAX; count++) {
    const open = lower.indexOf('<style', cursor);
    if (open < 0) {
      break;
    }
    const nameEnd = lower.charAt(open + '<style'.length);
    if (nameEnd !== '>' && nameEnd !== '/' && !/\s/.test(nameEnd)) {
      cursor = open + 1;
      continue;
    }
    const openEnd = lower.indexOf('>', open);
    if (openEnd < 0) {
      break;
    }
    const close = lower.indexOf('</style', openEnd);
    const to = close < 0 ? text.length : close;
    if (to > openEnd + 1) {
      blocks.push({ from: openEnd + 1, to });
    }
    if (close < 0) {
      break;
    }
    cursor = close + 1;
  }
  assert(blocks.length <= STYLE_BLOCKS_MAX, 'styleBlocks: the block count is bounded');
  return blocks;
}

export interface CssDeclaration {
  readonly property: string;
  readonly value: CssChipRange;
}

export function scanDeclarations(text: string, region: CssChipRange, onDeclaration: (declaration: CssDeclaration) => void): void {
  assert(region.from <= region.to, 'scanDeclarations: the region keeps its order');
  assert(region.to <= text.length, 'scanDeclarations: the region lies in the text');
  let start = region.from;
  let depth = 0;
  let index = region.from;
  for (let step = 0; index < region.to; step++) {
    assert(step <= region.to - region.from, 'scanDeclarations: the scan moves forward');
    const character = text.charAt(index);
    if (character === '/' && text.charAt(index + 1) === '*') {
      const after = commentEnd(text, index, region.to);
      if (text.slice(start, index).trim() === '') {
        start = after;
      }
      index = after;
      continue;
    }
    if (character === '"' || character === "'") {
      index = quoteEnd(text, index, region.to);
      continue;
    }
    if (character === '$' && text.charAt(index + 1) === '{') {
      index = holeEnd(text, index, region.to);
      continue;
    }
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      if (character === ';' || character === '}') {
        declarationsIn(text, { from: start, to: index }, onDeclaration);
        start = index + 1;
      } else if (character === '{') {
        start = index + 1;
      }
    }
    index += 1;
  }
  declarationsIn(text, { from: start, to: region.to }, onDeclaration);
}

function holeEnd(text: string, open: number, limit: number): number {
  assert(text.startsWith('${', open), 'holeEnd: a hole opens here');
  const close = text.indexOf('}', open + 2);
  return close < 0 || close >= limit ? open + 1 : close + 1;
}

function commentEnd(text: string, open: number, limit: number): number {
  assert(text.startsWith('/*', open), 'commentEnd: a comment opens here');
  const close = text.indexOf('*/', open + 2);
  return close < 0 || close + 2 > limit ? limit : close + 2;
}

function quoteEnd(text: string, open: number, limit: number): number {
  const quote = text.charAt(open);
  for (let index = open + 1; index < limit; index++) {
    const character = text.charAt(index);
    if (character === '\\') {
      index += 1;
    } else if (character === quote || character === '\n') {
      return index + 1;
    }
  }
  return limit;
}

function declarationsIn(text: string, run: CssChipRange, onDeclaration: (declaration: CssDeclaration) => void): void {
  let from = run.from;
  for (let pass = 0; from < run.to; pass++) {
    assert(pass <= run.to - run.from, 'declarationsIn: each pass moves forward');
    const colon = text.indexOf(':', from);
    if (colon < 0 || colon >= run.to) {
      return;
    }
    const cut = nextDeclarationLine(text, { from: colon + 1, to: run.to });
    declarationIn(text, { from, to: cut ?? run.to }, colon, onDeclaration);
    if (cut === undefined) {
      return;
    }
    assert(cut > from, 'declarationsIn: a cut is past the run start');
    from = cut;
  }
}

function nextDeclarationLine(text: string, range: CssChipRange): number | undefined {
  let depth = 0;
  let index = range.from;
  for (let step = 0; index < range.to; step++) {
    assert(step <= range.to - range.from, 'nextDeclarationLine: the scan moves forward');
    const character = text.charAt(index);
    if (character === '/' && text.charAt(index + 1) === '*') {
      index = commentEnd(text, index, range.to);
      continue;
    }
    if (character === '"' || character === "'") {
      index = quoteEnd(text, index, range.to);
      continue;
    }
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === '\n' && depth === 0) {
      const line = text.slice(index + 1, Math.min(range.to, index + 1 + DECLARATION_START_CHARS_MAX));
      if (DECLARATION_START.test(line)) {
        return index + 1;
      }
    }
    index += 1;
  }
  return undefined;
}

function declarationIn(text: string, run: CssChipRange, colon: number, onDeclaration: (declaration: CssDeclaration) => void): void {
  assert(run.from <= colon, 'declarationIn: the colon is in the run');
  assert(colon < run.to, 'declarationIn: the value follows the colon');
  const property = text.slice(run.from, colon).trim();
  if (!PROPERTY_NAME.test(property)) {
    return;
  }
  const trimmed = trimmedValue(text, { from: colon + 1, to: run.to });
  const value = trimmed.from < trimmed.to ? trimmed : emptyValueAt(text, colon, run.to);
  onDeclaration({ property: property.startsWith('--') ? property : property.toLowerCase(), value });
}

function emptyValueAt(text: string, colon: number, limit: number): CssChipRange {
  let at = colon + 1;
  while (at < limit) {
    const character = text.charAt(at);
    if (character !== ' ' && character !== '\t') {
      break;
    }
    at += 1;
  }
  assert(at <= limit, 'emptyValueAt: the place is in the run');
  return { from: at, to: at };
}

function trimmedValue(text: string, range: CssChipRange): CssChipRange {
  const raw = text.slice(range.from, range.to);
  const leading = raw.length - raw.trimStart().length;
  const kept = raw.trimEnd().replace(/\s*!\s*important$/i, '');
  const to = range.from + kept.trimEnd().length;
  const from = Math.min(range.from + leading, to);
  assert(from <= to, 'trimmedValue: the value keeps its order');
  return { from, to };
}

export function unprefixedProperty(property: string): string {
  return property.startsWith('--') ? property : property.replace(VENDOR_PREFIX, '');
}

function declarationChips(text: string, declaration: CssDeclaration, chips: CssValueChip[]): void {
  const { property, value } = declaration;
  if (value.from === value.to) {
    const create = createChip(unprefixedProperty(property), value.from);
    if (create !== undefined) {
      chips.push(create);
    }
    return;
  }
  const valueText = text.slice(value.from, value.to);
  if (property.startsWith('--')) {
    customPropertyChips(text, declaration, chips);
    return;
  }
  const base = unprefixedProperty(property);
  if (isKeywordProperty(base) && isKeywordOf(base, valueText)) {
    chips.push({ kind: 'keyword', property: base, from: value.from, to: value.to, value: valueText });
  }
  const variables = variableChips(text, declaration);
  const insideVariable = (offset: number): boolean => variables.some((chip) => chip.from < offset && offset < chip.to);
  if (isLayered(base)) {
    const lower = valueText.toLowerCase();
    if (!WHOLE_VARIABLE.test(valueText) && (lower === 'none' || !WIDE_KEYWORDS.has(lower))) {
      chips.push({ kind: 'layers', property: base, from: value.from, to: value.to, value: valueText });
    }
  }
  chips.push(...variables);
  if (EASING_PROPERTIES.has(base)) {
    for (const token of topLevelTokens(text, value, /[\s,]/)) {
      if (isEasing(token.value)) {
        chips.push({ kind: 'easing', ...token });
      }
    }
    if (EASING_ONLY_PROPERTIES.has(base) && unfinishedWord(valueText) && !isEasing(valueText) && !WIDE_KEYWORDS.has(valueText.toLowerCase())) {
      chips.push({ kind: 'easing', from: value.from, to: value.to, value: valueText });
    }
  } else if (CLIP_PATH_PROPERTIES.has(base)) {
    if (!WIDE_KEYWORDS.has(valueText.toLowerCase())) {
      chips.push({ kind: 'clipPath', from: value.from, to: value.to, value: valueText });
    }
  } else if (base === 'box-shadow' || base === 'text-shadow') {
    for (const layer of topLevelTokens(text, value, /,/)) {
      if (!WIDE_KEYWORDS.has(layer.value.toLowerCase()) && !WHOLE_VARIABLE.test(layer.value)) {
        chips.push({ kind: base === 'box-shadow' ? 'boxShadow' : 'textShadow', ...layer });
      }
    }
  }
  pushGradients(text, value, chips, insideVariable);
  if (base === 'background-image' && unfinishedWord(valueText) && !WIDE_KEYWORDS.has(valueText.toLowerCase())) {
    chips.push({ kind: 'gradient', from: value.from, to: value.to, value: valueText });
  }
  if (COLOR_PROPERTIES.has(base) || COLOR_SHORTHANDS.has(base)) {
    pushColors(text, value, chips);
  }
  if (COLOR_PROPERTIES.has(base) && unfinishedWord(valueText) && !isColorLiteral(valueText) && !COLOR_KEYWORDS.has(valueText.toLowerCase())) {
    chips.push({ kind: 'color', from: value.from, to: value.to, value: valueText, variable: undefined });
  }
}

function customPropertyChips(text: string, declaration: CssDeclaration, chips: CssValueChip[]): void {
  const { value } = declaration;
  const valueText = text.slice(value.from, value.to);
  const variables = variableChips(text, declaration);
  chips.push(...variables);
  if (isEasing(valueText)) {
    chips.push({ kind: 'easing', from: value.from, to: value.to, value: valueText });
  } else if (isColorLiteral(valueText)) {
    chips.push({ kind: 'color', from: value.from, to: value.to, value: valueText, variable: declaration.property });
  }
  pushGradients(text, value, chips, (offset) => variables.some((chip) => chip.from < offset && offset < chip.to));
}

function pushGradients(text: string, value: CssChipRange, chips: CssValueChip[], insideVariable: (offset: number) => boolean): void {
  for (const gradient of functionCalls(text, value, GRADIENT_START)) {
    const parsed = parseGradient(gradient.value);
    if (parsed !== undefined && gradientFitsEditor(parsed) && !insideVariable(gradient.from)) {
      chips.push({ kind: 'gradient', ...gradient });
    }
  }
}

function pushColors(text: string, value: CssChipRange, chips: CssValueChip[]): void {
  for (const token of valueWords(text, value)) {
    if (isColorLiteral(token.value)) {
      chips.push({ kind: 'color', ...token, variable: undefined });
    }
  }
}

function createChip(property: string, at: number): CssValueChip | undefined {
  const empty = { from: at, to: at, value: '' };
  if (isLayered(property)) {
    return { kind: 'layers', property, ...empty };
  }
  if (CLIP_PATH_PROPERTIES.has(property)) {
    return { kind: 'clipPath', ...empty };
  }
  if (GRADIENT_CREATE_PROPERTIES.has(property)) {
    return { kind: 'gradient', ...empty };
  }
  if (EASING_CREATE_PROPERTIES.has(property)) {
    return { kind: 'easing', ...empty };
  }
  if (COLOR_PROPERTIES.has(property)) {
    return { kind: 'color', ...empty, variable: undefined };
  }
  if (isKeywordProperty(property)) {
    return { kind: 'keyword', property, ...empty };
  }
  return undefined;
}

function isLayered(property: string): property is LayeredProperty {
  return LAYERED.has(property);
}

function unfinishedWord(value: string): boolean {
  return UNFINISHED_WORD.test(value);
}

export function isColorLiteral(token: string): boolean {
  const trimmed = token.trim();
  if (HEX_COLOR.test(trimmed)) {
    return true;
  }
  if (COLOR_FUNCTION.test(trimmed)) {
    return trimmed.endsWith(')') && !/var\(/i.test(trimmed);
  }
  return CSS_COLOR_NAMES.has(trimmed.toLowerCase());
}

function variableChips(text: string, declaration: CssDeclaration): CssValueChip[] {
  const property = declaration.property.startsWith('--') ? undefined : declaration.property;
  return functionCalls(text, declaration.value, VARIABLE_START).map((call) => ({ kind: 'variable', ...call, property, declaration: declaration.value }));
}

export function functionCalls(text: string, range: CssChipRange, start: RegExp): Array<CssChipRange & { readonly value: string }> {
  const calls: Array<CssChipRange & { readonly value: string }> = [];
  let index = range.from;
  for (let step = 0; index < range.to; step++) {
    assert(step <= range.to - range.from, 'functionCalls: the scan moves forward');
    const character = text.charAt(index);
    if (character === '"' || character === "'") {
      index = quoteEnd(text, index, range.to);
      continue;
    }
    if (character === '/' && text.charAt(index + 1) === '*') {
      index = commentEnd(text, index, range.to);
      continue;
    }
    const before = index === range.from ? '' : text.charAt(index - 1);
    if (!/[\w-]/.test(before) && start.test(text.slice(index, Math.min(range.to, index + 64)))) {
      const close = closingParen(text, text.indexOf('(', index), range.to);
      if (close !== undefined) {
        calls.push({ from: index, to: close + 1, value: text.slice(index, close + 1) });
        index = close + 1;
        continue;
      }
    }
    index += 1;
  }
  return calls;
}

function closingParen(text: string, open: number, limit: number): number | undefined {
  assert(text.charAt(open) === '(', 'closingParen: it starts at an opening paren');
  let depth = 0;
  for (let index = open; index < limit; index++) {
    const character = text.charAt(index);
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

export function topLevelTokens(text: string, range: CssChipRange, separator: RegExp): Array<CssChipRange & { readonly value: string }> {
  const tokens: Array<CssChipRange & { readonly value: string }> = [];
  const push = (from: number, to: number): void => {
    const trimmed = trimmedValue(text, { from, to });
    if (trimmed.from < trimmed.to) {
      tokens.push({ ...trimmed, value: text.slice(trimmed.from, trimmed.to) });
    }
  };
  let depth = 0;
  let start = range.from;
  for (let index = range.from; index < range.to; index++) {
    const character = text.charAt(index);
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && separator.test(character)) {
      push(start, index);
      start = index + 1;
    }
  }
  push(start, range.to);
  return tokens;
}

export function valueWords(text: string, range: CssChipRange): Array<CssChipRange & { readonly value: string }> {
  const words: Array<CssChipRange & { readonly value: string }> = [];
  let start: number | undefined = undefined;
  let depth = 0;
  const end = (at: number): void => {
    if (start !== undefined && start < at) {
      words.push({ from: start, to: at, value: text.slice(start, at) });
    }
    start = undefined;
  };
  let index = range.from;
  for (let step = 0; index < range.to; step++) {
    assert(step <= range.to - range.from, 'valueWords: the scan moves forward');
    const character = text.charAt(index);
    if (depth === 0 && character === '/' && text.charAt(index + 1) === '*') {
      end(index);
      index = commentEnd(text, index, range.to);
      continue;
    }
    if (character === '"' || character === "'") {
      end(index);
      index = quoteEnd(text, index, range.to);
      continue;
    }
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && /[\s,/]/.test(character)) {
      end(index);
      index += 1;
      continue;
    }
    if (start === undefined) {
      start = index;
    }
    index += 1;
  }
  end(range.to);
  return words;
}
