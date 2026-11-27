import { assert } from '../../shared/core/assert';
import { readFence } from '../parse/astroFence';
import { findMatchingBrace, skipStringOrComment } from '../parse/astroLexical';

export const STYLE_SCAN_LIMITS = {
  sourceCharsMax: 32 * 1024 * 1024,
  elementDepthMax: 1024,
} as const satisfies Record<string, number>;

export interface StyleElementSpan {
  readonly start: number;
  readonly end: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly attributes: readonly string[];
  readonly extracted: boolean;
}

export type StyleBlockScan =
  | {
      readonly kind: 'certain';
      readonly count: number;
      readonly elements: readonly StyleElementSpan[];
    }
  | { readonly kind: 'uncertain'; readonly reason: string };

export function scanStyleBlocks(source: string): StyleBlockScan {
  if (source.length > STYLE_SCAN_LIMITS.sourceCharsMax) {
    return uncertain('the file is longer than the scan reads');
  }
  const fence = readFence(source);
  if (fence.kind === 'unreadable') {
    return uncertain(fence.what);
  }
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const scan = scanTemplate(source, fence.kind === 'fence' ? fence.length : bom);
  if (scan.kind === 'certain') {
    assert(scan.count === scan.elements.filter((element) => element.extracted).length, 'scanStyleBlocks: the count is the extracted elements');
    assert(scan.count <= scan.elements.length, 'scanStyleBlocks: no more blocks than elements');
  }
  return scan;
}

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const MARKUP_STYLE_PARENTS: ReadonlySet<string> = new Set(['svg', 'template', 'noscript']);
const MARKUP_STYLE_ATTRIBUTES: readonly string[] = ['is:inline', 'set:html', 'set:text'];
const WHITE_SPACE_ONLY = /^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*$/;
const TAG_NAME = /[A-Za-z][\w:.$-]*/y;
const NEXT_MARKUP = /[<{}]/g;

interface OpenElement {
  readonly name: string;
  readonly markupStyles: boolean;
}

interface OpeningTag {
  readonly name: string;
  readonly attributes: readonly string[];
  readonly end: number;
  readonly selfClosing: boolean;
}

type TagRead = { readonly kind: 'tag'; readonly tag: OpeningTag } | { readonly kind: 'uncertain'; readonly reason: string };

function scanTemplate(source: string, start: number): StyleBlockScan {
  const elements: StyleElementSpan[] = [];
  const open: OpenElement[] = [];
  let index = start;
  for (let pass = 0; pass <= source.length + 1; pass += 1) {
    NEXT_MARKUP.lastIndex = index;
    const found = NEXT_MARKUP.exec(source);
    if (found === null) {
      return open.length === 0 ? certain(elements) : uncertain(`<${open.at(-1)?.name ?? ''}> is never closed`);
    }
    const at = found.index;
    assert(at >= index, 'scanTemplate: the search moves forward');
    const step = scanMarkupAt(source, at, open, elements);
    if (typeof step === 'string') {
      return uncertain(step);
    }
    assert(step > at, 'scanTemplate: every step consumes text');
    index = step;
  }
  assert(false, 'scanTemplate: the pass bound is the source length');
}

function scanMarkupAt(source: string, at: number, open: OpenElement[], elements: StyleElementSpan[]): number | string {
  const char = source.charAt(at);
  if (char === '}') {
    return 'a } outside any expression';
  }
  if (char === '{') {
    const close = findMatchingBrace(source, at);
    return close === -1 ? 'an expression that is never closed' : close + 1;
  }
  assert(char === '<', 'scanMarkupAt: markup starts at <');
  if (source.startsWith('<!--', at)) {
    const close = source.indexOf('-->', at + 4);
    return close === -1 ? 'a comment that is never closed' : close + 3;
  }
  if (source.startsWith('<!', at)) {
    if (source.startsWith('<![CDATA[', at)) {
      return 'a CDATA section';
    }
    const close = source.indexOf('>', at);
    return close === -1 ? 'a declaration that is never closed' : close + 1;
  }
  if (source.startsWith('</', at)) {
    return closeElement(source, at, open);
  }
  if (source.startsWith('<>', at)) {
    return pushElement(open, '') ?? at + 2;
  }
  TAG_NAME.lastIndex = at + 1;
  if (!TAG_NAME.test(source)) {
    return at + 1;
  }
  const read = readOpeningTag(source, at);
  if (read.kind === 'uncertain') {
    return read.reason;
  }
  return enterElement(source, { at, tag: read.tag }, open, elements);
}

