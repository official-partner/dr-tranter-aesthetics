import { assert } from '../../shared/core/assert';
import type { Digest } from '../../shared/core/brand';

export type SaveState =
  | { readonly tag: 'clean'; readonly checksum: Digest }
  | { readonly tag: 'dirty'; readonly baseChecksum: Digest }
  | { readonly tag: 'saving'; readonly baseChecksum: Digest }
  | { readonly tag: 'failed'; readonly baseChecksum: Digest; readonly message: string }
  | { readonly tag: 'conflicted'; readonly baseChecksum: Digest; readonly diskChecksum: Digest };

export function saveStateClean(checksum: Digest): SaveState {
  return { tag: 'clean', checksum };
}

export function saveStateEdited(state: SaveState): SaveState {
  switch (state.tag) {
    case 'clean':
      return { tag: 'dirty', baseChecksum: state.checksum };
    case 'failed':
      return { tag: 'dirty', baseChecksum: state.baseChecksum };
    case 'dirty':
      return state;
    case 'saving':
      return { tag: 'dirty', baseChecksum: state.baseChecksum };
    case 'conflicted':
      return state;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function saveStateStarted(state: SaveState): SaveState {
  assert(saveStateNeedsWrite(state), `Only an unsaved page starts a save, not ${state.tag}`);
  return { tag: 'saving', baseChecksum: saveStateBase(state) };
}

export function saveStateFailed(state: SaveState, message: string): SaveState {
  assert(state.tag !== 'clean', 'A clean page has no failed save');
  assert(state.tag !== 'conflicted', 'A failed save cannot dismiss a conflict');
  assert(message.length > 0, 'A failed save explains why it did not reach disk');
  return { tag: 'failed', baseChecksum: state.baseChecksum, message };
}

export function saveStateRefused(state: SaveState, baseChecksum: Digest, diskChecksum: Digest): SaveState {
  assert(state.tag !== 'clean', 'A clean page has nothing to refuse');
  assert(diskChecksum !== baseChecksum, 'A refusal names bytes other than the base');
  return { tag: 'conflicted', baseChecksum, diskChecksum };
}

export function saveStateAccepted(state: SaveState): SaveState {
  assert(state.tag === 'conflicted', `Only a conflicted page can be accepted, not ${state.tag}`);
  return { tag: 'dirty', baseChecksum: state.diskChecksum };
}

export function saveStateNeedsWrite(state: SaveState): boolean {
  return state.tag === 'dirty' || state.tag === 'failed';
}

export function saveStateBase(state: SaveState): Digest {
  return state.tag === 'clean' ? state.checksum : state.baseChecksum;
}
