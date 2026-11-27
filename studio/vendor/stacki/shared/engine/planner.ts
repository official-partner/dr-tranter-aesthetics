import { assert } from '../core/assert';
import { countOccurrences } from './byteSearch';
import { diffBytes, DIFF_BUDGET } from './diff';
import { editInlineStyle } from './inlineStyle';
import type { AttributeValue, Intent, Operation, RejectionReason } from './intent';
import { LIMITS } from '../core/limits';
import { mapSpanThroughOutcome, type SpanMapping } from './mapSpan';
import {
  byteOffsetsIn,
  closeTagStart,
  containsNewline,
  isWhitespace,
  lineIndent,
  nodeEditable,
  openTagEnd,
  resolveTarget,
  tagNameEnd,
  textOf,
  whitespaceBefore,
  writtenAsTag,
  type PlanContext,
  type SpanMapper,
  type Target,
} from './planSupport';
import { planAppendBody, planInsertNode, planMoveNode, planRemoveNode, planWrapNodes } from './planTree';
import { planCodePatch, planFrontmatterSlot, planInsertFrontmatter, planRenameBinding, planRewriteText, planRevertSplices, planRewriteNode } from './planText';
import type { AnchorRef, NodeKind, StructuralPath } from '../page/ref';
import { err, ok, type Result } from '../core/result';
import type { Snapshot } from '../page/snapshot';
import type { ProjectedAttribute, ProjectedNode } from '../page/sourceProjection';
import { byteStringsEqual, encodeUtf8, toByteSpan, toByteString, type ByteSpan, type ByteString } from '../core/span';

export interface Splice {
  readonly range: ByteSpan;
  readonly expectedBytes: ByteString;
  readonly replacementBytes: ByteString;
}

export interface PostKind {
  readonly path: StructuralPath;
  readonly kind: NodeKind;
}

export type CandidatePolicy = 'must-parse' | 'may-be-invalid';

export interface Plan {
  readonly splices: readonly Splice[];
  readonly relocation?: ByteRelocation | undefined;
  readonly postKinds: readonly PostKind[];
  readonly candidate: CandidatePolicy;
}

export interface ByteRelocation {
  readonly source: ByteSpan;
  readonly target: ByteSpan;
}

export interface PlanningBase {
  readonly authored: Snapshot;
  readonly current: Snapshot;
}

export function planIntent(base: PlanningBase, intent: Intent): Result<Plan, RejectionReason> {
  if (base.authored.checksum === base.current.checksum) {
    assert(byteStringsEqual(base.authored.bytes, base.current.bytes), 'Equal checksums name equal bytes');
    return planWith(base, intent, (span) => ({ tag: 'resolved', span }));
  }
  return planIntentThroughDiff(base, intent);
}

export function planIntentThroughDiff(base: PlanningBase, intent: Intent): Result<Plan, RejectionReason> {
  let computed: ReturnType<typeof diffBytes> | undefined;
  return planWith(base, intent, (span) => {
    computed ??= diffBytes(base.authored.bytes, base.current.bytes, DIFF_BUDGET);
    const distance = computed.tag === 'computed' ? computed.diff.distance : base.authored.bytes.length + base.current.bytes.length;
    return uniqueOrAmbiguous(base, distance, mapSpanThroughOutcome(computed, span));
  });
}


function uniqueOrAmbiguous(base: PlanningBase, distance: number, mapped: SpanMapping): SpanMapping {
  assert(Number.isSafeInteger(distance), 'The diff distance is an integer');
  if (mapped.tag === 'resolved') {
    if (distance > 0) {
      const region = toByteString(base.current.bytes.subarray(mapped.span.start, mapped.span.end));
      const occurrences = countOccurrences(base.current.bytes, region, 2);
      assert(occurrences >= 1, 'The resolved region occurs where it was mapped');
      const authoredOccurrences = countOccurrences(base.authored.bytes, region, 2);
      assert(authoredOccurrences >= 1, 'The resolved region is the authored region');
      if (occurrences === 1) {
        if (authoredOccurrences === 1) {
          return mapped;
        }
        return { tag: 'ambiguous' };
      }
      return { tag: 'ambiguous' };
    }
    return mapped;
  }
  return mapped;
}

