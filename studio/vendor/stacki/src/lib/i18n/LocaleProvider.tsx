import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import { localeDirection, type Locale, type LocalePreference } from '../../../shared/core/i18n/locales';
import { resolveLocale } from '../../../shared/core/i18n/parseLocale';
import { buildLocaleValue, ENGLISH, LocaleContext, warnOnce, type LocaleValue } from './localeContext';
import { loadCatalog, type CatalogLoader } from './loadCatalog';
import { readLocalePreference, subscribeLocalePreference, systemLanguageTags } from './localeStore';

interface Props {
  readonly children: ReactNode;
  readonly loader?: CatalogLoader;
  readonly languageTags?: readonly string[];
  readonly onPreference?: (preference: LocalePreference) => void;
}

export function LocaleProvider({ children, loader = loadCatalog, languageTags, onPreference }: Props) {
  const preference = useSyncExternalStore(subscribeLocalePreference, readLocalePreference, readLocalePreference);
  const wanted: Locale = resolveLocale(preference, languageTags ?? systemLanguageTags());
  const [value, setValue] = useState<LocaleValue>(ENGLISH);
  useEffect(() => {
    onPreference?.(preference);
  }, [preference, onPreference]);
  useEffect(() => {
    if (wanted === 'en') {
      setValue(ENGLISH);
      return undefined;
    }
    let current = true;
    void loader(wanted).then((result) => {
      if (!current) {
        return;
      }
      if (result.ok) {
        const onIssue = warnOnce();
        setValue(buildLocaleValue(wanted, result.value, onIssue));
      } else {
        console.warn(`[i18n] ${result.error.message}`);
      }
    });
    return () => {
      current = false;
    };
  }, [wanted, loader]);
  useEffect(() => {
    assert(value.locale.length > 0, 'LocaleProvider: the active locale is set');
    document.documentElement.lang = value.locale;
    document.documentElement.dir = localeDirection(value.locale);
  }, [value.locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
