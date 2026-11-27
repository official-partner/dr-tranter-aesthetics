import { formatMessage } from '../../../shared/core/i18n/catalog';
import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import { messages as english } from '../../../shared/properties/i18n/messages/en/index';
import { propertyErrorText, type PropertyError } from '../../../shared/properties/propertyErrors';
import { isKnownMessageKey, type Translator } from './localeContext';

export function propertyErrorTextFor(error: PropertyError, translate: Translator): string {
  const say = (message: string, ref: MessageRef | undefined): string => {
    if (ref === undefined || !isKnownMessageKey(ref.key)) {
      return message;
    }
    return formatMessage('en', english[ref.key], ref.params ?? {}).ok ? translate(ref.key, ref.params) : message;
  };
  return propertyErrorText(error, say);
}
