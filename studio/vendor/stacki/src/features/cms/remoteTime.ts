
import { assert } from '../../../shared/core/assert';
import { formattersFor, type Formatters } from '../../../shared/core/i18n/format';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';

export interface RemoteText {
  readonly translate: Translator;
  readonly format: Formatters;
}

export const ENGLISH_REMOTE_TEXT: RemoteText = { translate: ENGLISH_TRANSLATE, format: formattersFor('en') };

export function relativeTime(iso: string, now = Date.now(), text: RemoteText = ENGLISH_REMOTE_TEXT): string {
  assert(Number.isFinite(now), 'Now is a moment in time');
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) {
    return text.translate('cmsRemote.time.justNow');
  }
  if (minutes < 60) {
    return text.translate('cmsRemote.time.minutesAgo', { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return text.translate('cmsRemote.time.hoursAgo', { count: hours });
  }
  return text.format.formatDate(then, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
