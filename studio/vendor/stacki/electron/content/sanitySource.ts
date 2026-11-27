
import { assert } from '../../shared/core/assert';

const ENTRIES_MAX = 256;
const STRING_CHARS_MAX = 1000;

export function ownString(body: string, key: string): string | undefined {
  const at = ownKey(body, key);
  if (at === undefined) {
    return undefined;
  }
  const start = body.slice(at).search(/\S/);
  const quote = start === -1 ? '' : body.charAt(at + start);
  if (quote !== '"' && quote !== "'" && quote !== '`') {
    return undefined;
  }
  return stringAt(body, at + start + 1, quote);
}

export function ownBracketed(body: string, key: string, open: '[' | '{'): string | undefined {
  const at = ownKey(body, key);
  if (at === undefined) {
    return undefined;
  }
  const start = body.slice(at).search(/\S/);
  if (start === -1 || body.charAt(at + start) !== open) {
    return undefined;
  }
  const close = closing(body, at + start);
  return close === undefined ? undefined : body.slice(at + start + 1, close);
}

export function ownSource(body: string, key: string): string | undefined {
  const at = ownKey(body, key);
  if (at === undefined) {
    return undefined;
  }
  const rest = body.slice(at);
  return entries(rest)[0] ?? '';
}

function stringAt(text: string, from: number, quote: string): string | undefined {
  let out = '';
  for (let index = from; index < text.length && out.length <= STRING_CHARS_MAX; index++) {
    const char = text.charAt(index);
    if (char === '\\') {
      const escape = escapeAt(text, index);
      out += escape.text;
      index += escape.length - 1;
    } else if (char === quote) {
      return out;
    } else if (quote === '`' && text.startsWith('${', index)) {
      return undefined;
    } else {
      out += char;
    }
  }
  assert(out.length > 0 || from <= text.length, 'A string read starts inside the text');
  return undefined;
}

export function entryObject(entry: string): string {
  const open = entry.indexOf('{');
  const close = open === -1 ? undefined : closing(entry, open);
  return close === undefined ? '' : entry.slice(open + 1, close);
}

export function entries(list: string): string[] {
  const out: string[] = [];
  let start = 0;
  walk(list, (index, depth) => {
    if (depth === 0 && list.charAt(index) === ',') {
      out.push(list.slice(start, index));
      start = index + 1;
    }
    return out.length < ENTRIES_MAX;
  });
  out.push(list.slice(start));
  return out.filter((entry) => entry.trim() !== '');
}

export function ownKey(body: string, key: string): number | undefined {
  const pattern = new RegExp(`(?<![\\w$])${key}\\s*:`, 'y');
  let found: number | undefined;
  walk(body, (index, depth) => {
    pattern.lastIndex = index;
    const match = depth === 0 ? pattern.exec(body) : undefined;
    if (match) {
      found = index + match[0].length;
    }
    return found === undefined;
  });
  return found;
}

export function closing(text: string, open: number): number | undefined {
  let found: number | undefined;
  walk(text.slice(open), (index, depth) => {
    if (depth === 0 && index > 0) {
      found = open + index;
    }
    return found === undefined;
  });
  assert(found === undefined || found > open, 'A bracket closes after it opens');
  return found;
}

export function walk(text: string, visit: (index: number, depth: number) => boolean): void {
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    const comment = commentEnd(text, index);
    if (comment !== undefined) {
      index = comment;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
    }
    if (!visit(index, depth)) {
      return;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
    }
  }
}

function commentEnd(text: string, index: number): number | undefined {
  if (text.startsWith('//', index)) {
    const end = text.indexOf('\n', index);
    return end === -1 ? text.length : end;
  }
  if (text.startsWith('/*', index)) {
    const end = text.indexOf('*/', index + 2);
    return end === -1 ? text.length : end + 1;
  }
  return undefined;
}

function escapeAt(text: string, index: number): { readonly text: string; readonly length: number } {
  const unicode = /^\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/.exec(text.slice(index, index + 10));
  const hex = /^\\x([0-9a-fA-F]{2})/.exec(text.slice(index, index + 4));
  if (unicode) {
    const code = parseInt(unicode[1] ?? unicode[2] ?? '', 16);
    if (code <= 0x10ffff) {
      return { text: String.fromCodePoint(code), length: unicode[0].length };
    }
  }
  if (hex) {
    return { text: String.fromCharCode(parseInt(hex[1] ?? '0', 16)), length: hex[0].length };
  }
  const next = text.charAt(index + 1);
  const named: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r' };
  assert(next.length <= 1, 'An escape names one character');
  return { text: named[next] ?? next, length: 2 };
}
