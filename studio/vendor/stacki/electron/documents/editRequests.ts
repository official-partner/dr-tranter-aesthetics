import { assert } from '../../shared/core/assert';
import type { Edit, NodeRef } from '../../shared/engine/editRequest';
import type { BuiltEdit, EditBase, IntentDraft } from '../../../../src/features/source/documentHost';
import { isAttributeHost, TAG_NAME_RE } from '../../shared/engine/intent';
import type { Operation, RejectionReason, SourceEdit } from '../../shared/engine/intent';
import { renameSites } from '../../shared/engine/loopScope';
import { closeTagStart, indentedFragment, lineIndent, nodeAtPath, openTagEnd, tagNameEnd, textOf } from '../../shared/engine/planSupport';
import { insertedIndent, labelledSpan, wrapperTakesLines } from '../../shared/engine/planTree';
import { wrappedTextHunk } from '../../shared/engine/planText';
import { diffCodePatch } from '../../shared/engine/codePatch';
import { encodeText } from '../../shared/page/htmlText';
import { parsePageResult, type PageNode } from '../../shared/page/pageNode';
import { toAnchorRef, type AnchorRef } from '../../shared/page/ref';
import { err, ok, type Result } from '../../shared/core/result';
import type { Snapshot } from '../../shared/page/snapshot';
import { byteStringsEqual, decodeUtf8, encodeUtf8, spansAscending, toByteSpan, toByteString } from '../../shared/core/span';
import { parsePage, serializeNodes, serializePage } from '../parse/astroParser';
import { indentUnitBelow, indentUnitOf } from '../../shared/core/indent';
import { frontmatterSlot, pageFormat, placedHunks, resolveRef, shiftedHunks, type Authored } from './editAnchors';
import { markdownEditDraft, markdownPageNodes } from './markdownEdits';
import { entityTextHunks } from './textEntities';

export function buildEdit(edit: Edit, base: EditBase): Result<BuiltEdit, RejectionReason> {
  if (edit.tag === 'set-frontmatter') {
    if (base.history === 'own-commits') {
      const built = buildEditIntent(edit, base.current);
      return built.ok ? ok({ draft: built.value, basis: 'current' }) : built;
    }
  }
  const built = buildEditIntent(edit, base.authored);
  return built.ok ? ok({ draft: built.value, basis: 'authored' }) : built;
}

export function buildEditIntent(edit: Edit, snapshot: Snapshot): Result<IntentDraft, RejectionReason> {
  const decoded = decodeUtf8(snapshot.bytes);
  assert(decoded.ok, 'A page the renderer read decodes');
  if (edit.tag === 'revert') {
    return revertDraft(snapshot, edit.hunks);
  }
  if (edit.tag === 'code-patch') {
    return codePatchDraft(snapshot, edit.hunks);
  }
  const projection = snapshot.projection;
  if (projection.tag === 'parse-error') {
    return err('source-invalid');
  }
  const format = pageFormat(snapshot.path);
  const authored: Authored = { snapshot, text: decoded.value, projection, format };
  if (edit.tag === 'replace-page') {
    return format === 'astro' ? replacePageDraft(authored, edit.model) : err('unsupported-operation');
  }
  if (format !== 'astro') {
    const drafted = markdownEditDraft(edit, authored);
    if (drafted !== undefined) {
      return drafted;
    }
  }
  return nodeEditDraft(edit, authored);
}

