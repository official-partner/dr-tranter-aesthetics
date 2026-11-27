
import { assert } from '../core/assert';
import { list, record, text } from '../core/boundary';

export const STYLE_MOVE_LIMITS = {
  sheetsMax: 64,
  textCharsMax: 4_000_000,
  journalCharsMax: 32_000_000,
  nameCharsMax: 4_096,
} as const satisfies Record<string, number>;

export const STYLE_MOVE_ROLES = ['component', 'page', 'sheet'] as const;
export type StyleMoveRole = (typeof STYLE_MOVE_ROLES)[number];

export interface StyleMoveFile {
  readonly role: StyleMoveRole;
  readonly path: string;
  readonly rel: string;
  readonly before: string | undefined;
  readonly after: string | undefined;
}

export interface StyleMoveJournal {
  readonly version: 1;
  readonly id: string;
  readonly startedAt: number;
  readonly component: string;
  readonly files: readonly StyleMoveFile[];
}

export type StyleMoveProgress = 'before' | 'after' | 'changed';

export type StyleMoveState =
  | { readonly kind: 'untouched' }
  | { readonly kind: 'done' }
  | { readonly kind: 'interrupted'; readonly done: readonly string[]; readonly left: readonly string[] }
  | { readonly kind: 'changed'; readonly changed: readonly string[] };

export type StyleMoveTarget = 'moved' | 'original';

export interface PendingStyleMove {
  readonly journal: StyleMoveJournal;
  readonly state: StyleMoveState;
  readonly canFinish: boolean;
}

export type StyleMoveResolution = { readonly ok: true } | { readonly ok: false; readonly changed: readonly string[] };

export function parseStyleMoveTarget(input: unknown): StyleMoveTarget {
  if (input === 'moved' || input === 'original') {
    return input;
  }
  throw new Error('Style move: expected moved or original');
}

export function parsePendingStyleMove(input: unknown): PendingStyleMove | undefined {
  const value = record(input);
  if (value['pending'] === undefined) {
    return undefined;
  }
  const pending = record(value['pending']);
  const journal = parseStyleMoveJournal(pending['journal']);
  const state = parseStyleMoveState(pending['state']);
  const named = new Set(journal.files.map((file) => file.rel));
  assert(
    stateFiles(state).every((rel) => named.has(rel)),
    'parsePendingStyleMove: the state names only journalled files',
  );
  const canFinish = pending['canFinish'];
  if (typeof canFinish !== 'boolean') {
    throw new Error('Style move: expected whether it can be finished');
  }
  return { journal, state, canFinish };
}

export function parseStyleMoveResolution(input: unknown): StyleMoveResolution {
  const value = record(input);
  if (value['ok'] === true) {
    return { ok: true };
  }
  if (value['ok'] === false) {
    return { ok: false, changed: list(name)(value['changed']) };
  }
  throw new Error('Style move: expected a resolution');
}

function parseStyleMoveState(input: unknown): StyleMoveState {
  const value = record(input);
  switch (value['kind']) {
    case 'untouched':
      return { kind: 'untouched' };
    case 'done':
      return { kind: 'done' };
    case 'interrupted':
      return { kind: 'interrupted', done: list(name)(value['done']), left: list(name)(value['left']) };
    case 'changed':
      return { kind: 'changed', changed: list(name)(value['changed']) };
    default:
      throw new Error('Style move: unknown state');
  }
}

