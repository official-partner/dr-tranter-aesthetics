
import { CSS_VARIABLE_LIMITS } from './cssVarRead';

export const NAMED_COLORS = new Set([
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
  'cyan',
  'magenta',
  'lime',
  'navy',
  'teal',
  'olive',
  'maroon',
  'silver',
  'gold',
  'beige',
  'ivory',
  'coral',
  'salmon',
  'khaki',
  'indigo',
  'violet',
]);

export const COLOR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

export interface ValueLookup {
  get(name: string): string | undefined;
}

export function resolveValue(value: unknown, map: ValueLookup, depth = 0): string {
  if (depth > CSS_VARIABLE_LIMITS.resolveDepthMax) {
    return String(value);
  }
  const next = String(value).replace(
    /var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
    (whole: string, name: string, fallback: string | undefined) => {
      const found = map.get(name);
      if (found !== undefined) {
        return found;
      }
      return fallback !== undefined ? fallback.trim() : whole;
    },
  );
  return next === String(value) ? next : resolveValue(next, map, depth + 1);
}

export function colorOf(resolved: unknown): string | undefined {
  const value = String(resolved).trim();
  if (!value) {
    return undefined;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(value)) {
    return value;
  }
  if (COLOR_FUNCTION.test(value)) {
    return value;
  }
  if (NAMED_COLORS.has(value.toLowerCase())) {
    return value;
  }
  return undefined;
}

export const isUncomputableColor = (resolved: unknown): boolean => /(^|\s|\()color-mix\(/i.test(String(resolved));

export const FONT_WORDS = new RegExp(
  '(serif|sans-serif|monospace|cursive|system-ui|uppercase|lowercase|capitalize|' + 'balance|pretty|italic|normal|inherit)',
  'i',
);

export function kindOf(value: unknown, resolved: unknown): string {
  const text = String(resolved ?? value).trim();
  if (!text) {
    return 'size';
  }
  if (colorOf(text) || isUncomputableColor(text)) {
    return 'color';
  }
  if (/^-?\d*\.?\d+$/.test(text)) {
    return 'number';
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(text)) {
    return 'percentage';
  }
  if (/^-?\d*\.?\d+([a-z%]+)$/i.test(text) || /^(calc|clamp|min|max)\(/i.test(text)) {
    return 'size';
  }
  if (/[a-z]/i.test(text) && (FONT_WORDS.test(text) || text.includes(',') || /^[a-z-]+$/i.test(text))) {
    return 'font';
  }
  return 'size';
}
