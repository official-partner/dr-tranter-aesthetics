import { assert } from '../../shared/core/assert';
import type { Digest } from '../../shared/core/brand';
import { EDIT_BATCH_EDITS_MAX, type Edit, type EditBatchRequest, type EditRequest, type NodeRef } from '../../shared/engine/editRequest';
import type { RejectionReason, SourceEdit } from '../../shared/engine/intent';
import { LIMITS } from '../../shared/core/limits';
import type { PageEditError, PageEdited } from '../../shared/ipc/pageSave';
import type { PageModel, PageNode } from '../../shared/page/pageNode';
import type { Result } from '../../shared/core/result';
import type { EditorModel } from './pageView';
import type { SaveState } from './saveState';

export interface PageOrigin {
  readonly checksum: Digest;
  readonly source: string;
  readonly model: PageModel;
}

export interface AppliedEdit {
  readonly checksum: Digest;
  readonly inverse: readonly SourceEdit[];
}

export type EditsOutcome =
  | { readonly tag: 'pending'; readonly waiting: number; readonly applied: readonly AppliedEdit[] }
  | { readonly tag: 'applied'; readonly applied: readonly AppliedEdit[] }
  | { readonly tag: 'folded' }
  | { readonly tag: 'dropped' };

export interface EditsRecord {
  outcome: EditsOutcome;
}

export interface EditGesture {
  readonly request: (refOf: (nodeId: string) => NodeRef | undefined, origin: PageOrigin) => readonly Edit[] | undefined;
  readonly apply: (model: EditorModel) => EditorModel;
  readonly coalesceKey: string | undefined;
  readonly urgency: boolean | 'live';
  readonly stream: string | undefined;
  readonly restates?: string;
}

export type CodeBaseline =
  | {
      readonly tag: 'known';
      readonly checksum: Digest;
      readonly source: string;
      readonly typedFrom: string;
    }
  | { readonly tag: 'disk' };

export type QueueEntry =
  | {
      readonly tag: 'gesture';
      readonly gesture: EditGesture;
      readonly record: EditsRecord;
      readonly stream: string | undefined;
    }
  | {
      readonly tag: 'code';
      readonly baseline: CodeBaseline;
      readonly records: readonly EditsRecord[];
    };

export interface TypedFrom {
  readonly save: SaveState;
  readonly source: string;
  readonly origin: PageOrigin | undefined;
}

export class EditDrafts {
  #path: string | undefined;
  #entries: QueueEntry[] = [];

  entries(path: string): readonly QueueEntry[] {
    return path === this.#path ? this.#entries : [];
  }

  empty(path: string): boolean {
    return this.entries(path).length === 0;
  }

  addGesture(path: string, gesture: EditGesture, record: EditsRecord): 'queued' | 'full' {
    this.#own(path);
    const stream = gesture.stream;
    const last = this.#entries[this.#entries.length - 1];
    if (last?.tag === 'gesture' && stream !== undefined) {
      if (last.stream === stream && last.record === record) {
        this.#entries[this.#entries.length - 1] = { tag: 'gesture', gesture, record, stream };
        return 'queued';
      }
    }
    if (this.#entries.length >= LIMITS.intentsPendingMax) {
      return 'full';
    }
    owe(record);
    this.#entries.push({ tag: 'gesture', gesture, record, stream });
    return 'queued';
  }