function stateFiles(state: StyleMoveState): readonly string[] {
  switch (state.kind) {
    case 'untouched':
    case 'done':
      return [];
    case 'interrupted':
      return [...state.done, ...state.left];
    case 'changed':
      return state.changed;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function styleMoveCanFinish(journal: StyleMoveJournal, disks: readonly (string | undefined)[]): boolean {
  assert(disks.length === journal.files.length, 'styleMoveCanFinish: one disk text per journalled file');
  const blocked = journal.files.some((file, index) => file.role === 'page' && file.after === undefined && disks[index] === file.before);
  assert(
    journal.files.some((file) => file.role === 'page'),
    'styleMoveCanFinish: a journal has its page',
  );
  return !blocked;
}

export function styleMoveProgress(file: StyleMoveFile, disk: string | undefined): StyleMoveProgress {
  if (disk === file.before) {
    return 'before';
  }
  if (disk === undefined) {
    return 'changed';
  }
  if (file.after === undefined) {
    return 'after';
  }
  return disk === file.after ? 'after' : 'changed';
}

export function styleMoveState(journal: StyleMoveJournal, disks: readonly (string | undefined)[]): StyleMoveState {
  assert(disks.length === journal.files.length, 'styleMoveState: one disk text per journalled file');
  const progress = journal.files.map((file, index) => styleMoveProgress(file, disks[index]));
  const changed = journal.files.filter((_, index) => progress[index] === 'changed').map((file) => file.rel);
  if (changed.length > 0) {
    return { kind: 'changed', changed };
  }
  const done = journal.files.filter((_, index) => progress[index] === 'after').map((file) => file.rel);
  const left = journal.files.filter((_, index) => progress[index] === 'before').map((file) => file.rel);
  assert(done.length + left.length === journal.files.length, 'styleMoveState: every file is done or left');
  if (done.length === 0) {
    return { kind: 'untouched' };
  }
  return left.length === 0 ? { kind: 'done' } : { kind: 'interrupted', done, left };
}

export function styleMoveOrder(files: readonly StyleMoveFile[], target: StyleMoveTarget): readonly StyleMoveFile[] {
  const rank = (file: StyleMoveFile): number => STYLE_MOVE_ROLES.indexOf(file.role);
  const ordered = [...files].sort((left, right) => (target === 'moved' ? rank(left) - rank(right) : rank(right) - rank(left)));
  assert(ordered.length === files.length, 'styleMoveOrder: every file is written once');
  return ordered;
}

export function parseStyleMoveJournal(input: unknown): StyleMoveJournal {
  const value = record(input);
  if (value['version'] !== 1) {
    throw new Error('Style move journal: unknown version');
  }
  const startedAt = value['startedAt'];
  if (typeof startedAt !== 'number' || !Number.isSafeInteger(startedAt) || startedAt < 0) {
    throw new Error('Style move journal: expected a start time');
  }
  const files = list(styleMoveFile)(value['files']);
  const roles = files.map((file) => file.role);
  if (roles.filter((role) => role === 'component').length !== 1 || roles.filter((role) => role === 'page').length !== 1) {
    throw new Error('Style move journal: expected one component and one page');
  }
  if (roles.length - 2 > STYLE_MOVE_LIMITS.sheetsMax) {
    throw new Error('Style move journal: too many stylesheets');
  }
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error('Style move journal: a file is listed twice');
  }
  const chars = files.reduce((sum, file) => sum + (file.before?.length ?? 0) + (file.after?.length ?? 0), 0);
  if (chars > STYLE_MOVE_LIMITS.journalCharsMax) {
    throw new Error('Style move journal: too large');
  }
  return { version: 1, id: name(value['id']), startedAt, component: name(value['component']), files };
}

function styleMoveFile(input: unknown): StyleMoveFile {
  const value = record(input);
  const role = styleMoveRole(value['role']);
  const file: StyleMoveFile = {
    role,
    path: name(value['path']),
    rel: name(value['rel']),
    before: maybeText(value['before']),
    after: maybeText(value['after']),
  };
  if (role === 'component' && file.before !== undefined) {
    throw new Error('Style move journal: a new component did not exist before');
  }
  if (role !== 'component' && file.before === undefined) {
    throw new Error('Style move journal: a page or stylesheet existed before');
  }
  if (role === 'sheet' && file.after === undefined) {
    throw new Error('Style move journal: a stylesheet’s new text is known before it is written');
  }
  return file;
}

function styleMoveRole(input: unknown): StyleMoveRole {
  const role = STYLE_MOVE_ROLES.find((known) => known === input);
  if (role === undefined) {
    throw new Error('Style move journal: unknown file role');
  }
  return role;
}

function name(input: unknown): string {
  const value = text(input);
  if (value.length === 0 || value.length > STYLE_MOVE_LIMITS.nameCharsMax) {
    throw new Error('Style move journal: a name or path is 1 to 4096 characters');
  }
  return value;
}

function maybeText(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const value = text(input);
  if (value.length > STYLE_MOVE_LIMITS.textCharsMax) {
    throw new Error('Style move journal: a file text is over the limit');
  }
  return value;
}
