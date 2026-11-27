
import { assert } from '../../../../shared/core/assert';
import type { MatchTarget } from '../model/selectors';
import type { EmbedDocument } from '../model/webflow';
import type { ScanState } from './EditorBasics';

export const SCAN_SNAPSHOT_ENTRIES_MAX = 32;

export interface ScanSnapshot {
  readonly scan: ScanState;
  readonly target: MatchTarget;
  readonly classList: readonly string[];
  readonly primed: { readonly target: MatchTarget; readonly key: string } | undefined;
}

const entries = new Map<string, ScanSnapshot>();

export function scanSnapshotKey(elementKey: string, docs: readonly EmbedDocument[]): string {
  assert(elementKey.length > 0, 'scanSnapshotKey: an element key is never empty');
  return `${elementKey}\u0000${docsFingerprint(docs)}`;
}

export function readScanSnapshot(key: string): ScanSnapshot | undefined {
  const found = entries.get(key);
  if (found === undefined) {
    return undefined;
  }
  assert(found.scan.settled, 'readScanSnapshot: only settled answers are remembered');
  entries.delete(key);
  entries.set(key, found);
  return found;
}

export function rememberScanSnapshot(key: string, snapshot: ScanSnapshot): void {
  assert(snapshot.scan.settled, 'rememberScanSnapshot: only a settled answer is remembered');
  assert(!snapshot.scan.awaitingFirstAnswer, 'rememberScanSnapshot: a remembered answer is not waiting');
  entries.delete(key);
  entries.set(key, snapshot);
  for (const oldest of entries.keys()) {
    if (entries.size <= SCAN_SNAPSHOT_ENTRIES_MAX) {
      break;
    }
    entries.delete(oldest);
  }
  assert(entries.size <= SCAN_SNAPSHOT_ENTRIES_MAX, 'rememberScanSnapshot: the cache is bounded');
}

export function forgetScanSnapshots(): void {
  entries.clear();
}

function docsFingerprint(docs: readonly EmbedDocument[]): string {
  let hash = 0x811c9dc5;
  const mix = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const document of docs) {
    mix(document.source.key);
    mix('\u0000');
    mix(document.code);
    mix('\u0001');
  }
  return `${docs.length}:${hash.toString(36)}`;
}
