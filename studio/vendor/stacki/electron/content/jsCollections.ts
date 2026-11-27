
import { assert } from '../../shared/core/assert';
import { CODE_INDENT_UNIT } from '../../shared/core/indent';
import { LIMITS } from '../../shared/core/limits';
import { toRecord } from '../../shared/core/record';

const SCAN_LIMITS = { templateDepthMax: 64 } as const;

const ID_KEY = /^[A-Za-z_$][\w$]*$/;

const EXPR = '__expr';

interface ExprMarker {
  readonly __expr: string;
}

const isExpr = (value: unknown): value is ExprMarker => typeof toRecord(value)?.[EXPR] === 'string';

function skipQuoted(source: string, start: number, depth = 0): number {
  if (depth > SCAN_LIMITS.templateDepthMax) {
    return source.length;
  }
  const quote = source.charAt(start);
  let i = start + 1;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && source.charAt(i + 1) === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const character = source.charAt(i);
        if (character === '"' || character === "'" || character === '`') {
          i = skipQuoted(source, i, depth + 1);
          continue;
        }
        if (character === '{') {
          depth += 1;
        } else if (character === '}') {
          depth -= 1;
        }
        i += 1;
      }
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    i += 1;
  }
  return i;
}

const NEXT_STATEMENT = /^(?:(?:export|import|const|let|var|function|class|return|if|for|while|switch|try)\b|\}|---)/;

function scanStatement(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(source, i);
      continue;
    }
    if (source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth += 1;
    } else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth < 0) {
        return i;
      }
    } else if (ch === ';' && depth === 0) {
      return i;
    } else if (ch === '\n' && depth === 0) {
      const next = skipTrivia(source, i);
      if (next >= source.length || NEXT_STATEMENT.test(source.slice(next, next + 10))) {
        return i;
      }
    }
    i += 1;
  }
  return i;
}

function skipTrivia(source: string, start: number): number {
  let i = start;
  for (let pass = 0; pass <= source.length; pass++) {
    while (i < source.length && /\s/.test(source.charAt(i))) {
      i += 1;
    }
    if (source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    return i;
  }
  assert(false, 'Trivia ends within its text');
}

class Unsupported extends Error {}

interface Parsed {
  readonly value: unknown;
  readonly next: number;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

function parseString(source: string, start: number): { value: string; next: number } {
  const quote = source.charAt(start);
  let out = '';
  let i = start + 1;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === '\\') {
      const next = source.charAt(i + 1);
      if (next === 'u') {
        if (source.charAt(i + 2) === '{') {
          const close = source.indexOf('}', i + 3);
          out += String.fromCodePoint(parseInt(source.slice(i + 3, close), 16));
          i = close + 1;
        } else {
          out += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
          i += 6;
        }
        continue;
      }
      out += SIMPLE_ESCAPES[next] ?? (next || String(undefined));
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { value: out, next: i + 1 };
    }
    if (quote === '`' && ch === '$' && source.charAt(i + 1) === '{') {
      throw new Unsupported('template expression');
    }
    out += ch;
    i += 1;
  }
  throw new Unsupported('unterminated string');
}

function parseValue(source: string, start: number, depth = 0): Parsed {
  if (depth > LIMITS.ipcDepthMax) {
    throw new Unsupported('nested too deeply');
  }
  const i = skipTrivia(source, start);
  const ch = source.charAt(i);
  if (ch === '"' || ch === "'" || ch === '`') {
    return parseString(source, i);
  }
  if (ch === '[') {
    return parseArray(source, i, depth);
  }
  if (ch === '{') {
    return parseObject(source, i, depth);
  }
  const word = parseWord(source, i);
  if (word !== undefined) {
    return word;
  }
  const numberMatch = /^-?(?:0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|\.\d+)/.exec(source.slice(i));
  if (numberMatch) {
    return { value: Number(numberMatch[0].replace(/_/g, '')), next: i + numberMatch[0].length };
  }
  const name = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(source.slice(i));
  if (name) {
    const after = skipTrivia(source, i + name[0].length);
    const at = source.charAt(after);
    if (after >= source.length || at === ',' || at === ']' || at === '}') {
      return { value: { [EXPR]: name[0] }, next: i + name[0].length };
    }
  }
  throw new Unsupported('not a literal');
}