function nodeEditDraft(edit: Exclude<Edit, { readonly tag: 'revert' | 'code-patch' }>, authored: Authored): Result<IntentDraft, RejectionReason> {
  switch (edit.tag) {
    case 'set-attribute':
    case 'remove-attribute':
    case 'set-inline-style': {
      const { target, ...rest } = edit;
      return withAnchor(authored, target, (anchor) => (isAttributeHost(anchor.expectedKind) ? ok({ anchor, operation: rest }) : err('unsupported-operation')));
    }
    case 'remove-node': {
      const { target, ...rest } = edit;
      return withAnchor(authored, target, (anchor) => ok({ anchor, operation: rest }));
    }
    case 'insert-node':
      return withAnchor(authored, edit.target, (anchor) => insertDraft(authored, anchor, edit));
    case 'move-node':
      return withAnchor(authored, edit.target, (anchor) =>
        withAnchor(authored, edit.destination, (destination) => ok({ anchor, operation: { tag: 'move-node', destination, placement: edit.placement } })),
      );
    case 'rename-binding':
      return withAnchor(authored, edit.target, (anchor) => renameDraft(authored, anchor, edit));
    case 'rename-tag':
      return withAnchor(authored, edit.target, (anchor) => tagRenameDraft(authored, anchor, edit.to));
    case 'rename-attribute':
      return withAnchor(authored, edit.target, (anchor) =>
        isAttributeHost(anchor.expectedKind)
          ? ok({ anchor, operation: { tag: 'rename-attribute', from: edit.from, to: edit.to } })
          : err('unsupported-operation'),
      );
    case 'replace-node':
      return withAnchor(authored, edit.target, (anchor) => replaceDraft(authored, anchor, edit.node));
    case 'wrap-nodes':
      return withAnchor(authored, edit.target, (anchor) => withAnchor(authored, edit.last, (last) => wrapDraft(authored, anchor, last, edit.name)));
    case 'wrap-text':
      return withAnchor(authored, edit.target, (anchor) => textWrapDraft(authored, anchor, edit.name));
    case 'unwrap-node':
      return withAnchor(authored, edit.target, (anchor) => unwrapDraft(authored, anchor));
    case 'append-body':
      return ok(appendDraft(authored, edit.nodes));
    case 'set-frontmatter':
      return frontmatterDraft(authored, edit.model);
    case 'replace-page':
      return replacePageDraft(authored, edit.model);
    default: {
      const exhaustive: never = edit;
      return exhaustive;
    }
  }
}

function replacePageDraft(authored: Authored, next: Extract<Edit, { tag: 'replace-page' }>['model']): Result<IntentDraft, RejectionReason> {
  const parsed = parsePageResult(parsePage(authored.text, { locs: true }));
  if (!parsed.editable) {
    return err('source-invalid');
  }
  const before = serializePage(parsed.model);
  const after = serializePage(next);
  const hunks = placedHunks(before, after, authored.text);
  if (!hunks.ok) {
    return hunks;
  }
  const anchor = toAnchorRef({
    span: toByteSpan(0, authored.snapshot.bytes.length),
    path: [],
    expectedKind: 'document',
  });
  return ok({ anchor, operation: { tag: 'rewrite-text', hunks: hunks.value } });
}

function appendDraft(authored: Authored, nodes: readonly PageNode[]): IntentDraft {
  const source = serializeNodes(nodes, indentUnitOf(authored.text)).replace(/\r?\n$/, '');
  const eol = authored.text.includes('\r\n') ? '\r\n' : '\n';
  const anchor = toAnchorRef({
    span: toByteSpan(0, authored.snapshot.bytes.length),
    path: [],
    expectedKind: 'document',
  });
  const lines = source.split(/\r?\n/).join(eol);
  return { anchor, operation: { tag: 'append-body', source: lines } };
}

function withAnchor(authored: Authored, ref: NodeRef, next: (anchor: AnchorRef) => Result<IntentDraft, RejectionReason>): Result<IntentDraft, RejectionReason> {
  const resolved = resolveRef(authored, ref);
  return resolved.ok ? next(resolved.value.anchor) : resolved;
}

function insertDraft(authored: Authored, anchor: AnchorRef, edit: Extract<Edit, { tag: 'insert-node' }>): Result<IntentDraft, RejectionReason> {
  const eol = authored.text.includes('\r\n') ? '\r\n' : '\n';
  const content = edit.content;
  if (content.tag === 'copy') {
    return withAnchor(authored, content.source, (source) => {
      const copied = nodeAtPath(authored.projection, source.path);
      assert(copied !== undefined, 'A checked copy source names a projected node');
      const span = labelledSpan(authored.snapshot.bytes, authored.projection, copied);
      const bytes = authored.snapshot.bytes.subarray(span.start, span.end);
      const text = Buffer.from(bytes).toString('utf8');
      return ok({
        anchor,
        operation: { tag: 'insert-node', placement: edit.placement, source: text },
      });
    });
  }
  const landing = nodeAtPath(authored.projection, anchor.path);
  assert(landing !== undefined, 'A checked anchor names a projected node');
  const indent = insertedIndent(authored.snapshot.bytes, authored.projection, landing, edit.placement);
  const printed = serializeNodes(content.nodes, indentUnitBelow(authored.text, indent)).replace(/\r?\n$/, '');
  const text = indentedFragment(printed, indent, eol);
  const operation: Operation = { tag: 'insert-node', placement: edit.placement, source: text };
  return ok({ anchor, operation });
}

