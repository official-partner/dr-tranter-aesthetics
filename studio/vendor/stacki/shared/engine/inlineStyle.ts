import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import type { StyleDeclaration } from './intent';

export interface StyleTextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type StyleEditResult =
  | { readonly tag: 'edited'; readonly edits: readonly StyleTextEdit[]; readonly text: string }
  | { readonly tag: 'ambiguous' }
  | { readonly tag: 'unreadable' };

interface Declaration {
  readonly property: string;
  readonly start: number;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly end: number;
}

export interface InlineDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

const IMPORTANT_FLAG = /\s*!\s*important\s*$/i;

export function readInlineStyle(text: string): readonly InlineDeclaration[] | undefined {
  assert(text.length <= LIMITS.attrCharsMax, 'A style value is inside the attribute bound');
  const declarations = scanDeclarations(text);
  if (declarations === undefined) {
    return undefined;
  }
  const read = declarations.map((found): InlineDeclaration => {
    const raw = text.slice(found.valueStart, found.valueEnd);
    const important = IMPORTANT_FLAG.test(raw);
    return { property: found.property, value: important ? raw.replace(IMPORTANT_FLAG, '') : raw, important };
  });
  assert(read.length === declarations.length, 'readInlineStyle: one reading per declaration');
  return read;
}

export function editInlineStyle(text: string, property: string, declaration: StyleDeclaration): StyleEditResult {
  assert(text.length <= LIMITS.attrCharsMax, 'A style value is inside the attribute bound');
  const declarations = scanDeclarations(text);
  if (declarations === undefined) {
    return { tag: 'unreadable' };
  }
  const matching = declarations.filter((found) => sameProperty(found.property, property));
  if (matching.length > 1) {
    return { tag: 'ambiguous' };
  }
  const [found] = matching;
  const edits = declaration.tag === 'set' ? setEdits(text, declarations, found, property, declaration.value) : removeEdits(text, declarations, found);
  return { tag: 'edited', edits, text: applyStyleEdits(text, edits) };
}

export function singleDeclarationChange(before: string, after: string): { readonly property: string; readonly declaration: StyleDeclaration } | undefined {
  const old = scanDeclarations(before);
  const next = scanDeclarations(after);
  if (old === undefined || next === undefined) {
    return undefined;
  }
  const value = (list: readonly Declaration[], text: string, property: string) => {
    const found = list.filter((entry) => sameProperty(entry.property, property));
    if (found.length !== 1) {
      return undefined;
    }
    const [only] = found;
    return only === undefined ? undefined : text.slice(only.valueStart, only.valueEnd);
  };
  const properties = [...new Set([...old, ...next].map((entry) => entry.property))];
  const changed = properties.filter((property) => value(old, before, property) !== value(next, after, property));
  const [property] = changed;
  if (changed.length !== 1 || property === undefined) {
    return undefined;
  }
  const set = value(next, after, property);
  const declaration: StyleDeclaration = set === undefined ? { tag: 'remove' } : { tag: 'set', value: set };
  const edited = editInlineStyle(before, property, declaration);
  if (edited.tag !== 'edited') {
    return undefined;
  }
  return edited.text === after ? { property, declaration } : undefined;
}

export function applyStyleEdits(text: string, edits: readonly StyleTextEdit[]): string {
  let result = '';
  let cursor = 0;
  for (const edit of edits) {
    assert(cursor <= edit.start, 'Style edits ascend without overlapping');
    assert(edit.start <= edit.end, 'A style edit has an order');
    result += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return result + text.slice(cursor);
}

function setEdits(
  text: string,
  declarations: readonly Declaration[],
  found: Declaration | undefined,
  property: string,
  value: string,
): readonly StyleTextEdit[] {
  if (found !== undefined) {
    return [{ start: found.valueStart, end: found.valueEnd, text: value }];
  }
  const last = declarations[declarations.length - 1];
  if (last === undefined) {
    const at = text.trimEnd().length;
    return [{ start: at, end: at, text: `${property}: ${value}` }];
  }
  const closed = text.slice(last.valueEnd, last.end).includes(';');
  return closed
    ? [{ start: last.end, end: last.end, text: ` ${property}: ${value};` }]
    : [{ start: last.valueEnd, end: last.valueEnd, text: `; ${property}: ${value}` }];
}

function removeEdits(text: string, declarations: readonly Declaration[], found: Declaration | undefined): readonly StyleTextEdit[] {
  if (found === undefined) {
    return [];
  }
  const index = declarations.indexOf(found);
  const next = declarations[index + 1];
  if (next !== undefined) {
    return [{ start: found.start, end: next.start, text: '' }];
  }
  const previous = declarations[index - 1];
  const from = previous === undefined ? found.start : text.slice(0, found.start).trimEnd().length;
  return [{ start: from, end: found.end, text: '' }];
}

function sameProperty(left: string, right: string): boolean {
  if (left.startsWith('--')) {
    return left === right;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function scanDeclarations(text: string): readonly Declaration[] | undefined {
  const pieces = splitTopLevel(text);
  if (pieces === undefined) {
    return undefined;
  }
  const declarations: Declaration[] = [];
  for (const piece of pieces) {
    const body = text.slice(piece.start, piece.end);
    if (body.trim() === '') {
      continue;
    }
    const colon = body.indexOf(':');
    if (colon === -1) {
      return undefined;
    }
    const leading = body.length - body.trimStart().length;
    const property = body.slice(leading, colon).trim();
    if (property === '') {
      return undefined;
    }
    const valueRaw = body.slice(colon + 1);
    const valueLead = valueRaw.length - valueRaw.trimStart().length;
    const valueStart = piece.start + colon + 1 + valueLead;
    const valueEnd = piece.start + colon + 1 + valueRaw.trimEnd().length;
    declarations.push({
      property,
      start: piece.start + leading,
      valueStart,
      valueEnd: Math.max(valueStart, valueEnd),
      end: piece.terminated ? piece.end + 1 : Math.max(valueStart, valueEnd),
    });
  }
  return declarations;
}

interface Piece {
  readonly start: number;
  readonly end: number;
  readonly terminated: boolean;
}

function splitTopLevel(text: string): readonly Piece[] | undefined {
  const pieces: Piece[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quote !== undefined) {
      if (char === '\\') {
        index++;
      } else if (char === quote) {
        quote = undefined;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth--;
      if (depth < 0) {
        return undefined;
      }
    } else if (char === ';' && depth === 0) {
      pieces.push({ start, end: index, terminated: true });
      start = index + 1;
    }
  }
  if (quote !== undefined || depth !== 0) {
    return undefined;
  }
  pieces.push({ start, end: text.length, terminated: false });
  return pieces;
}
