
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';

const LOCALES = [
  'en-US',
  'en-GB',
  'en-CA',
  'en-AU',
  'en-NZ',
  'en-IE',
  'en-ZA',
  'en-IN',
  'es-ES',
  'es-MX',
  'es-US',
  'es-AR',
  'es-CO',
  'pt-BR',
  'pt-PT',
  'fr-FR',
  'fr-CA',
  'fr-BE',
  'fr-CH',
  'de-DE',
  'de-AT',
  'de-CH',
  'it-IT',
  'nl-NL',
  'nl-BE',
  'sv-SE',
  'nb-NO',
  'da-DK',
  'fi-FI',
  'pl-PL',
  'cs-CZ',
  'ro-RO',
  'hu-HU',
  'el-GR',
  'tr-TR',
  'ru-RU',
  'uk-UA',
  'he-IL',
  'ar-SA',
  'ar-EG',
  'hi-IN',
  'id-ID',
  'ms-MY',
  'th-TH',
  'vi-VN',
  'tl-PH',
  'zh-CN',
  'zh-TW',
  'zh-HK',
  'ja-JP',
  'ko-KR',
  'sw-KE',
  'af-ZA',
  'zu-ZA',
];

const LOCALE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})$/;
const TIME_ZONE = /^(?:[A-Z][A-Za-z_-]+\/[A-Za-z_/+-]+|UTC|GMT)$/;

export function suggestedOptions(name: string, value: string | undefined): readonly string[] {
  const text = value ?? '';
  if (TIME_ZONE.test(text) || (text === '' && /time\s*zone|timezone|tz$/i.test(name))) {
    return withCurrent(timeZonesNear(text), text);
  }
  if (LOCALE.test(text) || (text === '' && /locale|language/i.test(name))) {
    return withCurrent(LOCALES, text);
  }
  return [];
}

function timeZonesNear(value: string): readonly string[] {
  const all = Intl.supportedValuesOf('timeZone');
  const region = value.includes('/') ? value.slice(0, value.indexOf('/') + 1) : 'America/';
  const near = all.filter((zone) => zone.startsWith(region));
  return ['UTC', ...near].slice(0, LIMITS.propOptionsMax - 1);
}

function withCurrent(options: readonly string[], current: string): readonly string[] {
  const list = current === '' || options.includes(current) ? options : [current, ...options];
  assert(list.length <= LIMITS.propOptionsMax, 'Suggested choices fit a dropdown');
  return list;
}