function renameDraft(authored: Authored, anchor: AnchorRef, edit: Extract<Edit, { tag: 'rename-binding' }>): Result<IntentDraft, RejectionReason> {
  const loop = nodeAtPath(authored.projection, anchor.path);
  assert(loop !== undefined, 'A checked anchor names a projected node');
  if (loop.kind !== 'map') {
    return err('unsupported-operation');
  }
  const sites = renameSites(authored.projection, authored.snapshot.bytes, loop, edit.from);
  if (sites === undefined) {
    return err('unsupported-operation');
  }
  return ok({ anchor, operation: { tag: 'rename-binding', from: edit.from, to: edit.to, sites } });
}

function tagRenameDraft(authored: Authored, anchor: AnchorRef, to: string): Result<IntentDraft, RejectionReason> {
  const node = nodeAtPath(authored.projection, anchor.path);
  assert(node !== undefined, 'A checked anchor names a projected node');
  if (node.kind !== 'element' && node.kind !== 'component') {
    return err('unsupported-operation');
  }
  const bytes = authored.snapshot.bytes;
  const from = textOf(bytes, toByteSpan(node.span.start + 1, tagNameEnd(bytes, node)));
  if (!TAG_NAME_RE.test(from)) {
    return err('unsupported-operation');
  }
  if (from === to) {
    return err('unsupported-operation');
  }
  return ok({ anchor, operation: { tag: 'rename-tag', from, to } });
}

function replaceDraft(authored: Authored, anchor: AnchorRef, next: PageNode): Result<IntentDraft, RejectionReason> {
  const projected = nodeAtPath(authored.projection, anchor.path);
  assert(projected !== undefined, 'A checked anchor names a projected node');
  const previous = pageNodeAt(authored, anchor.path);
  if (previous === undefined) {
    return err('anchor-moved');
  }
  if (previous.kind === 'raw' && next.kind === 'raw') {
    const contents = rawContentsDraft(authored, anchor, { previous, next });
    if (contents !== undefined) {
      return contents;
    }
  }
  if (previous.kind === 'text' && next.kind === 'text') {
    const words = textDraft(authored, anchor, { previous, next });
    if (words !== undefined) {
      return words;
    }
  }
  const bytes = authored.snapshot.bytes;
  const eol = authored.text.includes('\r\n') ? '\r\n' : '\n';
  const indent = lineIndent(bytes, projected.span.start);
  const print = (node: PageNode): string =>
    serializeNodes([node])
      .replace(/\r?\n$/, '')
      .split(/\r?\n/)
      .join(`${eol}${indent}`);
  const own = textOf(bytes, projected.span);
  const hunks = placedHunks(print(previous), print(next), own);
  if (!hunks.ok) {
    const content = contentDraft(authored, anchor, { projected, previous, next, print });
    if (content !== undefined) {
      return content;
    }
    console.warn('A node restatement could not be placed on its bytes:', {
      reason: hunks.error,
      path: anchor.path,
      own: own.slice(0, 400),
      printed: print(previous).slice(0, 400),
      next: print(next).slice(0, 400),
    });
    return hunks;
  }
  const moved = shiftedHunks(hunks.value, projected.span.start);
  return ok({ anchor, operation: { tag: 'rewrite-node', hunks: moved } });
}

