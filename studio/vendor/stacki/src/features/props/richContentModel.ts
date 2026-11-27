import { BIND_PATH_RE } from '../../editor/bindings';
import type { Attr } from '../../../shared/page/pageNode';
import { assert } from '../../../shared/core/assert';
import { textValueCanonical } from '../../../shared/page/htmlText';
import { LIMITS } from '../../../shared/core/limits';

export interface InlineCandidate {
  readonly kind: string;
  readonly name?: string;
  readonly value?: string;
  readonly props?: Readonly<Record<string, { readonly type: string; readonly value?: string } | undefined>> | undefined;
  readonly children?: readonly InlineCandidate[] | undefined;
}
export interface InlineExpression {
  readonly kind: 'expr';
  readonly value: string;
  readonly preview?: string;
}
export type InlineNode =
  | { readonly kind: 'text'; readonly value: string }
  | InlineExpression
  | {
      readonly kind: 'element';
      readonly name: string;
      readonly props?: Readonly<Record<string, Attr | undefined>>;
      readonly children: readonly InlineNode[] | undefined;
    };

export const INLINE_TAGS: ReadonlySet<string> = new Set(['strong', 'em', 'b', 'i', 'sup', 'sub', 'code', 'a', 'span', 'br', 'small', 'mark', 'u', 's']);

export const isSimpleExpr = (node: InlineCandidate): node is InlineExpression =>
  node.kind === 'expr' && typeof node.value === 'string' && /^\{[^{}]*\}$/.test(node.value) && !node.value.includes('<');

export function isInlineOnly<T extends InlineCandidate>(children: readonly T[] | undefined): children is readonly (T & InlineNode)[] {
  if (!children?.length) {
    return false;
  }
  const pending: { readonly node: InlineCandidate; readonly depth: number }[] = children.map((node) => ({ node, depth: 0 }));
  for (let index = 0; index < pending.length; index++) {
    assert(pending.length <= LIMITS.treeNodesMax, 'RichContent: node limit exceeded');
    const next = pending[index];
    assert(next !== undefined, 'RichContent: queued node exists');
    assert(next.depth <= LIMITS.treeDepthMax, 'RichContent: depth limit exceeded');
    const node = next.node;
    if ((node.kind === 'text' && typeof node.value === 'string') || isSimpleExpr(node)) {
      continue;
    }
    if (node.kind !== 'element' || !INLINE_TAGS.has(String(node.name).toLowerCase())) {
      return false;
    }
    if (
      !Object.values(node.props || {}).every(
        (value) => value === undefined || value.type === 'bare' || (value.type === 'string' && typeof value.value === 'string'),
      )
    ) {
      return false;
    }
    if (!('children' in node)) {
      return false;
    }
    assert(pending.length + (node.children?.length ?? 0) <= LIMITS.treeNodesMax, 'RichContent: node limit exceeded');
    for (const child of node.children ?? []) {
      pending.push({ node: child, depth: next.depth + 1 });
    }
  }
  return true;
}

const esc = (text: string | undefined) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function isChippable(inner: string | undefined) {
  const text = String(inner || '').trim();
  if (/^(true|false|null|undefined)$/.test(text) || /^[-+]?(\d+\.?\d*|\.\d+)$/.test(text)) {
    return false;
  }
  return BIND_PATH_RE.test(text);
}

export function nodesToHtml(nodes: readonly InlineNode[] | undefined, chippable: (text: string) => boolean = isChippable): string {
  return richSerialize(nodes ?? [], new Budget(LIMITS.treeNodesMax), 0, chippable);
}
class Budget {
  private remaining: number;
  constructor(limit: number) {
    assert(Number.isSafeInteger(limit), 'RichContent: node budget is an integer');
    this.remaining = limit;
  }
  take(count: number, message: string): void {
    assert(count <= this.remaining, message);
    this.remaining -= count;
  }
}
function richSerialize(nodes: readonly InlineNode[], budget: Budget, depth: number, chippable: (text: string) => boolean): string {
  assert(depth <= LIMITS.treeDepthMax, 'RichContent: serialization depth limit exceeded');
  let out = '';
  for (const node of nodes) {
    budget.take(1, 'RichContent: serialization node limit exceeded');
    if (node.kind === 'text') {
      out += /[{}]/.test(node.value) ? `<span ${LITERAL_ATTRIBUTE}="">${esc(node.value)}</span>` : esc(node.value);
    } else if (node.kind === 'expr') {
      const inner = node.value.replace(/^\{|\}$/g, '').trim();
      if (chippable(inner)) {
        out += `<span class="expr-chip" contenteditable="false" data-expr="${esc(node.value).replace(/"/g, '&quot;')}">${esc(node.preview ?? inner)}</span>`;
      } else {
        out += esc(node.value);
      }
    } else {
      const attrs = Object.entries(node.props || {})
        .map(([key, value]) => (value === undefined || value.type === 'bare' ? ` ${key}` : ` ${key}="${esc(value.value).replace(/"/g, '&quot;')}"`))
        .join('');
      out +=
        node.children === undefined || node.children.length === 0
          ? node.name === 'br'
            ? '<br>'
            : `<${node.name}${attrs}></${node.name}>`
          : `<${node.name}${attrs}>` + richSerialize(node.children, budget, depth + 1, chippable) + `</${node.name}>`;
    }
    assert(out.length <= LIMITS.ipcFieldCharsMax, 'RichContent: HTML limit exceeded');
  }
  assert(out.length <= LIMITS.ipcFieldCharsMax, 'RichContent: HTML limit exceeded');
  return out;
}

