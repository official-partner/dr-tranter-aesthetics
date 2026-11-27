import { assert } from '../core/assert';
import { indentUnitBelow } from '../core/indent';
import { HTML_INLINE_REPLACED_TAGS, HTML_PHRASING_TAGS, HTML_TEXT_ONLY_PARENTS, HTML_VOID_TAGS, HTML_WHITESPACE_TAGS } from '../page/htmlTags';
import type { Operation, Placement, RejectionReason } from './intent';
import { labelsNode } from '../page/leadingNote';
import { stripEdits, scopeAt, type SourceReplacement } from './loopScope';
import type { ByteRelocation, Plan, PostKind, Splice } from './planner';
import {
  blankText,
  closeTagStart,
  containsNewline,
  lineIndent,
  nodeAtPath,
  nodeEditable,
  nodePlaceable,
  nodeUnchanged,
  openTagEnd,
  parentPath,
  resolveTarget,
  samePath,
  siblingsOf,
  slice,
  startsWith,
  tagNameEnd,
  textOf,
  validProjections,
  whitespaceAfter,
  whitespaceBefore,
  type PlanContext,
  type Target,
  type ValidProjection,
} from './planSupport';
import { toChildIndex, type AnchorRef } from '../page/ref';
import { err, ok, type Result } from '../core/result';
import { markdownPrefix } from './markdownLayout';
import { checkInsertion, checkRelocation, checkWrap } from './planPlacement';
import { itemMarker, markdownBeside, markdownInsertion, markdownRemoval, markdownRemoved, reprefixed } from './planMarkdown';
import type { NodeList, ProjectedNode } from '../page/sourceProjection';
import { encodeUtf8, toByteSpan, toByteString, type ByteSpan, type ByteString } from '../core/span';

const NEWLINE = 0x0a;

interface Insertion {
  readonly range: ByteSpan;
  readonly text: string;
  readonly anchorPath: readonly number[] | undefined;
}

export function planRemoveNode(context: PlanContext, anchor: AnchorRef): Result<Plan, RejectionReason> {
  const resolved = resolveTarget(context, anchor);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.value;
  if (!movable(target.current.kind)) {
    return err('unsupported-operation');
  }
  if (!nodePlaceable(target.current)) {
    return err('unsupported-operation');
  }
  if (!nodeUnchanged(context, target)) {
    return err('region-externally-modified');
  }
  const current = currentProjection(context);
  const node = target.current;
  switch (node.list) {
    case 'markup': {
      if (leavesCodeEmpty(context.current.bytes, current, node)) {
        return err('unsupported-operation');
      }
      return ok(removalPlan(context.current.bytes, current, node, removalRange));
    }
    case 'blocks':
    case 'items': {
      const removed = markdownRemoved(current, node);
      if (!nodePlaceable(removed)) {
        return err('unsupported-operation');
      }
      const removal = markdownRemoval(context.current.bytes, current, removed);
      if (removal === undefined) {
        return err('unsupported-operation');
      }
      const splice = spliceAt(context.current.bytes, removal.range, removal.text);
      const postKinds = parentKind(current, removed);
      return ok({ splices: [splice], postKinds, candidate: 'must-parse' });
    }
    case 'inline':
      return err('unsupported-operation');
    default: {
      const exhaustive: never = node.list;
      return exhaustive;
    }
  }
}

function removalPlan(
  bytes: ByteString,
  projection: ValidProjection,
  node: ProjectedNode,
  range: (bytes: ByteString, projection: ValidProjection, node: ProjectedNode) => ByteSpan,
): Plan {
  const splice = spliceAt(bytes, range(bytes, projection, node), '');
  return { splices: [splice], postKinds: parentKind(projection, node), candidate: 'must-parse' };
}

export function planInsertNode(context: PlanContext, anchor: AnchorRef, operation: Extract<Operation, { tag: 'insert-node' }>): Result<Plan, RejectionReason> {
  const resolved = resolveTarget(context, anchor);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.value;
  if (!placeWritable(context.current.bytes, currentProjection(context), target.current, operation.placement)) {
    return err('unsupported-operation');
  }
  const current = currentProjection(context);
  const placed = checkInsertion(context.current.bytes, current, target.current, operation.placement, operation.source);
  if (!placed.ok) {
    return placed;
  }
  const insertion = insertionAt(context.current.bytes, current, target.current, operation.placement, { text: operation.source, origin: 'new' });
  if (!insertion.ok) {
    return insertion;
  }
  const splice = spliceAt(context.current.bytes, insertion.value.range, insertion.value.text);
  const anchorPath = insertion.value.anchorPath;
  const postKinds = anchorPath === undefined ? [] : [{ path: anchorPath.map(toChildIndex), kind: target.current.kind }];
  return ok({ splices: [splice], postKinds, candidate: 'must-parse' });
}

export function planWrapNodes(context: PlanContext, anchor: AnchorRef, operation: Extract<Operation, { tag: 'wrap-nodes' }>): Result<Plan, RejectionReason> {
  const first = resolveTarget(context, anchor);
  if (!first.ok) {
    return first;
  }
  const last = resolveTarget(context, operation.last);
  if (!last.ok) {
    return last;
  }
  const start = first.value.current;
  const end = last.value.current;
  if (!movable(start.kind) || !movable(end.kind)) {
    return err('unsupported-operation');
  }
  if (!nodePlaceable(start) || !nodePlaceable(end)) {
    return err('unsupported-operation');
  }
  if (!samePath(parentPath(start.path), parentPath(end.path))) {
    return err('unsupported-operation');
  }
  if (start.list !== 'markup') {
    return err('unsupported-operation');
  }
  if (end.span.start < start.span.start) {
    return err('unsupported-operation');
  }
  const bytes = context.current.bytes;
  const placed = checkWrap(bytes, currentProjection(context), start, end, operation.open);
  if (!placed.ok) {
    return placed;
  }
  const splices = [
    spliceAt(bytes, toByteSpan(start.span.start, start.span.start), operation.open),
    spliceAt(bytes, toByteSpan(end.span.end, end.span.end), operation.close),
  ];
  assert(start.span.start < end.span.end, 'A run of nodes covers at least one byte');
  return ok({ splices, postKinds: [], candidate: 'must-parse' });
}

