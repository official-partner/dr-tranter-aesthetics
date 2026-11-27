import { useEffect, useRef, useState } from 'react';

export const COPY_LIMITS = {
  confirmMs: 1_500,
} as const satisfies Record<string, number>;

export type CopyState = 'idle' | 'copied' | 'failed';

export async function copyText(text: string): Promise<'copied' | 'failed'> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (error: unknown) {
    console.error('Copying to the clipboard failed', error);
    return 'failed';
  }
}

export function useCopy(): { readonly state: CopyState; readonly copy: (text: string) => void } {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = (text: string): void => {
    void copyText(text).then((result) => {
      if (!mounted.current) {
        return;
      }
      setState(result);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), COPY_LIMITS.confirmMs);
    });
  };
  return { state, copy };
}
