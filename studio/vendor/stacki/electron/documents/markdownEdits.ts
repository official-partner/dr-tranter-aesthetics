import { assert } from '../../shared/core/assert';
import type { Edit, NodeRef } from '../../shared/engine/editRequest';
import type { AttributeValue, Placement, RejectionReason } from '../../shared/engine/intent';
import { blankLinePrefix, markdownPrefix } from '../../shared/engine/markdownLayout';
import { parsePageResult, type Attr, type PageNode } from '../../shared/page/pageNode';
import { markdownBeside } from '../../shared/engine/planMarkdown';
import { nodeAtPath, parentPath, textOf } from '../../shared/engine/planSupport';
import { toAnchorRef } from '../../shared/page/ref';
import { err, ok, type Result } from '../../shared/core/result';
import type { ProjectedNode } from '../../shared/page/sourceProjection';
import { toByteSpan } from '../../shared/core/span';
import type { IntentDraft } from '../../../../src/features/source/documentHost';
import { frontmatterSlot, placedHunks, resolveRef, shiftedHunks, type Authored, type Resolved } from './editAnchors';
import { parseMarkdownPage, printMarkdownFrontmatter, printMarkdownItem, printMarkdownNode, type MarkdownLayout } from '../parse/markdownParser';

type Drafted = Result<IntentDraft, RejectionReason> | undefined;

export function markdownEditDraft(edit: Edit, authored: Authored): Drafted {
  assert(authored.format !== 'astro', 'Only a Markdown page has Markdown drafts');
  switch (edit.tag) {
    case 'set-attribute':
    case 'remove-attribute':
      return onMarkdown(authored, edit.target, (target) => rewriteDraft(authored, target, (node) => withAttribute(node, edit)));
    case 'rename-tag':
      return onMarkdown(authored, edit.target, (target) => rewriteDraft(authored, target, (node) => renamedBlock(node, edit.to)));
    case 'replace-node':
      return onMarkdown(authored, edit.target, (target) => rewriteDraft(authored, target, () => edit.node));
    case 'set-inline-style':
    case 'rename-attribute':
    case 'wrap-nodes':
    case 'wrap-text':
    case 'unwrap-node':
      return onMarkdown(authored, edit.target, () => err('unsupported-operation'));
    case 'insert-node':
      if (edit.content.tag === 'copy') {
        return undefined;
      }
      return insertionDraft(authored, edit.target, edit.placement, edit.content.nodes);
    case 'append-body':
      return appendDraft(authored, edit.nodes);
    case 'set-frontmatter':
      return frontmatterDraft(authored, edit.model.extraFrontmatter);
    case 'replace-page':
      return undefined;
    case 'remove-node':
    case 'move-node':
    case 'rename-binding':
    case 'revert':
    case 'code-patch':
      return undefined;
    default: {
      const exhaustive: never = edit;
      return exhaustive;
    }
  }
}

export function markdownPageNodes(authored: Authored): readonly PageNode[] | undefined {
  const mdx = authored.format === 'mdx';
  const parsed = parsePageResult(parseMarkdownPage(authored.text, { mdx }));
  return parsed.editable ? parsed.model.nodes : undefined;
}

function onMarkdown(authored: Authored, ref: NodeRef, next: (target: Resolved) => Result<IntentDraft, RejectionReason>): Drafted {
  const resolved = resolveRef(authored, ref);
  if (!resolved.ok) {
    return resolved;
  }
  return resolved.value.node.syntax === 'markup' ? undefined : next(resolved.value);
}


interface Located {
  readonly node: PageNode;
  readonly parent: PageNode | undefined;
  readonly index: number;
}

function rewriteDraft(authored: Authored, target: Resolved, change: (node: PageNode) => PageNode | undefined): Result<IntentDraft, RejectionReason> {
  const located = locate(authored, target.node.path);
  if (located === undefined) {
    return err('anchor-moved');
  }
  assert(located.node.kind === target.node.kind, 'The parse and the projection agree');
  const next = change(located.node);
  if (next === undefined) {
    return err('unsupported-operation');
  }
  const layout = layoutAt(authored, target.node);
  if (layout === undefined) {
    return err('unsupported-operation');
  }
  const print = (node: PageNode): string =>
    target.node.list === 'items' ? printMarkdownItem(node, itemAt(located, 0), layout) : printMarkdownNode(node, layout);
  const own = textOf(authored.snapshot.bytes, target.node.span);
  const hunks = placedHunks(print(located.node), print(next), own);
  if (!hunks.ok) {
    return hunks;
  }
  const moved = shiftedHunks(hunks.value, target.node.span.start);
  return ok({ anchor: target.anchor, operation: { tag: 'rewrite-node', hunks: moved } });
}