export function planAppendBody(context: PlanContext, anchor: AnchorRef, operation: Extract<Operation, { tag: 'append-body' }>): Result<Plan, RejectionReason> {
  assert(anchor.expectedKind === 'document', 'An append anchors the whole document');
  const projections = validProjections(context);
  if (!projections.ok) {
    return projections;
  }
  if (projections.value.current.nodes.length > 0) {
    return err('anchor-moved');
  }
  const bytes = context.current.bytes;
  const end = bytes.length;
  const crlf = end > 1 && bytes[end - 2] === 0x0d && bytes[end - 1] === NEWLINE;
  const eol = crlf || bytesHaveCrlf(bytes) ? '\r\n' : '\n';
  const lead = end === 0 || bytes[end - 1] === NEWLINE ? '' : eol;
  const splice = spliceAt(bytes, toByteSpan(end, end), `${lead}${operation.source}${eol}`);
  return ok({ splices: [splice], postKinds: [], candidate: 'must-parse' });
}

function bytesHaveCrlf(bytes: ByteString): boolean {
  for (let index = 1; index < bytes.length; index++) {
    if (bytes[index] === NEWLINE) {
      return bytes[index - 1] === 0x0d;
    }
  }
  return false;
}

export function planMoveNode(context: PlanContext, anchor: AnchorRef, operation: Extract<Operation, { tag: 'move-node' }>): Result<Plan, RejectionReason> {
  const source = resolveTarget(context, anchor);
  if (!source.ok) {
    return source;
  }
  const destination = resolveTarget(context, operation.destination);
  if (!destination.ok) {
    return destination;
  }
  const moved = source.value.current;
  if (!movable(moved.kind)) {
    return err('unsupported-operation');
  }
  if (!nodePlaceable(moved)) {
    if (moved.capability !== 'repeated-source-node') {
      return err('unsupported-operation');
    }
  }
  if (!placeWritable(context.current.bytes, currentProjection(context), destination.value.current, operation.placement)) {
    return err('unsupported-operation');
  }
  if (startsWith(destination.value.current.path, moved.path)) {
    return err('unsupported-operation');
  }
  if (!nodeUnchanged(context, source.value)) {
    return err('region-externally-modified');
  }
  const current = currentProjection(context);
  const placed = checkRelocation(context.current.bytes, current, moved, destination.value.current, operation.placement);
  if (!placed.ok) {
    return placed;
  }
  const list = listAt(current, destination.value.current, operation.placement);
  if (list !== moved.list) {
    return err('unsupported-operation');
  }
  switch (list) {
    case 'markup':
      if (leavesCodeEmpty(context.current.bytes, current, moved)) {
        return err('unsupported-operation');
      }
      return planRelocation(context, source.value, destination.value, operation.placement);
    case 'blocks':
    case 'items':
      return planMarkdownRelocation(context, moved, destination.value.current, operation.placement);
    case 'inline':
      return err('unsupported-operation');
    default: {
      const exhaustive: never = list;
      return exhaustive;
    }
  }
}

function planMarkdownRelocation(context: PlanContext, moved: ProjectedNode, destination: ProjectedNode, placement: Placement): Result<Plan, RejectionReason> {
  const bytes = context.current.bytes;
  const current = currentProjection(context);
  const beside = markdownBeside(current, destination, placement);
  if (beside === undefined) {
    return err('unsupported-operation');
  }
  if (moved.list === 'items') {
    if (itemMarker(bytes, moved) !== itemMarker(bytes, beside.node)) {
      return err('unsupported-operation');
    }
  }
  const prefix = markdownPrefix(bytes, beside.node.span.start);
  const text = prefix === undefined ? undefined : reprefixed(bytes, moved, prefix);
  if (text === undefined) {
    return err('unsupported-operation');
  }
  const anchorPath = placement === 'before' ? shifted(destination.path) : destination.path;
  const insertion = markdownInsertion(bytes, current, beside, anchorPath, text);
  if (insertion === undefined) {
    return err('unsupported-operation');
  }
  const removal = markdownRemoval(bytes, current, markdownRemoved(current, moved));
  if (removal === undefined) {
    return err('unsupported-operation');
  }
  return relocationSplices(bytes, insertion, removal, { span: moved.span, text });
}

function planRelocation(context: PlanContext, source: Target, destination: Target, placement: Placement): Result<Plan, RejectionReason> {
  const bytes = context.current.bytes;
  const current = currentProjection(context);
  const text = relocatedText(bytes, current, source.current, destination.current, placement);
  if (!text.ok) {
    return text;
  }
  const landing = placement === 'before' ? (labelOf(bytes, current, destination.current) ?? destination.current) : destination.current;
  const insertion = insertionAt(bytes, current, landing, placement, { text: text.value, origin: 'relocated' });
  if (!insertion.ok) {
    return insertion;
  }
  const removal = { range: removalRange(bytes, current, source.current), text: '' };
  return relocationSplices(bytes, insertion.value, removal, {
    span: source.current.span,
    text: textOf(bytes, source.current.span),
  });
}

