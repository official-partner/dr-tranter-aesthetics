import { assert } from '../../../shared/core/assert';

interface SnapshotChip {
  readonly text: string;
  readonly name: string;
  readonly type: string;
}


export interface FieldSnapshot {
  readonly text: string;
  readonly chips: readonly SnapshotChip[];
  readonly caret: number;
}

export interface FieldHistory {
  readonly past: readonly FieldSnapshot[];
  readonly future: readonly FieldSnapshot[];
  readonly run: { readonly kind: string; readonly atMs: number } | undefined;
}

export const FIELD_HISTORY_STEPS_MAX = 100;
export const TYPING_RUN_MS = 1000;

export const EMPTY_FIELD_HISTORY: FieldHistory = { past: [], future: [], run: undefined };

export function recordEdit(
  history: FieldHistory,
  before: FieldSnapshot,
  edit: { readonly kind: string; readonly atMs: number; readonly grouped: boolean },
): FieldHistory {
  assert(Number.isFinite(edit.atMs), 'recordEdit: an edit has a time');
  const continues = edit.grouped && history.run !== undefined && history.run.kind === edit.kind && edit.atMs - history.run.atMs <= TYPING_RUN_MS;
  const last = history.past.at(-1);
  if (continues || (last !== undefined && sameSnapshot(last, before))) {
    return { past: history.past, future: [], run: { kind: edit.kind, atMs: edit.atMs } };
  }
  const past = [...history.past, before].slice(-FIELD_HISTORY_STEPS_MAX);
  assert(past.length <= FIELD_HISTORY_STEPS_MAX, 'recordEdit: the history is bounded');
  return { past, future: [], run: { kind: edit.kind, atMs: edit.atMs } };
}

export function undoStep(history: FieldHistory, current: FieldSnapshot): { readonly show: FieldSnapshot; readonly history: FieldHistory } | undefined {
  const show = history.past.at(-1);
  if (show === undefined) {
    return undefined;
  }
  const future = [...history.future, current].slice(-FIELD_HISTORY_STEPS_MAX);
  return { show, history: { past: history.past.slice(0, -1), future, run: undefined } };
}

export function redoStep(history: FieldHistory, current: FieldSnapshot): { readonly show: FieldSnapshot; readonly history: FieldHistory } | undefined {
  const show = history.future.at(-1);
  if (show === undefined) {
    return undefined;
  }
  const past = [...history.past, current].slice(-FIELD_HISTORY_STEPS_MAX);
  return { show, history: { past, future: history.future.slice(0, -1), run: undefined } };
}

function sameSnapshot(left: FieldSnapshot, right: FieldSnapshot): boolean {
  if (left.text !== right.text) {
    return false;
  }
  return left.chips.map((chip) => chip.text).join('\u0001') === right.chips.map((chip) => chip.text).join('\u0001');
}
