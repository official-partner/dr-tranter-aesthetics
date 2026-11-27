import { assert } from '../../../shared/core/assert';

export const ASSET_SORTS = ['newest', 'oldest', 'nameAscending', 'nameDescending', 'largest', 'smallest'] as const;
export type AssetSort = (typeof ASSET_SORTS)[number];
export const ASSET_SORT_DEFAULT: AssetSort = 'newest';

export const ASSET_VIEWS = ['grid', 'list', 'compact'] as const;
export type AssetView = (typeof ASSET_VIEWS)[number];
export const ASSET_VIEW_DEFAULT: AssetView = 'grid';

export interface SortableAsset {
  readonly rel: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedMs?: number;
}

export function isAssetSort(input: unknown): input is AssetSort {
  return ASSET_SORTS.some((sort) => sort === input);
}

export function isAssetView(input: unknown): input is AssetView {
  return ASSET_VIEWS.some((view) => view === input);
}

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortAssets<Asset extends SortableAsset>(files: readonly Asset[], sort: AssetSort, collator: Intl.Collator = NAME_COLLATOR): readonly Asset[] {
  const sorted = [...files].sort((left, right) => compareAssets(left, right, sort, collator));
  assert(sorted.length === files.length, 'Sorting keeps every file');
  const [first, second] = sorted;
  if (first !== undefined && second !== undefined) {
    assert(compareAssets(first, second, sort, collator) <= 0, 'The first two files are in order');
  }
  return sorted;
}

export function sortFolders<Folder extends { readonly rel: string; readonly name: string }>(
  folders: readonly Folder[],
  collator: Intl.Collator = NAME_COLLATOR,
): readonly Folder[] {
  const sorted = [...folders].sort((left, right) => collator.compare(left.name, right.name) || ordinal(left.rel, right.rel));
  assert(sorted.length === folders.length, 'Sorting keeps every folder');
  return sorted;
}

function compareAssets(left: SortableAsset, right: SortableAsset, sort: AssetSort, collator: Intl.Collator): number {
  switch (sort) {
    case 'newest':
      return compareTimes(left, right, -1) || byName(left, right, collator);
    case 'oldest':
      return compareTimes(left, right, 1) || byName(left, right, collator);
    case 'nameAscending':
      return byName(left, right, collator);
    case 'nameDescending':
      return byName(right, left, collator);
    case 'largest':
      return right.size - left.size || byName(left, right, collator);
    case 'smallest':
      return left.size - right.size || byName(left, right, collator);
    default: {
      const exhaustive: never = sort;
      return exhaustive;
    }
  }
}

function compareTimes(left: SortableAsset, right: SortableAsset, direction: 1 | -1): number {
  if (left.modifiedMs === undefined) {
    return right.modifiedMs === undefined ? 0 : 1;
  }
  if (right.modifiedMs === undefined) {
    return -1;
  }
  return direction * (left.modifiedMs - right.modifiedMs);
}

function byName(left: SortableAsset, right: SortableAsset, collator: Intl.Collator): number {
  return collator.compare(left.name, right.name) || ordinal(left.rel, right.rel);
}

function ordinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left === right ? 0 : 1;
}

export interface NameParts {
  readonly head: string;
  readonly tail: string;
}

export function middleParts(name: string, tailChars: number): NameParts {
  assert(Number.isSafeInteger(tailChars), 'The tail is a whole number of characters');
  assert(tailChars > 0, 'The tail keeps at least one character');
  const characters = Array.from(name);
  const tailCount = Math.min(tailChars, Math.floor(characters.length / 2));
  const head = characters.slice(0, characters.length - tailCount).join('');
  const tail = characters.slice(characters.length - tailCount).join('');
  assert(head + tail === name, 'The parts put back together are the name');
  return { head, tail };
}