function relocationSplices(
  bytes: ByteString,
  insertion: Pick<Insertion, 'range' | 'text'>,
  removal: { readonly range: ByteSpan; readonly text: string },
  moved: { readonly span: ByteSpan; readonly text: string },
): Result<Plan, RejectionReason> {
  const into = insertion.range;
  const out = removal.range;
  if (overlaps(into, out)) {
    return err('unsupported-operation');
  }
  const insert = spliceAt(bytes, into, insertion.text);
  const remove = spliceAt(bytes, out, removal.text);
  const splices = into.end <= out.start ? [insert, remove] : [remove, insert];
  const relocation = relocationOf(bytes, insertion, remove, moved);
  return ok({ splices, relocation, postKinds: [], candidate: 'must-parse' });
}

function relocationOf(
  bytes: ByteString,
  insertion: Pick<Insertion, 'range' | 'text'>,
  removal: Splice,
  moved: { readonly span: ByteSpan; readonly text: string },
): ByteRelocation | undefined {
  const source = moved.span;
  assert(removal.range.start <= source.start, 'The move removes its source start');
  assert(source.end <= removal.range.end, 'The move removes its source end');
  const original = textOf(bytes, source);
  assert(original.length > 0, 'A moved subtree has source text');
  if (original !== moved.text) {
    return undefined;
  }
  const offset = insertion.text.indexOf(original);
  if (offset < 0) {
    return undefined;
  }
  if (insertion.text.indexOf(original, offset + 1) !== -1) {
    return undefined;
  }
  const shift = removal.range.end <= insertion.range.start ? removal.replacementBytes.length - removal.expectedBytes.length : 0;
  const start = insertion.range.start + shift + encodeUtf8(insertion.text.slice(0, offset)).length;
  const target = toByteSpan(start, start + source.end - source.start);
  return { source, target };
}

function overlaps(into: ByteSpan, out: ByteSpan): boolean {
  if (into.start === into.end) {
    if (out.start < into.start) {
      return into.start < out.end;
    }
    return false;
  }
  if (out.start < into.end) {
    return into.start < out.end;
  }
  return false;
}

function point(at: number): ByteSpan {
  return toByteSpan(at, at);
}

function relocatedText(
  bytes: ByteString,
  projection: ValidProjection,
  moved: ProjectedNode,
  destination: ProjectedNode,
  placement: Placement,
): Result<string, RejectionReason> {
  const before = scopeAt(projection, bytes, moved.path);
  const destinationPath = inside(placement) ? [...destination.path, toChildIndex(0)] : destination.path;
  const after = scopeAt(projection, bytes, destinationPath);
  if (before === undefined) {
    return err('unsupported-operation');
  }
  if (after === undefined) {
    return err('unsupported-operation');
  }
  const lost = before.filter((name) => !after.includes(name));
  const edits = lost.length === 0 ? [] : stripEdits(projection, bytes, moved, lost);
  if (edits === undefined) {
    return err('unsupported-operation');
  }
  const relocated = withReplacements(bytes, labelledSpan(bytes, projection, moved), edits);
  const text = textOf(relocated, toByteSpan(0, relocated.length));
  return ok(labelRealigned(bytes, projection, moved, text, insertedIndent(bytes, projection, destination, placement)));
}

function labelRealigned(bytes: ByteString, projection: ValidProjection, moved: ProjectedNode, text: string, landing: string): string {
  const label = labelOf(bytes, projection, moved);
  if (label === undefined) {
    return text;
  }
  const gap = textOf(bytes, toByteSpan(label.span.end, moved.span.start));
  const newline = gap.lastIndexOf('\n');
  if (newline < 0) {
    return text;
  }
  if (gap.slice(newline + 1) !== lineIndent(bytes, label.span.start)) {
    return text;
  }
  const labelText = textOf(bytes, label.span);
  assert(text.startsWith(labelText + gap), 'labelRealigned: the moved text opens with its label and gap');
  return `${labelText}${gap.slice(0, newline + 1)}${landing}${text.slice(labelText.length + gap.length)}`;
}

function withReplacements(bytes: ByteString, span: ByteSpan, edits: readonly SourceReplacement[]): ByteString {
  const parts: Uint8Array[] = [];
  let cursor = span.start;
  for (const edit of edits) {
    assert(cursor <= edit.span.start, 'Replacements ascend without overlapping');
    assert(edit.span.end <= span.end, 'Replacements lie inside the moved node');
    parts.push(bytes.subarray(cursor, edit.span.start), encodeUtf8(edit.text));
    cursor = edit.span.end;
  }
  parts.push(bytes.subarray(cursor, span.end));
  const size = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return toByteString(joined);
}

function inCode(projection: ValidProjection, node: ProjectedNode): boolean {
  if (node.path.length === 1) {
    return false;
  }
  const parent = nodeAtPath(projection, parentPath(node.path));
  assert(parent !== undefined, 'A nested node has a parent');
  return parent.kind === 'branch' || parent.kind === 'map';
}

function leavesCodeEmpty(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): boolean {
  if (node.path.length === 1) {
    return false;
  }
  if (!inCode(projection, node)) {
    return false;
  }
  const label = labelOf(bytes, projection, node);
  const others = siblingsOf(projection, node).filter((sibling) => sibling !== node && sibling !== label && !blankText(bytes, sibling));
  return others.length === 0;
}

export function removalRange(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): ByteSpan {
  const first = labelOf(bytes, projection, node) ?? node;
  const span = toByteSpan(first.span.start, node.span.end);
  const floor = siblingBounds(bytes, projection, first).floor;
  const ceiling = siblingBounds(bytes, projection, node).ceiling;
  const before = whitespaceBefore(bytes, span.start, floor);
  if (before < span.start) {
    return toByteSpan(before, span.end);
  }
  const after = whitespaceAfter(bytes, span.end, ceiling);
  const newline = bytes.subarray(span.end, after).indexOf(0x0a);
  if (newline >= 0) {
    return toByteSpan(span.start, span.end + newline + 1);
  }
  return span;
}