  typeCode(path: string, shown: TypedFrom, record: EditsRecord): void {
    this.#own(path);
    const code = this.#entries.find((entry) => entry.tag === 'code');
    for (const entry of this.#entries) {
      if (entry.tag !== 'code') {
        for (const replaced of recordsOf(entry)) {
          replaced.outcome = { tag: 'dropped' };
        }
      }
    }
    const records = code === undefined ? [] : code.records;
    const baseline = code === undefined ? typedBaseline(shown) : code.baseline;
    const kept = records.includes(record) ? records : [...records, record];
    if (!records.includes(record)) {
      owe(record);
    }
    this.#entries = [{ tag: 'code', baseline, records: kept }];
    assert(this.#entries.length === 1, 'Typing leaves the page one patch to save');
  }

  codeBaseline(path: string): CodeBaseline {
    const code = this.entries(path).find((entry) => entry.tag === 'code');
    assert(code?.tag === 'code', 'Only a code entry has a baseline');
    return code.baseline;
  }

  codeSaved(path: string, saved: Omit<Extract<CodeBaseline, { tag: 'known' }>, 'tag'>): void {
    const at = this.entries(path).findIndex((entry) => entry.tag === 'code');
    const code = this.#entries[at];
    if (code?.tag !== 'code') {
      return;
    }
    this.#entries[at] = { ...code, baseline: { tag: 'known', ...saved } };
  }

  acceptDisk(path: string): void {
    const at = this.entries(path).findIndex((entry) => entry.tag === 'code');
    const code = this.#entries[at];
    if (code?.tag === 'code') {
      this.#entries[at] = { ...code, baseline: { tag: 'disk' } };
    }
  }

  shift(path: string): QueueEntry | undefined {
    if (path !== this.#path) {
      return undefined;
    }
    return this.#entries.shift();
  }

  unshift(path: string, entry: QueueEntry): void {
    this.#own(path);
    const [first] = this.#entries;
    if (entry.tag === 'gesture' && first?.tag === 'code') {
      writeOutcome(entry.record, { tag: 'dropped' });
      return;
    }
    if (entry.tag === 'code' && first?.tag === 'code') {
      const older = first.records.filter((record) => !entry.records.includes(record));
      const records = [...entry.records, ...older];
      this.#entries[0] = { ...first, baseline: entry.baseline, records };
      return;
    }
    this.#entries.unshift(entry);
  }

  discard(path: string): void {
    for (const entry of this.entries(path)) {
      for (const record of recordsOf(entry)) {
        record.outcome = { tag: 'dropped' };
      }
    }
    if (path === this.#path) {
      this.#entries = [];
    }
  }

  #own(path: string): void {
    if (path !== this.#path) {
      this.#path = path;
      this.#entries = [];
    }
  }
}

function typedBaseline(shown: TypedFrom): CodeBaseline {
  const save = shown.save;
  switch (save.tag) {
    case 'clean':
    case 'dirty':
    case 'failed':
    case 'saving': {
      const origin = shown.origin;
      const checksum = save.tag === 'clean' ? save.checksum : save.baseChecksum;
      assert(origin === undefined || origin.checksum === checksum, 'The shown text is the origin');
      return { tag: 'known', checksum, source: shown.source, typedFrom: shown.source };
    }
    case 'conflicted':
      return { tag: 'disk' };
    default: {
      const exhaustive: never = save;
      return exhaustive;
    }
  }
}

export function recordsOf(entry: QueueEntry): readonly EditsRecord[] {
  switch (entry.tag) {
    case 'gesture':
      return [entry.record];
    case 'code':
      return entry.records;
    default: {
      const exhaustive: never = entry;
      return exhaustive;
    }
  }
}

export function recordWrite(records: readonly EditsRecord[], applied: AppliedEdit): void {
  const newest = records[records.length - 1];
  assert(newest !== undefined, 'A write is made for at least one step');
  for (const record of records.slice(0, -1)) {
    record.outcome = { tag: 'folded' };
  }
  recordApplied(newest, applied);
}

export function recordApplied(record: EditsRecord, applied: AppliedEdit): void {
  const outcome = record.outcome;
  if (outcome.tag !== 'pending') {
    return;
  }
  assert(outcome.waiting > 0, 'An answer arrives for a write the step waits on');
  const done = [...outcome.applied, applied];
  writeOutcome(record, outcome.waiting === 1 ? { tag: 'applied', applied: done } : { tag: 'pending', waiting: outcome.waiting - 1, applied: done });
}

export function recordNoChange(record: EditsRecord): void {
  const outcome = record.outcome;
  if (outcome.tag !== 'pending') {
    return;
  }
  assert(outcome.waiting > 0, 'A settled request was owed an answer');
  writeOutcome(record, outcome.waiting === 1 ? { tag: 'applied', applied: outcome.applied } : { ...outcome, waiting: outcome.waiting - 1 });
}