function contentDraft(
  authored: Authored,
  anchor: AnchorRef,
  nodes: {
    readonly projected: NonNullable<ReturnType<typeof nodeAtPath>>;
    readonly previous: PageNode;
    readonly next: PageNode;
    readonly print: (node: PageNode) => string;
  },
): Result<IntentDraft, RejectionReason> | undefined {
  const { projected, previous, next, print } = nodes;
  if ((previous.kind !== 'element' && previous.kind !== 'component') || next.kind !== previous.kind || next.name !== previous.name) {
    return undefined;
  }
  if (JSON.stringify(next.props ?? {}) !== JSON.stringify(previous.props ?? {}) || previous.children === undefined || next.children === undefined) {
    return undefined;
  }
  const bytes = authored.snapshot.bytes;
  const open = openTagEnd(bytes, projected);
  const close = open.selfClosing ? undefined : closeTagStart(bytes, projected, open.end);
  if (close === undefined || close < open.end) {
    return undefined;
  }
  const bare = print({ ...next, props: {}, attrOrder: [] } as PageNode); // eslint-disable-line no-restricted-syntax -- the same node without its attributes: every field was validated when `next` was parsed.
  const opening = `<${next.name}>`;
  const closing = bare.lastIndexOf(`</${next.name}>`);
  if (!bare.startsWith(opening) || closing < opening.length) {
    return undefined;
  }
  const written = textOf(bytes, toByteSpan(open.end, close));
  const leading = /^\s*/.exec(written)?.[0] ?? '';
  const trailing = written.trim() === '' ? '' : (/\s*$/.exec(written)?.[0] ?? '');
  const inner = `${leading}${bare.slice(opening.length, closing).trim()}${trailing}`;
  assert(open.end <= close, 'The content lies between the tags');
  return ok({ anchor, operation: { tag: 'rewrite-node', hunks: [{ span: toByteSpan(open.end, close), text: inner }] } });
}

function rawContentsDraft(
  authored: Authored,
  anchor: AnchorRef,
  nodes: { readonly previous: RawPageNode; readonly next: RawPageNode },
): Result<IntentDraft, RejectionReason> | undefined {
  const { previous, next } = nodes;
  if (previous.name !== next.name || JSON.stringify([previous.props, previous.attrOrder]) !== JSON.stringify([next.props, next.attrOrder])) {
    return undefined;
  }
  const projected = nodeAtPath(authored.projection, anchor.path);
  assert(projected?.kind === 'raw', 'A raw page node is a projected raw node');
  const bytes = authored.snapshot.bytes;
  const open = openTagEnd(bytes, projected);
  const close = open.selfClosing ? undefined : closeTagStart(bytes, projected, open.end);
  if (close === undefined || textOf(bytes, toByteSpan(open.end, close)) !== previous.inner) {
    return undefined;
  }
  const change = diffCodePatch(previous.inner, next.inner);
  if (!change.ok) {
    return change;
  }
  if (change.value.length === 0) {
    return err('unsupported-operation');
  }
  const hunks = shiftedHunks(
    change.value.map((hunk) => ({ span: hunk.span, text: hunk.text })),
    open.end,
  );
  assert(
    hunks.every((hunk) => hunk.span.start >= open.end && hunk.span.end <= close),
    'A contents edit stays between the tags',
  );
  return ok({ anchor, operation: { tag: 'rewrite-node', hunks } });
}

type RawPageNode = Extract<PageNode, { readonly kind: 'raw' }>;
type TextPageNode = Extract<PageNode, { readonly kind: 'text' | 'expr' | 'raw-line' }>;

