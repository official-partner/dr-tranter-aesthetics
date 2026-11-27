import type { AppOverridePoint } from '../../shared/properties/appsRpc';
import type { Translator } from '../lib/i18n/localeContext';
import { useTranslate } from '../lib/i18n/useTranslate';
import { useAppOverrideOwner } from './appOverrideSlot';
import './overrideNote.css';

export function overrideTitle(translate: Translator, owner: string): string {
  return translate('ui.overrideNote.title', { owner });
}

export function OverrideNote({ point }: { readonly point: AppOverridePoint }) {
  const translate = useTranslate();
  const owner = useAppOverrideOwner(point);
  if (owner === undefined) {
    return undefined;
  }
  return (
    <span className="override-note" title={overrideTitle(translate, owner)}>
      {translate('ui.overrideNote.via', { owner })}
    </span>
  );
}
