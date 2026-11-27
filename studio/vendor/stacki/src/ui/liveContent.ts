
import { createLiveValue } from './liveValue';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

export interface LiveContent {
  readonly owner: string;
  readonly nodeID: string;
  readonly html: string;
  readonly caret?: readonly number[] | undefined;
}

export const liveContent = createLiveValue<LiveContent | undefined>(undefined);

export function setLiveContent(next: LiveContent): void {
  assert(next.owner !== '', 'Live content names who typed it');
  assert(next.html.length <= LIMITS.ipcFieldCharsMax, 'Live content fits one field');
  const current = liveContent.get();
  if (current?.owner === next.owner && current.nodeID === next.nodeID) {
    if (current.html === next.html && current.caret?.join('.') === next.caret?.join('.')) {
      return;
    }
  }
  liveContent.set(next);
}

export function clearLiveContent(owner: string): void {
  if (liveContent.get()?.owner === owner) {
    liveContent.set(undefined);
  }
}
