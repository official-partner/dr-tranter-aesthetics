import { createTranslator } from '../../core/i18n/catalog';
import { messages as english } from './messages/en/index';
import type { Translator } from './messageRef';

export const ENGLISH_TRANSLATE: Translator = createTranslator({
  locale: 'en',
  catalog: english,
  fallback: english,
  onIssue: () => undefined,
});