function textDraft(
  authored: Authored,
  anchor: AnchorRef,
  nodes: { readonly previous: TextPageNode; readonly next: TextPageNode },
): Result<IntentDraft, RejectionReason> | undefined {
  const { previous, next } = nodes;
  const projected = nodeAtPath(authored.projection, anchor.path);
  assert(projected?.kind === 'text', 'A text page node is a projected text node');
  const own = textOf(authored.snapshot.bytes, projected.span);
  const before = encodeText(previous.value);
  if (own !== before) {
    const spelled = entityTextHunks(own, previous.value, next.value);
    if (spelled === undefined) {
      return undefined;
    }
    if (!spelled.ok) {
      return spelled;
    }
    return ok({ anchor, operation: { tag: 'rewrite-node', hunks: shiftedHunks(spelled.value, projected.span.start) } });
  }
  if (own.includes('\n')) {
    return undefined;
  }
  const after = encodeText(next.value);
  const change = diffCodePatch(before, after);
  if (!change.ok) {
    return change;
  }
  if (change.value.length === 0) {
    return err('unsupported-operation');
  }
  const hunks = shiftedHunks(
    change.value.map((hunk) => ({ span: hunk.span, text: hunk.text })),
    projected.span.start,
  );
  assert(
    hunks.every((hunk) => hunk.span.start >= projected.span.start && hunk.span.end <= projected.span.end),
    'A text edit stays inside its run',
  );
  return ok({ anchor, operation: { tag: 'rewrite-node', hunks } });
}

function wrapDraft(authored: Authored, anchor: AnchorRef, last: AnchorRef, name: string): Result<IntentDraft, RejectionReason> {
  const first = nodeAtPath(authored.projection, anchor.path);
  assert(first !== undefined, 'A checked anchor names a projected node');
  const eol = authored.text.includes('\r\n') ? '\r\n' : '\n';
  const indent = lineIndent(authored.snapshot.bytes, anchor.span.start);
  const lines = wrapperTakesLines(authored.snapshot.bytes, authored.projection, first, name);
  const operation: Operation = {
    tag: 'wrap-nodes',
    last,
    open: lines ? `<${name}>${eol}${indent}` : `<${name}>`,
    close: lines ? `${eol}${indent}</${name}>` : `</${name}>`,
  };
  return ok({ anchor, operation });
}

function textWrapDraft(authored: Authored, anchor: AnchorRef, name: string): Result<IntentDraft, RejectionReason> {
  const node = nodeAtPath(authored.projection, anchor.path);
  assert(node !== undefined, 'A checked anchor names a projected node');
  if (node.kind !== 'text') {
    return err('unsupported-operation');
  }
  const hunk = wrappedTextHunk(textOf(authored.snapshot.bytes, node.span), node.span, name);
  if (hunk === undefined) {
    return err('unsupported-operation');
  }
  return ok({ anchor, operation: { tag: 'rewrite-node', hunks: [hunk] } });
}

function unwrapDraft(authored: Authored, anchor: AnchorRef): Result<IntentDraft, RejectionReason> {
  const node = nodeAtPath(authored.projection, anchor.path);
  assert(node !== undefined, 'A checked anchor names a projected node');
  if (node.kind !== 'element' && node.kind !== 'component') {
    return err('unsupported-operation');
  }
  const bytes = authored.snapshot.bytes;
  const open = openTagEnd(bytes, node);
  const close = closeTagStart(bytes, node, open.end);
  if (open.selfClosing || close === undefined) {
    return err('unsupported-operation');
  }
  const openEnd = lineEndAfter(bytes, open.end, close) ?? open.end;
  const closeStart = lineStartBefore(bytes, close, openEnd) ?? close;
  const hunks: SourceEdit[] = [
    { span: toByteSpan(node.span.start, openEnd), text: '' },
    { span: toByteSpan(closeStart, node.span.end), text: '' },
  ];
  return ok({ anchor, operation: { tag: 'rewrite-node', hunks } });
}

function lineEndAfter(bytes: Uint8Array, from: number, ceiling: number): number | undefined {
  for (let at = from; at < ceiling; at++) {
    const byte = bytes[at];
    if (byte === 0x0a) {
      return at + 1;
    }
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d) {
      return undefined;
    }
  }
  return undefined;
}

function lineStartBefore(bytes: Uint8Array, to: number, floor: number): number | undefined {
  for (let at = to - 1; at >= floor; at--) {
    const byte = bytes[at];
    if (byte === 0x0a) {
      return at > floor && bytes[at - 1] === 0x0d ? at - 1 : at;
    }
    if (byte !== 0x20 && byte !== 0x09) {
      return undefined;
    }
  }
  return undefined;
}