export function labelOf(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): ProjectedNode | undefined {
  const siblings = siblingsOf(projection, node);
  const index = siblings.indexOf(node);
  assert(index >= 0, 'labelOf: a node is among its siblings');
  const previous = siblings[index - 1];
  if (previous === undefined) {
    return undefined;
  }
  if (!labelsNode(previous.kind, node.kind)) {
    return undefined;
  }
  assert(previous.span.end <= node.span.start, 'labelOf: a label precedes its node');
  assert(textOf(bytes, toByteSpan(previous.span.end, node.span.start)).trim() === '', 'labelOf: only whitespace parts a label from its node');
  return previous;
}

export function labelledSpan(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): ByteSpan {
  const label = labelOf(bytes, projection, node);
  if (label === undefined) {
    return node.span;
  }
  assert(label.span.start < node.span.start, 'labelledSpan: a label starts before its node');
  return toByteSpan(label.span.start, node.span.end);
}

function insertionAt(
  bytes: ByteString,
  projection: ValidProjection,
  anchor: ProjectedNode,
  placement: Placement,
  written: Written,
): Result<Insertion, RejectionReason> {
  if (listAt(projection, anchor, placement) !== 'markup') {
    return markdownInsertionAt(bytes, projection, anchor, placement, written.text);
  }
  if (inside(placement)) {
    return insertionInside(bytes, projection, anchor, placement, written);
  }
  if (!movable(anchor.kind)) {
    return err('unsupported-operation');
  }
  if (inCode(projection, anchor)) {
    if (!betweenLoopRoots(bytes, projection, anchor, placement)) {
      return err('unsupported-operation');
    }
  }
  return ok(
    insertionBeside(bytes, projection, anchor, placement === 'after' ? 'after' : 'before', written, besideAnchorPath(bytes, projection, anchor, placement)),
  );
}

function besideAnchorPath(bytes: ByteString, projection: ValidProjection, anchor: ProjectedNode, placement: Placement): readonly number[] | undefined {
  assert(!inside(placement), 'Inside a parent the anchor is the parent');
  assert(anchor.path.length > 0, 'A tree node has a path');
  if (siblingsOf(projection, anchor).some((sibling) => blankText(bytes, sibling))) {
    return undefined;
  }
  return placement === 'after' ? anchor.path : shifted(anchor.path);
}

function insertionBeside(
  bytes: ByteString,
  projection: ValidProjection,
  anchor: ProjectedNode,
  side: 'before' | 'after',
  written: Written,
  anchorPath: readonly number[] | undefined,
): Insertion {
  const lined = written.origin === 'new' ? insertionOnOwnLine(bytes, projection, anchor, side, written.text) : undefined;
  if (lined !== undefined) {
    return { ...lined, anchorPath };
  }
  const edge = insertionAtTextEdge(bytes, projection, anchor, side, written.text);
  if (edge !== undefined) {
    return { ...edge, anchorPath };
  }
  const separator = written.origin === 'new' ? separatorBeside(bytes, projection, anchor, written.text) : separatorBefore(bytes, projection, anchor);
  if (side === 'after') {
    const closing = written.origin === 'new' ? closingLineAfter(bytes, projection, anchor, separator, written.text) : '';
    return { range: point(anchor.span.end), text: `${separator}${written.text}${closing}`, anchorPath };
  }
  return { range: point(anchor.span.start), text: `${written.text}${separator}`, anchorPath };
}

function insertionAtTextEdge(
  bytes: ByteString,
  projection: ValidProjection,
  anchor: ProjectedNode,
  side: 'before' | 'after',
  text: string,
): Pick<Insertion, 'range' | 'text'> | undefined {
  if (anchor.kind !== 'text') {
    return undefined;
  }
  const parent = tagParent(projection, anchor);
  if (parent === undefined) {
    return undefined;
  }
  if (parentFlow(bytes, projection, parent) === 'whitespace') {
    return undefined;
  }
  const words = toByteSpan(contentStart(bytes, anchor), contentEnd(bytes, anchor));
  const edge = side === 'after' ? toByteSpan(words.end, anchor.span.end) : toByteSpan(anchor.span.start, words.start);
  const breaks = bytes.subarray(edge.start, edge.end);
  const at = side === 'after' ? breaks.lastIndexOf(NEWLINE) : breaks.indexOf(NEWLINE);
  if (at < 0) {
    return undefined;
  }
  const lineStart = edge.start + at + 1;
  assert(lineStart <= anchor.span.end, 'A line inside a text node starts inside it');
  assert(lineStart === 0 || bytes[lineStart - 1] === NEWLINE, 'The new line starts after a line break');
  return { range: point(lineStart), text: `${insertedIndent(bytes, projection, anchor, side)}${text}${eolOf(bytes)}` };
}

function contentEnd(bytes: ByteString, node: ProjectedNode): number {
  const start = contentStart(bytes, node);
  let end = node.span.end;
  if (node.kind === 'text') {
    while (end > start) {
      if (!ASCII_WHITESPACE.has(bytes[end - 1] ?? 0)) {
        break;
      }
      end--;
    }
  }
  assert(start <= end, 'contentEnd: a node ends after its content starts');
  return end;
}

function closingLineAfter(bytes: ByteString, projection: ValidProjection, anchor: ProjectedNode, separator: string, text: string): string {
  assert(separator.trim() === '', 'closingLineAfter: a separator is whitespace');
  if (!separator.includes('\n')) {
    return '';
  }
  const parent = tagParent(projection, anchor);
  if (parent === undefined) {
    return '';
  }
  if (neighboursOf(bytes, projection, anchor).next !== undefined) {
    return '';
  }
  if (contentOf(bytes, projection, anchor).end !== anchor.span.end) {
    return '';
  }
  if (!standsOnOwnLine(bytes, projection, parent, text)) {
    return '';
  }
  return `${eolOf(bytes)}${lineIndent(bytes, parent.span.start)}`;
}

