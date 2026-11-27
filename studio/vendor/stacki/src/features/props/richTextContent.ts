import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { Attr } from '../../../shared/page/pageNode';
import { renderedAssetPath } from '../../editor/richAssetImports';
import { editableHTML } from '../../ui/htmlFieldModel';
import type { InlineNode } from './richContentModel';

export const RICH_TEXT_CODE_REASONS = ['expression', 'component', 'markup', 'size'] as const;
export type RichTextCodeReason = (typeof RICH_TEXT_CODE_REASONS)[number];

export type RichTextView = { readonly view: 'rich'; readonly html: string } | { readonly view: 'code'; readonly reason: RichTextCodeReason };

export const RICH_TEXT_SOURCE_CHARS_MAX = 200_000;

export function richTextView(source: string | undefined, document: Document): RichTextView {
  const text = source ?? '';
  if (text.length > RICH_TEXT_SOURCE_CHARS_MAX) {
    return { view: 'code', reason: 'size' };
  }
  if (/[{}]/.test(text)) {
    return { view: 'code', reason: 'expression' };
  }
  if (/<\/?(?:[A-Z]|[a-z][\w-]*\.)/.test(text)) {
    return { view: 'code', reason: 'component' };
  }
  if (/<!--|<!|<\s*>|<(?:slot|script|style|template|fragment)\b|\s[a-z]+:[\w-]+\s*=?/i.test(text)) {
    return { view: 'code', reason: 'markup' };
  }
  const projection = editableHTML(text, document, { media: true });
  if (projection.restricted) {
    return { view: 'code', reason: 'markup' };
  }
  assert(projection.html.length <= text.length * 2 + 64, 'The editor projection is bounded by its source');
  return { view: 'rich', html: text };
}

const LAYOUT_TAGS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'figure',
  'figcaption',
  'hr',
  'img',
  'video',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'pre',
]);

export function withoutLayoutSpace(nodes: readonly InlineNode[], inBlock = true, depth = 0): InlineNode[] {
  assert(depth <= LIMITS.treeDepthMax, 'Rich text depth is bounded');
  const layout = (node: InlineNode | undefined) => (node === undefined ? inBlock : node.kind === 'element' && LAYOUT_TAGS.has(node.name));
  return nodes.flatMap((node, index): InlineNode[] => {
    if (node.kind === 'element') {
      if (node.name === 'pre' || node.name === 'textarea' || node.children === undefined) {
        return [node];
      }
      return [{ ...node, children: withoutLayoutSpace(node.children, LAYOUT_TAGS.has(node.name), depth + 1) }];
    }
    if (node.kind !== 'text') {
      return [node];
    }
    let value = node.value.replace(/[\t ]*\n\s*/g, '\n');
    if (value.startsWith('\n') && layout(nodes[index - 1])) {
      value = value.slice(1);
    }
    if (value.endsWith('\n') && layout(nodes[index + 1])) {
      value = value.slice(0, -1);
    }
    value = value.replaceAll('\n', ' ');
    return value === '' ? [] : [{ ...node, value }];
  });
}

const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'source']);

export function richTextNodes(html: string, document: Document): InlineNode[] {
  assert(html.length <= LIMITS.ipcFieldCharsMax, 'Rich text content fits one field');
  const template = document.createElement('template');
  template.innerHTML = html;
  let count = 0;
  const read = (parent: Node, depth: number): InlineNode[] => {
    assert(depth <= LIMITS.treeDepthMax, 'Rich text depth is bounded');
    const out: InlineNode[] = [];
    for (const child of Array.from(parent.childNodes)) {
      count += 1;
      assert(count <= LIMITS.treeNodesMax, 'Rich text node count is bounded');
      if (child.nodeType === 3) {
        const value = child.textContent ?? '';
        if (value !== '') {
          out.push({ kind: 'text', value });
        }
        continue;
      }
      const ElementType = document.defaultView?.Element;
      if (ElementType === undefined || !(child instanceof ElementType)) {
        continue;
      }
      const element = child;
      const name = element.localName;
      const props = Object.fromEntries(
        Array.from(element.attributes).map((attribute): [string, Attr] => {
          const value = attribute.name === 'src' ? renderedAssetPath(attribute.value) : attribute.value;
          return [attribute.name, value === '' ? { type: 'bare' } : { type: 'string', value }];
        }),
      );
      out.push({ kind: 'element', name, props, children: VOID_TAGS.has(name) ? undefined : read(element, depth + 1) });
    }
    return out;
  };
  const nodes = read(template.content, 0);
  assert(count <= LIMITS.treeNodesMax, 'Rich text conversion stays inside the tree bound');
  return nodes;
}

