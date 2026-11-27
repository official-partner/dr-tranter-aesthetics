import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const SoundScope = createContext(false);

export function SoundHere({ children }: { readonly children?: ReactNode }) {
  return <SoundScope.Provider value>{children}</SoundScope.Provider>;
}

export const useSoundHere = () => useContext(SoundScope);
