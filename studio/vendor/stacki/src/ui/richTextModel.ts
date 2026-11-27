import { assert } from '../../shared/core/assert';
import { CODE_INDENT_UNIT } from '../../shared/core/indent';
import { BOUNDARY_LIMITS } from '../../shared/core/boundary';
import { safeHTMLLink } from '../../shared/page/richPaste';

export { cleanPastedHTML } from '../../shared/page/richPaste';

export const RICH_TEXT_LIMITS = {
  inlineCharsMax: 200,
  prefixCharsMax: 6,
  formatDepthMax: 32,
} as const;

export const BLOCKS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'] as const;
export type Block = (typeof BLOCKS)[number];

export type BlockShortcut =
  { readonly kind: 'block'; readonly block: Block } | { readonly kind: 'list'; readonly list: 'ul' | 'ol' } | { readonly kind: 'rule' };

export interface InlineShortcut {
  readonly tag: 'strong' | 'em' | 'code' | 's';
  readonly length: number;
  readonly text: string;
}

const BLOCK_PREFIXES: Readonly<Record<string, BlockShortcut>> = {
  '#': { kind: 'block', block: 'h1' },
  '##': { kind: 'block', block: 'h2' },
  '###': { kind: 'block', block: 'h3' },
  '####': { kind: 'block', block: 'h4' },
  '#####': { kind: 'block', block: 'h5' },
  '######': { kind: 'block', block: 'h6' },
  '>': { kind: 'block', block: 'blockquote' },
  '```': { kind: 'block', block: 'pre' },
  '-': { kind: 'list', list: 'ul' },
  '*': { kind: 'list', list: 'ul' },
  '+': { kind: 'list', list: 'ul' },
  '1.': { kind: 'list', list: 'ol' },
  '1)': { kind: 'list', list: 'ol' },
};

export function blockShortcut(lineText: string): BlockShortcut | undefined {
  if (lineText === '---') {
    return { kind: 'rule' };
  }
  if (!lineText.endsWith(' ')) {
    return undefined;
  }
  const prefix = lineText.slice(0, -1);
  if (prefix.length > RICH_TEXT_LIMITS.prefixCharsMax) {
    return undefined;
  }
  return Object.hasOwn(BLOCK_PREFIXES, prefix) ? BLOCK_PREFIXES[prefix] : undefined;
}

const INLINE_PATTERNS: readonly (readonly [InlineShortcut['tag'], RegExp])[] = [
  ['strong', /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/],
  ['s', /~~([^~\s](?:[^~]*[^~\s])?)~~$/],
  ['code', /`([^`]+)`$/],
  ['em', /(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/],
  ['em', /(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/],
];

export function inlineShortcut(textBeforeCaret: string): InlineShortcut | undefined {
  const tail = textBeforeCaret.slice(-(RICH_TEXT_LIMITS.inlineCharsMax + 4));
  for (const [tag, pattern] of INLINE_PATTERNS) {
    const match = pattern.exec(tail);
    const text = match?.[1];
    if (match !== null && text !== undefined) {
      const marker = (match[0].length - text.length) / 2;
      const length = text.length + Math.floor(marker) * 2;
      assert(length <= match[0].length, 'An inline run is no longer than its match');
      return { tag, length, text };
    }
  }
  return undefined;
}

export function textCounts(text: string): { readonly words: number; readonly characters: number } {
  assert(text.length <= BOUNDARY_LIMITS.textLengthMax, 'Rich text: text limit exceeded');
  const trimmed = text.trim();
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
  assert(words <= text.length, 'There are never more words than characters');
  return { words, characters: text.replace(/\s/g, '').length };
}

export function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function linkAddress(typed: string): string | undefined {
  const text = typed.trim();
  if (text === '' || text.length > BOUNDARY_LIMITS.textLengthMax) {
    return undefined;
  }
  if (safeHTMLLink(text)) {
    return text;
  }
  if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(text)) {
    return `mailto:${text}`;
  }
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(text)) {
    return `https://${text}`;
  }
  return undefined;
}

const LINE_TAGS = new Set(('p div h1 h2 h3 h4 h5 h6 ul ol li blockquote pre hr table thead tbody tfoot tr td th ' + 'caption figure figcaption').split(' '));

export function formatHTML(html: string, document: Document): string {
  assert(html.length <= BOUNDARY_LIMITS.textLengthMax, 'Rich text: text limit exceeded');
  const template = document.createElement('template');
  template.innerHTML = html;
  const lines = formatChildren(template.content, 0);
  const formatted = lines.join('\n');
  assert(!formatted.startsWith(CODE_INDENT_UNIT), 'The top level is not indented');
  return formatted;
}

function formatChildren(parent: ParentNode, depth: number): string[] {
  const lines: string[] = [];
  let inline = '';
  const flush = (): void => {
    if (inline.trim() !== '') {
      lines.push(CODE_INDENT_UNIT.repeat(depth) + inline.trim());
    }
    inline = '';
  };
  for (const node of parent.childNodes) {
    if (isElement(node) && LINE_TAGS.has(node.localName)) {
      flush();
      lines.push(...formatBlock(node, depth));
    } else {
      inline += serializeInline(node);
    }
  }
  flush();
  return lines;
}

function formatBlock(element: Element, depth: number): string[] {
  const indent = CODE_INDENT_UNIT.repeat(depth);
  const nested = [...element.children].some((child) => LINE_TAGS.has(child.localName));
  if (!nested || element.localName === 'pre' || depth >= RICH_TEXT_LIMITS.formatDepthMax) {
    return [indent + hangingLines(element, indent)];
  }
  const open = element.outerHTML.slice(0, element.outerHTML.indexOf('>') + 1);
  return [indent + open, ...formatChildren(element, depth + 1), `${indent}</${element.localName}>`];
}

function hangingLines(element: Element, indent: string): string {
  const markup = element.outerHTML;
  if (element.localName === 'pre' || element.localName === 'textarea' || element.querySelector('pre, textarea') !== null) {
    return markup;
  }
  const closing = `</${element.localName}>`;
  return markup
    .split(/\n[ \t]*/)
    .map((line, index) => (index === 0 ? line : `${indent}${line === closing ? '' : CODE_INDENT_UNIT}${line}`))
    .join('\n');
}

function serializeInline(node: ChildNode): string {
  if (isElement(node)) {
    return node.outerHTML;
  }
  if (node.nodeType === node.TEXT_NODE) {
    return escapeText(node.textContent ?? '').replace(/\s+/g, ' ');
  }
  return '';
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;');
}

function isElement(node: Node): node is Element {
  return node.nodeType === node.ELEMENT_NODE;
}