export function writeOutcome(record: EditsRecord, outcome: EditsOutcome): void {
  assert(record.outcome !== outcome, 'An outcome is written as a new value');
  // eslint-disable-next-line no-param-reassign -- EditsRecord is a shared cell; its one writer.
  record.outcome = outcome;
}

function owe(record: EditsRecord): void {
  const outcome = record.outcome;
  switch (outcome.tag) {
    case 'pending':
      writeOutcome(record, { ...outcome, waiting: outcome.waiting + 1 });
      return;
    case 'applied':
      writeOutcome(record, { tag: 'pending', waiting: 1, applied: outcome.applied });
      return;
    case 'folded':
    case 'dropped':
      writeOutcome(record, { tag: 'pending', waiting: 1, applied: [] });
      return;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function nodeRefIn(origin: PageOrigin, nodeId: string): NodeRef | undefined {
  const pending: { readonly node: PageNode; readonly path: readonly number[] }[] = [];
  origin.model.nodes.forEach((node, index) => pending.push({ node, path: [index] }));
  for (let visited = 0; visited < pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'The origin stays inside the tree bound');
    const entry = pending[visited];
    assert(entry !== undefined, 'The visit index lies inside the pending list');
    const node = entry.node;
    if (node.kind === 'chunk-group') {
      continue;
    }
    if (node.id === nodeId) {
      if (node.start === undefined || node.end === undefined) {
        return undefined;
      }
      return { path: entry.path, kind: node.kind, span: { start: node.start, end: node.end } };
    }
    if ('children' in node && Array.isArray(node.children)) {
      const children: readonly PageNode[] = node.children;
      children.forEach((child, index) => pending.push({ node: child, path: [...entry.path, index] }));
    }
  }
  return undefined;
}

export type GestureSent =
  | { readonly tag: 'applied'; readonly replies: readonly PageEdited[] }
  | {
      readonly tag: 'refused';
      readonly reason: RejectionReason;
      readonly diskChecksum: Digest;
      readonly replies: readonly PageEdited[];
    }
  | { readonly tag: 'retry'; readonly message: string }
  | {
      readonly tag: 'uncertain';
      readonly message: string;
      readonly replies: readonly PageEdited[];
    };

interface GestureSendInput {
  readonly path: string;
  readonly origin: PageOrigin;
  readonly gesture: EditGesture;
  readonly record: EditsRecord;
  readonly send: (request: EditRequest) => Promise<Result<PageEdited, PageEditError>>;
  readonly sendBatch?: (request: EditBatchRequest) => Promise<Result<PageEdited, PageEditError>>;
}

export async function sendGesture(input: GestureSendInput): Promise<GestureSent> {
  const { origin } = input;
  const refOf = (nodeId: string): NodeRef | undefined => nodeRefIn(origin, nodeId);
  const restated = input.gesture.restates;
  if (restated !== undefined && !nodesById(origin.model.nodes).has(restated)) {
    return { tag: 'refused', reason: 'anchor-moved', diskChecksum: origin.checksum, replies: [] };
  }
  const requested = input.gesture.request(refOf, origin);
  if (requested === undefined || requested.length === 0) {
    return sendReplacement(input, refOf);
  }
  const specialized = requested.filter((edit) => !restatesOrigin(origin, edit));
  if (specialized.length === 0) {
    recordNoChange(input.record);
    return { tag: 'applied', replies: [] };
  }
  assert(specialized.length <= requested.length, 'Settling restated requests only removes requests');
  if (specialized.length > 1) {
    if (input.sendBatch !== undefined) {
      if (specialized.length <= EDIT_BATCH_EDITS_MAX) {
        const batched = await sendBatched(input, specialized, input.sendBatch);
        if (batched !== undefined) {
          return batched;
        }
      }
    }
  }
  const sent = await sendRequests(input, specialized);
  if (sent.tag !== 'refused' || sent.reason !== 'unsupported-operation') {
    return sent;
  }
  if (sent.replies.length > 0 || specialized.every((edit) => edit.tag === 'replace-node')) {
    return sent;
  }
  return sendReplacement(input, refOf);
}

async function sendReplacement(input: GestureSendInput, refOf: (nodeId: string) => NodeRef | undefined): Promise<GestureSent> {
  const predicted = input.gesture.apply(input.origin.model);
  const replacements = replacementRequests(input.origin, predicted, refOf);
  if (replacements !== undefined && replacements.length > 0) {
    const batched = await sendBatchedWhole(input, replacements);
    if (batched !== undefined) {
      return batched;
    }
    const sent = await sendRequests(input, replacements);
    if (sent.tag !== 'refused' || sent.reason !== 'unsupported-operation') {
      return sent;
    }
    if (sent.replies.length > 0) {
      return sent;
    }
  }
  if (predicted === input.origin.model) {
    recordNoChange(input.record);
    return { tag: 'applied', replies: [] };
  }
  return sendRequests(input, [replacementPageRequest(predicted)]);
}

export function replacementRequests(origin: PageOrigin, predicted: EditorModel, refOf: (nodeId: string) => NodeRef | undefined): readonly Edit[] | undefined {
  const replaced = replacementEdits(origin, predicted, refOf);
  return replaced === undefined ? undefined : [...frontmatterEdits(origin.model, predicted), ...replaced];
}

export function replacementPageRequest(predicted: EditorModel): Edit {
  return { tag: 'replace-page', model: replacementModel(predicted) };
}

function frontmatterEdits(before: PageModel, after: EditorModel): readonly Edit[] {
  if (before.extraFrontmatter === after.extraFrontmatter) {
    if (JSON.stringify(before.imports) === JSON.stringify(after.imports)) {
      return [];
    }
  }
  return [{ tag: 'set-frontmatter', model: { ...after, nodes: [] } }];
}

async function sendBatchedWhole(input: GestureSendInput, requests: readonly Edit[]): Promise<GestureSent | undefined> {
  if (input.sendBatch === undefined) {
    return undefined;
  }
  if (requests.length <= 1) {
    return undefined;
  }
  return requests.length <= EDIT_BATCH_EDITS_MAX ? sendBatched(input, requests, input.sendBatch) : undefined;
}

async function sendBatched(
  input: GestureSendInput,
  requests: readonly Edit[],
  sendBatch: (request: EditBatchRequest) => Promise<Result<PageEdited, PageEditError>>,
): Promise<GestureSent | undefined> {
  assert(requests.length > 1, 'A batch holds several requests');
  assert(requests.length <= EDIT_BATCH_EDITS_MAX, 'A batch stays inside its bound');
  const answer = await sendBatch({ pagePath: input.path, authoredChecksum: input.origin.checksum, edits: requests });
  if (answer.ok) {
    const { checksum, inverse } = answer.value;
    recordApplied(input.record, { checksum, inverse });
    return { tag: 'applied', replies: [answer.value] };
  }
  if (answer.error.code === 'rejected') {
    return undefined;
  }
  return stopped(answer.error, input.origin.checksum, []);
}

async function sendRequests(input: GestureSendInput, requests: readonly Edit[]): Promise<GestureSent> {
  const replies: PageEdited[] = [];
  for (const edit of requests) {
    if (replies.length > 0) {
      const outcome = input.record.outcome;
      if (outcome.tag === 'pending' || outcome.tag === 'applied') {
        owe(input.record);
      }
    }
    const request = { pagePath: input.path, authoredChecksum: input.origin.checksum, edit };
    const answer = await input.send(request);
    if (answer.ok) {
      const { checksum, inverse } = answer.value;
      recordApplied(input.record, { checksum, inverse });
      replies.push(answer.value);
      continue;
    }
    return stopped(answer.error, input.origin.checksum, replies);
  }
  assert(replies.length === requests.length, 'Every request applied');
  return { tag: 'applied', replies };
}

export function restatesOrigin(origin: PageOrigin, edit: Edit): boolean {
  if (edit.tag !== 'replace-node') {
    return false;
  }
  const next = edit.node;
  if (next.kind !== 'raw') {
    return false;
  }
  const previous = nodesById(origin.model.nodes).get(next.id);
  if (previous?.kind !== 'raw') {
    return false;
  }
  if (previous.inner !== next.inner) {
    return false;
  }
  if (previous.name !== next.name) {
    return false;
  }
  return JSON.stringify([previous.props, previous.attrOrder]) === JSON.stringify([next.props, next.attrOrder]);
}

function replacementEdits(origin: PageOrigin, predicted: EditorModel, refOf: (nodeId: string) => NodeRef | undefined): readonly Edit[] | undefined {
  const afterById = nodesById(predicted.nodes);
  const pending: PageNode[] = [...origin.model.nodes];
  const edits: Edit[] = [];
  for (let visited = 0; visited < pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'A replacement search stays inside the tree bound');
    const before = pending[visited];
    assert(before !== undefined, 'A replacement search visits an existing node');
    const after = afterById.get(before.id);
    if (after !== undefined && before !== after && !hasChangedDirectChild(before, after)) {
      const target = refOf(before.id);
      if (target === undefined) {
        return undefined;
      }
      edits.push({ tag: 'replace-node', target, node: withoutStaleAttributeSpans(after) });
    }
    pending.push(...childNodes(before));
  }
  assert(edits.length <= LIMITS.treeNodesMax, 'A replacement search yields at most one per node');
  return edits;
}

