
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';

export interface ScalarItem {
  readonly text: string;
  readonly quote: string | undefined;
  readonly fields?: undefined;
}

export interface ItemField {
  readonly key: string;
  readonly keyQuote: string | undefined;
  readonly text: string;
  readonly quote: string | undefined;
}

export interface ObjectItem {
  readonly fields: readonly ItemField[];
  readonly text?: undefined;
  readonly quote?: undefined;
}

export type Item = ScalarItem | ObjectItem;

type ItemDraft = { text: string; quote: string | undefined } | { fields: ItemField[] };

const NUMBER_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)$/;

const NESTING_DEPTH_MAX = LIMITS.listFieldDepthMax - 1;

function objectFrom(source: string, nesting: number): { fields: ItemField[] } | undefined {
  const body = source.trim().slice(1, -1);
  const parts = splitTop(body);
  if (!parts) {
    return undefined;
  }
  const fields: ItemField[] = [];
  for (const [i, part] of parts.entries()) {
    if (!part.trim()) {
      if (i === parts.length - 1) {
        continue;
      }
      return undefined;
    }
    const colon = topColon(part);
    if (colon === -1) {
      return undefined;
    }
    const rawKey = part.slice(0, colon).trim();
    const key = /^(['"`])(.*)\1$/.test(rawKey) ? rawKey.slice(1, -1) : rawKey;
    const first = rawKey.charAt(0);
    const keyQuote = first === '"' || first === "'" ? first : undefined;
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
      return undefined;
    }
    const raw = part.slice(colon + 1).trim();
    if (raw === 'true' || raw === 'false') {
      fields.push({ key, keyQuote, text: raw, quote: undefined });
      continue;
    }
    if (raw.startsWith('[') || raw.startsWith('{')) {
      if (nestedItems(raw, nesting + 1) === undefined) {
        return undefined;
      }
      fields.push({ key, keyQuote, text: raw, quote: undefined });
      continue;
    }
    const value = itemFrom(raw, nesting) ?? codeFrom(raw);
    if (!value || 'fields' in value) {
      return undefined;
    }
    fields.push({ key, keyQuote, text: value.text, quote: value.quote });
  }
  return fields.length ? { fields } : undefined;
}

function codeFrom(raw: string): ItemDraft | undefined {
  if (raw === '' || raw.startsWith('{') || raw.startsWith('[')) {
    return undefined;
  }
  return { text: raw, quote: undefined };
}

export function fieldHoldsCode(field: Pick<ItemField, 'text' | 'quote'>): boolean {
  if (field.quote !== undefined) {
    return false;
  }
  const nested = nestedItems(field.text);
  if (nested !== undefined) {
    return itemsHoldCode(nested);
  }
  return field.text !== 'true' && field.text !== 'false' && !NUMBER_TEXT.test(field.text);
}

export function itemsHoldCode(items: readonly Item[]): boolean {
  return items.some((item) => (item.fields ?? []).some(fieldHoldsCode));
}

export function nestedItems(source: string, nesting = 1): Item[] | undefined {
  const text = source.trim();
  if (nesting > NESTING_DEPTH_MAX) {
    return undefined;
  }
  if (text.startsWith('[')) {
    return arrayItems(text, nesting);
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    const object = objectFrom(text, nesting);
    return object === undefined ? undefined : [object];
  }
  return undefined;
}

function topColon(part: string): number {
  let depth = 0;
  for (let i = 0; i < part.length; i++) {
    const character = part.charAt(i);
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      i++;
      while (i < part.length && part.charAt(i) !== quote) {
        i += part.charAt(i) === '\\' ? 2 : 1;
      }
      continue;
    }
    if (character === '[' || character === '(' || character === '{') {
      depth++;
    } else if (character === ']' || character === ')' || character === '}') {
      depth--;
    } else if (character === ':' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function itemFrom(source: string, nesting: number): ItemDraft | undefined {
  const text = source.trim();
  if (!text) {
    return undefined;
  }
  if (text.charAt(0) === '{' && text.charAt(text.length - 1) === '}') {
    return objectFrom(text, nesting);
  }
  const quote = text.charAt(0);
  if (quote === '"' || quote === "'" || quote === '`') {
    if (text.length < 2 || text.charAt(text.length - 1) !== quote) {
      return undefined;
    }
    const body = text.slice(1, -1);
    if (quote === '`' && /\$\{/.test(body)) {
      return undefined;
    }
    for (let i = 0; i < body.length; i++) {
      if (body.charAt(i) === '\\') {
        i++;
        continue;
      }
      if (body.charAt(i) === quote) {
        return undefined;
      }
    }
    return { text: body.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n'), quote };
  }
  if (NUMBER_TEXT.test(text)) {
    return { text, quote: undefined };
  }
  return undefined;
}

function splitTop(body: string): string[] | undefined {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < body.length; i++) {
    const character = body.charAt(i);
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      i++;
      while (i < body.length && body.charAt(i) !== quote) {
        i += body.charAt(i) === '\\' ? 2 : 1;
      }
      if (i >= body.length) {
        return undefined;
      }
      continue;
    }
    if (character === '[' || character === '(' || character === '{') {
      depth++;
    } else if (character === ']' || character === ')' || character === '}') {
      depth--;
      if (depth < 0) {
        return undefined;
      }
    } else if (character === ',' && depth === 0) {
      out.push(body.slice(last, i));
      last = i + 1;
    }
  }
  if (depth !== 0) {
    return undefined;
  }
  out.push(body.slice(last));
  return out;
}

export function arrayItems(source: unknown, nesting = 0, mode: ItemMode = 'literal'): Item[] | undefined {
  assert(nesting <= NESTING_DEPTH_MAX, 'arrayItems: a list nests within its bound');
  const text = String(source ?? '').trim();
  if (!text.startsWith('[') || !text.endsWith(']')) {
    return undefined;
  }
  const parts = splitTop(text.slice(1, -1));
  if (!parts) {
    return undefined;
  }
  const items: Item[] = [];
  for (const [i, part] of parts.entries()) {
    if (!part.trim()) {
      if (i === parts.length - 1) {
        continue;
      }
      return undefined;
    }
    const item = itemFrom(part, nesting) ?? (mode === 'bindable' ? scalarCodeFrom(part) : undefined);
    if (!item) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}

export type ItemMode = 'literal' | 'bindable';

function scalarCodeFrom(source: string): ScalarItem | undefined {
  const text = source.trim();
  if (text === '' || text.startsWith('...') || text.startsWith('{') || text.startsWith('[')) {
    return undefined;
  }
  assert(text.length <= LIMITS.attrCharsMax, 'scalarCodeFrom: an item is bounded');
  return { text, quote: undefined };
}

export function itemHoldsCode(item: Item): boolean {
  return item.fields === undefined && item.quote === undefined && item.text !== 'true' && item.text !== 'false' && !NUMBER_TEXT.test(item.text);
}

function quoted(item: { readonly text: string; readonly quote: string | undefined | undefined }, fallback: string): string {
  const quote = item.quote || fallback;
  const body = String(item.text).replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`).replace(/\n/g, '\\n');
  return `${quote}${body}${quote}`;
}

export function arrayText(items: readonly Item[] | undefined): string {
  const list = items ?? [];
  const fallback = list.find((item) => item.quote)?.quote || list.flatMap((item) => item.fields ?? []).find((field) => field.quote)?.quote || '"';
  const one = (item: Item): string => {
    if (item.fields) {
      const inner = item.fields
        .map(
          (field) =>
            `${field.keyQuote ? `${field.keyQuote}${field.key}${field.keyQuote}` : field.key}: ${
              field.quote === undefined ? String(field.text) : quoted(field, fallback)
            }`,
        )
        .join(', ');
      return `{ ${inner} }`;
    }
    return item.quote === undefined ? String(item.text) : quoted(item, fallback);
  };
  return `[${list.map(one).join(', ')}]`;
}

export interface ObjectRow {
  readonly key: string;
  readonly keyQuote: string | undefined;
  readonly kind: 'list' | 'boolean' | 'number' | 'text';
  readonly text?: string;
  readonly quote?: string | undefined;
  readonly items?: readonly Item[];
}

export function objectFields(source: unknown): ObjectRow[] | undefined {
  const text = String(source ?? '').trim();
  if (!text.startsWith('{') || !text.endsWith('}')) {
    return undefined;
  }
  const parts = splitTop(text.slice(1, -1));
  if (!parts) {
    return undefined;
  }
  const out: ObjectRow[] = [];
  for (const [i, part] of parts.entries()) {
    if (!part.trim()) {
      if (i === parts.length - 1) {
        continue;
      }
      return undefined;
    }
    const colon = topColon(part);
    if (colon === -1) {
      return undefined;
    }
    const rawKey = part.slice(0, colon).trim();
    const key = /^(['"`])(.*)\1$/.test(rawKey) ? rawKey.slice(1, -1) : rawKey;
    const first = rawKey.charAt(0);
    const keyQuote = first === '"' || first === "'" ? first : undefined;
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
      return undefined;
    }
    const raw = part.slice(colon + 1).trim();
    if (raw.startsWith('[')) {
      const items = arrayItems(raw);
      if (!items) {
        return undefined;
      }
      out.push({ key, keyQuote, kind: 'list', items });
      continue;
    }
    if (raw === 'true' || raw === 'false') {
      out.push({ key, keyQuote, kind: 'boolean', text: raw, quote: undefined });
      continue;
    }
    const value = itemFrom(raw, 0);
    if (!value || 'fields' in value) {
      return undefined;
    }
    out.push({
      key,
      keyQuote,
      kind: value.quote === undefined ? 'number' : 'text',
      text: value.text,
      quote: value.quote,
    });
  }
  return out.length ? out : undefined;
}