export function withInnerSource(element: string, current: { readonly name: string; readonly inner: string }, next: string): string | undefined {
  assert(current.name.length > 0, 'A tag with content has a name');
  if (/\/>\s*$/.test(element)) {
    if (current.inner !== '') {
      return undefined;
    }
    return next === '' ? element : `${element.replace(/\s*\/>\s*$/, '')}>${next}</${current.name}>`;
  }
  const close = element.lastIndexOf('</');
  const start = close - current.inner.length;
  if (close < 0 || start < 0 || element.slice(start, close) !== current.inner || element.charAt(start - 1) !== '>') {
    return undefined;
  }
  const result = element.slice(0, start) + next + element.slice(close);
  assert(result.length === element.length - current.inner.length + next.length, 'Only the content changed');
  return result;
}

export function sameRichContent(left: string, right: string, document: Document): boolean {
  return JSON.stringify(richShape(richTextNodes(left, document), 0)) === JSON.stringify(richShape(richTextNodes(right, document), 0));
}

function richShape(nodes: readonly InlineNode[], depth: number): readonly unknown[] {
  assert(depth <= LIMITS.treeDepthMax, 'Rich text nesting is bounded');
  return nodes.flatMap((node): readonly unknown[] => {
    if (node.kind === 'text') {
      const value = node.value.replace(/\s+/g, ' ').trim();
      return value === '' ? [] : [value];
    }
    if (node.kind === 'expr') {
      return [node.value];
    }
    return [{ name: node.name, props: node.props, children: node.children === undefined ? undefined : richShape(node.children, depth + 1) }];
  });
}

export function innerSourceOf(element: string): string | undefined {
  assert(element.length <= RICH_TEXT_SOURCE_CHARS_MAX * 2, 'An element read for its content is bounded');
  if (!element.startsWith('<')) {
    return undefined;
  }
  let quote = '';
  let depth = 0;
  for (let index = 1; index < element.length; index++) {
    const character = element.charAt(index);
    if (quote !== '') {
      quote = character === quote ? '' : quote;
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth = Math.max(0, depth - 1);
    } else if (character === '>' && depth === 0) {
      if (element.charAt(index - 1) === '/') {
        return '';
      }
      const close = element.lastIndexOf('</');
      return close > index ? element.slice(index + 1, close) : undefined;
    }
  }
  return undefined;
}

export interface MarkupNode {
  readonly kind: string;
  readonly name?: string;
  readonly value?: string;
  readonly props?: Readonly<Record<string, { readonly type: string; readonly value?: string } | undefined>> | undefined;
  readonly children?: readonly MarkupNode[] | undefined;
}

export function plainChildrenHTML(children: readonly MarkupNode[] | undefined): string | undefined {
  let count = 0;
  const write = (nodes: readonly MarkupNode[], depth: number): string | undefined => {
    assert(depth <= LIMITS.treeDepthMax, 'Plain markup depth is bounded');
    let out = '';
    for (const node of nodes) {
      count += 1;
      if (count > LIMITS.treeNodesMax) {
        return undefined;
      }
      if (node.kind === 'text') {
        out += node.value ?? '';
        continue;
      }
      if (node.kind !== 'element' || node.name === undefined || !/^[a-z][a-z0-9]*$/.test(node.name)) {
        return undefined;
      }
      let attributes = '';
      for (const [name, value] of Object.entries(node.props ?? {})) {
        if (value?.type === 'bare') {
          attributes += ` ${name}`;
        } else if (value?.type === 'string') {
          attributes += ` ${name}="${(value.value ?? '').replaceAll('"', '&quot;')}"`;
        } else if (value !== undefined) {
          return undefined;
        }
      }
      if (node.children === undefined) {
        out += `<${node.name}${attributes}>`;
        continue;
      }
      const inner = write(node.children, depth + 1);
      if (inner === undefined) {
        return undefined;
      }
      out += `<${node.name}${attributes}>${inner}</${node.name}>`;
    }
    return out;
  };
  return write(children ?? [], 0);
}