function replacementModel(model: EditorModel): PageModel {
  return { ...model, nodes: model.nodes.map((node) => replacementNode(node, 0)) };
}

function replacementNode(node: PageNode, depth: number): PageNode {
  assert(depth <= LIMITS.treeDepthMax, 'A replacement model stays inside the tree depth bound');
  const replacement = withoutStaleAttributeSpans(node);
  switch (replacement.kind) {
    case 'component':
    case 'element':
      return replacement.children === undefined
        ? replacement
        : {
            ...replacement,
            children: replacement.children.map((child) => replacementNode(child, depth + 1)),
          };
    case 'map':
    case 'branch':
    case 'chunk-group':
      return {
        ...replacement,
        children: replacement.children.map((child) => replacementNode(child, depth + 1)),
      };
    case 'cond':
      return {
        ...replacement,
        children: replacement.children.map((branch) => {
          const child = replacementNode(branch, depth + 1);
          assert(child.kind === 'branch', 'A conditional keeps branch children');
          return child;
        }),
      };
    case 'comment':
    case 'expr':
    case 'raw':
    case 'raw-line':
    case 'text':
      return replacement;
    default: {
      const exhaustive: never = replacement;
      return exhaustive;
    }
  }
}

function withoutStaleAttributeSpans(node: PageNode): PageNode {
  const { attrSpans: staleAttributeSpans, ...replacement } = node;
  void staleAttributeSpans;
  return replacement;
}