function parseArray(source: string, open: number, depth: number): Parsed {
  assert(source.charAt(open) === '[', 'parseArray: starts at its bracket');
  const items: unknown[] = [];
  let i = skipTrivia(source, open + 1);
  while (source.charAt(i) !== ']') {
    if (i >= source.length) {
      throw new Unsupported('unterminated array');
    }
    const value = parseValue(source, i, depth + 1);
    assert(value.next > i, 'parseArray: every item consumes source');
    items.push(value.value);
    i = skipTrivia(source, value.next);
    if (source.charAt(i) === ',') {
      i = skipTrivia(source, i + 1);
    }
  }
  return { value: items, next: i + 1 };
}

function parseObject(source: string, open: number, depth: number): Parsed {
  assert(source.charAt(open) === '{', 'parseObject: starts at its brace');
  const record: Record<string, unknown> = {};
  let i = skipTrivia(source, open + 1);
  while (source.charAt(i) !== '}') {
    if (i >= source.length) {
      throw new Unsupported('unterminated object');
    }
    if (source.startsWith('...', i)) {
      throw new Unsupported('spread');
    }
    let key: string;
    const keyQuote = source.charAt(i);
    if (keyQuote === '"' || keyQuote === "'") {
      const quotedKey = parseString(source, i);
      key = quotedKey.value;
      i = skipTrivia(source, quotedKey.next);
    } else {
      const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
      if (!match) {
        throw new Unsupported('computed or unusual key');
      }
      key = match[0];
      i = skipTrivia(source, i + match[0].length);
    }
    if (source.charAt(i) !== ':') {
      throw new Unsupported('shorthand or method');
    }
    const value = parseValue(source, i + 1, depth + 1);
    assert(value.next > i, 'parseObject: every value consumes source');
    record[key] = value.value;
    i = skipTrivia(source, value.next);
    if (source.charAt(i) === ',') {
      i = skipTrivia(source, i + 1);
    }
  }
  return { value: record, next: i + 1 };
}

function parseWord(source: string, at: number): Parsed | undefined {
  const word = /^(true|false|null|undefined)\b/.exec(source.slice(at));
  const wordText = word?.[1];
  if (word === null || wordText === undefined) {
    return undefined;
  }
  const next = at + word[0].length;
  if (wordText === 'true') {
    return { value: true, next };
  }
  if (wordText === 'false') {
    return { value: false, next };
  }
  // eslint-disable-next-line stacki/no-null -- The file's own null: data it holds, not absence.
  return { value: null, next };
}

interface ScanOptions {
  readonly requireExport?: boolean;
  readonly allowPlainLists?: boolean;
}

const declRe = (tail: string, { requireExport }: { readonly requireExport: boolean }): RegExp =>
  new RegExp(`${requireExport ? 'export\\s+' : '(?:^|[\\n;{])[ \\t]*(?:export\\s+)?'}` + `const\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*${tail}`, 'g');

export interface Collection {
  readonly name: string;
  readonly data: unknown[] | undefined;
  readonly start: number;
  readonly end: number;
  readonly reason?: string;
}

function findCollections(source: string, options: ScanOptions = {}): Collection[] {
  const { requireExport = true, allowPlainLists = false } = options;
  const out: Collection[] = [];
  const re = declRe('\\[', { requireExport });
  let match;
  while ((match = re.exec(source)) !== null) {
    const name = match[1];
    if (name === undefined) {
      continue;
    }
    const start = match.index + match[0].length - 1;
    let parsed: Parsed;
    try {
      parsed = parseValue(source, start);
    } catch (error: unknown) {
      out.push({
        name,
        data: undefined,
        start,
        end: start,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const value = parsed.value;
    if (!Array.isArray(value)) {
      continue;
    }
    const list: unknown[] = value;
    const isRecords = list.length > 0 && list.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
    const isPlainList = allowPlainLists && list.every((item) => item === null || typeof item !== 'object');
    if (!isRecords && !isPlainList) {
      continue;
    }
    out.push({ name, data: list, start, end: parsed.next });
  }
  return out;
}


const WIDTH = 80;

const quote = (value: unknown): string => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

function literal(value: unknown, indent: string, pad: string, depth = 0): string {
  if (depth > LIMITS.ipcDepthMax) {
    throw new Error('literal: the value nests deeper than a file can hold');
  }
  if (isExpr(value)) {
    return value[EXPR];
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'string') {
    return quote(value);
  }
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (!list.length) {
      return '[]';
    }
    const inner = pad + indent;
    const items = list.map((item) => inner + literal(item, indent, inner, depth + 1));
    return `[\n${items.join(',\n')},\n${pad}]`;
  }
  const record = toRecord(value);
  if (!record) {
    return '{}';
  }
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return '{}';
  }
  const pair = ([name, value]: [string, unknown]): string => `${ID_KEY.test(name) ? name : quote(name)}: ${literal(value, indent, pad + indent, depth + 1)}`;
  const oneLine = `{ ${entries.map(pair).join(', ')} }`;
  if (pad.length + oneLine.length + 1 <= WIDTH && !oneLine.includes('\n')) {
    return oneLine;
  }
  const inner = pad + indent;
  return `{\n${entries
    .map(([name, value]) => {
      const key = ID_KEY.test(name) ? name : quote(name);
      const rendered = literal(value, indent, inner, depth + 1);
      if (!rendered.includes('\n') && inner.length + key.length + 2 + rendered.length + 1 > WIDTH) {
        return `${inner}${key}:\n${inner}${indent}${rendered}`;
      }
      return `${inner}${key}: ${rendered}`;
    })
    .join(',\n')},\n${pad}}`;
}

function serializeCollection(data: readonly unknown[], indent = CODE_INDENT_UNIT): string {
  if (!data.length) {
    return '[]';
  }
  return `[\n${data.map((row) => indent + literal(row, indent, indent)).join(',\n')},\n]`;
}

function indentOf(text: string, fallback: string): string {
  const re = /\n([ \t]+)(\S)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const lead = match[1];
    if (match[2] === '*' || lead === undefined) {
      continue;
    }
    return lead.charAt(0) === '\t' ? '\t' : ' '.repeat(lead.length);
  }
  return fallback;
}