function markdownInsertionAt(
  bytes: ByteString,
  projection: ValidProjection,
  anchor: ProjectedNode,
  placement: Placement,
  text: string,
): Result<Insertion, RejectionReason> {
  const beside = markdownBeside(projection, anchor, placement);
  if (beside === undefined) {
    return err('unsupported-operation');
  }
  if (beside.node.list === 'inline') {
    return err('unsupported-operation');
  }
  if (beside.node.list === 'markup') {
    return err('unsupported-operation');
  }
  const anchorPath = placement === 'before' ? shifted(anchor.path) : anchor.path;
  const insertion = markdownInsertion(bytes, projection, beside, anchorPath, text);
  return insertion === undefined ? err('unsupported-operation') : ok(insertion);
}

function listAt(projection: ValidProjection, anchor: ProjectedNode, placement: Placement): NodeList {
  if (!inside(placement)) {
    return anchor.list;
  }
  if (anchor.syntax === 'markup') {
    return 'markup';
  }
  const [first] = childrenOf(projection, anchor);
  return first === undefined ? 'inline' : first.list;
}

function insertionInside(
  bytes: ByteString,
  projection: ValidProjection,
  parent: ProjectedNode,
  placement: Placement,
  written: Written,
): Result<Insertion, RejectionReason> {
  const text = written.text;
  const tag = parent.kind === 'element' || parent.kind === 'component';
  const structure = parent.kind === 'map' || parent.kind === 'branch';
  if (!tag && !structure) {
    return err('unsupported-operation');
  }
  const children = childrenOf(projection, parent);
  const first = children[0];
  const last = children[children.length - 1];
  if (first !== undefined) {
    if (last !== undefined) {
      const beside = placement === 'first-child' ? first : last;
      const anchorPath = parent.path;
      const preserved = branchChildAsMarkup(bytes, parent, beside);
      if (preserved !== undefined) {
        if (placement !== 'first-child') {
          return err('unsupported-operation');
        }
        const separator = separatorBefore(bytes, projection, beside);
        return ok({ range: beside.span, text: `${text}${separator}${preserved}`, anchorPath });
      }
      return ok(insertionBeside(bytes, projection, beside, placement === 'first-child' ? 'before' : 'after', written, anchorPath));
    }
  }
  if (parent.kind === 'branch') {
    return ok({ range: parent.span, text, anchorPath: parent.path });
  }
  if (parent.kind === 'map') {
    const placeholder = emptyLoopPlaceholder(bytes, parent);
    if (placeholder === undefined) {
      return err('unsupported-operation');
    }
    return ok({ range: placeholder, text, anchorPath: parent.path });
  }
  if (!tag) {
    return err('unsupported-operation');
  }
  const open = openTagEnd(bytes, parent);
  if (open.selfClosing) {
    const name = textOf(bytes, toByteSpan(parent.span.start + 1, tagNameEnd(bytes, parent)));
    if (parent.kind === 'element' && HTML_VOID_TAGS.has(name.toLowerCase())) {
      return err('unsupported-operation');
    }
    return ok(insertionIntoSelfClosingTag(bytes, projection, parent, open.end, text));
  }
  const close = closeTagStart(bytes, parent, open.end);
  if (close === undefined) {
    return err('unsupported-operation');
  }
  return ok(insertionIntoEmptyTag(bytes, projection, parent, toByteSpan(open.end, close), text));
}

function insertionIntoEmptyTag(bytes: ByteString, projection: ValidProjection, parent: ProjectedNode, gap: ByteSpan, text: string): Insertion {
  assert(gap.start <= gap.end, 'A tag closes after it opens');
  assert(textOf(bytes, gap).trim().length === 0, 'An empty tag holds whitespace at most');
  const anchorPath = parent.path;
  if (parentFlow(bytes, projection, parent) === 'whitespace') {
    return { range: point(gap.start), text, anchorPath };
  }
  const eol = eolOf(bytes);
  const indent = nestedIndent(bytes, lineIndent(bytes, parent.span.start));
  if (containsNewline(bytes, gap)) {
    return { range: point(gap.start), text: `${eol}${indent}${text}`, anchorPath };
  }
  if (standsOnOwnLine(bytes, projection, parent, text)) {
    return { range: gap, text: `${eol}${indent}${text}${eol}${lineIndent(bytes, parent.span.start)}`, anchorPath };
  }
  return { range: point(gap.start), text, anchorPath };
}

function insertionIntoSelfClosingTag(bytes: ByteString, projection: ValidProjection, parent: ProjectedNode, openEnd: number, text: string): Insertion {
  assert(parent.kind === 'component' || parent.kind === 'element', 'A paired conversion starts from a tag');
  const slash = openEnd - 2;
  assert(bytes[slash] === 0x2f, 'A self-closing component ends in a slash');
  const nameSpan = toByteSpan(parent.span.start + 1, tagNameEnd(bytes, parent));
  const name = textOf(bytes, nameSpan);
  assert(name.length > 0, 'A component has a written tag name');
  const range = toByteSpan(selfClosingTailStart(bytes, slash), openEnd);
  const eol = eolOf(bytes);
  const outer = lineIndent(bytes, parent.span.start);
  const body = standsOnOwnLine(bytes, projection, parent, text) ? `${eol}${nestedIndent(bytes, outer)}${text}${eol}${outer}` : text;
  return {
    range,
    text: `>${body}</${name}>`,
    anchorPath: parent.path,
  };
}

