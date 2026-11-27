
import { assert } from '../../shared/core/assert';

let holds = 0;

export function holdWindow(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    holds -= 1;
    assert(holds >= 0, 'holdWindow: releases never outnumber holds');
  };
}

export function windowHeld(): boolean {
  assert(holds >= 0, 'windowHeld: the hold count is never negative');
  return holds > 0;
}
