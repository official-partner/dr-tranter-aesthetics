
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';

const SUBSTITUTION_PASSES_MAX = 32;

export function customPropertiesIn(text: string): readonly string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const name = match[1];
    if (name !== undefined && names.size < LIMITS.scanEntriesMax) {
      names.add(name);
    }
  }
  return [...names];
}

export function substituteCustomProperties(text: string, values: ReadonlyMap<string, string>): string {
  assert(values.size <= LIMITS.scanEntriesMax, 'substituteCustomProperties: the values are a bounded answer');
  let out = text;
  for (let pass = 0; pass < SUBSTITUTION_PASSES_MAX; pass++) {
    const found = innermostVar(out);
    if (found === undefined) {
      return out;
    }
    const known = values.get(found.name)?.trim() ?? '';
    const replacement = known !== '' ? known : found.fallback;
    out = out.slice(0, found.start) + replacement + out.slice(found.end);
  }
  return out;
}

function innermostVar(text: string): { readonly name: string; readonly fallback: string; readonly start: number; readonly end: number } | undefined {
  for (const match of text.matchAll(/var\(/g)) {
    const start = match.index;
    let depth = 0;
    let close = -1;
    for (let i = start + 3; i < text.length; i++) {
      const char = text[i];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) {
      return undefined;
    }
    const inside = text.slice(start + 4, close);
    if (!inside.includes('var(')) {
      const comma = inside.indexOf(',');
      const name = (comma < 0 ? inside : inside.slice(0, comma)).trim();
      assert(close > start, 'innermostVar: a var() closes after it opens');
      return { name, fallback: comma < 0 ? '' : inside.slice(comma + 1).trim(), start, end: close + 1 };
    }
  }
  return undefined;
}