function planWith(base: PlanningBase, intent: Intent, mapSpan: SpanMapper): Result<Plan, RejectionReason> {
  assert(base.authored.path === intent.file, 'An intent is planned against its own file');
  assert(base.current.path === intent.file, 'The current snapshot is of the intent file');
  assert(base.authored.checksum === intent.authoredChecksum, 'The authored snapshot is the one the intent names');
  const context: PlanContext = { authored: base.authored, current: base.current, mapSpan };
  const anchor = intent.anchor;
  const operation = intent.operation;
  switch (operation.tag) {
    case 'set-attribute':
    case 'remove-attribute':
    case 'set-inline-style':
      return planAttributeOperation(context, anchor, operation);
    case 'insert-node':
      return planInsertNode(context, anchor, operation);
    case 'remove-node':
      return planRemoveNode(context, anchor);
    case 'move-node':
      return planMoveNode(context, anchor, operation);
    case 'wrap-nodes':
      return planWrapNodes(context, anchor, operation);
    case 'append-body':
      return planAppendBody(context, anchor, operation);
    case 'rename-binding':
      return planRenameBinding(context, anchor, operation);
    case 'edit-frontmatter-slot':
      return planFrontmatterSlot(context, anchor, operation);
    case 'insert-frontmatter':
      return planInsertFrontmatter(context, anchor, operation);
    case 'apply-code-patch':
      return planCodePatch(context, anchor, operation);
    case 'revert-splices':
      return planRevertSplices(context, anchor, operation);
    case 'rename-tag':
      return planRenameTag(context, anchor, operation);
    case 'rename-attribute':
      return planRenameAttribute(context, anchor, operation);
    case 'rewrite-node':
      return planRewriteNode(context, anchor, operation);
    case 'rewrite-text':
      return planRewriteText(context, anchor, operation);
    default: {
      const exhaustive: never = operation;
      throw new Error(`Unknown operation ${JSON.stringify(exhaustive)}`);
    }
  }
}

type AttributeOperation = Extract<Operation, { tag: 'set-attribute' | 'remove-attribute' | 'set-inline-style' }>;

function planAttributeOperation(context: PlanContext, anchor: AnchorRef, operation: AttributeOperation): Result<Plan, RejectionReason> {
  const resolved = resolveTarget(context, anchor);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.value;
  if (!nodeEditable(target.current)) {
    return err('unsupported-operation');
  }
  if (!writtenAsTag(target.current)) {
    return err('unsupported-operation');
  }
  if (tagNameEnd(context.current.bytes, target.current) === target.current.span.start + 1) {
    return err('unsupported-operation');
  }
  const name = operation.tag === 'set-inline-style' ? 'style' : operation.name;
  const found = soleAttribute(target, name);
  if (!found.ok) {
    return found;
  }
  const attribute = found.value;
  if (attribute !== undefined) {
    if (!nodeEditable(attributeAsNode(attribute, target.current))) {
      return err('unsupported-operation');
    }
  }
  const splices = attributeSplices(context, target, attribute, operation);
  if (!splices.ok) {
    return splices;
  }
  const postKinds = [{ path: target.current.path, kind: target.current.kind }];
  return ok({ splices: splices.value, postKinds, candidate: 'must-parse' });
}

function planRenameAttribute(
  context: PlanContext,
  anchor: AnchorRef,
  operation: Extract<Operation, { tag: 'rename-attribute' }>,
): Result<Plan, RejectionReason> {
  const resolved = resolveTarget(context, anchor);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.value;
  if (!nodeEditable(target.current)) {
    return err('unsupported-operation');
  }
  if (!writtenAsTag(target.current)) {
    return err('unsupported-operation');
  }
  const found = soleAttribute(target, operation.from);
  if (!found.ok) {
    return found;
  }
  const attribute = found.value;
  if (attribute === undefined) {
    return err('anchor-moved');
  }
  if (!nodeEditable(attributeAsNode(attribute, target.current))) {
    return err('unsupported-operation');
  }
  const clash = target.current.attributes.some((candidate) => candidate.name === operation.to);
  if (clash) {
    return err('unsupported-operation');
  }
  const nameSpan = attribute.nameSpan;
  assert(nameSpan !== undefined, 'A named attribute has a name span');
  assert(textOf(context.current.bytes, nameSpan) === operation.from, 'The name span holds it');
  const splice = spliceAt(context.current.bytes, nameSpan, operation.to);
  const postKinds = [{ path: target.current.path, kind: target.current.kind }];
  return ok({ splices: [splice], postKinds, candidate: 'must-parse' });
}

