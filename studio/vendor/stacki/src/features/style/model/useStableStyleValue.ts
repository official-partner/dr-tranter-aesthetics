import { useEffect, useRef } from 'react';

export function useStableStyleValue(value: string, options: { readonly pending: boolean }, scope: readonly unknown[]) {
  const { pending } = options;
  const last = useRef({ value, scope });
  const same = scope.length === last.current.scope.length && scope.every((key, index) => key === last.current.scope[index]);
  useEffect(() => {
    if (!pending) {
      last.current = { value, scope };
    }
  });
  return pending && same ? last.current.value : value;
}