function enterElement(
  source: string,
  { at, tag }: { readonly at: number; readonly tag: OpeningTag },
  open: OpenElement[],
  elements: StyleElementSpan[],
): number | string {
  const lower = tag.name.toLowerCase();
  if (lower === 'style' || lower === 'script') {
    if (tag.name !== lower) {
      return `<${tag.name}> in capitals, which the compiler does not read as <${lower}>`;
    }
    const insideMarkupStyles = open.at(-1)?.markupStyles ?? false;
    if (tag.selfClosing) {
      if (lower === 'style') {
        elements.push({ start: at, end: tag.end, bodyStart: tag.end, bodyEnd: tag.end, attributes: tag.attributes, extracted: false });
      }
      return tag.end;
    }
    const close = rawTextClose(source, tag.end, lower);
    if (typeof close === 'string') {
      return close;
    }
    if (lower === 'style') {
      const body = source.slice(tag.end, close.bodyEnd);
      const kept = insideMarkupStyles || MARKUP_STYLE_ATTRIBUTES.some((name) => tag.attributes.includes(name));
      elements.push({
        start: at,
        end: close.end,
        bodyStart: tag.end,
        bodyEnd: close.bodyEnd,
        attributes: tag.attributes,
        extracted: !kept && !WHITE_SPACE_ONLY.test(body),
      });
    }
    return close.end;
  }
  if (tag.selfClosing || VOID_ELEMENTS.has(tag.name)) {
    return tag.end;
  }
  if (tag.attributes.includes('is:raw')) {
    const close = rawTextClose(source, tag.end, tag.name);
    if (typeof close === 'string') {
      return close;
    }
    if (source.slice(tag.end, close.bodyEnd).includes(`<${tag.name}`)) {
      return `an is:raw <${tag.name}> that holds another <${tag.name}>`;
    }
    return close.end;
  }
  return pushElement(open, tag.name) ?? tag.end;
}

function pushElement(open: OpenElement[], name: string): string | undefined {
  if (open.length >= STYLE_SCAN_LIMITS.elementDepthMax) {
    return 'elements nested deeper than the scan reads';
  }
  const parent = open.at(-1)?.markupStyles ?? false;
  open.push({ name, markupStyles: parent || MARKUP_STYLE_PARENTS.has(name) });
  assert(open.length <= STYLE_SCAN_LIMITS.elementDepthMax, 'pushElement: the stack stays inside its bound');
  return undefined;
}

function closeElement(source: string, at: number, open: OpenElement[]): number | string {
  const close = source.indexOf('>', at);
  if (close === -1) {
    return 'a closing tag that is never finished';
  }
  const name = source.slice(at + 2, close).trim();
  const innermost = open.at(-1);
  if (innermost === undefined) {
    return `</${name}> with no element open`;
  }
  if (innermost.name !== name) {
    return `</${name}> closes <${innermost.name}>`;
  }
  open.pop();
  return close + 1;
}

function rawTextClose(source: string, from: number, name: string): { readonly bodyEnd: number; readonly end: number } | string {
  const closing = new RegExp(`</${name.replace(/[.$]/g, '\\$&')}`, 'gi');
  closing.lastIndex = from;
  const found = closing.exec(source);
  if (found === null) {
    return `<${name}> is never closed`;
  }
  const bodyEnd = found.index;
  const nameEnd = bodyEnd + found[0].length;
  if (source.slice(bodyEnd + 2, nameEnd) !== name) {
    return `</${name}> written in another case`;
  }
  let end = nameEnd;
  while (end < source.length && /\s/.test(source.charAt(end))) {
    end += 1;
  }
  if (source.charAt(end) !== '>') {
    return `</${name}> followed by something other than >`;
  }
  assert(bodyEnd >= from, 'rawTextClose: the body ends after it starts');
  assert(end > bodyEnd, 'rawTextClose: the closing tag follows the body');
  return { bodyEnd, end: end + 1 };
}

