import { createContext, useContext, type ReactNode } from 'react';

export interface PropFieldAction {
  readonly icon: ReactNode;
  readonly label: string;
  readonly pressed: boolean;
  readonly refused: boolean;
  readonly onPress: () => void;
}

export interface PropFieldExtra {
  readonly action?: PropFieldAction;
  readonly lockedReason?: string;
  readonly provenance?: PropFieldProvenance;
  readonly mixed?: string;
  readonly reset?: () => void;
}

export interface PropFieldProvenance {
  readonly tone: 'inherited' | 'noted' | 'given';
  readonly tip: string;
}

export function provenanceResets(provenance: PropFieldProvenance | undefined): boolean {
  return provenance === undefined || provenance.tone === 'noted';
}

export type PropFieldExtras = (name: string) => PropFieldExtra | undefined;

export const PropFieldExtrasContext = createContext<PropFieldExtras | undefined>(undefined);

export function usePropFieldExtra(name: string): PropFieldExtra | undefined {
  return useContext(PropFieldExtrasContext)?.(name);
}
