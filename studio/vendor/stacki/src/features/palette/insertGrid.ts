import { assert } from '../../../shared/core/assert';
import { insertFolderKeys, type InsertFolderKey } from './insertFolders';


export const INSERT_COLUMNS = 3;

export const insertResultsMax = 200;

export interface ViewItem {
  readonly cat?: string;
  readonly card?: { readonly folder: InsertFolderKey | undefined } | undefined;
}

export type InsertTab = 'all' | 'components' | 'elements' | 'other' | 'apps';

export interface InsertPill {
  readonly key: InsertFolderKey;
  readonly count: number;
}

export interface InsertFolderFilter {
  readonly pills: readonly InsertPill[];
  readonly selected: InsertFolderKey | undefined;
}

export interface InsertView<T> {
  readonly shown: readonly T[];
  readonly folders: InsertFolderFilter | undefined;
}

export function insertView<T extends ViewItem>(
  ranked: readonly T[],
  tab: InsertTab,
  { chosen, present }: { readonly chosen: InsertFolderKey | undefined; readonly present: readonly InsertFolderKey[] },
): InsertView<T> {
  assert(Number.isSafeInteger(ranked.length), 'Ranked hits form a list');
  if (tab !== 'components') {
    return { shown: ranked.slice(0, insertResultsMax), folders: undefined };
  }
  const keys = insertFolderKeys(present);
  const counts = new Map<InsertFolderKey, number>(keys.map((key) => [key, 0]));
  for (const item of ranked) {
    const folder = item.card?.folder;
    if (folder !== undefined) {
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  const selected = chosen !== undefined && keys.includes(chosen) ? chosen : undefined;
  const pills = keys.map((key) => ({ key, count: counts.get(key) ?? 0 }));
  const shown = selected === undefined ? ranked : ranked.filter((item) => item.card?.folder === selected);
  assert(pills.length === keys.length, 'Every folder has one pill');
  return { shown: shown.slice(0, insertResultsMax), folders: { pills, selected } };
}

export type GridMove = 'left' | 'right' | 'up' | 'down';

export function moveHighlight(current: number, count: number, move: GridMove): number {
  assert(count > 0, 'Moving the highlight needs at least one card');
  assert(current >= 0, 'The highlight is a position');
  assert(current < count, 'The highlight sits on a card');
  const last = count - 1;
  switch (move) {
    case 'left':
      return Math.max(current - 1, 0);
    case 'right':
      return Math.min(current + 1, last);
    case 'up':
      return current >= INSERT_COLUMNS ? current - INSERT_COLUMNS : current;
    case 'down': {
      const next = current + INSERT_COLUMNS;
      if (next <= last) {
        return next;
      }
      const rowOfCurrent = Math.floor(current / INSERT_COLUMNS);
      const rowOfLast = Math.floor(last / INSERT_COLUMNS);
      return rowOfCurrent < rowOfLast ? last : current;
    }
    default: {
      const exhaustive: never = move;
      return exhaustive;
    }
  }
}