function readOpeningTag(source: string, start: number): TagRead {
  TAG_NAME.lastIndex = start + 1;
  const match = TAG_NAME.exec(source);
  assert(match !== null, 'readOpeningTag: called on a tag name');
  const name = match[0];
  const attributes: string[] = [];
  let index = start + 1 + name.length;
  for (let pass = 0; pass <= source.length; pass += 1) {
    if (index >= source.length) {
      return { kind: 'uncertain', reason: `<${name}> is never finished` };
    }
    const char = source.charAt(index);
    if (char === '>') {
      return { kind: 'tag', tag: { name, attributes, end: index + 1, selfClosing: false } };
    }
    if (char === '/' && source.charAt(index + 1) === '>') {
      return { kind: 'tag', tag: { name, attributes, end: index + 2, selfClosing: true } };
    }
    const next = attributeEnd(source, index, attributes);
    if (typeof next === 'string') {
      return { kind: 'uncertain', reason: `<${name}>: ${next}` };
    }
    assert(next > index, 'readOpeningTag: every attribute step consumes text');
    index = next;
  }
  return { kind: 'uncertain', reason: `<${name}> is longer than the scan reads` };
}

function attributeEnd(source: string, index: number, attributes: string[]): number | string {
  const char = source.charAt(index);
  if (/\s/.test(char) || char === '/') {
    return index + 1;
  }
  if (char === '{') {
    const close = findMatchingBrace(source, index);
    return close === -1 ? 'an expression that is never closed' : close + 1;
  }
  if (char === '"' || char === "'" || char === '`' || char === '=') {
    return `a stray ${char}`;
  }
  let nameEnd = index;
  while (nameEnd < source.length && !/[\s"'`=<>/{}]/.test(source.charAt(nameEnd))) {
    nameEnd += 1;
  }
  if (nameEnd === index) {
    return `a stray ${char}`;
  }
  attributes.push(source.slice(index, nameEnd));
  let cursor = nameEnd;
  while (cursor < source.length && /\s/.test(source.charAt(cursor))) {
    cursor += 1;
  }
  if (source.charAt(cursor) !== '=') {
    return nameEnd;
  }
  cursor += 1;
  while (cursor < source.length && /\s/.test(source.charAt(cursor))) {
    cursor += 1;
  }
  return attributeValueEnd(source, cursor);
}

function attributeValueEnd(source: string, start: number): number | string {
  const char = source.charAt(start);
  if (char === '"' || char === "'") {
    const close = source.indexOf(char, start + 1);
    return close === -1 ? 'a quoted value that is never closed' : close + 1;
  }
  if (char === '`') {
    const end = skipStringOrComment(source, start);
    return end <= start || end > source.length || source.charAt(end - 1) !== '`' ? 'a template value that is never closed' : end;
  }
  if (char === '{') {
    const close = findMatchingBrace(source, start);
    return close === -1 ? 'an expression value that is never closed' : close + 1;
  }
  let end = start;
  while (end < source.length && !/[\s>"'`=<]/.test(source.charAt(end))) {
    if (source.charAt(end) === '/' && source.charAt(end + 1) === '>') {
      break;
    }
    end += 1;
  }
  return end === start ? 'an attribute with no value after =' : end;
}

function certain(elements: readonly StyleElementSpan[]): StyleBlockScan {
  return { kind: 'certain', count: elements.filter((element) => element.extracted).length, elements };
}

function uncertain(reason: string): StyleBlockScan {
  assert(reason.length > 0, 'uncertain: a reason is given');
  return { kind: 'uncertain', reason };
}
