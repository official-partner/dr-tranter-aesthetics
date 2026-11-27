import { err, ok, type AppError, type Result } from '../../../shared/core/result';
import { parseCatalog, type Catalog } from '../../../shared/core/i18n/catalog';
import type { Locale } from '../../../shared/core/i18n/locales';
import { messages as english } from '../../../shared/properties/i18n/messages/en/index';

export type CatalogImporters = Readonly<Record<Locale, () => Promise<unknown>>>;

const SHIPPED_IMPORTERS: CatalogImporters = {
  en: () => Promise.resolve(english),
  es: () => import('../../../shared/properties/i18n/messages/es/index'),
  fr: () => import('../../../shared/properties/i18n/messages/fr/index'),
  de: () => import('../../../shared/properties/i18n/messages/de/index'),
  'pt-BR': () => import('../../../shared/properties/i18n/messages/ptBR/index'),
  it: () => import('../../../shared/properties/i18n/messages/it/index'),
  nl: () => import('../../../shared/properties/i18n/messages/nl/index'),
  pl: () => import('../../../shared/properties/i18n/messages/pl/index'),
  tr: () => import('../../../shared/properties/i18n/messages/tr/index'),
  ru: () => import('../../../shared/properties/i18n/messages/ru/index'),
  id: () => import('../../../shared/properties/i18n/messages/id/index'),
  hi: () => import('../../../shared/properties/i18n/messages/hi/index'),
  ar: () => import('../../../shared/properties/i18n/messages/ar/index'),
  he: () => import('../../../shared/properties/i18n/messages/he/index'),
  ja: () => import('../../../shared/properties/i18n/messages/ja/index'),
  ko: () => import('../../../shared/properties/i18n/messages/ko/index'),
  'zh-CN': () => import('../../../shared/properties/i18n/messages/zhCN/index'),
  'zh-TW': () => import('../../../shared/properties/i18n/messages/zhTW/index'),
};

export type CatalogLoader = (locale: Locale) => Promise<Result<Catalog, AppError>>;

export function createCatalogLoader(importers: CatalogImporters): CatalogLoader {
  const settled = new Map<Locale, Catalog>();
  const pending = new Map<Locale, Promise<Result<Catalog, AppError>>>();
  return (locale) => {
    const ready = settled.get(locale);
    if (ready !== undefined) {
      return Promise.resolve(ok(ready));
    }
    const running = pending.get(locale);
    if (running !== undefined) {
      return running;
    }
    const started = importCatalog(importers, locale).then((result) => {
      pending.delete(locale);
      if (result.ok) {
        settled.set(locale, result.value);
      }
      return result;
    });
    pending.set(locale, started);
    return started;
  };
}

export const loadCatalog: CatalogLoader = createCatalogLoader(SHIPPED_IMPORTERS);

async function importCatalog(importers: CatalogImporters, locale: Locale): Promise<Result<Catalog, AppError>> {
  let loaded: unknown;
  try {
    loaded = await importers[locale]();
  } catch (failure: unknown) {
    return err({ code: 'catalog-import-failed', message: `Could not load the ${locale} catalog: ${String(failure)}` });
  }
  const candidate = typeof loaded === 'object' && loaded !== null && 'messages' in loaded ? loaded.messages : loaded;
  const parsed = parseCatalog(candidate);
  if (parsed.ok) {
    return parsed;
  }
  return err({ code: parsed.error.code, message: `The ${locale} catalog is invalid: ${parsed.error.message}` });
}
