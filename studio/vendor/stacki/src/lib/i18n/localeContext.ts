import { createContext } from 'react';
import { createTranslator, formatMessage, type Catalog, type CatalogIssue, type Translate } from '../../../shared/core/i18n/catalog';
import { formattersFor, type Formatters } from '../../../shared/core/i18n/format';
import { LOCALE_DEFAULT, type Locale } from '../../../shared/core/i18n/locales';
import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import { createRichTranslator } from '../../../shared/core/i18n/richText';
import { messages as english } from '../../../shared/properties/i18n/messages/en/index';
import type { MessageKey } from '../../../shared/properties/i18n/messages/en/index';
import type { TypedMessageRef } from '../../../shared/properties/i18n/messageRef';
import { createReactRichTranslator, type RichTranslator } from './translateRich';

export type { MessageKey };
export type Translator = Translate<MessageKey>;

export type RefTranslator = (ref: TypedMessageRef) => string;

export type DescribedTranslator = (described: { readonly message: string; readonly messageRef?: MessageRef | undefined }) => string;

export interface LocaleValue {
  readonly locale: Locale;
  readonly translate: Translator;
  readonly translateRich: RichTranslator;
  readonly translateRef: RefTranslator;
  readonly translateDescribed: DescribedTranslator;
  readonly format: Formatters;
}

export function warnOnce(): (issue: CatalogIssue) => void {
  const seen = new Set<string>();
  return (issue) => {
    const id = `${issue.locale}:${issue.key}:${issue.kind}`;
    if (!seen.has(id) && seen.size < 1_000) {
      seen.add(id);
      console.warn(`[i18n] ${issue.kind} ${issue.locale} ${issue.key}${issue.kind === 'bad-message' ? `: ${issue.reason}` : ''}`);
    }
  };
}

export function isKnownMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(english, key);
}

export function buildLocaleValue(locale: Locale, catalog: Catalog, onIssue: (issue: CatalogIssue) => void): LocaleValue {
  const options = { locale, catalog, fallback: english, onIssue };
  const translate = createTranslator(options);
  const translateRef: RefTranslator = (ref) => translate(ref.key, ref.params);
  const translateDescribed: DescribedTranslator = (value) => {
    const reference = value.messageRef;
    if (reference === undefined || !isKnownMessageKey(reference.key)) {
      return value.message;
    }
    const probe = formatMessage('en', english[reference.key], reference.params ?? {});
    return probe.ok ? translate(reference.key, reference.params) : value.message;
  };
  return {
    locale,
    translate,
    translateRich: createReactRichTranslator(createRichTranslator(options)),
    translateRef,
    translateDescribed,
    format: formattersFor(locale),
  };
}

export const ENGLISH: LocaleValue = buildLocaleValue(LOCALE_DEFAULT, english, warnOnce());

export const LocaleContext = createContext<LocaleValue>(ENGLISH);
