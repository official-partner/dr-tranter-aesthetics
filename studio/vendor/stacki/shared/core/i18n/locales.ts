
export const LOCALES = ['en', 'es', 'fr', 'de', 'pt-BR', 'it', 'nl', 'pl', 'tr', 'ru', 'id', 'hi', 'ar', 'he', 'ja', 'ko', 'zh-CN', 'zh-TW'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_DEFAULT: Locale = 'en';

export type TextDirection = 'ltr' | 'rtl';

export type FlagCountry = 'br' | 'cn' | 'de' | 'es' | 'fr' | 'id' | 'il' | 'in' | 'it' | 'jp' | 'kr' | 'nl' | 'pl' | 'ru' | 'sa' | 'tr' | 'tw' | 'us';

export interface LocaleInfo {
  readonly nativeName: string;
  readonly directory: string;
  readonly direction: TextDirection;
  readonly mark: string;
  readonly flag: FlagCountry;
}

export const LOCALE_INFO = {
  en: { nativeName: 'English', directory: 'en', direction: 'ltr', mark: 'EN', flag: 'us' },
  es: { nativeName: 'Español', directory: 'es', direction: 'ltr', mark: 'ES', flag: 'es' },
  fr: { nativeName: 'Français', directory: 'fr', direction: 'ltr', mark: 'FR', flag: 'fr' },
  de: { nativeName: 'Deutsch', directory: 'de', direction: 'ltr', mark: 'DE', flag: 'de' },
  'pt-BR': { nativeName: 'Português (Brasil)', directory: 'ptBR', direction: 'ltr', mark: 'PT', flag: 'br' },
  it: { nativeName: 'Italiano', directory: 'it', direction: 'ltr', mark: 'IT', flag: 'it' },
  nl: { nativeName: 'Nederlands', directory: 'nl', direction: 'ltr', mark: 'NL', flag: 'nl' },
  pl: { nativeName: 'Polski', directory: 'pl', direction: 'ltr', mark: 'PL', flag: 'pl' },
  tr: { nativeName: 'Türkçe', directory: 'tr', direction: 'ltr', mark: 'TR', flag: 'tr' },
  ru: { nativeName: 'Русский', directory: 'ru', direction: 'ltr', mark: 'RU', flag: 'ru' },
  id: { nativeName: 'Bahasa Indonesia', directory: 'id', direction: 'ltr', mark: 'ID', flag: 'id' },
  hi: { nativeName: 'हिन्दी', directory: 'hi', direction: 'ltr', mark: 'HI', flag: 'in' },
  ar: { nativeName: 'العربية', directory: 'ar', direction: 'rtl', mark: 'AR', flag: 'sa' },
  he: { nativeName: 'עברית', directory: 'he', direction: 'rtl', mark: 'HE', flag: 'il' },
  ja: { nativeName: '日本語', directory: 'ja', direction: 'ltr', mark: 'JA', flag: 'jp' },
  ko: { nativeName: '한국어', directory: 'ko', direction: 'ltr', mark: 'KO', flag: 'kr' },
  'zh-CN': { nativeName: '中文（简体）', directory: 'zhCN', direction: 'ltr', mark: '简', flag: 'cn' },
  'zh-TW': { nativeName: '中文（繁體）', directory: 'zhTW', direction: 'ltr', mark: '繁', flag: 'tw' },
} as const satisfies Record<Locale, LocaleInfo>;

export const LOCALE_TAG_ALIASES = {
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  iw: 'he',
  in: 'id',
} as const satisfies Record<string, Locale>;

export const LOCALE_PREFERENCES = ['system', ...LOCALES] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export const LOCALE_PREFERENCE_DEFAULT: LocalePreference = 'system';

export function localeDirection(locale: Locale): TextDirection {
  return LOCALE_INFO[locale].direction;
}

export function localeNativeName(locale: Locale): string {
  return LOCALE_INFO[locale].nativeName;
}
