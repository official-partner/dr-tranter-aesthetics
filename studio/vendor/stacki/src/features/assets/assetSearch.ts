import { assert } from '../../../shared/core/assert';
import { foldSearchText, holdsEveryWord, queryWords } from '../../lib/searchText';
import type { AssetFile } from './assetPaths';
import type { AssetPanelEntry } from './assetPanelBridge';

export interface AssetIndex {
  readonly files: readonly AssetFile[];
  readonly haystacks: readonly string[];
}

export { foldSearchText, isSearching, queryWords } from '../../lib/searchText';

export const EMPTY_ASSET_INDEX: AssetIndex = { files: [], haystacks: [] };

export function buildAssetIndex(entries: readonly AssetPanelEntry[], accepts: (file: AssetFile) => boolean): AssetIndex {
  const files: AssetFile[] = [];
  const haystacks: string[] = [];
  for (const entry of entries) {
    if (!isAssetFile(entry)) {
      continue;
    }
    if (accepts(entry)) {
      files.push(entry);
      haystacks.push(foldSearchText(entry.rel));
    }
  }
  assert(files.length === haystacks.length, 'Every indexed file has its text');
  assert(files.length <= entries.length, 'The index holds no more than the listing');
  return { files, haystacks };
}

export function searchAssets(index: AssetIndex, query: string): readonly AssetFile[] {
  const words = queryWords(query);
  assert(index.files.length === index.haystacks.length, 'The index is whole');
  if (words.length === 0) {
    return [];
  }
  const found: AssetFile[] = [];
  for (let position = 0; position < index.files.length; position += 1) {
    const haystack = index.haystacks[position];
    const file = index.files[position];
    if (haystack === undefined || file === undefined) {
      continue;
    }
    if (holdsEveryWord(haystack, words)) {
      found.push(file);
    }
  }
  assert(found.length <= index.files.length, 'A search never finds more files than there are');
  return found;
}

function isAssetFile(entry: AssetPanelEntry): entry is AssetFile {
  return !entry.isDir;
}