export function domToNodes(element: HTMLElement): InlineNode[] {
  return richReadDOM(element, new Budget(LIMITS.treeNodesMax), 0);
}
function richReadDOM(element: Element, budget: Budget, depth: number): InlineNode[] {
  assert(depth <= LIMITS.treeDepthMax, 'RichContent: DOM depth limit exceeded');
  const out: InlineNode[] = [];
  for (const node of element.childNodes) {
    budget.take(1, 'RichContent: DOM node limit exceeded');
    if (node.nodeType === 3) {
      if (node.textContent) {
        const textNodes = richReadText(node.textContent);
        budget.take(Math.max(0, textNodes.length - 1), 'RichContent: parsed node limit exceeded');
        out.push(...textNodes);
      }
    } else if (isDOMElement(node)) {
      if (node.hasAttribute(LITERAL_ATTRIBUTE)) {
        out.push(...richReadLiteral(node, budget));
      } else if (node.classList.contains('expr-chip')) {
        out.push({
          kind: 'expr',
          value: node.getAttribute('data-expr') || `{${node.textContent}}`,
        });
      } else {
        out.push(...richReadElement(node, budget, depth));
      }
    }
    assert(out.length <= LIMITS.treeNodesMax, 'RichContent: parsed node limit exceeded');
  }
  return out;
}
export const LITERAL_ATTRIBUTE = 'data-rich-literal';
export const CARET_BREAK_ATTRIBUTE = 'data-rich-caret';

function richReadLiteral(node: Element, budget: Budget): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of node.childNodes) {
    budget.take(1, 'RichContent: DOM node limit exceeded');
    if (child.nodeType === 3) {
      if (child.textContent) {
        out.push({ kind: 'text', value: textValueCanonical(child.textContent) });
      }
    } else if (isDOMElement(child) && child.tagName.toLowerCase() === 'br') {
      out.push({ kind: 'element', name: 'br', props: {}, children: undefined });
    } else if (child.textContent) {
      out.push({ kind: 'text', value: textValueCanonical(child.textContent) });
    }
  }
  assert(
    out.every((item) => item.kind !== 'expr'),
    'A literal run holds no expressions',
  );
  return out;
}

function richReadText(raw: string): InlineNode[] {
  assert(raw.length <= LIMITS.nodeValueCharsMax, 'RichContent: text limit exceeded');
  const out: InlineNode[] = [];
  const expression = /\{[^{}]*\}/g;
  let last = 0;
  for (const match of raw.matchAll(expression)) {
    if (match.index > last) {
      out.push({ kind: 'text', value: textValueCanonical(raw.slice(last, match.index)) });
    }
    out.push({ kind: 'expr', value: match[0] });
    last = match.index + match[0].length;
    assert(out.length <= LIMITS.treeNodesMax, 'RichContent: text expression limit exceeded');
  }
  if (last < raw.length) {
    out.push({ kind: 'text', value: textValueCanonical(raw.slice(last)) });
  }
  return out;
}
function richReadElement(node: Element, budget: Budget, depth: number): InlineNode[] {
  let name = node.tagName.toLowerCase();
  if (name === 'b') {
    name = 'strong';
  }
  if (name === 'i') {
    name = 'em';
  }
  if (name === 'br') {
    return node.hasAttribute(CARET_BREAK_ATTRIBUTE) ? [] : [{ kind: 'element', name: 'br', props: {}, children: undefined }];
  }
  const children = richReadDOM(node, budget, depth + 1);
  if (!INLINE_TAGS.has(name)) {
    return children;
  }
  const props = Object.fromEntries(
    ['href', 'class', 'target', 'rel'].flatMap((attribute): [string, Attr][] => {
      const value = node.getAttribute(attribute);
      if (value === null || value === '') {
        return [];
      }
      assert(value.length <= LIMITS.attrCharsMax, 'RichContent: attribute limit exceeded');
      return [[attribute, { type: 'string', value }]];
    }),
  );
  return [{ kind: 'element', name, props, children }];
}
export function isDOMElement(node: Node | undefined): node is Element {
  const ElementType = node?.ownerDocument?.defaultView?.Element;
  return !!ElementType && node instanceof ElementType;
}

export function withoutTrailingBreaks(nodes: readonly InlineNode[], depth = 0): InlineNode[] {
  assert(depth <= LIMITS.treeDepthMax, 'RichContent: trailing-break depth limit exceeded');
  const out = [...nodes];
  for (let guard = 0; guard <= nodes.length && out.length > 0; guard++) {
    const last = out[out.length - 1];
    assert(last !== undefined, 'RichContent: the last node exists');
    if (last.kind === 'element' && last.name === 'br') {
      out.pop();
    } else if (last.kind === 'text' && last.value.trim() === '' && out.length > 1) {
      out.pop();
    } else if (last.kind === 'element' && last.children !== undefined && last.children.length > 0) {
      const inner = withoutTrailingBreaks(last.children, depth + 1);
      if (inner.length === last.children.length) {
        break;
      }
      if (inner.length > 0) {
        out[out.length - 1] = { ...last, children: inner };
        break;
      }
      out.pop();
    } else {
      break;
    }
  }
  return out;
}