export function objectText(fields: readonly ObjectRow[] | undefined): string {
  const list = fields ?? [];
  const fallback = list.find((row) => row.quote)?.quote || list.flatMap((row) => row.items ?? []).find((item) => item.quote)?.quote || '"';
  const one = (row: ObjectRow): string => {
    const name = row.keyQuote ? `${row.keyQuote}${row.key}${row.keyQuote}` : row.key;
    if (row.items) {
      return `${name}: ${arrayText(row.items)}`;
    }
    const valueText = row.quote === undefined ? String(row.text) : quoted({ text: row.text ?? '', quote: row.quote }, fallback);
    return `${name}: ${valueText}`;
  };
  return `{ ${list.map(one).join(', ')} }`;
}

const NAMES = ['label', 'name', 'title', 'text', 'value'] as const;

export function itemLabel(item: Item | undefined): string {
  if (!item) {
    return '';
  }
  if (!item.fields) {
    return String(item.text);
  }
  for (const want of NAMES) {
    const field = item.fields.find((candidate) => {
      return candidate.key === want && String(candidate.text).trim();
    });
    if (field) {
      return String(field.text);
    }
  }
  const words = item.fields.find((field) => field.quote !== undefined && String(field.text).trim());
  return String((words ?? item.fields[0])?.text ?? '');
}

