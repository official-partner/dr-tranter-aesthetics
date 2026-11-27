import { useContext } from 'react';
import type { Formatters } from '../../../shared/core/i18n/format';
import { LocaleContext, type DescribedTranslator, type LocaleValue, type RefTranslator, type Translator } from './localeContext';
import type { RichTranslator } from './translateRich';

export function useTranslate(): Translator {
  return useContext(LocaleContext).translate;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}

export function useTranslateRich(): RichTranslator {
  return useContext(LocaleContext).translateRich;
}

export function useTranslateRef(): RefTranslator {
  return useContext(LocaleContext).translateRef;
}

export function useTranslateDescribed(): DescribedTranslator {
  return useContext(LocaleContext).translateDescribed;
}

export function useFormat(): Formatters {
  return useContext(LocaleContext).format;
}
