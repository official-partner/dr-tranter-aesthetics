
import { createContext } from 'react';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { WireColumn } from '../../../shared/ipc/ipcResults';
import { LIVE_VARIABLE_MESSAGE, liveVariableKey, type LiveVariable, type LiveVariableMessage } from '../../../shared/properties/liveVariables';
import type { VariableCell, VariableFile } from '../../ipc/variablesBridge';

export type VariableWrite = (cell: VariableCell, value: string) => Promise<boolean>;

export const VARIABLE_SAVE_ROUNDS_MAX = 10_000;

export function liveVariableOf(files: readonly VariableFile[], cell: VariableCell): LiveVariable {
  const column = columnOf(files, cell);
  return { selector: cell.selector, context: column?.context ?? [], name: cell.name, value: cell.value };
}

function columnOf(files: readonly VariableFile[], cell: VariableCell): WireColumn | undefined {
  const file = files.find((candidate) => candidate.rel === cell.file);
  for (const group of file?.groups ?? []) {
    const found = group.columns.find((column) => column.id === cell.column);
    if (found !== undefined) {
      return found;
    }
    for (const block of group.blocks) {
      const inBlock = block.columns?.find((column) => column.id === cell.column);
      if (inBlock !== undefined) {
        return inBlock;
      }
    }
  }
  return undefined;
}

export function variableCellKey(cell: Pick<VariableCell, 'file' | 'column' | 'selector' | 'name'>): string {
  return [cell.file, cell.column, cell.selector, cell.name].join('\n');
}

export function cellAfterWrite(cell: VariableCell, value: string): VariableCell {
  assert(cell.valueEnd >= cell.valueStart, 'cellAfterWrite: the range is ordered');
  const next = { ...cell, value, valueEnd: cell.valueStart + value.length };
  assert(next.valueEnd - next.valueStart === value.length, 'cellAfterWrite: the range spans the value');
  return next;
}

interface Waiting {
  cell: VariableCell;
  draft: string;
  readonly settled: Array<() => void>;
}

interface Lane {
  written: VariableCell | undefined;
  waiting: Waiting | undefined;
}

export interface VariableSaveHooks {
  readonly onStart?: (cell: VariableCell, value: string) => void;
  readonly onIdle?: (cell: VariableCell, value: string | undefined) => void;
}

export function createVariableSaves(write: VariableWrite, hooks: VariableSaveHooks = {}) {
  const lanes = new Map<string, Lane>();

  const run = async (key: string): Promise<void> => {
    const lane = lanes.get(key);
    assert(lane !== undefined, 'Variable saves: a lane runs only while it is registered');
    let failed = false;
    let last: { cell: VariableCell; value: string } | undefined;
    for (let round = 0; lane.waiting !== undefined; round += 1) {
      assert(round < VARIABLE_SAVE_ROUNDS_MAX, 'Variable saves: a lane chained past its round limit');
      const job = lane.waiting;
      lane.waiting = undefined;
      const cell = lane.written ?? job.cell;
      hooks.onStart?.(cell, job.draft);
      let ok = false;
      try {
        ok = job.draft === cell.value ? true : await write(cell, job.draft);
      } finally {
        for (const settle of job.settled) {
          settle();
        }
      }
      failed = !ok;
      lane.written = ok ? cellAfterWrite(cell, job.draft) : undefined;
      last = { cell, value: job.draft };
    }
    lanes.delete(key);
    if (last !== undefined) {
      hooks.onIdle?.(last.cell, failed ? undefined : last.value);
    }
  };

  const save = (cell: VariableCell, value: string): Promise<void> => {
    const key = variableCellKey(cell);
    const existing = lanes.get(key);
    return new Promise<void>((resolve) => {
      if (existing !== undefined) {
        const waiting = existing.waiting ?? { cell, draft: value, settled: [] };
        waiting.cell = cell;
        waiting.draft = value;
        waiting.settled.push(resolve);
        assert(waiting.settled.length <= VARIABLE_SAVE_ROUNDS_MAX, 'Variable saves: waiters stay bounded');
        existing.waiting = waiting;
        return;
      }
      assert(lanes.size < LIMITS.scanEntriesMax, 'Variable saves: lane limit exceeded');
      const lane: Lane = { written: undefined, waiting: { cell, draft: value, settled: [resolve] } };
      lanes.set(key, lane);
      void run(key);
    });
  };

  return { save, busy: (cell: VariableCell) => lanes.has(variableCellKey(cell)) };
}

type LiveState = 'previewing' | 'saving' | 'released';

export function createLiveVariables(post: (message: LiveVariableMessage) => void) {
  const states = new Map<string, LiveState>();

  const remember = (key: string, state: LiveState): void => {
    if (!states.has(key)) {
      assert(states.size < LIMITS.scanEntriesMax, 'Live variables: state limit exceeded');
    }
    states.set(key, state);
  };

  return {
    draft(variable: LiveVariable, value: string | undefined): void {
      const key = liveVariableKey(variable);
      if (value !== undefined) {
        remember(key, 'previewing');
        post({ type: LIVE_VARIABLE_MESSAGE, op: 'set', variable: { ...variable, value } });
        return;
      }
      if (states.get(key) === 'previewing') {
        states.delete(key);
        post({ type: LIVE_VARIABLE_MESSAGE, op: 'drop', variable });
      }
    },
    saving(variable: LiveVariable): void {
      const key = liveVariableKey(variable);
      if (states.has(key)) {
        remember(key, 'saving');
      }
    },
    saved(variable: LiveVariable, value: string | undefined): void {
      const key = liveVariableKey(variable);
      if (states.get(key) !== 'saving') {
        return;
      }
      states.delete(key);
      post(
        value === undefined
          ? { type: LIVE_VARIABLE_MESSAGE, op: 'drop', variable }
          : { type: LIVE_VARIABLE_MESSAGE, op: 'drop', variable: { ...variable, value }, until: value },
      );
    },
    clear(): void {
      states.clear();
      post({ type: LIVE_VARIABLE_MESSAGE, op: 'clear' });
    },
  };
}

export const VariablePreviewContext = createContext<((cell: VariableCell, value: string | undefined) => void) | undefined>(undefined);