function replaceCollection(source: string, name: string, data: readonly unknown[], options?: ScanOptions): string | undefined {
  const found = findCollections(source, options).find((collection) => collection.name === name);
  if (!found || found.data === undefined) {
    return undefined;
  }
  const indent = indentOf(source.slice(found.start, found.end), indentOf(source, CODE_INDENT_UNIT));
  return source.slice(0, found.start) + serializeCollection(data, indent) + source.slice(found.end);
}


const GENERAL = '*general';

interface ScalarExport {
  readonly name: string;
  readonly value: unknown;
  readonly start: number;
  readonly end: number;
  readonly code?: boolean;
}

function findScalarExports(source: string, options: ScanOptions = {}): ScalarExport[] {
  const out: ScalarExport[] = [];
  const re = declRe('', { requireExport: options.requireExport !== false });
  let match;
  while ((match = re.exec(source)) !== null) {
    const name = match[1];
    if (name === undefined) {
      continue;
    }
    const start = match.index + match[0].length;
    let parsed: Parsed;
    try {
      parsed = parseValue(source, start);
    } catch {
      const end = scanStatement(source, start);
      const text = source.slice(start, end).trim();
      if (text) {
        out.push({ name, value: { [EXPR]: text }, start, end: start + text.length, code: true });
      }
      continue;
    }
    const value = parsed.value;
    if (Array.isArray(value) && !isPlainValues(value, options)) {
      continue;
    }
    out.push({ name, value: value, start, end: parsed.next });
  }
  return out;
}

function isPlainValues(list: readonly unknown[], options: ScanOptions): boolean {
  if (options.allowPlainLists === true) {
    return false;
  }
  return list.every((item) => item === null || typeof item !== 'object');
}

function readGeneral(source: string, options?: ScanOptions): Record<string, unknown> | undefined {
  const found = findScalarExports(source, options);
  if (!found.length) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const scalar of found) {
    out[scalar.name] = scalar.value;
  }
  return out;
}

function writeGeneral(source: string, data: Record<string, unknown>, options?: ScanOptions): string {
  const found = findScalarExports(source, options).filter((scalar) => Object.prototype.hasOwnProperty.call(data, scalar.name));
  let out = source;
  for (const scalar of [...found].reverse()) {
    const next = data[scalar.name];
    if (isExpr(scalar.value) || isExpr(next)) {
      if (isExpr(next) && isExpr(scalar.value) && next[EXPR] === scalar.value[EXPR]) {
        continue;
      }
    } else if (next === scalar.value || JSON.stringify(next) === JSON.stringify(scalar.value)) {
      continue;
    }
    out = out.slice(0, scalar.start) + literal(next, indentOf(source, CODE_INDENT_UNIT), '') + out.slice(scalar.end);
  }
  return out;
}

export { EXPR, isExpr, findCollections, replaceCollection, serializeCollection, findScalarExports, readGeneral, writeGeneral, GENERAL };
