import type { ReactNode } from 'react';
import type { MessageKey } from '../../lib/i18n/localeContext';
import type { Translator } from '../../lib/i18n/localeContext';
import type { ScanComponent } from '../../../shared/properties/projectScan';
import type { InsertFolderKey } from './insertFolders';

export interface InsertCardPlace {
  readonly folder: InsertFolderKey | undefined;
}


export type InsertChoice =
  | { readonly type: 'component' | 'astroAsset'; readonly name: string; readonly path?: string }
  | { readonly type: 'element'; readonly tag: string }
  | {
      readonly type: 'map' | 'cond' | 'text' | 'comment' | 'expr' | 'doctype' | 'style' | 'script';
    };

export type InsertItem = InsertChoice & {
  readonly label: string;
  readonly labelKey?: MessageKey;
  readonly sub?: string;
  readonly subKey?: MessageKey;
  readonly search?: string;
  readonly cat: 'components' | 'elements' | 'other';
  readonly icon: ReactNode;
  readonly card?: InsertCardPlace;
  readonly instances?: number;
  readonly preview?: ScanComponent;
};

export function insertItemLabel(item: Pick<InsertItem, 'label' | 'labelKey'>, translate: Translator): string {
  return item.labelKey === undefined ? item.label : translate(item.labelKey);
}

export function insertItemSub(item: Pick<InsertItem, 'sub' | 'subKey'>, translate: Translator): string | undefined {
  return item.subKey === undefined ? item.sub : translate(item.subKey);
}
