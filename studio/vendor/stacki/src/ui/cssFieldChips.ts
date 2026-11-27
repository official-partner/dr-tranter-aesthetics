import type { Extension } from '@codemirror/state';
import type { ReactNode } from 'react';
import { assert } from '../../shared/core/assert';

export interface CssFieldChips {
  readonly extension: Extension;
  readonly overlay: ReactNode;
}

export type CssFieldChipsHook = (text: 'stylesheet') => CssFieldChips;

const NO_CHIPS: CssFieldChips = { extension: [], overlay: undefined };
let installed: CssFieldChipsHook = () => NO_CHIPS;
let drawn: CssFieldChipsHook | undefined;

export function installCssFieldChips(useChips: CssFieldChipsHook): void {
  assert(drawn === undefined || drawn === useChips, 'installCssFieldChips: install before the first CSS field is drawn');
  installed = useChips;
}

export function useCssFieldChips(): CssFieldChips {
  drawn = installed;
  return installed('stylesheet');
}
