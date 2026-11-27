import { assert } from '../assert';
import { err, ok, type Result } from '../result';
import { LOCALE_DEFAULT, LOCALE_PREFERENCES, LOCALE_TAG_ALIASES, LOCALES, type Locale, type LocalePreference } from './locales';

const LANGUAGE_TAG_CHARS_MAX = 35;
const LANGUAGE_TAGS_MAX = 32;

export function parseLocale(input: unknown): Result<Locale> {
  if (typeof input !== 'string') {
    return err({ code: 'locale-type', message: 'A locale is a string' });
  }
  if (input.length > LANGUAGE_TAG_CHARS_MAX) {
    return err({ code: 'locale-length', message: 'Locale tag is too long' });
  }
  const found = LOCALES.find((locale) => locale === input);
  if (found === undefined) {
    return err({ code: 'locale-unknown', message: `Unsupported locale "${input}"` });
  }
  return ok(found);
}

export function parseLocalePreference(input: unknown): Result<LocalePreference> {
  const found = LOCALE_PREFERENCES.find((preference) => preference === input);
  if (found === undefined) {
    return err({ code: 'preference-unknown', message: 'Unsupported language preference' });
  }
  return ok(found);
}

export function matchLocale(languageTag: string): Locale | undefined {
  assert(typeof languageTag === 'string', 'matchLocale: the tag is a string');
  if (languageTag.length === 0 || languageTag.length > LANGUAGE_TAG_CHARS_MAX) {
    return undefined;
  }
  const lower = languageTag.toLowerCase().replaceAll('_', '-');
  const exact = LOCALES.find((locale) => locale.toLowerCase() === lower);
  if (exact !== undefined) {
    return exact;
  }
  const aliased = aliasOf(lower);
  if (aliased !== undefined) {
    return aliased;
  }
  const primary = lower.split('-')[0];
  return LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === primary);
}

function aliasOf(lower: string): Locale | undefined {
  assert(lower === lower.toLowerCase(), 'aliasOf: the tag is lowercase');
  for (const [alias, locale] of Object.entries(LOCALE_TAG_ALIASES)) {
    if (lower === alias || lower.startsWith(`${alias}-`)) {
      assert(LOCALES.includes(locale), 'aliasOf: an alias names a shipped locale');
      return locale;
    }
  }
  return undefined;
}

export function systemLocale(languageTags: readonly string[]): Locale {
  assert(languageTags.length <= LANGUAGE_TAGS_MAX, 'systemLocale: at most LANGUAGE_TAGS_MAX tags');
  for (const tag of languageTags) {
    const matched = matchLocale(tag);
    if (matched !== undefined) {
      return matched;
    }
  }
  return LOCALE_DEFAULT;
}

export function resolveLocale(preference: LocalePreference, languageTags: readonly string[]): Locale {
  if (preference === 'system') {
    return systemLocale(languageTags.slice(0, LANGUAGE_TAGS_MAX));
  }
  const found = parseLocale(preference);
  assert(found.ok, 'resolveLocale: a non-system preference is a shipped locale');
  return found.value;
}
