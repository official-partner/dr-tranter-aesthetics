import { englishText, messageRef, type MessageKey, type TypedMessageRef } from './i18n/messageRef';
import type { MessageParams } from '../core/i18n/catalog';

export class MediaInputError extends Error {
  readonly messageRef: TypedMessageRef;

  constructor(key: MessageKey, params?: MessageParams) {
    const reference = messageRef(key, params);
    super(englishText(reference));
    this.name = 'MediaInputError';
    this.messageRef = reference;
  }
}
