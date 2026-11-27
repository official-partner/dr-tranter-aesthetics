
import { createContext, useCallback, useContext, useState } from 'react';

export const SelectorScopeContext = createContext('');

export function useSelectorState<T>(initial: T): readonly [T, (next: T) => void] {
  const selector = useContext(SelectorScopeContext);
  const [held, setHeld] = useState<{ readonly selector: string; readonly value: T }>({ selector, value: initial });
  const value = held.selector === selector ? held.value : initial;
  const set = useCallback((next: T) => setHeld({ selector, value: next }), [selector]);
  return [value, set] as const;
}
