import type { MessageParams } from '../../core/i18n/catalog';
import { englishText, messageRef, type MessageKey, type TypedMessageRef } from './messageRef';

export class ReferencedError extends Error {
  readonly messageRef: TypedMessageRef;

  constructor(key: MessageKey, params?: MessageParams) {
    const reference = messageRef(key, params);
    super(englishText(reference));
    this.messageRef = reference;
  }
}
