
import type { Attr, AttrSpan } from '../../shared/page/pageNode';
import { toUtf16Span } from '../../shared/core/span';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { ParserNode } from './astroParserTypes';
import { findMatchingBrace, skipStringOrComment } from './astroLexical';

export { HTML_VOID_TAGS as VOID_ELEMENTS } from '../../shared/page/htmlTags';
export const RAW_ELEMENTS = new Set(['style', 'script']);

const PENDING_ID = 'n0';
export const makeId = (): string => PENDING_ID;

export function assignPathIds(nodes: readonly ParserNode[], prefix: string, depth: number): void {
  assert(depth <= LIMITS.treeDepthMax, 'Path ids are assigned within the depth bound');
  for (const [index, node] of nodes.entries()) {
    const path = prefix === '' ? String(index) : `${prefix}.${index}`;
    if (node.id !== 'layout') {
      node.id = `n${path}`;
    }
    if (Array.isArray(node.children)) {
      assignPathIds(node.children, path, depth + 1);
    }
  }
}


export function parseAttrs(attrString: string): Record<string, Attr> {
  return propsOf(scanAttrs(attrString));
}

function propsOf(scanned: readonly ScannedAttr[]): Record<string, Attr> {
  return Object.fromEntries(scanned.map((found) => [found.name, found.attr]));
}

interface ScannedAttr {
  readonly name: string;
  readonly attr: Attr;
  readonly from: number;
  readonly to: number;
  readonly nameAt: readonly [number, number] | undefined;
  readonly valueAt: readonly [number, number] | undefined;
  readonly shorthand?: true;
}

