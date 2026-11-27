import { boolean, object } from '../core/boundary';
import { LOCALE_PREFERENCES, type LocalePreference } from '../core/i18n/locales';
import { parseLocalePreference } from '../core/i18n/parseLocale';

export function parseLocalePreferenceValue(input: unknown): LocalePreference {
  const parsed = parseLocalePreference(input);
  if (!parsed.ok) {
    throw new Error(`Locale preference: expected one of ${LOCALE_PREFERENCES.join(', ')}`);
  }
  return parsed.value;
}

export const parseLocaleSet = object({ preference: parseLocalePreferenceValue });
export const parseLocaleSetResult = object({ saved: boolean });