function planRenameTag(context: PlanContext, anchor: AnchorRef, operation: Extract<Operation, { tag: 'rename-tag' }>): Result<Plan, RejectionReason> {
  const resolved = resolveTarget(context, anchor);
  if (!resolved.ok) {
    return resolved;
  }
  const node = resolved.value.current;
  const bytes = context.current.bytes;
  if (!nodeEditable(node)) {
    return err('unsupported-operation');
  }
  if (!writtenAsTag(node)) {
    return err('unsupported-operation');
  }
  const name = toByteSpan(node.span.start + 1, tagNameEnd(bytes, node));
  if (name.start === name.end) {
    return err('unsupported-operation');
  }
  if (textOf(bytes, name) !== operation.from) {
    return err('anchor-moved');
  }
  const splices = [spliceAt(bytes, name, operation.to)];
  const open = openTagEnd(bytes, node);
  if (!open.selfClosing) {
    const closing = closingName(bytes, node, open.end, operation.from);
    if (closing === undefined) {
      return err('unsupported-operation');
    }
    splices.push(spliceAt(bytes, closing, operation.to));
  }
  assert(splices.length <= 2, 'A tag has at most an opening and a closing name');
  return ok({ splices, postKinds: [], candidate: 'must-parse' });
}

function closingName(bytes: ByteString, node: ProjectedNode, openEnd: number, name: string): ByteSpan | undefined {
  const start = closeTagStart(bytes, node, openEnd);
  if (start === undefined) {
    return undefined;
  }
  const span = toByteSpan(start + 2, start + 2 + encodeUtf8(name).length);
  if (span.end > node.span.end) {
    return undefined;
  }
  if (textOf(bytes, span) !== name) {
    return undefined;
  }
  const after = bytes[span.end];
  if (after === undefined) {
    return undefined;
  }
  return after === 0x3e || isWhitespace(after) ? span : undefined;
}

