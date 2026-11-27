import type { Attr } from '../../shared/page/pageNode';
import { assert } from '../../shared/core/assert';
import { classExpressionOccurrences } from '../../shared/engine/classExpressionRemoval';
type ClassProps = Readonly<Record<string, Attr>>;
interface ClassEdit {
  readonly key: string;
  readonly value: Attr;
  readonly remove?: 'class';
}


const LIST = 'class:list';

export type ClassPlacement =
  { readonly kind: 'end' } | { readonly kind: 'before'; readonly className: string } | { readonly kind: 'after'; readonly className: string };

export const PLACEMENT_END: ClassPlacement = { kind: 'end' };

const quoted = (name: string): string => JSON.stringify(name);

function quotedLike(code: string, name: string): string {
  const quote = /(['"])/.exec(code)?.[1];
  if (quote === "'" && !name.includes("'") && !name.includes('\\')) {
    return `'${name}'`;
  }
  return quoted(name);
}

export function namesIn(prop: Attr | undefined): readonly string[] {
  if (!prop) {
    return [];
  }
  if (prop.type === 'string') {
    return String(prop.value).trim().split(/\s+/).filter(Boolean);
  }
  const text = String(('value' in prop ? prop.value : '') || '');
  const out = [];
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const inner = match[1] ?? match[2] ?? match[3] ?? '';
    for (const word of inner.split(/\$\{[^}]*\}|\s+/)) {
      if (word) {
        out.push(word);
      }
    }
  }
  return out;
}

export function hasClass(props: ClassProps | undefined, name: unknown): boolean {
  const clean = String(name || '').trim();
  if (!clean) {
    return true;
  }
  if (/\s/.test(clean)) {
    return false;
  }
  return ['class', LIST].some((key) => {
    const prop = props?.[key];
    if (prop?.type !== 'expr') {
      return namesIn(prop).includes(clean);
    }
    const count = classExpressionOccurrences(prop.value, clean, key === LIST ? 'list' : 'string');
    return count === undefined ? namesIn(prop).includes(clean) : count > 0;
  });
}

export function withClass(props: ClassProps | undefined, name: unknown, placement: ClassPlacement = PLACEMENT_END): ClassEdit | undefined {
  const clean = String(name || '').trim();
  if (!clean || /\s/.test(clean)) {
    return undefined;
  }
  if (hasClass(props, clean)) {
    return undefined;
  }

  const list = props?.[LIST];
  if (list) {
    if (list.type !== 'expr') {
      return undefined;
    }
    const text = String(list.value || '').trim();
    const at = text.lastIndexOf(']');
    if (!text.startsWith('[') || at < 0) {
      return { key: LIST, value: { type: 'expr', value: `[${text}, ${quotedLike(text, clean)}]` } };
    }
    const head = text.slice(0, at);
    const tail = text.slice(at);
    const lines = head.split('\n');
    const last = lines.at(-1) ?? '';
    if (lines.length > 1) {
      const indent = (head.match(/\n([ \t]*)\S/) || [, '  '])[1];
      const comma = /,\s*$/.test(head) ? '' : ',';
      const closingIndent = last.match(/^[ \t]*/)?.[0] ?? '';
      const opening = `${head.replace(/\s+$/, '')}${comma}\n${indent}${quotedLike(text, clean)},`;
      return {
        key: LIST,
        value: {
          type: 'expr',
          value: `${opening}\n${closingIndent}${tail}`,
        },
      };
    }
    const placed = placedInList(text, clean, placement);
    if (placed !== undefined) {
      return { key: LIST, value: { type: 'expr', value: placed } };
    }
    const comma = /\[\s*$/.test(head) ? '' : ', ';
    return { key: LIST, value: { type: 'expr', value: `${head}${comma}${quotedLike(text, clean)}${tail}` } };
  }

  const cls = props?.['class'];
  if (!cls) {
    return { key: 'class', value: { type: 'string', value: clean } };
  }
  if (cls.type === 'string') {
    const words = namesIn(cls);
    return { key: 'class', value: { type: 'string', value: placedInWords(words, clean, placement).join(' ') } };
  }
  if (cls.type === 'expr') {
    const text = String(cls.value || '').trim();
    if (text.startsWith('`') && text.endsWith('`') && text.length > 1) {
      return { key: 'class', value: { type: 'expr', value: `${text.slice(0, -1)} ${clean}\`` } };
    }
    return withClassExpression(text, clean);
  }
  return undefined;
}

export function placedInWords(words: readonly string[], name: string, placement: ClassPlacement): readonly string[] {
  assert(!words.includes(name), 'placedInWords: the class is not already written');
  const anchor = placement.kind === 'end' ? -1 : words.indexOf(placement.className);
  const at = anchor === -1 ? words.length : placement.kind === 'before' ? anchor : anchor + 1;
  const placed = [...words.slice(0, at), name, ...words.slice(at)];
  assert(placed.length === words.length + 1, 'placedInWords: exactly one class is added');
  return placed;
}

function placedInList(text: string, name: string, placement: ClassPlacement): string | undefined {
  if (placement.kind === 'end') {
    return undefined;
  }
  if (text.includes('\n')) {
    return undefined;
  }
  const anchor = new RegExp(`([\\[,]\\s*)(["'])${escapeRegExp(placement.className)}\\2(?=\\s*[,\\]])`).exec(text);
  if (anchor === null) {
    return undefined;
  }
  const lead = anchor[1] ?? '';
  const start = anchor.index + lead.length;
  const end = anchor.index + anchor[0].length;
  assert(start < end, 'placedInList: the anchor entry is not empty');
  if (placement.kind === 'before') {
    return `${text.slice(0, start)}${quotedLike(text, name)}, ${text.slice(start)}`;
  }
  return `${text.slice(0, end)}, ${quotedLike(text, name)}${text.slice(end)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withClassExpression(text: string, name: string): ClassEdit {
  const expression = text.includes('//') ? `${text}\n` : text;
  return {
    key: LIST,
    value: { type: 'expr', value: `[(${expression}), ${quoted(name)}]` },
    remove: 'class',
  };
}

export default withClass;