function selfClosingTailStart(bytes: ByteString, slash: number): number {
  let start = slash;
  while (start > 0) {
    const previous = bytes[start - 1];
    assert(previous !== undefined, 'The self-closing tail lies inside the bytes');
    if (previous !== 0x20 && previous !== 0x09) {
      break;
    }
    start--;
  }
  return bytes[start - 1] === NEWLINE ? slash : start;
}

function branchChildAsMarkup(bytes: ByteString, parent: ProjectedNode, child: ProjectedNode): string | undefined {
  if (parent.kind !== 'branch') {
    return undefined;
  }
  if (child.kind !== 'cond' && child.kind !== 'expr') {
    return undefined;
  }
  assert(parent.span.start <= child.span.start, 'A branch child starts inside its branch');
  assert(child.span.end <= parent.span.end, 'A branch child ends inside its branch');
  const source = textOf(bytes, child.span);
  return source.startsWith('{') ? source : `{${source}}`;
}

const EMPTY_LOOP_TAIL = /=>[ \t\r\n]*\([ \t\r\n]*null[ \t\r\n]*\)[ \t\r\n]*\)[ \t\r\n]*\}?[ \t\r\n]*$/;

function emptyLoopPlaceholder(bytes: ByteString, loop: ProjectedNode): ByteSpan | undefined {
  assert(loop.kind === 'map', 'Only a loop holds an empty-loop placeholder');
  assert(loop.callback !== true, 'A callback loop is refused before its placeholder is read');
  const source = textOf(bytes, loop.span);
  const match = EMPTY_LOOP_TAIL.exec(source);
  if (match === null) {
    return undefined;
  }
  const keyword = source.lastIndexOf('null');
  assert(keyword > match.index, 'The placeholder lies inside the matched tail');
  const tailBytes = source.length - keyword;
  const start = loop.span.end - tailBytes;
  assert(start >= loop.span.start, 'The placeholder starts inside the loop');
  return toByteSpan(start, start + 'null'.length);
}

function separatorBefore(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): string {
  const first = labelOf(bytes, projection, node) ?? node;
  const bounds = siblingBounds(bytes, projection, first);
  const start = whitespaceBefore(bytes, first.span.start, bounds.floor);
  const separator = textOf(bytes, toByteSpan(start, first.span.start));
  if (separator === '') {
    if (node.path.length === 1) {
      return eolOf(bytes);
    }
  }
  return separator;
}

function siblingBounds(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): { readonly floor: number; readonly ceiling: number } {
  const { previous, next } = neighboursOf(bytes, projection, node);
  const outer = contentOf(bytes, projection, node);
  return {
    floor: previous === undefined ? outer.start : previous.span.end,
    ceiling: next === undefined ? outer.end : next.span.start,
  };
}

function neighboursOf(
  bytes: ByteString,
  projection: ValidProjection,
  node: ProjectedNode,
): { readonly previous: ProjectedNode | undefined; readonly next: ProjectedNode | undefined } {
  const siblings = siblingsOf(projection, node).filter((sibling) => sibling === node || !blankText(bytes, sibling));
  const index = siblings.indexOf(node);
  assert(index >= 0, 'A node is among its siblings');
  return { previous: siblings[index - 1], next: siblings[index + 1] };
}

function contentOf(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): ByteSpan {
  if (node.path.length === 1) {
    const body = projection.frontmatter === undefined ? bomLength(bytes) : projection.frontmatter.end;
    return toByteSpan(body, bytes.length);
  }
  const parent = nodeAtPath(projection, parentPath(node.path));
  assert(parent !== undefined, 'A nested node has a parent');
  if (parent.kind === 'element' || parent.kind === 'component') {
    const open = openTagEnd(bytes, parent);
    const close = closeTagStart(bytes, parent, open.end);
    assert(close !== undefined, 'A tag with children has a closing tag');
    return toByteSpan(open.end, close);
  }
  return parent.span;
}


interface Written {
  readonly text: string;
  readonly origin: 'new' | 'relocated';
}

type FlowLevel = 'block' | 'inline' | 'opaque' | 'text';

type ParentFlow = 'flow' | 'opaque' | 'phrasing' | 'whitespace';

const ASCII_WHITESPACE: ReadonlySet<number> = new Set([0x20, 0x09, 0x0a, 0x0d]);

const TAG_NAME_AT_START = /^<([A-Za-z][^\s/>]*)/;

const LEADING_NOTE = /^(?:\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->)(?=[\s\S]*\S)/;

export function insertedIndent(bytes: ByteString, projection: ValidProjection, anchor: ProjectedNode, placement: Placement): string {
  assert(anchor.span.start <= anchor.span.end, 'An anchor covers its own bytes');
  assert(anchor.span.end <= bytes.length, 'An anchor lies inside the bytes');
  if (inside(placement)) {
    return childIndent(bytes, projection, anchor);
  }
  const parent = tagParent(projection, anchor);
  if (parent === undefined) {
    return lineIndent(bytes, anchor.span.start);
  }
  const start = contentStart(bytes, anchor);
  return startsLine(bytes, start) ? lineIndent(bytes, start) : childIndent(bytes, projection, parent);
}

export function wrapperTakesLines(bytes: ByteString, projection: ValidProjection, first: ProjectedNode, name: string): boolean {
  assert(name.length > 0, 'A wrapper has a tag name');
  assert(first.span.end <= bytes.length, 'A wrapped node lies inside the bytes');
  const parent = tagParent(projection, first);
  if (parent !== undefined) {
    if (parentFlow(bytes, projection, parent) === 'whitespace') {
      return false;
    }
  }
  return tagLevel(name) === 'block' ? true : nodeLevel(bytes, first) === 'block';
}

