import { centralIcon } from '../../ui/central/CentralIcon';
import { add as centralAdd, close as centralClose, trashCanSimple as centralTrashCanSimple } from '../../ui/central/centralGeometry';

import type { ResolvedProp } from './model/resolved';

export type SetProp = (prop: string, value: string, important: boolean) => void;
export type ClearProp = (prop: string | string[]) => void;
export type Read = (prop: string) => ResolvedProp | undefined;
export type OnProvenance = (prop: string, anchor: DOMRect) => void;
export type OnSelectSelector = (selector: string, prop?: string) => void;
export type LabelProps = {
  read: Read;
  busy: boolean;
  clearProp: ClearProp;
  onProvenance: OnProvenance;
  onSelectSelector: OnSelectSelector;
};

export const resolvedValue = (read: Read, prop: string): string => {
  const resolved = read(prop);
  if (!resolved) {
    return '';
  }
  return (resolved.source === 'selected' && resolved.selectedValue ? resolved.selectedValue.value : resolved.winner.value).trim();
};

export const CloseIcon = centralIcon(centralClose);
export const PlusIcon = centralIcon(centralAdd);
export const TrashIcon = centralIcon(centralTrashCanSimple);
