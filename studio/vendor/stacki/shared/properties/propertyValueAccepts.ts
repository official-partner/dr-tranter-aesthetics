
import { assert } from '../core/assert';

export const VALUE_ACCEPTS_LIMITS = {
  depthMax: 8,
  substitutionsMax: 64,
  valueCharsMax: 4_096,
} as const;

export type VariableLookup = (name: string) => string | undefined;

export type ValuePredicate = (computed: string) => boolean;

const FONT_WEIGHT_KEYWORDS: ReadonlySet<string> = new Set(['normal', 'bold', 'bolder', 'lighter']);
const FONT_WEIGHT_MIN = 1;
const FONT_WEIGHT_MAX = 1000;
const FONT_WEIGHT_OFFERED_MIN = 100;
const FONT_WEIGHT_OFFERED_STEP = 50;
const CSS_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function isValidFontWeight(computed: string): boolean {
  return acceptsFontWeight(computed, FONT_WEIGHT_MIN);
}

export function isOfferedFontWeight(computed: string): boolean {
  const accepted = acceptsFontWeight(computed, FONT_WEIGHT_OFFERED_MIN);
  if (accepted === false || FONT_WEIGHT_KEYWORDS.has(computed.trim().toLowerCase())) {
    return accepted;
  }
  return Number(computed.trim()) % FONT_WEIGHT_OFFERED_STEP === 0;
}

function acceptsFontWeight(computed: string, weightMin: number): boolean {
  const trimmed = computed.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  if (FONT_WEIGHT_KEYWORDS.has(trimmed)) {
    return true;
  }
  if (CSS_NUMBER.test(trimmed)) {
    const weight = Number(trimmed);
    return weight >= weightMin && weight <= FONT_WEIGHT_MAX;
  }
  return false;
}

