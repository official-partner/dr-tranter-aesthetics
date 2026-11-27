import type { Attr } from '../../shared/page/pageNode';
import { TYPE_OPERATORS } from './dataScope';
import { assert } from '../../shared/core/assert';
import type { ImportNeed } from './dataSample';

interface BindableNode {
  readonly props?: Record<string, { readonly type?: string } | undefined> | undefined;
  readonly children?: readonly { readonly kind?: string; readonly value?: string }[] | undefined;
}

export function isDataBound(node: BindableNode | undefined): boolean {
  if (!node) {
    return false;
  }
  for (const value of Object.values(node.props ?? {})) {
    if (value?.type === 'expr') {
      return true;
    }
  }
  for (const child of node.children ?? []) {
    if (child.kind === 'expr') {
      return true;
    }
    if (child.kind === 'text' && /\{[^{}]*\}/.test(child.value ?? '')) {
      return true;
    }
  }
  return false;
}

export const BIND_PATH_RE = /^[A-Za-z_$][\w$]*(?:\[(?:\d+|"(?:[^"\\]|\\.)*")\])*(?:\.[A-Za-z_$][\w$]*(?:\[(?:\d+|"(?:[^"\\]|\\.)*")\])*)*$/;

export interface TemplateHole {
  readonly from: number;
  readonly to: number;
  readonly path: string;
}

export function templateHoles(text: unknown): TemplateHole[] {
  const source = String(text ?? '');
  const out: TemplateHole[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.charAt(i) === '\\') {
      i += 2;
      continue;
    }
    if (source.charAt(i) !== '$' || source.charAt(i + 1) !== '{') {
      i += 1;
      continue;
    }
    const close = source.indexOf('}', i + 2);
    if (close === -1) {
      break;
    }
    const path = source.slice(i + 2, close).trim();
    if (BIND_PATH_RE.test(path)) {
      out.push({ from: i, to: close + 1, path });
    }
    i = close + 1;
  }
  return out;
}


export interface Part {
  readonly text?: string;
  readonly expr?: string;
}

const unescapeTpl = (text: string): string =>
  String(text)
    .replace(/\\`/g, '`')
    .replace(/\\\$\{/g, '${')
    .replace(/\\\\/g, '\\');

const escapeTpl = (text: string | undefined): string => String(text).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const CODE_WORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'new',
  'typeof',
  'void',
  'delete',
  'in',
  'of',
  'instanceof',
  'await',
  'return',
  'if',
  'else',
  'this',
]);

const NOT_SIMPLE = /[(){}`]|=>|\[\s*[^\d\s]/;

export function codeParts(source: unknown): Part[] | undefined {
  const text = String(source || '');
  if (NOT_SIMPLE.test(text)) {
    return undefined;
  }
  const out: Part[] = [];
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const character = text.charAt(i);
    if (character === '"' || character === "'") {
      i += 1;
      while (i < text.length && text.charAt(i) !== character) {
        i += text.charAt(i) === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }
    if (!/[A-Za-z_$]/.test(character)) {
      i += 1;
      continue;
    }
    let j = i;
    const word = (): void => {
      while (j < text.length && /[\w$]/.test(text.charAt(j))) {
        j += 1;
      }
      while (/^\[\d+\]/.test(text.slice(j))) {
        j += text.slice(j).indexOf(']') + 1;
      }
    };
    word();
    while (text.charAt(j) === '.' && /[A-Za-z_$]/.test(text.charAt(j + 1))) {
      j += 1;
      word();
    }
    const optional = text.charAt(i - 1) === '.' && text.charAt(i - 2) === '?';
    if (text.charAt(i - 1) === '.' && !optional) {
      i = j;
      continue;
    }
    const from = optional ? i - 1 : i;
    const name = text.slice(from, j);
    if (TYPE_OPERATORS.has(name)) {
      break;
    }
    if (!CODE_WORDS.has(name.replace(/^\./, '').split('.')[0] ?? '')) {
      if (from > last) {
        out.push({ text: text.slice(last, from) });
      }
      out.push({ expr: name });
      last = j;
    }
    i = j;
  }
  if (last < text.length) {
    out.push({ text: text.slice(last) });
  }
  return out.some((part) => part.expr !== undefined) && out.some((part) => part.text !== undefined) ? out : undefined;
}

interface ValueLike {
  readonly type?: string;
  readonly value?: unknown;
}

export function valueModeOf(value: ValueLike | undefined): 'text' | 'code' {
  if (!value || value.type !== 'expr') {
    return 'text';
  }
  const source = String(value.value ?? '').trim();
  if (!source || BIND_PATH_RE.test(source)) {
    return 'text';
  }
  if (/^(['"`])/.test(source)) {
    return 'text';
  }
  return codeParts(source) ? 'code' : 'text';
}