function insertionOnOwnLine(
  bytes: ByteString,
  projection: ValidProjection,
  anchor: ProjectedNode,
  side: 'before' | 'after',
  text: string,
): Pick<Insertion, 'range' | 'text'> | undefined {
  const parent = tagParent(projection, anchor);
  if (parent === undefined) {
    return undefined;
  }
  if (fragmentLevel(text) !== 'block') {
    return undefined;
  }
  if (parentFlow(bytes, projection, parent) === 'whitespace') {
    return undefined;
  }
  if (separatorBefore(bytes, projection, anchor).includes('\n')) {
    return undefined;
  }
  const neighbours = neighboursOf(bytes, projection, anchor);
  const previous = side === 'after' ? anchor : neighbours.previous;
  const next = side === 'after' ? neighbours.next : anchor;
  if (!blockOrEdge(bytes, previous)) {
    return undefined;
  }
  if (!blockOrEdge(bytes, next)) {
    return undefined;
  }
  const bounds = siblingBounds(bytes, projection, anchor);
  const gap = side === 'after' ? toByteSpan(anchor.span.end, bounds.ceiling) : toByteSpan(bounds.floor, anchor.span.start);
  assert(textOf(bytes, gap).trim().length === 0, 'Block siblings are set apart by whitespace at most');
  const eol = eolOf(bytes);
  const indent = childIndent(bytes, projection, parent);
  if (containsNewline(bytes, gap)) {
    return { range: point(gap.start), text: `${eol}${indent}${text}` };
  }
  const after = next === undefined ? lineIndent(bytes, parent.span.start) : indent;
  return { range: gap, text: `${eol}${indent}${text}${eol}${after}` };
}

function blockOrEdge(bytes: ByteString, node: ProjectedNode | undefined): boolean {
  return node === undefined ? true : nodeLevel(bytes, node) === 'block';
}

function separatorBeside(bytes: ByteString, projection: ValidProjection, anchor: ProjectedNode, text: string): string {
  const separator = separatorBefore(bytes, projection, anchor);
  if (tagParent(projection, anchor) === undefined) {
    return separator;
  }
  const neighbours = neighboursOf(bytes, projection, anchor);
  if (!blockOrEdge(bytes, neighbours.previous)) {
    return separator;
  }
  if (!inlineLevel(fragmentLevel(text))) {
    return separator;
  }
  if (!inlineLevel(nodeLevel(bytes, anchor))) {
    return separator;
  }
  const next = neighbours.next;
  if (next === undefined) {
    return '';
  }
  if (!inlineLevel(nodeLevel(bytes, next))) {
    return '';
  }
  const spacing = separatorBefore(bytes, projection, next);
  assert(spacing.trim() === '', 'separatorBeside: the spacing between siblings is whitespace');
  return spacing;
}

function inlineLevel(level: FlowLevel): boolean {
  return level === 'inline' || level === 'text';
}

function standsOnOwnLine(bytes: ByteString, projection: ValidProjection, parent: ProjectedNode, text: string): boolean {
  const flow = parentFlow(bytes, projection, parent);
  const level = fragmentLevel(text);
  switch (flow) {
    case 'whitespace':
      return false;
    case 'phrasing':
      return level === 'block';
    case 'opaque':
      return level === 'block' || level === 'opaque';
    case 'flow':
      return level !== 'text';
    default: {
      const exhaustive: never = flow;
      return exhaustive;
    }
  }
}

function parentFlow(bytes: ByteString, projection: ValidProjection, parent: ProjectedNode): ParentFlow {
  assert(parent.kind === 'element' || parent.kind === 'component', 'Only a tag has a flow');
  for (let depth = parent.path.length; depth > 0; depth--) {
    const ancestor = nodeAtPath(projection, parent.path.slice(0, depth));
    assert(ancestor !== undefined, 'A node has every ancestor on its path');
    if (ancestor.kind === 'element') {
      if (HTML_WHITESPACE_TAGS.has(tagNameOf(bytes, ancestor))) {
        return 'whitespace';
      }
    }
  }
  if (parent.kind === 'component') {
    return 'opaque';
  }
  const name = tagNameOf(bytes, parent);
  if (name.includes('-')) {
    return 'opaque';
  }
  if (HTML_TEXT_ONLY_PARENTS.has(name)) {
    return 'phrasing';
  }
  return HTML_PHRASING_TAGS.has(name) ? 'phrasing' : 'flow';
}

function fragmentLevel(text: string): FlowLevel {
  const note = LEADING_NOTE.exec(text.trimStart());
  const trimmed = note === null ? text.trimStart() : text.trimStart().slice(note[0].length).trimStart();
  const name = TAG_NAME_AT_START.exec(trimmed)?.[1];
  if (name !== undefined) {
    return tagLevel(name);
  }
  if (trimmed.startsWith('<')) {
    return 'opaque';
  }
  if (trimmed.startsWith('{')) {
    return trimmed.includes('\n') ? 'opaque' : 'text';
  }
  return 'text';
}

function nodeLevel(bytes: ByteString, node: ProjectedNode): FlowLevel {
  switch (node.kind) {
    case 'element':
      return tagLevel(tagNameOf(bytes, node));
    case 'raw':
      return 'block';
    case 'text':
    case 'expr':
      return 'text';
    case 'component':
    case 'comment':
    case 'raw-line':
    case 'map':
    case 'cond':
    case 'branch':
    case 'chunk-group':
      return 'opaque';
    default: {
      const exhaustive: never = node.kind;
      return exhaustive;
    }
  }
}

function tagLevel(name: string): FlowLevel {
  assert(name.length > 0, 'A classified tag has a name');
  const lower = name.toLowerCase();
  if (name !== lower) {
    return 'opaque';
  }
  if (name.includes('-')) {
    return 'opaque';
  }
  if (name.includes('.')) {
    return 'opaque';
  }
  if (HTML_PHRASING_TAGS.has(name)) {
    return 'inline';
  }
  return HTML_INLINE_REPLACED_TAGS.has(name) ? 'inline' : 'block';
}

