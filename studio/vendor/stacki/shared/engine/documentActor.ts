import { assert } from '../core/assert';
import type { Digest, FilePath } from '../core/brand';
import type { Intent, Operation, Outcome, RejectionReason, SubmissionResult } from './intent';
import { LIMITS } from '../core/limits';
import type { Plan, PlanningBase } from './planner';
import { err, ok, type Result } from '../core/result';
import type { Snapshot } from '../page/snapshot';
import type { ByteString } from '../core/span';
import { applySplices, changedRanges, witnessesHold } from './splice';


export interface DiskError {
  readonly code: 'missing' | 'failed';
  readonly message: string;
}

export interface DiskRead {
  readonly bytes: ByteString;
  readonly generation: number;
}

export interface DiskLock {
  readonly path: FilePath;
  readonly token: string;
}

export type LockError = { readonly code: 'held'; readonly message: string } | { readonly code: 'failed'; readonly message: string };

export type ReplaceError = { readonly code: 'failed'; readonly message: string } | { readonly code: 'not-durable'; readonly message: string };

export interface DocumentDisk {
  read(path: FilePath): Result<DiskRead, DiskError>;
  lock(path: FilePath): Result<DiskLock, LockError>;
  unlock(lock: DiskLock): Result<void, DiskError>;
  replace(path: FilePath, bytes: ByteString): Result<void, ReplaceError>;
}

export type Planner = (base: PlanningBase, intent: Intent) => Result<Plan, RejectionReason>;

export interface Projector {
  hash(bytes: ByteString): Digest;
  snapshot(path: FilePath, bytes: ByteString): Snapshot;
  candidate(path: FilePath, base: Snapshot, plan: Plan, bytes: ByteString): Snapshot;
}

export type PreflightGate = (
  base: Snapshot,
  candidate: Snapshot,
  operation: Operation,
) => { readonly tag: 'pass' } | { readonly tag: 'refuse'; readonly message: string };

export interface ActorDependencies {
  readonly disk: DocumentDisk;
  readonly planner: Planner;
  readonly projector: Projector;
  readonly preflight?: PreflightGate;
}


export interface Submission {
  readonly intent: Intent;
  readonly authored: Snapshot | undefined;
}

export interface InFlight {
  readonly intent: Intent;
  readonly base: Snapshot;
  readonly plan: Plan;
  readonly candidate: Snapshot;
}

export type ActorPhase =
  { readonly tag: 'idle' } | ({ readonly tag: 'planned' } & InFlight) | ({ readonly tag: 'written'; readonly lock: DiskLock } & InFlight);

export type WatcherHint = 'clean' | 'dirty';

export interface ActorState {
  readonly path: FilePath;
  readonly snapshot: Snapshot | undefined;
  readonly generation: number;
  readonly queue: readonly Submission[];
  readonly phase: ActorPhase;
  readonly hint: WatcherHint;
}

export type ActorEffect =
  | { readonly tag: 'outcome'; readonly outcome: Outcome }
  | ({
      readonly tag: 'committed';
      readonly previousGeneration: number;
      readonly generation: number;
    } & InFlight)
  | { readonly tag: 'refreshed'; readonly previousGeneration: number; readonly generation: number }
  | ({ readonly tag: 'unchanged' } & InFlight)
  | { readonly tag: 'disk-error'; readonly intentId: Intent['id']; readonly message: string }
  | { readonly tag: 'preflight-refused'; readonly intentId: Intent['id']; readonly message: string }
  | { readonly tag: 'lock-leaked'; readonly path: FilePath };

export interface ActorStep {
  readonly state: ActorState;
  readonly effects: readonly ActorEffect[];
  readonly parses: number;
}

export function createActor(path: FilePath): ActorState {
  return {
    path,
    snapshot: undefined,
    generation: 0,
    queue: [],
    phase: { tag: 'idle' },
    hint: 'dirty',
  };
}


export function submitIntent(state: ActorState, submission: Submission): { readonly state: ActorState; readonly result: SubmissionResult } {
  const intent = submission.intent;
  assert(intent.file === state.path, 'An intent is submitted to its own file actor');
  if (submission.authored !== undefined) {
    assert(submission.authored.path === intent.file, 'The authored snapshot is of the file');
    assert(submission.authored.checksum === intent.authoredChecksum, 'The authored snapshot is the one the intent names');
  }
  assert(state.queue.length <= LIMITS.intentsPendingMax, 'The queue never exceeds its bound');
  if (state.queue.length < LIMITS.intentsPendingMax) {
    const next = { ...state, queue: [...state.queue, submission] };
    return { state: next, result: { tag: 'accepted', intentId: intent.id } };
  }
  return { state, result: { tag: 'backpressured' } };
}