function nodesById(roots: readonly PageNode[]): ReadonlyMap<string, PageNode> {
  const found = new Map<string, PageNode>();
  const pending: PageNode[] = [...roots];
  for (let visited = 0; visited < pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'A node index stays inside the tree bound');
    const node = pending[visited];
    assert(node !== undefined, 'A node index visits an existing node');
    found.set(node.id, node);
    pending.push(...childNodes(node));
  }
  return found;
}

function hasChangedDirectChild(before: PageNode, after: PageNode): boolean {
  const beforeChildren = childNodes(before);
  const afterChildren = childNodes(after);
  const directAfter = new Map(afterChildren.map((child) => [child.id, child]));
  return beforeChildren.some((child) => {
    const next = directAfter.get(child.id);
    return next !== undefined && child !== next;
  });
}

function childNodes(node: PageNode): readonly PageNode[] {
  if ('children' in node && Array.isArray(node.children)) {
    const children: readonly PageNode[] = node.children;
    return children;
  }
  return [];
}

function stopped(error: PageEditError, authored: Digest, replies: readonly PageEdited[]): GestureSent {
  const disk = replies[replies.length - 1]?.checksum ?? authored;
  switch (error.code) {
    case 'rejected':
      return {
        tag: 'refused',
        reason: error.reason,
        diskChecksum: error.diskChecksum ?? disk,
        replies,
      };
    case 'missing':
    case 'filesystem':
    case 'backpressured':
      return replies.length === 0 ? { tag: 'retry', message: error.message } : { tag: 'uncertain', message: error.message, replies };
    case 'write-race':
    case 'uncertain':
      return { tag: 'uncertain', message: error.message, replies };
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
