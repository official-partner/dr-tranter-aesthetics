
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { Attr } from '../../shared/page/pageNode';
import type { AttributeDefault } from './propDeclaration';
import type { EditorNode } from './pageView';

type Props = Readonly<Record<string, Attr | undefined>>;
type WrittenProps = Readonly<Record<string, Attr>>;

export interface AttributesBinding {
  readonly defaults: readonly AttributeDefault[];
  readonly own: readonly string[];
}

const NOT_DEFAULTS = /^(class|style|class:list|slot)$|^(set|is|client|server|transition|define):/;

export function spreadKey(local: string): string {
  assert(/^[A-Za-z_$][\w$]*$/.test(local), 'spreadKey: a rest binding is an identifier');
  return `...${local}`;
}

export function readAttributesBinding(props: Props | undefined, local: string): AttributesBinding | undefined {
  const entries = present(props);
  assert(entries.length <= LIMITS.attrsPerNodeMax, 'readAttributesBinding: attribute limit exceeded');
  const at = entries.findIndex(([name]) => name === spreadKey(local));
  if (at < 0) {
    return undefined;
  }
  const defaults: AttributeDefault[] = [];
  for (const [name, value] of entries.slice(0, at)) {
    if (!NOT_DEFAULTS.test(name) && (value.type === 'string' || value.type === 'bare')) {
      defaults.push({ name, value: value.type === 'string' ? value.value : '' });
    }
  }
  const own = entries.slice(at + 1).map(([name]) => name);
  assert(defaults.length + own.length < entries.length, 'readAttributesBinding: the spread is neither a default nor its own');
  return { defaults, own };
}

export function boundAttributes(props: Props | undefined, local: string, defaults: readonly AttributeDefault[]): WrittenProps {
  const key = spreadKey(local);
  const entries = present(props);
  const at = entries.findIndex(([name]) => name === key);
  const connected = at >= 0;
  const before = connected ? entries.slice(0, at).filter((entry) => !isDefaultable(entry)) : entries.filter((entry) => !isOwn(entry, local));
  const after = connected ? entries.slice(at + 1) : entries.filter((entry) => isOwn(entry, local));
  const ownNames = new Set(after.map(([name]) => name));
  const replaced = new Set(defaults.map((entry) => entry.name));
  const out: Record<string, Attr> = {};
  for (const [name, value] of before) {
    if (!replaced.has(name)) {
      define(out, name, value);
    }
  }
  for (const entry of defaults) {
    if (!ownNames.has(entry.name)) {
      define(out, entry.name, entry.value === '' ? { type: 'bare' } : { type: 'string', value: entry.value });
    }
  }
  define(out, key, { type: 'spread', value: local });
  for (const [name, value] of after) {
    define(out, name, value);
  }
  assert(Object.keys(out).length <= LIMITS.attrsPerNodeMax, 'boundAttributes: attribute limit exceeded');
  assert(readAttributesBinding(out, local) !== undefined, 'boundAttributes: the spread reads back');
  return out;
}

export function unboundAttributes(props: Props | undefined, local: string): WrittenProps {
  const key = spreadKey(local);
  const out: Record<string, Attr> = {};
  for (const [name, value] of present(props)) {
    if (name !== key) {
      define(out, name, value);
    }
  }
  assert(readAttributesBinding(out, local) === undefined, 'unboundAttributes: the spread is gone');
  assert(Object.keys(out).length >= present(props).length - 1, 'unboundAttributes: only the spread is taken out');
  return out;
}

export function withDefaultAttribute(props: Props | undefined, local: string, name: string, value: Attr): WrittenProps {
  const key = spreadKey(local);
  assert(name !== key, 'withDefaultAttribute: the spread is not a default');
  assert(!Object.hasOwn(props ?? {}, name), 'withDefaultAttribute: the attribute is new');
  const out: Record<string, Attr> = {};
  for (const [entryName, entryValue] of present(props)) {
    if (entryName === key) {
      define(out, name, value);
    }
    define(out, entryName, entryValue);
  }
  if (!Object.hasOwn(out, name)) {
    define(out, name, value);
  }
  assert(Object.keys(out).length <= LIMITS.attrsPerNodeMax + 1, 'withDefaultAttribute: attribute limit exceeded');
  return out;
}

export function restUsedElsewhere(markup: string, local: string): boolean {
  assert(/^[A-Za-z_$][\w$]*$/.test(local), 'restUsedElsewhere: a rest binding is an identifier');
  assert(markup.length <= LIMITS.sourceBytesMax, 'restUsedElsewhere: the markup is bounded');
  const word = new RegExp(`(?<![\\w$])${local.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  let count = 0;
  for (const match of markup.matchAll(word)) {
    assert(match.index <= markup.length, 'restUsedElsewhere: a match is in the markup');
    count++;
    if (count > 1) {
      return true;
    }
  }
  return false;
}

function isOwn([name, value]: readonly [string, Attr], local: string): boolean {
  return NOT_DEFAULTS.test(name) || (value.type === 'spread' && name !== spreadKey(local));
}

function isDefaultable([name, value]: readonly [string, Attr]): boolean {
  return !NOT_DEFAULTS.test(name) && (value.type === 'string' || value.type === 'bare');
}

function present(props: Props | undefined): readonly (readonly [string, Attr])[] {
  const out: (readonly [string, Attr])[] = [];
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value !== undefined) {
      out.push([name, value]);
    }
  }
  return out;
}

function define(target: Record<string, Attr>, name: string, value: Attr): void {
  Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true });
}

export function withAttributes(node: EditorNode, props: WrittenProps): EditorNode {
  const { attrSpans: staleSpans, ...rest } = node;
  void staleSpans;
  const order = Object.keys(props);
  assert(order.length <= LIMITS.attrsPerNodeMax, 'withAttributes: attribute limit exceeded');
  const out: EditorNode = { ...rest, props, attrOrder: order };
  assert(out.attrSpans === undefined, 'withAttributes: stale spans are gone');
  return out;
}