const ATTR_NAME = /[^\s"'<>/={}]+/y;

interface AttrScan {
  readonly attrs: readonly ScannedAttr[];
  readonly problem: string | undefined;
}

function scanAttrsChecked(source: string): AttrScan {
  const found: ScannedAttr[] = [];
  const names = new Set<string>();
  for (let position = 0; position < source.length;) {
    const character = source.charAt(position);
    if (character === '/' || /\s/.test(character)) {
      position++;
      continue;
    }
    const attribute = scanAttr(source, position);
    if (typeof attribute === 'string') {
      return { attrs: found, problem: attribute };
    }
    assert(attribute.to > position, 'An attribute scan advances');
    assert(attribute.to <= source.length, 'An attribute stays inside its source');
    if (names.has(attribute.name)) {
      return { attrs: found, problem: `a duplicate ${attribute.attr.type === 'spread' ? 'spread' : `${attribute.name} attribute`}` };
    }
    names.add(attribute.name);
    found.push(attribute);
    position = attribute.to;
  }
  return { attrs: found, problem: undefined };
}

function scanAttrs(source: string): readonly ScannedAttr[] {
  return scanAttrsChecked(source).attrs;
}

function scanAttr(source: string, from: number): ScannedAttr | string {
  if (source.charAt(from) === '{') {
    return scanSpreadAttr(source, from) ?? 'an attribute written as braces the editor cannot read';
  }
  ATTR_NAME.lastIndex = from;
  const match = ATTR_NAME.exec(source);
  if (!match) {
    return 'an attribute the editor cannot read';
  }
  const name = match[0];
  const end = from + name.length;
  const nameAt: readonly [number, number] = [from, end];
  const equalsAt = scanAttrSpace(source, end);
  if (source.charAt(equalsAt) !== '=') {
    return { name, attr: { type: 'bare' }, from, to: end, nameAt, valueAt: undefined };
  }
  const valueStart = scanAttrSpace(source, equalsAt + 1);
  const quote = source.charAt(valueStart);
  if (quote === '"' || quote === "'") {
    const close = source.indexOf(quote, valueStart + 1);
    if (close === -1) {
      return `an unclosed quote in the ${name} attribute`;
    }
    return {
      name,
      attr: { type: 'string', value: source.slice(valueStart + 1, close) },
      from,
      to: close + 1,
      nameAt,
      valueAt: [valueStart + 1, close],
    };
  }
  if (quote !== '{') {
    return quote === '`' ? `the ${name} attribute written with a backtick template` : `the ${name} attribute written without quotes`;
  }
  const close = findMatchingBrace(source, valueStart);
  if (close === -1) {
    return `an unclosed { in the ${name} attribute`;
  }
  const valueAt = scanAttrTrim(source, valueStart + 1, close);
  return {
    name,
    attr: { type: 'expr', value: source.slice(...valueAt) },
    from,
    to: close + 1,
    nameAt,
    valueAt,
  };
}

function scanSpreadAttr(source: string, from: number): ScannedAttr | undefined {
  const close = findMatchingBrace(source, from);
  if (close === -1) {
    return undefined;
  }
  const bodyAt = scanAttrSpace(source, from + 1);
  if (!source.startsWith('...', bodyAt)) {
    return scanShorthandAttr(source, from, close);
  }
  const valueAt = scanAttrTrim(source, bodyAt + 3, close);
  const value = source.slice(...valueAt);
  return {
    name: `...${value}`,
    attr: { type: 'spread', value },
    from,
    to: close + 1,
    nameAt: undefined,
    valueAt,
  };
}

const SHORTHAND_NAME = /^[A-Za-z_$][\w$]*$/;

function scanShorthandAttr(source: string, from: number, close: number): ScannedAttr | undefined {
  const bodyAt = scanAttrTrim(source, from + 1, close);
  const name = source.slice(...bodyAt);
  if (!SHORTHAND_NAME.test(name)) {
    return undefined;
  }
  return { name, attr: { type: 'expr', value: name }, from, to: close + 1, nameAt: bodyAt, valueAt: bodyAt, shorthand: true };
}

function expandShorthand(attrs: string): string {
  let out = '';
  let cursor = 0;
  for (const found of scanAttrs(attrs)) {
    if (found.shorthand === true) {
      out += `${attrs.slice(cursor, found.from)}${found.name}={${found.name}}`;
      cursor = found.to;
    }
  }
  return out + attrs.slice(cursor);
}

function scanAttrSpace(source: string, from: number): number {
  let position = from;
  while (position < source.length && /\s/.test(source.charAt(position))) {
    position++;
  }
  return position;
}

function scanAttrTrim(source: string, from: number, to: number): readonly [number, number] {
  const raw = source.slice(from, to);
  const start = from + raw.length - raw.trimStart().length;
  return [start, start + raw.trim().length];
}

function attrSpansOf(scanned: readonly ScannedAttr[], base: number): AttrSpan[] {
  const at = ([start, end]: readonly [number, number]) => toUtf16Span(base + start, base + end);
  return scanned.map((found): AttrSpan => {
    const span = toUtf16Span(base + found.from, base + found.to);
    const { name, attr } = found;
    switch (attr.type) {
      case 'string':
      case 'expr':
        return {
          type: attr.type,
          name,
          span,
          nameSpan: at(required(found.nameAt, 'Named attribute has a name')),
          valueSpan: at(required(found.valueAt, 'Valued attribute has a value')),
        };
      case 'bare':
        return { type: 'bare', name, span, nameSpan: at(required(found.nameAt, 'Bare name')) };
      case 'spread':
        return {
          type: 'spread',
          name,
          span,
          valueSpan: at(required(found.valueAt, 'Spread body')),
        };
    }
  });
}

export function attrsAsWritten(node: ParserNode): string | undefined {
  if (!node.attrSource) {
    return undefined;
  }
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  return flat(expandShorthand(node.attrSource)) === flat(serializeAttrs(node.props, node.attrOrder)) ? node.attrSource : undefined;
}

export function tagProps(attrs: string, attrsAt: number | undefined): { props: Record<string, Attr>; attrOrder?: string[]; attrSpans?: AttrSpan[] } {
  return tagFields(attrs, attrsAt).fields;
}

export function tagFields(
  attrs: string,
  attrsAt: number | undefined,
): {
  readonly problem: string | undefined;
  readonly fields: { props: Record<string, Attr>; attrOrder?: string[]; attrSpans?: AttrSpan[]; attrSource?: string };
} {
  const { attrs: scanned, problem } = scanAttrsChecked(attrs);
  const props = propsOf(scanned);
  const attrOrder = Object.keys(props);
  const spans = attrsAt === undefined ? {} : { attrSpans: attrSpansOf(scanned, attrsAt) };
  const source = attrs && (attrs.includes('\n') || scanned.some((found) => found.shorthand === true)) ? { attrSource: attrs } : {};
  return { problem, fields: attrOrder.length ? { props, attrOrder, ...spans, ...source } : { props, ...spans, ...source } };
}

function orderedProps(props: Readonly<Record<string, Attr>> | undefined, order?: readonly string[]): ReadonlyArray<readonly [string, Attr]> {
  const entries = Object.entries(props || {});
  if (!order || !order.length) {
    return entries;
  }
  const held = new Map(entries);
  const out: [string, Attr][] = [];
  for (const name of order) {
    if (held.has(name)) {
      out.push([name, required(held.get(name), 'Ordered attribute exists')]);
    }
  }
  const known = new Set(order);
  for (const [name, attr] of entries) {
    if (!known.has(name)) {
      out.push([name, attr]);
    }
  }
  return out;
}

function closed(value: string): string {
  let lineComment = false;
  for (let position = 0; position < value.length; position++) {
    const skipped = skipStringOrComment(value, position);
    if (skipped !== position) {
      lineComment = value.startsWith('//', position) && !value.includes('\n', position);
      position = skipped - 1;
    } else if (value.charAt(position).trim() !== '') {
      lineComment = false;
    }
  }
  return lineComment ? `${value}\n` : value;
}

export function serializeAttrs(props: Readonly<Record<string, Attr>> | undefined, order?: readonly string[]): string {
  const parts = [];
  for (const [name, attr] of orderedProps(props, order)) {
    if (attr?.type === 'spread') {
      parts.push(`{...${closed(attr.value)}}`);
    } else if (attr === undefined || attr.type === 'bare') {
      parts.push(name);
    } else if (attr.type === 'expr') {
      parts.push(`${name}={${closed(attr.value)}}`);
    } else {
      parts.push(`${name}="${String(attr.value).replace(/"/g, '&quot;')}"`);
    }
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function required<T>(value: T | undefined, message: string): T {
  assert(value !== undefined, message);
  return value;
}
