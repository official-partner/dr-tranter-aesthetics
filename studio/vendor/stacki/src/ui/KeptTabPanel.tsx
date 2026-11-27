import type { ReactNode } from 'react';

export function KeptTabPanel({ shown, children }: { readonly shown: boolean; readonly children: ReactNode }) {
  return <div style={{ display: shown ? 'contents' : 'none' }}>{children}</div>;
}
