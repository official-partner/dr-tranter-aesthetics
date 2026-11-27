import { assert } from '../../../shared/core/assert';
import { LOCALE_PREFERENCE_DEFAULT, LOCALE_PREFERENCES, type LocalePreference } from '../../../shared/core/i18n/locales';
import { parseLocalePreference } from '../../../shared/core/i18n/parseLocale';

const STORAGE_KEY = 'stacki.locale';

const listeners = new Set<() => void>();
let started = false;

export function readLocalePreference(): LocalePreference {
  try {
    const parsed = parseLocalePreference(localStorage.getItem(STORAGE_KEY));
    return parsed.ok ? parsed.value : LOCALE_PREFERENCE_DEFAULT;
  } catch {
    return LOCALE_PREFERENCE_DEFAULT;
  }
}

export function writeLocalePreference(preference: LocalePreference): void {
  assert(LOCALE_PREFERENCES.includes(preference), 'writeLocalePreference: a known preference');
  try {
    if (preference === LOCALE_PREFERENCE_DEFAULT) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
  }
  notify();
}

export function subscribeLocalePreference(listener: () => void): () => void {
  assert(listeners.size < 64, 'subscribeLocalePreference: listeners are removed on unmount');
  listeners.add(listener);
  if (!started && typeof window !== 'undefined') {
    started = true;
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        notify();
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function systemLanguageTags(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }
  const tags = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return tags.slice(0, 32);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}
