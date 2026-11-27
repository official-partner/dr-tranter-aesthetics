import { assert } from '../core/assert';
import { toFilePath, toIntentId, type Digest, type FilePath, type IntentId } from '../core/brand';
import { digest, pathText } from '../core/boundary';
import { LIMITS } from '../core/limits';
import { toArray, toRecord } from '../core/record';
import { isNodeKind, parseAnchorRef, type AnchorKind, type AnchorRef } from '../page/ref';
import { parseByteSpan, spanContains, spansAscending, utf8ByteLength, type ByteSpan } from '../core/span';

export type AttributeValue =
  { readonly type: 'string'; readonly value: string } | { readonly type: 'expr'; readonly value: string } | { readonly type: 'bare' };

export const PLACEMENTS = ['before', 'after', 'first-child', 'last-child'] as const;
export type Placement = (typeof PLACEMENTS)[number];

export interface SourceEdit {
  readonly span: ByteSpan;
  readonly text: string;
}

export type StyleDeclaration = { readonly tag: 'set'; readonly value: string } | { readonly tag: 'remove' };

export type Operation =
  | { readonly tag: 'set-attribute'; readonly name: string; readonly value: AttributeValue }
  | { readonly tag: 'remove-attribute'; readonly name: string }
  | { readonly tag: 'insert-node'; readonly placement: Placement; readonly source: string }
  | { readonly tag: 'remove-node' }
  | { readonly tag: 'move-node'; readonly destination: AnchorRef; readonly placement: Placement }
  | {
      readonly tag: 'rename-binding';
      readonly from: string;
      readonly to: string;
      readonly sites: readonly ByteSpan[];
    }
  | {
      readonly tag: 'set-inline-style';
      readonly property: string;
      readonly declaration: StyleDeclaration;
    }
  | { readonly tag: 'apply-code-patch'; readonly hunks: readonly SourceEdit[] }
  | { readonly tag: 'edit-frontmatter-slot'; readonly slot: ByteSpan; readonly text: string }
  | { readonly tag: 'revert-splices'; readonly hunks: readonly SourceEdit[] }
  | { readonly tag: 'rename-tag'; readonly from: string; readonly to: string }
  | { readonly tag: 'rename-attribute'; readonly from: string; readonly to: string }
  | { readonly tag: 'rewrite-node'; readonly hunks: readonly SourceEdit[] }
  | { readonly tag: 'append-body'; readonly source: string }
  | { readonly tag: 'insert-frontmatter'; readonly source: string }
  | {
      readonly tag: 'wrap-nodes';
      readonly last: AnchorRef;
      readonly open: string;
      readonly close: string;
    }
  | { readonly tag: 'rewrite-text'; readonly hunks: readonly SourceEdit[] };

export type OperationTag = Operation['tag'];

export interface Intent {
  readonly id: IntentId;
  readonly file: FilePath;
  readonly authoredChecksum: Digest;
  readonly anchor: AnchorRef;
  readonly operation: Operation;
}

export type SubmissionResult = { readonly tag: 'accepted'; readonly intentId: IntentId } | { readonly tag: 'backpressured' };