function tagNameOf(bytes: ByteString, node: ProjectedNode): string {
  assert(node.kind === 'element' || node.kind === 'component', 'Only a tag has a name');
  return textOf(bytes, toByteSpan(node.span.start + 1, tagNameEnd(bytes, node))).toLowerCase();
}

function tagParent(projection: ValidProjection, node: ProjectedNode): ProjectedNode | undefined {
  if (node.path.length === 1) {
    return undefined;
  }
  const parent = nodeAtPath(projection, parentPath(node.path));
  assert(parent !== undefined, 'A nested node has a parent');
  return parent.kind === 'element' || parent.kind === 'component' ? parent : undefined;
}

function childIndent(bytes: ByteString, projection: ValidProjection, parent: ProjectedNode): string {
  const lined = childrenOf(projection, parent)
    .filter((child) => !blankText(bytes, child))
    .map((child) => contentStart(bytes, child))
    .find((start) => startsLine(bytes, start));
  return lined === undefined ? nestedIndent(bytes, lineIndent(bytes, parent.span.start)) : lineIndent(bytes, lined);
}

function contentStart(bytes: ByteString, node: ProjectedNode): number {
  if (node.kind !== 'text') {
    return node.span.start;
  }
  let start = node.span.start;
  while (start < node.span.end) {
    if (!ASCII_WHITESPACE.has(bytes[start] ?? 0)) {
      break;
    }
    start++;
  }
  assert(start <= node.span.end, 'contentStart: the content starts inside the node');
  return start;
}

function nestedIndent(bytes: ByteString, outer: string): string {
  const unit = indentUnitBelow(textOf(bytes, toByteSpan(0, bytes.length)), outer);
  assert(unit.trim().length === 0, 'nestedIndent: a unit is only whitespace');
  return `${outer}${unit}`;
}

function eolOf(bytes: ByteString): '\n' | '\r\n' {
  return bytesHaveCrlf(bytes) ? '\r\n' : '\n';
}

function startsLine(bytes: ByteString, offset: number): boolean {
  const indent = lineIndent(bytes, offset);
  const start = offset - indent.length;
  return start === 0 ? true : bytes[start - 1] === NEWLINE;
}

function bomLength(bytes: ByteString): number {
  if (bytes[0] === 0xef) {
    if (bytes[1] === 0xbb) {
      return bytes[2] === 0xbf ? 3 : 0;
    }
  }
  return 0;
}

function childrenOf(projection: ValidProjection, node: ProjectedNode): readonly ProjectedNode[] {
  return projection.nodes.filter((candidate) => candidate.path.length === node.path.length + 1 && startsWith(candidate.path, node.path));
}

function parentKind(projection: ValidProjection, node: ProjectedNode): readonly PostKind[] {
  if (node.path.length === 1) {
    return [];
  }
  const parent = nodeAtPath(projection, parentPath(node.path));
  assert(parent !== undefined, 'A nested node has a parent');
  return [{ path: parent.path, kind: parent.kind }];
}

function currentProjection(context: PlanContext): ValidProjection {
  const projection = context.current.projection;
  assert(projection.tag === 'valid', 'A resolved target lies in a parsing file');
  return projection;
}

function shifted(path: readonly number[]): readonly number[] {
  const last = path[path.length - 1];
  assert(last !== undefined, 'A tree node has a path');
  return [...path.slice(0, -1), last + 1];
}

function placeWritable(bytes: ByteString, projection: ValidProjection, node: ProjectedNode, placement: Placement): boolean {
  if (inside(placement)) {
    if (node.callback === true) {
      return false;
    }
    return nodeEditable(node);
  }
  if (node.capability === 'repeated-source-node') {
    const parent = nodeAtPath(projection, parentPath(node.path));
    assert(parent !== undefined, 'A repeated source node has an enclosing owner');
    assert(node.list === 'markup', 'Repeated source nodes belong to markup syntax');
    if (parent.kind === 'element' || parent.kind === 'component') {
      return true;
    }
    return betweenLoopRoots(bytes, projection, node, placement);
  }
  return nodePlaceable(node);
}

function betweenLoopRoots(bytes: ByteString, projection: ValidProjection, node: ProjectedNode, placement: Placement): boolean {
  assert(!inside(placement), 'Only a placement beside a root stands between roots');
  assert(node.path.length > 1, 'A loop root has a parent');
  const parent = nodeAtPath(projection, parentPath(node.path));
  assert(parent !== undefined, 'A nested node has a parent');
  if (parent.kind !== 'map') {
    return false;
  }
  if (parent.callback === true) {
    return false;
  }
  const roots = siblingsOf(projection, node).filter((sibling) => !blankText(bytes, sibling));
  const index = roots.indexOf(node);
  assert(index >= 0, 'A loop root is among its siblings');
  if (placement === 'before') {
    return 0 < index;
  }
  return index + 1 < roots.length;
}

function inside(placement: Placement): boolean {
  switch (placement) {
    case 'first-child':
    case 'last-child':
      return true;
    case 'before':
    case 'after':
      return false;
    default: {
      const exhaustive: never = placement;
      return exhaustive;
    }
  }
}

function movable(kind: ProjectedNode['kind']): boolean {
  switch (kind) {
    case 'branch':
    case 'chunk-group':
      return false;
    case 'component':
    case 'element':
    case 'raw':
    case 'text':
    case 'expr':
    case 'raw-line':
    case 'comment':
    case 'map':
    case 'cond':
      return true;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function spliceAt(bytes: ByteString, range: ByteSpan, replacement: string): Splice {
  return {
    range,
    expectedBytes: slice(bytes, range),
    replacementBytes: encodeUtf8(replacement),
  };
}