function locate(authored: Authored, path: readonly number[]): Located | undefined {
  let list = markdownPageNodes(authored);
  let parent: PageNode | undefined;
  let found: Located | undefined;
  for (const step of path) {
    const node = list?.[step];
    if (node === undefined) {
      return undefined;
    }
    found = { node, parent, index: step };
    parent = node;
    list = 'children' in node ? (node.children ?? []) : [];
  }
  return found;
}

function layoutAt(authored: Authored, node: ProjectedNode): MarkdownLayout | undefined {
  const bytes = authored.snapshot.bytes;
  let start = node.span.start;
  if (node.list === 'items' || node.list === 'inline') {
    const parent = nodeAtPath(authored.projection, parentPath(node.path));
    assert(parent !== undefined, 'An item or inline text has its parent');
    start = parent.span.start;
  }
  const prefix = markdownPrefix(bytes, start);
  return prefix === undefined ? undefined : { prefix, eol: lineBreak(authored) };
}

function lineBreak(authored: Authored): string {
  return authored.text.includes('\r\n') ? '\r\n' : '\n';
}

function itemAt(located: Located, offset: number): { readonly marker: string; readonly number: number | undefined; readonly indent: string } {
  const list = located.parent;
  assert(list?.kind === 'element', 'An item sits in a list');
  const ordered = list.name === 'ol';
  const first = attrText(list.props?.['start']);
  const start = first === undefined ? 1 : Number(first);
  const own = list.mdNumbers?.[located.index] ?? start + located.index;
  return {
    marker: list.mdMarker ?? (ordered ? '.' : '-'),
    number: ordered ? own + offset : undefined,
    indent: list.mdIndent ?? '',
  };
}

function attrText(attr: Attr | undefined): string | undefined {
  return attr !== undefined && 'value' in attr ? attr.value : undefined;
}

function withAttribute(node: PageNode, edit: Extract<Edit, { tag: 'set-attribute' | 'remove-attribute' }>): PageNode | undefined {
  if (node.kind !== 'element') {
    return undefined;
  }
  const value = edit.tag === 'set-attribute' ? stringValue(edit.value) : '';
  if (value === undefined) {
    return undefined;
  }
  const kept = withoutKey(node.props ?? {}, edit.name);
  const props: Readonly<Record<string, Attr>> = edit.tag === 'set-attribute' ? { ...kept, [edit.name]: { type: 'string', value } } : kept;
  if (node.name === 'pre' && edit.name === 'lang') {
    return { ...node, props, mdInfo: value };
  }
  if (node.name === 'ol' && edit.name === 'start') {
    return renumbered(node, props, value === '' ? '1' : value);
  }
  return { ...node, props };
}

function stringValue(value: AttributeValue): string | undefined {
  return value.type === 'string' ? value.value : undefined;
}

function renumbered(
  node: Extract<PageNode, { readonly kind: 'component' | 'element' }>,
  props: Readonly<Record<string, Attr>>,
  value: string,
): PageNode | undefined {
  if (!/^\d{1,9}$/.test(value)) {
    return undefined;
  }
  const next = Number(value);
  const numbers = node.mdNumbers ?? [];
  const delta = next - (numbers[0] ?? 1);
  const rest = withoutKey(props, 'start');
  return {
    ...node,
    props: next === 1 ? rest : { ...rest, start: { type: 'string', value: String(next) } },
    mdNumbers: numbers.map((number) => number + delta),
  };
}