export function actorHasWork(state: ActorState): boolean {
  if (state.phase.tag === 'idle') {
    return state.queue.length > 0 ? true : state.hint === 'dirty';
  }
  return true;
}

export function actorQuiescent(state: ActorState): boolean {
  if (state.phase.tag === 'idle') {
    return state.queue.length === 0;
  }
  return false;
}

export function markDirty(state: ActorState): ActorState {
  return { ...state, hint: 'dirty' };
}

export function stepActor(state: ActorState, dependencies: ActorDependencies): ActorStep {
  const phase = state.phase;
  switch (phase.tag) {
    case 'idle':
      return stepIdle(state, dependencies);
    case 'planned':
      return stepPlanned(state, phase, dependencies);
    case 'written':
      return stepWritten(state, phase, dependencies);
    default: {
      const exhaustive: never = phase;
      throw new Error(`Unknown actor phase ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function refreshActor(state: ActorState, dependencies: ActorDependencies): Result<ActorStep, DiskError> {
  assert(state.phase.tag === 'idle', 'Only an idle actor refreshes');
  const refreshed = refresh(state, dependencies);
  if ('code' in refreshed) {
    return err(refreshed);
  }
  assert(refreshed.step.parses <= 1, 'A refresh parses at most once');
  return ok(refreshed.step);
}

export function crashActor(state: ActorState): ActorStep {
  const effects: ActorEffect[] = [];
  const phase = state.phase;
  if (phase.tag !== 'idle') {
    const outcome: Outcome = {
      tag: 'uncertain',
      intentId: phase.intent.id,
      candidateChecksum: phase.candidate.checksum,
    };
    effects.push({ tag: 'outcome', outcome });
  }
  for (const { intent } of state.queue) {
    const outcome: Outcome = {
      tag: 'uncertain',
      intentId: intent.id,
      candidateChecksum: undefined,
    };
    effects.push({ tag: 'outcome', outcome });
  }
  assert(effects.length <= LIMITS.intentsPendingMax + 1, 'A crash reports at most the queue');
  return { state: createActor(state.path), effects, parses: 0 };
}

export type Reconciliation = 'applied' | 'not-applied' | 'changed-again';

export function reconcileUncertain(input: {
  readonly baseChecksum: Digest;
  readonly candidateChecksum: Digest | undefined;
  readonly currentChecksum: Digest | undefined;
}): Reconciliation {
  const current = input.currentChecksum;
  if (current === undefined) {
    return 'changed-again';
  }
  if (current === input.candidateChecksum) {
    return 'applied';
  }
  if (current === input.baseChecksum) {
    return 'not-applied';
  }
  assert(current !== input.candidateChecksum, 'Neither the candidate nor the base is on disk');
  return 'changed-again';
}


type Refreshed = { readonly state: ActorState; readonly step: ActorStep };

function refresh(state: ActorState, dependencies: ActorDependencies): Refreshed | DiskError {
  const read = dependencies.disk.read(state.path);
  if (!read.ok) {
    return read.error;
  }
  const generation = read.value.generation;
  assert(generation >= state.generation, 'A disk read never returns an older generation');
  const checksum = dependencies.projector.hash(read.value.bytes);
  if (state.snapshot !== undefined) {
    if (state.snapshot.checksum === checksum) {
      const next: ActorState = { ...state, generation, hint: 'clean' };
      return { state: next, step: { state: next, effects: [], parses: 0 } };
    }
  }
  const snapshot = dependencies.projector.snapshot(state.path, read.value.bytes);
  assert(snapshot.checksum === checksum, 'The snapshot names the bytes just read');
  const next: ActorState = { ...state, snapshot, generation, hint: 'clean' };
  const effect: ActorEffect = {
    tag: 'refreshed',
    previousGeneration: state.generation,
    generation,
  };
  return { state: next, step: { state: next, effects: [effect], parses: 1 } };
}

function stepIdle(state: ActorState, dependencies: ActorDependencies): ActorStep {
  const refreshed = refresh(state, dependencies);
  const [submission, ...rest] = state.queue;
  if (submission === undefined) {
    return 'code' in refreshed ? { state, effects: [], parses: 0 } : refreshed.step;
  }
  const intent = submission.intent;
  if ('code' in refreshed) {
    const cause = diskError(intent, refreshed.message);
    return reject({ ...state, queue: rest }, intent, 'write-failed', 0, [cause]);
  }
  const current: ActorState = { ...refreshed.state, queue: rest };
  const base = current.snapshot;
  assert(base !== undefined, 'A successful refresh leaves a snapshot');
  const earlier = refreshed.step.effects;
  const parses = refreshed.step.parses;
  const authored = authoredBase(submission, base);
  if (authored === undefined) {
    return reject(current, intent, staleWithoutBytes(intent), parses, earlier);
  }
  const planned = dependencies.planner({ authored, current: base }, intent);
  if (!planned.ok) {
    return reject(current, intent, planned.error, parses, earlier);
  }
  const plan = planned.value;
  const checked = candidateOf(state.path, base, plan, dependencies.projector);
  if (!checked.ok) {
    return reject(current, intent, checked.error.reason, parses + checked.error.parses, earlier);
  }
  const candidate = checked.value;
  if (candidate.checksum === base.checksum) {
    return unchanged(current, { intent, base, plan, candidate }, parses + 1, earlier);
  }
  const verdict = dependencies.preflight?.(base, candidate, intent.operation) ?? { tag: 'pass' };
  if (verdict.tag === 'refuse') {
    assert(verdict.message.length > 0, 'A pre-flight refusal says why');
    const refused: ActorEffect = { tag: 'preflight-refused', intentId: intent.id, message: verdict.message };
    return reject(current, intent, 'would-break-page', parses + 1, [...earlier, refused]);
  }
  const phase: ActorPhase = { tag: 'planned', intent, base, plan, candidate };
  return { state: { ...current, phase }, effects: earlier, parses: parses + 1 };
}

function unchanged(state: ActorState, planned: InFlight, parses: number, earlier: readonly ActorEffect[]): ActorStep {
  assert(state.snapshot === planned.base, 'An unchanged plan is planned against the snapshot just read');
  assert(planned.candidate.bytes.length === planned.base.bytes.length, 'An unchanged candidate has the base length');
  assert(state.phase.tag === 'idle', 'An unchanged plan leaves the actor idle');
  assert(parses <= LIMITS.parseTasksInFlightMax, 'A step runs at most the parse bound');
  const outcome: Outcome = { tag: 'applied', intentId: planned.intent.id, changedRanges: [], checksum: planned.base.checksum };
  return { state, effects: [...earlier, { tag: 'unchanged', ...planned }, { tag: 'outcome', outcome }], parses };
}

function authoredBase(submission: Submission, current: Snapshot): Snapshot | undefined {
  if (submission.authored !== undefined) {
    return submission.authored;
  }
  return current.checksum === submission.intent.authoredChecksum ? current : undefined;
}

function staleWithoutBytes(intent: Intent): RejectionReason {
  const operation = intent.operation;
  switch (operation.tag) {
    case 'rewrite-text':
    case 'revert-splices':
      return 'region-externally-modified';
    case 'apply-code-patch':
      return 'merge-conflict';
    case 'set-attribute':
    case 'remove-attribute':
    case 'insert-node':
    case 'remove-node':
    case 'move-node':
    case 'rename-binding':
    case 'set-inline-style':
    case 'edit-frontmatter-slot':
    case 'rename-tag':
    case 'rename-attribute':
    case 'rewrite-node':
    case 'wrap-nodes':
    case 'append-body':
    case 'insert-frontmatter':
      return 'anchor-moved';
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

export function candidateOf(
  path: FilePath,
  base: Snapshot,
  plan: Plan,
  projector: Pick<ActorDependencies['projector'], 'candidate'>,
): Result<Snapshot, { readonly reason: RejectionReason; readonly parses: 0 | 1 }> {
  assert(base.path === path, 'A candidate is of the file its base is');
  if (!witnessesHold(base.bytes, plan.splices)) {
    return err({ reason: 'region-externally-modified', parses: 0 });
  }
  const bytes = applySplices(base.bytes, plan.splices);
  if (bytes.length > LIMITS.sourceBytesMax) {
    return err({ reason: 'resource-limit', parses: 0 });
  }
  const candidate = projector.candidate(path, base, plan, bytes);
  assert(candidate.bytes === bytes, 'The candidate is the applied bytes');
  if (plan.candidate === 'must-parse') {
    if (candidate.projection.tag === 'parse-error') {
      return err({ reason: 'source-invalid', parses: 1 });
    }
    if (!postKindsHold(candidate, plan)) {
      return err({ reason: 'unsupported-operation', parses: 1 });
    }
  }
  assert(candidate.path === path, 'The candidate is the same file');
  return ok(candidate);
}

function postKindsHold(candidate: Snapshot, plan: Plan): boolean {
  const projection = candidate.projection;
  assert(projection.tag === 'valid', 'Post-kinds are checked on a parsing candidate');
  for (const expected of plan.postKinds) {
    const found = projection.nodes.find((node) => {
      if (node.path.length === expected.path.length) {
        return node.path.every((step, index) => step === expected.path[index]);
      }
      return false;
    });
    if (found === undefined) {
      return false;
    }
    if (found.kind !== expected.kind) {
      return false;
    }
  }
  return true;
}

function stepPlanned(state: ActorState, phase: Extract<ActorPhase, { tag: 'planned' }>, dependencies: ActorDependencies): ActorStep {
  const disk = dependencies.disk;
  const idle: ActorState = { ...state, phase: { tag: 'idle' }, hint: 'dirty' };
  const intent = phase.intent;
  const locked = disk.lock(state.path);
  if (!locked.ok) {
    const cause = diskError(intent, locked.error.message);
    const reason = locked.error.code === 'held' ? 'write-race' : 'write-failed';
    return reject(idle, intent, reason, 0, [cause]);
  }
  const lock = locked.value;
  assert(lock.path === state.path, 'The lock is on the actor file');
  const read = disk.read(state.path);
  if (!read.ok) {
    const effects = release(disk, lock, [diskError(intent, read.error.message)]);
    return reject(idle, intent, 'write-failed', 0, effects);
  }
  if (dependencies.projector.hash(read.value.bytes) !== phase.base.checksum) {
    return reject(idle, intent, 'region-externally-modified', 0, release(disk, lock, []));
  }
  assert(witnessesHold(read.value.bytes, phase.plan.splices), 'Witnesses hold on re-read bytes');
  const replaced = disk.replace(state.path, phase.candidate.bytes);
  if (!replaced.ok) {
    const effects = release(disk, lock, [diskError(intent, replaced.error.message)]);
    if (replaced.error.code === 'failed') {
      return reject(idle, intent, 'write-failed', 0, effects);
    }
    return uncertain(idle, phase, effects);
  }
  const written: ActorPhase = { ...phase, tag: 'written', lock };
  return { state: { ...state, phase: written }, effects: [], parses: 0 };
}

function stepWritten(state: ActorState, phase: Extract<ActorPhase, { tag: 'written' }>, dependencies: ActorDependencies): ActorStep {
  const disk = dependencies.disk;
  const idle: ActorState = { ...state, phase: { tag: 'idle' }, hint: 'dirty' };
  const intent = phase.intent;
  const read = disk.read(state.path);
  const released = release(disk, phase.lock, []);
  if (!read.ok) {
    const effects = [...released, diskError(intent, read.error.message)];
    if (read.error.code === 'missing') {
      return reject(idle, intent, 'write-race', 0, effects);
    }
    return uncertain(idle, phase, effects);
  }
  if (dependencies.projector.hash(read.value.bytes) !== phase.candidate.checksum) {
    return reject(idle, intent, 'write-race', 0, released);
  }
  assert(read.value.generation >= state.generation, 'The commit never adopts an older generation');
  const committed: ActorState = {
    ...idle,
    hint: state.hint,
    snapshot: phase.candidate,
    generation: read.value.generation,
  };
  const outcome: Outcome = {
    tag: 'applied',
    intentId: intent.id,
    changedRanges: changedRanges(phase.plan.splices),
    checksum: phase.candidate.checksum,
  };
  const commit: ActorEffect = {
    tag: 'committed',
    previousGeneration: state.generation,
    generation: read.value.generation,
    intent,
    base: phase.base,
    plan: phase.plan,
    candidate: phase.candidate,
  };
  return {
    state: committed,
    effects: [...released, commit, { tag: 'outcome', outcome }],
    parses: 0,
  };
}

function release(disk: DocumentDisk, lock: DiskLock, effects: readonly ActorEffect[]): readonly ActorEffect[] {
  const released = disk.unlock(lock);
  return released.ok ? effects : [...effects, { tag: 'lock-leaked', path: lock.path }];
}

function diskError(intent: Intent, message: string): ActorEffect {
  return { tag: 'disk-error', intentId: intent.id, message };
}

function uncertain(state: ActorState, phase: InFlight, earlier: readonly ActorEffect[]): ActorStep {
  const outcome: Outcome = {
    tag: 'uncertain',
    intentId: phase.intent.id,
    candidateChecksum: phase.candidate.checksum,
  };
  return { state, effects: [...earlier, { tag: 'outcome', outcome }], parses: 0 };
}

function reject(state: ActorState, intent: Intent, reason: RejectionReason, parses: number, earlier: readonly ActorEffect[] = []): ActorStep {
  assert(parses <= LIMITS.parseTasksInFlightMax, 'A step runs at most the parse bound');
  const outcome: Outcome = { tag: 'rejected', intentId: intent.id, reason };
  return { state, effects: [...earlier, { tag: 'outcome', outcome }], parses };
}