const NON_FONT_KEYWORDS: ReadonlySet<string> = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'default',
  'none',
  'normal',
  'auto',
  'balance',
  'pretty',
  'stable',
  'nowrap',
  'wrap',
  'wrap-reverse',
  'break-word',
  'break-spaces',
  'pre',
  'pre-wrap',
  'uppercase',
  'lowercase',
  'capitalize',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
  'top',
  'bottom',
  'middle',
  'bold',
  'bolder',
  'lighter',
  'italic',
  'oblique',
  'underline',
  'overline',
  'line-through',
  'hidden',
  'visible',
  'block',
  'inline',
  'flex',
  'grid',
  'static',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'solid',
  'dashed',
  'dotted',
  'double',
  'ltr',
  'rtl',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'transparent',
  'currentcolor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'gray',
  'grey',
  'brown',
]);
const FONT_FAMILY_ITEMS_MAX = 32;
const QUOTED_FAMILY = /^(?:"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+')$/;
const IDENTIFIER = /^-?[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF-]*$/;

export function isValidFontFamily(computed: string): boolean {
  const items = splitTopLevel(computed.trim());
  if (items === undefined || items.length === 0 || items.length > FONT_FAMILY_ITEMS_MAX) {
    return false;
  }
  return items.every(isFamilyItem);
}

function isFamilyItem(item: string): boolean {
  if (item.length === 0) {
    return false;
  }
  if (QUOTED_FAMILY.test(item)) {
    return true;
  }
  const words = item.split(/\s+/);
  if (!words.every((word) => IDENTIFIER.test(word))) {
    return false;
  }
  return words.length > 1 || !NON_FONT_KEYWORDS.has(item.toLowerCase());
}

function splitTopLevel(text: string): string[] | undefined {
  const items: string[] = [];
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (quote !== '') {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = '';
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ',') {
      items.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote !== '') {
    return undefined;
  }
  items.push(text.slice(start).trim());
  return items;
}

const LINE_HEIGHT_MAX = 3;
const LINE_HEIGHT_MIN = 0;

export function isLineHeightMultiplier(computed: string): boolean {
  const trimmed = computed.trim();
  if (CSS_NUMBER.test(trimmed)) {
    const multiplier = Number(trimmed);
    return multiplier >= LINE_HEIGHT_MIN && multiplier <= LINE_HEIGHT_MAX;
  }
  return false;
}

const LETTER_SPACING_EXTENT_MAX = 1;
const LETTER_SPACING_LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(em|rem)$/i;

export function isLetterSpacingLength(computed: string): boolean {
  const trimmed = computed.trim();
  if (CSS_NUMBER.test(trimmed)) {
    return Number(trimmed) === 0;
  }
  const match = LETTER_SPACING_LENGTH.exec(trimmed);
  const amount = match?.[1];
  if (amount === undefined) {
    return false;
  }
  return Math.abs(Number(amount)) <= LETTER_SPACING_EXTENT_MAX;
}

const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const TEXT_TRANSFORM_CASES: ReadonlySet<string> = new Set(['capitalize', 'uppercase', 'lowercase']);
const TEXT_TRANSFORM_WIDTHS: ReadonlySet<string> = new Set(['full-width', 'full-size-kana']);

export function isValidTextTransform(computed: string): boolean {
  const tokens = computed.trim().toLowerCase().split(/\s+/);
  const first = tokens[0];
  if (first === undefined || first === '' || tokens.length > 3) {
    return false;
  }
  if (tokens.length === 1) {
    return first === 'none' || CSS_WIDE_KEYWORDS.has(first) || TEXT_TRANSFORM_CASES.has(first) || TEXT_TRANSFORM_WIDTHS.has(first);
  }
  if (new Set(tokens).size !== tokens.length) {
    return false;
  }
  const cases = tokens.filter((token) => TEXT_TRANSFORM_CASES.has(token));
  const widths = tokens.filter((token) => TEXT_TRANSFORM_WIDTHS.has(token));
  return cases.length <= 1 && cases.length + widths.length === tokens.length;
}

const PROPERTY_PREDICATES: ReadonlyMap<string, ValuePredicate> = new Map([
  ['font-family', isValidFontFamily],
  ['font-weight', isOfferedFontWeight],
  ['letter-spacing', isLetterSpacingLength],
  ['line-height', isLineHeightMultiplier],
  ['text-transform', isValidTextTransform],
]);

export function valuePredicateFor(property: string | undefined): ValuePredicate | undefined {
  if (property === undefined) {
    return undefined;
  }
  return PROPERTY_PREDICATES.get(property.trim().toLowerCase());
}

export function resolveVariableValue(value: string, lookup: VariableLookup): string | undefined {
  return substitute(value, lookup, []);
}

export function variableAccepted(declaredValue: string, lookup: VariableLookup, predicate: ValuePredicate): boolean {
  const computed = resolveVariableValue(declaredValue, lookup);
  if (computed === undefined) {
    return false;
  }
  return predicate(computed);
}

function substitute(value: string, lookup: VariableLookup, chain: readonly string[]): string | undefined {
  assert(chain.length <= VALUE_ACCEPTS_LIMITS.depthMax + 1, 'substitute: the chain stays within the depth bound');
  if (chain.length > VALUE_ACCEPTS_LIMITS.depthMax) {
    return undefined;
  }
  if (value.length > VALUE_ACCEPTS_LIMITS.valueCharsMax) {
    return undefined;
  }
  let result = value;
  for (let count = 0; count <= VALUE_ACCEPTS_LIMITS.substitutionsMax; count += 1) {
    const reference = findReference(result);
    if (reference === undefined) {
      return result;
    }
    if (reference.malformed) {
      return undefined;
    }
    const resolved = referenceValue(reference, lookup, chain);
    if (resolved === undefined) {
      return undefined;
    }
    result = result.slice(0, reference.start) + resolved + result.slice(reference.end);
  }
  return undefined;
}

function referenceValue(reference: Reference, lookup: VariableLookup, chain: readonly string[]): string | undefined {
  if (chain.includes(reference.name)) {
    return undefined;
  }
  const declared = lookup(reference.name);
  if (declared !== undefined) {
    return substitute(declared, lookup, [...chain, reference.name]);
  }
  if (reference.fallback === undefined) {
    return undefined;
  }
  return substitute(reference.fallback, lookup, [...chain, reference.name]);
}

interface Reference {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly fallback: string | undefined;
  readonly malformed: boolean;
}

function findReference(text: string): Reference | undefined {
  const start = text.search(/var\(/i);
  if (start < 0) {
    return undefined;
  }
  const innerStart = start + 4;
  let depth = 1;
  let comma = -1;
  let end = -1;
  for (let index = innerStart; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    } else if (character === ',' && depth === 1 && comma < 0) {
      comma = index;
    }
  }
  if (end < 0) {
    return { start, end: text.length, name: '', fallback: undefined, malformed: true };
  }
  const nameEnd = comma < 0 ? end - 1 : comma;
  const rawName = text.slice(innerStart, nameEnd).trim();
  const fallback = comma < 0 ? undefined : text.slice(comma + 1, end - 1).trim();
  if (/^--[A-Za-z0-9_-]+$/.test(rawName)) {
    return { start, end, name: rawName.slice(2), fallback, malformed: false };
  }
  return { start, end, name: '', fallback: undefined, malformed: true };
}