function renamedBlock(node: PageNode, to: string): PageNode | undefined {
  if (node.kind !== 'element') {
    return undefined;
  }
  if (textBlock(node.name) && textBlock(to)) {
    const { mdSetext, ...rest } = node;
    if (mdSetext !== undefined && (to === 'h1' || to === 'h2')) {
      return { ...rest, name: to, mdSetext: mdSetext.replace(/[=-]/g, to === 'h1' ? '=' : '-') };
    }
    return { ...rest, name: to };
  }
  if (listBlock(node.name) && listBlock(to)) {
    const ordered = to === 'ol';
    const numbers = (node.children ?? []).map((_item, index) => index + 1);
    const props = withoutKey(node.props ?? {}, 'start');
    return { ...node, name: to, props, mdMarker: ordered ? '.' : '-', mdNumbers: numbers };
  }
  return undefined;
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function textBlock(name: string): boolean {
  return name === 'p' || /^h[1-6]$/.test(name);
}

function listBlock(name: string): boolean {
  return name === 'ul' || name === 'ol';
}


function insertionDraft(authored: Authored, ref: NodeRef, placement: Placement, nodes: readonly PageNode[]): Drafted {
  const resolved = resolveRef(authored, ref);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.value.node;
  const inside = placement === 'first-child' || placement === 'last-child';
  if (inside ? target.syntax === 'markup' : target.list === 'markup') {
    return undefined;
  }
  const beside = markdownBeside(authored.projection, target, placement);
  if (beside === undefined) {
    return err('unsupported-operation');
  }
  const source = printedInsertion(authored, beside, nodes);
  if (source === undefined) {
    return err('unsupported-operation');
  }
  const operation = { tag: 'insert-node' as const, placement, source };
  return ok({ anchor: resolved.value.anchor, operation });
}

function printedInsertion(
  authored: Authored,
  beside: { readonly node: ProjectedNode; readonly side: 'before' | 'after' },
  nodes: readonly PageNode[],
): string | undefined {
  const eol = lineBreak(authored);
  const prefix = markdownPrefix(authored.snapshot.bytes, beside.node.span.start);
  if (prefix === undefined) {
    return undefined;
  }
  switch (beside.node.list) {
    case 'items': {
      if (!nodes.every((node) => isItem(node))) {
        return undefined;
      }
      const located = locate(authored, beside.node.path);
      const layout = layoutAt(authored, beside.node);
      if (located === undefined) {
        return undefined;
      }
      if (layout === undefined) {
        return undefined;
      }
      const first = beside.side === 'after' ? 1 : 0;
      const printed = nodes.map((node, index) => printMarkdownItem(node, itemAt(located, first + index), layout));
      return printed.join(`${eol}${prefix}`);
    }
    case 'blocks': {
      if (nodes.some((node) => isItem(node))) {
        return undefined;
      }
      const printed = nodes.map((node) => printMarkdownNode(node, { prefix, eol }));
      return printed.join(`${eol}${blankLinePrefix(prefix)}${eol}${prefix}`);
    }
    case 'inline':
    case 'markup':
      return undefined;
    default: {
      const exhaustive: never = beside.node.list;
      return exhaustive;
    }
  }
}

function isItem(node: PageNode): boolean {
  return node.kind === 'element' && node.name === 'li';
}

function appendDraft(authored: Authored, nodes: readonly PageNode[]): Result<IntentDraft, RejectionReason> {
  if (nodes.some((node) => isItem(node))) {
    return err('unsupported-operation');
  }
  const eol = lineBreak(authored);
  const source = nodes.map((node) => printMarkdownNode(node, { prefix: '', eol })).join(eol + eol);
  const anchor = toAnchorRef({
    span: toByteSpan(0, authored.snapshot.bytes.length),
    path: [],
    expectedKind: 'document',
  });
  return ok({ anchor, operation: { tag: 'append-body', source } });
}


function frontmatterDraft(authored: Authored, yaml: string): Result<IntentDraft, RejectionReason> {
  const eol = lineBreak(authored);
  const printed = printMarkdownFrontmatter(yaml, eol);
  const block = authored.projection.frontmatter;
  if (block === undefined) {
    if (yaml.trim() === '') {
      return err('unsupported-operation');
    }
    const anchor = toAnchorRef({
      span: toByteSpan(0, authored.snapshot.bytes.length),
      path: [],
      expectedKind: 'document',
    });
    return ok({ anchor, operation: { tag: 'insert-frontmatter', source: `${printed}${eol}` } });
  }
  const before = textOf(authored.snapshot.bytes, block);
  const after = before.endsWith('\n') ? `${printed}${eol}` : printed;
  const { slot, text } = frontmatterSlot(block, before, after);
  const anchor = toAnchorRef({ span: block, path: [], expectedKind: 'frontmatter' });
  return ok({ anchor, operation: { tag: 'edit-frontmatter-slot', slot, text } });
}