function pageNodeAt(authored: Authored, path: readonly number[]): PageNode | undefined {
  const roots = authored.format === 'astro' ? astroPageNodes(authored.text) : markdownPageNodes(authored);
  if (roots === undefined) {
    return undefined;
  }
  let list: readonly PageNode[] = roots;
  let node: PageNode | undefined;
  for (const step of path) {
    node = list[step];
    if (node === undefined) {
      return undefined;
    }
    list = 'children' in node && Array.isArray(node.children) ? node.children : [];
  }
  return node;
}

function astroPageNodes(text: string): readonly PageNode[] | undefined {
  const parsed = parsePageResult(parsePage(text, { locs: true }));
  return parsed.editable ? parsed.model.nodes : undefined;
}

function frontmatterDraft(authored: Authored, model: Extract<Edit, { tag: 'set-frontmatter' }>['model']): Result<IntentDraft, RejectionReason> {
  const block = authored.projection.frontmatter;
  const page = serializePage({ ...model, nodes: [] });
  if (block === undefined) {
    const printed = printedBlock(page, '\n');
    if (printed === undefined) {
      return err('unsupported-operation');
    }
    const anchor = toAnchorRef({
      span: toByteSpan(0, authored.snapshot.bytes.length),
      path: [],
      expectedKind: 'document',
    });
    return ok({ anchor, operation: { tag: 'insert-frontmatter', source: printed } });
  }
  const before = Buffer.from(authored.snapshot.bytes.subarray(block.start, block.end)).toString('utf8');
  const printed = printedBlock(page, before);
  if (printed === undefined) {
    return err('unsupported-operation');
  }
  const { slot, text } = frontmatterSlot(block, before, printed);
  const anchor = toAnchorRef({ span: block, path: [], expectedKind: 'frontmatter' });
  return ok({ anchor, operation: { tag: 'edit-frontmatter-slot', slot, text } });
}

function printedBlock(page: string, before: string): string | undefined {
  const eol = page.includes('\r\n') ? '\r\n' : '\n';
  const lines = page.split(eol);
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close === -1) {
    return undefined;
  }
  const block = lines.slice(0, close + 1).join(eol);
  return before.endsWith('\n') ? `${block}${eol}` : block;
}

function revertDraft(snapshot: Snapshot, hunks: Extract<Edit, { tag: 'revert' }>['hunks']): Result<IntentDraft, RejectionReason> {
  const inside = hunks.every((hunk) => hunk.span.end <= snapshot.bytes.length);
  if (!inside || !spansAscending(hunks.map((hunk) => hunk.span)) || hunks.length === 0) {
    return err('anchor-moved');
  }
  const anchor = toAnchorRef({
    span: toByteSpan(0, snapshot.bytes.length),
    path: [],
    expectedKind: 'document',
  });
  return ok({ anchor, operation: { tag: 'revert-splices', hunks } });
}

function codePatchDraft(snapshot: Snapshot, hunks: Extract<Edit, { tag: 'code-patch' }>['hunks']): Result<IntentDraft, RejectionReason> {
  assert(hunks.length > 0, 'The wire parser requires a hunk');
  assert(spansAscending(hunks.map((hunk) => hunk.span)), 'The wire parser orders the hunks');
  const bytes = snapshot.bytes;
  for (const hunk of hunks) {
    if (bytes.length < hunk.span.end) {
      return err('merge-conflict');
    }
    if (continuesCodePoint(bytes, hunk.span.start) || continuesCodePoint(bytes, hunk.span.end)) {
      return err('merge-conflict');
    }
    const held = bytes.subarray(hunk.span.start, hunk.span.end);
    if (!byteStringsEqual(toByteString(held), encodeUtf8(hunk.expected))) {
      return err('merge-conflict');
    }
  }
  const anchor = toAnchorRef({
    span: toByteSpan(0, bytes.length),
    path: [],
    expectedKind: 'document',
  });
  const edits = hunks.map((hunk) => ({ span: hunk.span, text: hunk.text }));
  return ok({ anchor, operation: { tag: 'apply-code-patch', hunks: edits } });
}

function continuesCodePoint(bytes: Uint8Array, offset: number): boolean {
  const byte = bytes[offset];
  if (byte === undefined) {
    return false;
  }
  return byte >= 0x80 && byte < 0xc0;
}
