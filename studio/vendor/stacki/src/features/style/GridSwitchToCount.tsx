import type { ReactNode } from 'react';
import { CodeInline } from '../../ui/CodeBlock';
import { confirmDialog } from '../../ui/ConfirmDialog';
import type { Translator } from '../../lib/i18n/localeContext';
import { parseTrackList } from './model/gridTemplate';
import { repeatTracks } from './gridTracks';


export function trackCountOf(value: string): number {
  return Math.max(1, parseTrackList(value).length);
}

export async function confirmSwitchToCount({ value, translate }: { readonly value: string; readonly translate: Translator }): Promise<boolean> {
  const body: ReactNode = (
    <>
      <p>{translate('style.gridControls.switchToCountBody', { count: trackCountOf(value) })}</p>
      <CodeInline text={value} language="css" />
    </>
  );
  const answer = await confirmDialog({
    title: translate('style.gridControls.switchToCountTitle'),
    body,
    confirmLabel: translate('style.gridControls.switchToCount'),
  });
  return answer === true;
}

export function countValue({ value, cell }: { readonly value: string; readonly cell: string }): string {
  return repeatTracks(trackCountOf(value), cell);
}