export function blankLike(items: readonly Item[] | undefined): Item {
  const shape = (items ?? []).find((item) => item.fields);
  const quote = (items ?? []).find((item) => item.quote)?.quote || '"';
  if (!shape || !shape.fields) {
    return { text: '', quote };
  }
  return { fields: shape.fields.map((field) => blankLikeField(field, quote, 1)) };
}

function blankLikeField(field: ItemField, quote: string, depth: number): ItemField {
  assert(depth <= LIMITS.listFieldDepthMax, 'blankLikeField: a field nests within its bound');
  const nested = field.quote === undefined ? nestedItems(field.text) : undefined;
  const object = nested?.[0]?.fields;
  if (nested !== undefined && field.text.trim().startsWith('[')) {
    return { key: field.key, keyQuote: field.keyQuote, text: '[]', quote: undefined };
  }
  if (object !== undefined) {
    const inner = object.map((own) => blankLikeField(own, quote, depth + 1));
    return { key: field.key, keyQuote: field.keyQuote, text: arrayText([{ fields: inner }]).slice(1, -1), quote: undefined };
  }
  return { key: field.key, keyQuote: field.keyQuote, text: '', quote: field.quote ?? quote };
}

export function moveItem<T>(items: readonly T[] | undefined, from: number, to: number): T[] {
  const list = [...(items ?? [])];
  if (!Number.isInteger(from) || from < 0 || from >= list.length) {
    return list;
  }
  const gap = Math.max(0, Math.min(list.length, Math.trunc(to)));
  if (gap === from || gap === from + 1) {
    return list;
  }
  const [moved] = list.splice(from, 1);
  if (moved === undefined) {
    return list;
  }
  list.splice(gap > from ? gap - 1 : gap, 0, moved);
  return list;
}
