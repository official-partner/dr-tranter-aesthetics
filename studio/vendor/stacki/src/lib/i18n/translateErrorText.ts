import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import { splitReferencedMessage } from '../../../shared/core/i18n/referencedMessage';
import { messages as english } from '../../../shared/properties/i18n/messages/en/index';
import type { MessageKey, Translator } from '../../../shared/properties/i18n/messageRef';
import type { Failure } from '../cleanError';

function isKnownKey(key: string): key is MessageKey {
  return Object.hasOwn(english, key);
}

export function translateReference(message: string, reference: MessageRef | undefined, translate: Translator): string {
  if (reference === undefined || !isKnownKey(reference.key)) {
    return message;
  }
  try {
    return translate(reference.key, reference.params);
  } catch {
    return message;
  }
}

export function translateErrorText(text: string, translate: Translator): string {
  const { message, messageRef } = splitReferencedMessage(text);
  return translateReference(message, messageRef, translate);
}

export function translateFailure(failure: Pick<Failure, 'error' | 'errorRef'>, translate: Translator): string {
  return translateReference(failure.error, failure.errorRef, translate);
}
