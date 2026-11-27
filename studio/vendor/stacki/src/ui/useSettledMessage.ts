import { useEffect, useState } from 'react';
import { assert } from '../../shared/core/assert';

export function useSettledMessage(message: string | undefined, settleMs: number): string | undefined {
  assert(Number.isSafeInteger(settleMs), 'useSettledMessage: the delay is whole milliseconds');
  assert(settleMs > 0, 'useSettledMessage: the delay is positive');
  const [settled, setSettled] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (message === undefined) {
      setSettled(undefined);
      return undefined;
    }
    const timer = setTimeout(() => setSettled(message), settleMs);
    return () => clearTimeout(timer);
  }, [message, settleMs]);
  return message === undefined ? undefined : settled;
}
