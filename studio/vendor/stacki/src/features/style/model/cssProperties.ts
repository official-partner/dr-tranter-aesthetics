import { all } from 'known-css-properties';

const NON_PROPERTIES = new Set([
  'accelerator',
  'additive-symbols',
  'alt',
  'ascent-override',
  'base-palette',
  'behavior',
  'descent-override',
  'fallback',
  'font-display',
  'inherits',
  'initial-value',
  'line-gap-override',
  'negative',
  'override-colors',
  'pad',
  'prefix',
  'range',
  'size-adjust',
  'speak-as',
  'src',
  'suffix',
  'symbols',
  'syntax',
  'system',
  'unicode-range',
]);

export const CSS_PROPERTIES: readonly string[] = Object.freeze(
  [...new Set(all.filter((prop) => !prop.startsWith('--') && !NON_PROPERTIES.has(prop) && (!prop.startsWith('-') || prop.startsWith('-webkit-'))))].sort(
    (left, right) => {
      const av = left.startsWith('-') ? 1 : 0;
      const bv = right.startsWith('-') ? 1 : 0;
      return av - bv || left.localeCompare(right);
    },
  ),
);

export function filterCssProperties(query: string, custom: readonly string[] = []): readonly string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return custom.length ? [...custom, ...CSS_PROPERTIES] : CSS_PROPERTIES;
  }
  const dashed = normalized.startsWith('-');
  const prefix: string[] = [];
  const substring: string[] = [];
  const customPrefix: string[] = [];
  const customSubstring: string[] = [];
  for (const prop of custom) {
    const at = prop.toLowerCase().indexOf(normalized);
    if (at === 0) {
      customPrefix.push(prop);
    } else if (at > 0) {
      customSubstring.push(prop);
    }
  }
  for (const prop of CSS_PROPERTIES) {
    const at = prop.indexOf(normalized);
    if (at === 0) {
      prefix.push(prop);
    } else if (at > 0) {
      substring.push(prop);
    }
  }
  return dashed ? [...customPrefix, ...prefix, ...customSubstring, ...substring] : [...prefix, ...customPrefix, ...substring, ...customSubstring];
}


const NON_NEGATIVE = new Set([
  'gap',
  'row-gap',
  'column-gap',
  'grid-gap',
  'grid-row-gap',
  'grid-column-gap',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block',
  'padding-block-start',
  'padding-block-end',
  'padding-inline',
  'padding-inline-start',
  'padding-inline-end',
]);

export function isNonNegative(prop: string): boolean {
  return NON_NEGATIVE.has(prop.trim().toLowerCase());
}

const NEGATIVE_LENGTH = /(^|[\s,])-(?:\d+\.?\d*|\.\d+)[a-z%]*/gi;

export function clampNonNegative(prop: string, value: string): string {
  if (!isNonNegative(prop) || value.includes('(')) {
    return value;
  }
  return value.replace(NEGATIVE_LENGTH, (_match, lead: string) => `${lead}0`);
}
