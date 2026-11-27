import { useRef, useState } from 'react';
import { followWhileRendering } from './fieldHooks';

export function useFieldDraft(external: string, options: { readonly busy: boolean }) {
  const { busy } = options;
  const [draft, setDraft] = useState(external);
  const focused = useRef(false);

  followWhileRendering(useState(external), external, () => {
    if (!focused.current) {
      setDraft(external);
    }
  });

  followWhileRendering(useState(busy), busy, () => {
    if (busy) {
      return;
    }
    if (!focused.current) {
      setDraft(external);
    }
  });

  return { draft, setDraft, focused, cleared: () => setDraft('') };
}