function attributeSplices(
  context: PlanContext,
  target: Target,
  attribute: ProjectedAttribute | undefined,
  operation: AttributeOperation,
): Result<readonly Splice[], RejectionReason> {
  switch (operation.tag) {
    case 'set-attribute':
      return ok([setAttributeSplice(context.current.bytes, target.current, attribute, operation)]);
    case 'remove-attribute':
      if (attribute === undefined) {
        return err('anchor-moved');
      }
      return ok([removalSplice(context.current.bytes, target.current, attribute)]);
    case 'set-inline-style':
      return inlineStyleSplices(context.current.bytes, target.current, attribute, operation);
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

function soleAttribute(target: Target, name: string): Result<ProjectedAttribute | undefined, RejectionReason> {
  const node = target.current;
  assert(node.attributes.length <= LIMITS.attrsPerNodeMax, 'Attributes are inside their bound');
  const found = node.attributes.filter((attribute) => attribute.name === name);
  if (found.length > 1) {
    return err('anchor-ambiguous');
  }
  const [attribute] = found;
  const authored = target.authored.attributes.filter((candidate) => candidate.name === name);
  assert(authored.length === found.length, 'A region moved whole keeps its attributes');
  const [before] = authored;
  if (attribute !== undefined) {
    assert(before !== undefined, 'The authored node had the attribute');
    assert(attribute.span.start === before.span.start + target.shift, 'The attribute moved whole');
  }
  return ok(attribute);
}

function attributeAsNode(attribute: ProjectedAttribute, node: ProjectedNode): ProjectedNode {
  return { ...node, capability: attribute.capability };
}

function setAttributeSplice(
  bytes: ByteString,
  node: ProjectedNode,
  attribute: ProjectedAttribute | undefined,
  operation: Extract<Operation, { tag: 'set-attribute' }>,
): Splice {
  if (attribute === undefined) {
    return insertionSplice(bytes, node, attributeText(operation.name, operation.value));
  }
  const value = operation.value;
  const valueSpan = attribute.valueSpan;
  if (valueSpan !== undefined) {
    if (attribute.type === 'string') {
      if (value.type === 'string') {
        const quote = bytes[valueSpan.start - 1];
        assert(quote === 0x22 || quote === 0x27, 'A string value sits in quotes');
        assert(bytes[valueSpan.end] === quote, 'A string value closes with its opening quote');
        if (!value.value.includes(String.fromCharCode(quote))) {
          return spliceAt(bytes, valueSpan, value.value);
        }
      }
    }
    if (attribute.type === 'expr') {
      if (value.type === 'expr') {
        return spliceAt(bytes, valueSpan, value.value);
      }
    }
  }
  assert(attribute.nameSpan !== undefined, 'A named attribute has a name span');
  const name = textOf(bytes, attribute.nameSpan);
  return spliceAt(bytes, attribute.span, attributeText(name, value));
}

export function attributeText(name: string, value: AttributeValue): string {
  switch (value.type) {
    case 'bare':
      return name;
    case 'expr':
      return `${name}={${value.value}}`;
    case 'string':
      return `${name}=${quoted(value.value)}`;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function quoted(value: string): string {
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replace(/"/g, '&quot;')}"`;
}

function insertionSplice(bytes: ByteString, node: ProjectedNode, text: string): Splice {
  const nameEnd = tagNameEnd(bytes, node);
  const last = node.attributes.reduce<ProjectedAttribute | undefined>(
    (latest, attribute) => (latest === undefined || attribute.span.end > latest.span.end ? attribute : latest),
    undefined,
  );
  if (last === undefined) {
    return spliceAt(bytes, toByteSpan(nameEnd, nameEnd), ` ${text}`);
  }
  const lined = containsNewline(bytes, toByteSpan(nameEnd, last.span.start));
  const separator = lined ? `\n${lineIndent(bytes, last.span.start)}` : ' ';
  return spliceAt(bytes, toByteSpan(last.span.end, last.span.end), `${separator}${text}`);
}

function removalSplice(bytes: ByteString, node: ProjectedNode, attribute: ProjectedAttribute): Splice {
  const floor = tagNameEnd(bytes, node);
  const start = whitespaceBefore(bytes, attribute.span.start, floor);
  assert(start < attribute.span.start, 'An attribute is separated from what precedes it');
  return spliceAt(bytes, toByteSpan(start, attribute.span.end), '');
}

function inlineStyleSplices(
  bytes: ByteString,
  node: ProjectedNode,
  attribute: ProjectedAttribute | undefined,
  operation: Extract<Operation, { tag: 'set-inline-style' }>,
): Result<readonly Splice[], RejectionReason> {
  const declaration = operation.declaration;
  if (attribute === undefined) {
    if (declaration.tag === 'set') {
      const text = `${operation.property}: ${declaration.value}`;
      return ok([insertionSplice(bytes, node, attributeText('style', { type: 'string', value: text }))]);
    }
    return ok([]);
  }
  const valueSpan = attribute.valueSpan;
  if (attribute.type !== 'string') {
    return err('unsupported-operation');
  }
  assert(valueSpan !== undefined, 'A string attribute has a value span');
  const quote = bytes[valueSpan.start - 1];
  if (declaration.tag === 'set') {
    if (declaration.value.includes(String.fromCharCode(quote ?? 0x22))) {
      return err('unsupported-operation');
    }
  }
  const text = textOf(bytes, valueSpan);
  const edited = editInlineStyle(text, operation.property, declaration);
  switch (edited.tag) {
    case 'edited': {
      const offsets = byteOffsetsIn(
        text,
        edited.edits.flatMap((edit) => [edit.start, edit.end]),
      );
      return ok(
        edited.edits.map((edit, index) => {
          const start = offsets[index * 2];
          const end = offsets[index * 2 + 1];
          assert(start !== undefined, 'Every edit start was converted');
          assert(end !== undefined, 'Every edit end was converted');
          const range = toByteSpan(valueSpan.start + start, valueSpan.start + end);
          return spliceAt(bytes, range, edit.text);
        }),
      );
    }
    case 'ambiguous':
      return err('anchor-ambiguous');
    case 'unreadable':
      return err('unsupported-operation');
    default: {
      const exhaustive: never = edited;
      return exhaustive;
    }
  }
}

export function spliceAt(bytes: ByteString, range: ByteSpan, replacement: string): Splice {
  assert(range.end <= bytes.length, 'A planned range lies inside the file');
  return {
    range,
    expectedBytes: toByteString(bytes.subarray(range.start, range.end)),
    replacementBytes: encodeUtf8(replacement),
  };
}