export const REJECTION_REASONS = [
  'anchor-moved',
  'anchor-ambiguous',
  'region-externally-modified',
  'source-invalid',
  'unsupported-operation',
  'resource-limit',
  'write-failed',
  'write-race',
  'merge-conflict',
  'invalid-placement',
  'would-break-page',
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export type Outcome =
  | {
      readonly tag: 'applied';
      readonly intentId: IntentId;
      readonly changedRanges: readonly ByteSpan[];
      readonly checksum: Digest;
    }
  | { readonly tag: 'rejected'; readonly intentId: IntentId; readonly reason: RejectionReason }
  | {
      readonly tag: 'uncertain';
      readonly intentId: IntentId;
      readonly candidateChecksum: Digest | undefined;
    };

const ATTRIBUTE_NAME_RE = /^[\w@:.-]+$/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
export const TAG_NAME_RE = /^[A-Za-z][\w.:-]*$/;
const STYLE_PROPERTY_RE = /^(?:--[\w-]+|-?[a-z][a-z-]*)$/;

export function describeRejection(reason: RejectionReason): string {
  switch (reason) {
    case 'anchor-moved':
      return 'The element you edited is no longer where it was.';
    case 'anchor-ambiguous':
      return 'The file changed and several elements now match the one you edited.';
    case 'region-externally-modified':
      return 'That part of the file was changed outside Stacki.';
    case 'source-invalid':
      return 'The page contains a syntax error that Stacki needs resolved before saving this edit.';
    case 'unsupported-operation':
      return 'Stacki encountered an editor error while applying the change.';
    case 'resource-limit':
      return 'The change exceeds a size limit.';
    case 'write-failed':
      return 'The file could not be written.';
    case 'write-race':
      return 'Another program wrote the file at the same moment.';
    case 'merge-conflict':
      return 'Your code edit overlaps another change to the file, so it was not merged.';
    case 'invalid-placement':
      return 'That change would put something where it cannot go and break the page, so nothing was written.';
    case 'would-break-page':
      return 'Stacki didn’t make this change because it would break the page.';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function parseRejectionReason(input: unknown, where: string): RejectionReason {
  for (const reason of REJECTION_REASONS) {
    if (reason === input) {
      return reason;
    }
  }
  throw new Error(`${where}: unknown rejection reason ${JSON.stringify(input)}`);
}

export function intentPayloadBytes(operation: Operation): number {
  return operationTexts(operation).reduce((total, text) => total + utf8ByteLength(text), 0);
}

function operationTexts(operation: Operation): readonly string[] {
  switch (operation.tag) {
    case 'set-attribute':
      return operation.value.type === 'bare' ? [operation.name] : [operation.name, operation.value.value];
    case 'remove-attribute':
      return [operation.name];
    case 'insert-node':
    case 'append-body':
    case 'insert-frontmatter':
      return [operation.source];
    case 'remove-node':
    case 'move-node':
      return [];
    case 'rename-binding':
    case 'rename-tag':
    case 'rename-attribute':
      return [operation.from, operation.to];
    case 'set-inline-style':
      return operation.declaration.tag === 'set' ? [operation.property, operation.declaration.value] : [operation.property];
    case 'apply-code-patch':
    case 'revert-splices':
    case 'rewrite-node':
    case 'rewrite-text':
      return operation.hunks.map((hunk) => hunk.text);
    case 'edit-frontmatter-slot':
      return [operation.text];
    case 'wrap-nodes':
      return [operation.open, operation.close];
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

export function toIntent(input: Intent): Intent {
  checkOperationAnchor(input.operation, input.anchor);
  assert(intentPayloadBytes(input.operation) >= 0, 'Payload size is a count');
  return input;
}

function checkOperationAnchor(operation: Operation, anchor: AnchorRef): void {
  const kind = anchor.expectedKind;
  switch (operation.tag) {
    case 'set-attribute':
    case 'remove-attribute':
    case 'set-inline-style':
    case 'rename-attribute':
      requireKind(operation.tag, { allowed: isAttributeHost(kind) });
      return;
    case 'rename-tag':
      requireKind(operation.tag, { allowed: kind === 'element' || kind === 'component' });
      requireNewName(operation.tag, operation.from, operation.to);
      return;
    case 'rewrite-node':
      requireKind(operation.tag, { allowed: isNodeKind(kind) });
      requireSites(
        operation.tag,
        anchor.span,
        operation.hunks.map((hunk) => hunk.span),
      );
      return;
    case 'insert-node':
    case 'remove-node':
      requireKind(operation.tag, { allowed: isNodeKind(kind) });
      return;
    case 'move-node':
      requireKind(operation.tag, { allowed: isNodeKind(kind) });
      requireKind(operation.tag, { allowed: isNodeKind(operation.destination.expectedKind) });
      return;
    case 'wrap-nodes':
      requireKind(operation.tag, { allowed: isNodeKind(kind) });
      requireKind(operation.tag, { allowed: isNodeKind(operation.last.expectedKind) });
      return;
    case 'rename-binding':
      requireKind(operation.tag, { allowed: kind === 'map' });
      requireSites(operation.tag, anchor.span, operation.sites);
      return;
    case 'apply-code-patch':
    case 'revert-splices':
    case 'rewrite-text':
      requireKind(operation.tag, { allowed: kind === 'document' });
      requireSites(
        operation.tag,
        anchor.span,
        operation.hunks.map((hunk) => hunk.span),
      );
      return;
    case 'edit-frontmatter-slot':
      requireKind(operation.tag, { allowed: kind === 'frontmatter' });
      requireSites(operation.tag, anchor.span, [operation.slot]);
      return;
    case 'append-body':
    case 'insert-frontmatter':
      requireKind(operation.tag, { allowed: kind === 'document' });
      return;
    default: {
      const exhaustive: never = operation;
      throw new Error(`Intent: unknown operation ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function isAttributeHost(kind: AnchorKind): boolean {
  switch (kind) {
    case 'element':
    case 'component':
    case 'raw':
      return true;
    case 'text':
    case 'expr':
    case 'raw-line':
    case 'comment':
    case 'map':
    case 'cond':
    case 'branch':
    case 'chunk-group':
    case 'frontmatter':
    case 'document':
      return false;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function requireNewName(tag: OperationTag, from: string, to: string): void {
  if (from === to) {
    throw new Error(`Intent: ${tag} must change the name`);
  }
}

function requireKind(tag: OperationTag, check: { readonly allowed: boolean }): void {
  if (!check.allowed) {
    throw new Error(`Intent: ${tag} cannot target this anchor kind`);
  }
}

function requireSites(tag: OperationTag, anchor: ByteSpan, sites: readonly ByteSpan[]): void {
  if (sites.length === 0) {
    throw new Error(`Intent: ${tag} needs at least one site`);
  }
  if (!spansAscending(sites)) {
    throw new Error(`Intent: ${tag} sites must ascend without overlapping`);
  }
  for (const site of sites) {
    if (!spanContains(anchor, site)) {
      throw new Error(`Intent: ${tag} site lies outside its anchor`);
    }
  }
}


export function parseIntent(input: unknown): Intent {
  const record = requireRecord(input, 'Intent');
  const id = record['id'];
  if (typeof id !== 'string') {
    throw new Error('Intent.id: expected string');
  }
  return toIntent({
    id: toIntentId(id),
    file: toFilePath(pathText(record['file'])),
    authoredChecksum: digest(record['authoredChecksum']),
    anchor: parseAnchorRef(record['anchor'], 'Intent.anchor'),
    operation: parseOperation(record['operation']),
  });
}

function parseOperation(input: unknown): Operation {
  const record = requireRecord(input, 'Operation');
  const tag = record['tag'];
  switch (tag) {
    case 'set-attribute':
      return {
        tag,
        name: attributeName(record['name'], 'Operation.name'),
        value: parseAttributeValue(record['value']),
      };
    case 'remove-attribute':
      return { tag, name: attributeName(record['name'], 'Operation.name') };
    case 'insert-node':
      return {
        tag,
        placement: parsePlacement(record['placement']),
        source: payloadText(record['source'], 'Operation.source'),
      };
    case 'remove-node':
      return { tag };
    case 'move-node':
      return {
        tag,
        destination: parseAnchorRef(record['destination'], 'Operation.destination'),
        placement: parsePlacement(record['placement']),
      };
    case 'rename-binding':
      return parseRenameBinding(record);
    case 'set-inline-style':
      return parseSetInlineStyle(record);
    case 'apply-code-patch':
    case 'revert-splices':
    case 'rewrite-node':
    case 'rewrite-text':
      return { tag, hunks: parseHunks(record['hunks']) };
    case 'rename-tag':
      return {
        tag,
        from: tagName(record['from'], 'Operation.from'),
        to: tagName(record['to'], 'Operation.to'),
      };
    case 'append-body':
    case 'insert-frontmatter':
      return { tag, source: payloadText(record['source'], 'Operation.source') };
    case 'wrap-nodes':
      return {
        tag,
        last: parseAnchorRef(record['last'], 'Operation.last'),
        open: payloadText(record['open'], 'Operation.open'),
        close: payloadText(record['close'], 'Operation.close'),
      };
    case 'rename-attribute': {
      const from = attributeName(record['from'], 'Operation.from');
      const to = attributeName(record['to'], 'Operation.to');
      if (from === to) {
        throw new Error('Operation.to: a rename must change the name');
      }
      return { tag, from, to };
    }
    case 'edit-frontmatter-slot':
      return {
        tag,
        slot: parseByteSpan(record['slot'], 'Operation.slot'),
        text: payloadText(record['text'], 'Operation.text'),
      };
    default:
      throw new Error(`Operation.tag: unknown operation ${JSON.stringify(tag)}`);
  }
}

function parseRenameBinding(record: Record<string, unknown>): Operation {
  const from = identifier(record['from'], 'Operation.from');
  const to = identifier(record['to'], 'Operation.to');
  if (from === to) {
    throw new Error('Operation.to: a rename must change the name');
  }
  const sites = requireArray(record['sites'], 'Operation.sites');
  return {
    tag: 'rename-binding',
    from,
    to,
    sites: sites.map((site, index) => parseByteSpan(site, `Operation.sites[${index}]`)),
  };
}

function parseSetInlineStyle(record: Record<string, unknown>): Operation {
  const property = record['property'];
  if (typeof property !== 'string') {
    throw new Error('Operation.property: expected string');
  }
  if (property.length > LIMITS.attrCharsMax) {
    throw new Error(`Operation.property: exceeds ${LIMITS.attrCharsMax} chars`);
  }
  if (!STYLE_PROPERTY_RE.test(property)) {
    throw new Error('Operation.property: expected a CSS property name');
  }
  const declaration = requireRecord(record['declaration'], 'Operation.declaration');
  const tag = declaration['tag'];
  if (tag === 'remove') {
    return { tag: 'set-inline-style', property, declaration: { tag } };
  }
  if (tag === 'set') {
    const value = boundedText(declaration['value'], 'Operation.declaration.value', LIMITS.attrCharsMax);
    return { tag: 'set-inline-style', property, declaration: { tag, value } };
  }
  throw new Error(`Operation.declaration.tag: unknown value ${JSON.stringify(tag)}`);
}

function parseHunks(input: unknown): readonly SourceEdit[] {
  const hunks = requireArray(input, 'Operation.hunks');
  return hunks.map((hunk, index) => {
    const record = requireRecord(hunk, `Operation.hunks[${index}]`);
    return {
      span: parseByteSpan(record['span'], `Operation.hunks[${index}].span`),
      text: payloadText(record['text'], `Operation.hunks[${index}].text`),
    };
  });
}

function parseAttributeValue(input: unknown): AttributeValue {
  const record = requireRecord(input, 'Operation.value');
  const type = record['type'];
  if (type === 'bare') {
    return { type };
  }
  if (type === 'string' || type === 'expr') {
    return {
      type,
      value: boundedText(record['value'], 'Operation.value.value', LIMITS.attrCharsMax),
    };
  }
  throw new Error(`Operation.value.type: unknown value ${JSON.stringify(type)}`);
}

function parsePlacement(input: unknown): Placement {
  for (const placement of PLACEMENTS) {
    if (placement === input) {
      return placement;
    }
  }
  throw new Error(`Operation.placement: unknown value ${JSON.stringify(input)}`);
}

export function parseSubmissionResult(input: unknown): SubmissionResult {
  const record = requireRecord(input, 'SubmissionResult');
  const tag = record['tag'];
  if (tag === 'backpressured') {
    return { tag };
  }
  if (tag === 'accepted') {
    return { tag, intentId: parseIntentId(record['intentId'], 'SubmissionResult.intentId') };
  }
  throw new Error(`SubmissionResult.tag: unknown value ${JSON.stringify(tag)}`);
}

export function parseOutcome(input: unknown): Outcome {
  const record = requireRecord(input, 'Outcome');
  const intentId = parseIntentId(record['intentId'], 'Outcome.intentId');
  const tag = record['tag'];
  switch (tag) {
    case 'applied': {
      const ranges = requireArray(record['changedRanges'], 'Outcome.changedRanges');
      const changedRanges = ranges.map((range, index) => parseByteSpan(range, `Outcome.changedRanges[${index}]`));
      if (!spansAscending(changedRanges)) {
        throw new Error('Outcome.changedRanges: expected ascending disjoint ranges');
      }
      return { tag, intentId, changedRanges, checksum: digest(record['checksum']) };
    }
    case 'rejected':
      return { tag, intentId, reason: parseRejectionReason(record['reason'], 'Outcome.reason') };
    case 'uncertain': {
      const candidate = record['candidateChecksum'];
      return {
        tag,
        intentId,
        candidateChecksum: candidate === undefined ? undefined : digest(candidate),
      };
    }
    default:
      throw new Error(`Outcome.tag: unknown value ${JSON.stringify(tag)}`);
  }
}

function parseIntentId(input: unknown, where: string): IntentId {
  if (typeof input !== 'string') {
    throw new Error(`${where}: expected string`);
  }
  return toIntentId(input);
}

function requireRecord(input: unknown, where: string): Record<string, unknown> {
  const record = toRecord(input);
  if (record === undefined) {
    throw new Error(`${where}: expected object`);
  }
  return record;
}

function requireArray(input: unknown, where: string): readonly unknown[] {
  const items = toArray(input);
  if (items === undefined) {
    throw new Error(`${where}: expected array`);
  }
  return items;
}

function boundedText(input: unknown, where: string, charsMax: number): string {
  if (typeof input !== 'string') {
    throw new Error(`${where}: expected string`);
  }
  if (input.length > charsMax) {
    throw new Error(`${where}: exceeds ${charsMax} chars`);
  }
  return input;
}

function payloadText(input: unknown, where: string): string {
  if (typeof input !== 'string') {
    throw new Error(`${where}: expected string`);
  }
  return input;
}

function attributeName(input: unknown, where: string): string {
  const name = boundedText(input, where, LIMITS.attrCharsMax);
  if (!ATTRIBUTE_NAME_RE.test(name)) {
    throw new Error(`${where}: expected an attribute name`);
  }
  return name;
}

function tagName(input: unknown, where: string): string {
  const name = boundedText(input, where, LIMITS.tagNameCharsMax);
  if (!TAG_NAME_RE.test(name)) {
    throw new Error(`${where}: expected a tag name`);
  }
  return name;
}

function identifier(input: unknown, where: string): string {
  const name = boundedText(input, where, LIMITS.tagNameCharsMax);
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`${where}: expected an identifier`);
  }
  return name;
}