export function partsFromValue(value: ValueLike | undefined): Part[] | undefined {
  if (!value) {
    return [];
  }
  if (value.type !== 'expr') {
    return value.value === '' ? [] : [{ text: String(value.value) }];
  }
  const source = String(value.value ?? '').trim();
  if (!source) {
    return [];
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(source) || /^(true|false|null|undefined)$/.test(source)) {
    return [{ text: source }];
  }
  if (BIND_PATH_RE.test(source)) {
    return [{ expr: source }];
  }
  const quoted = source.match(/^(['"])((?:[^\\]|\\.)*)\1$/);
  if (quoted) {
    return [{ text: (quoted[2] ?? '').replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1') }];
  }
  const tpl = source.match(/^`([\s\S]*)`$/);
  if (!tpl) {
    return codeParts(source);
  }
  const body = tpl[1] ?? '';
  const out: Part[] = [];
  let last = 0;
  let i = 0;
  while (i < body.length) {
    if (body.charAt(i) === '\\') {
      i += 2;
      continue;
    }
    if (body.charAt(i) !== '$' || body.charAt(i + 1) !== '{') {
      i++;
      continue;
    }
    const close = body.indexOf('}', i + 2);
    if (close === -1) {
      return undefined;
    }
    const expr = body.slice(i + 2, close).trim();
    if (!BIND_PATH_RE.test(expr)) {
      return undefined;
    }
    if (i > last) {
      out.push({ text: unescapeTpl(body.slice(last, i)) });
    }
    out.push({ expr });
    i = close + 1;
    last = i;
  }
  if (last < body.length) {
    out.push({ text: unescapeTpl(body.slice(last)) });
  }
  return out;
}

export function valueFromParts(
  parts: readonly Part[] | undefined,
  { numeric, mode }: { readonly numeric?: boolean; readonly mode?: string } = {},
): Extract<Attr, { readonly type: 'string' | 'expr' }> | undefined {
  const clean = (parts ?? []).filter((part) => (part.expr !== undefined ? String(part.expr).trim() !== '' : part.text !== ''));
  if (!clean.length) {
    return undefined;
  }
  if (mode === 'code' && clean.some((part) => part.expr !== undefined)) {
    return {
      type: 'expr',
      value: clean.map((part) => (part.expr !== undefined ? part.expr : part.text)).join(''),
    };
  }
  const only = clean.length === 1 ? clean[0] : undefined;
  if (only !== undefined && only.expr !== undefined) {
    return { type: 'expr', value: String(only.expr).trim() };
  }
  if (clean.every((part) => part.text !== undefined)) {
    const text = clean.map((part) => part.text).join('');
    return { type: numeric ? 'expr' : 'string', value: text };
  }
  const body = clean
    .map((part) => {
      return part.expr !== undefined ? `\${${String(part.expr).trim()}}` : escapeTpl(part.text);
    })
    .join('');
  return { type: 'expr', value: `\`${body}\`` };
}

export type PickNeed =
  | { readonly kind: 'collection'; readonly collection: string; readonly name: string }
  | { readonly kind: 'import'; readonly import: ImportNeed; readonly name: string };

interface BindContext {
  readonly ensureQuery?: (collection: string) => string | undefined;
  readonly ensureImport?: (need: ImportNeed) => string | undefined;
}

export function resolvePick(path: string, need: PickNeed | undefined, bindContext: BindContext | undefined): string {
  if (need === undefined) {
    return path;
  }
  assert(
    path === need.name || path.startsWith(need.name + '.') || path.startsWith(need.name + '['),
    'resolvePick: the path starts with the name its need reads',
  );
  const actual = actualName(need, bindContext);
  if (actual === undefined || actual === need.name) {
    return path;
  }
  return actual + path.slice(need.name.length);
}

function actualName(need: PickNeed, bindContext: BindContext | undefined): string | undefined {
  switch (need.kind) {
    case 'collection':
      return bindContext?.ensureQuery?.(need.collection);
    case 'import':
      return bindContext?.ensureImport?.(need.import);
    default: {
      const exhaustive: never = need;
      return exhaustive;
    }
  }
}
