
import type { MessageParams } from '../../../../shared/core/i18n/catalog';
import { englishText, messageRef, type MessageKey, type TypedMessageRef } from '../../../../shared/properties/i18n/messageRef';

export type Failure = { readonly ok: false; readonly error: string; readonly errorRef?: TypedMessageRef | undefined };

export function failureOf(key: MessageKey, params?: MessageParams): Failure & { readonly errorRef: TypedMessageRef } {
  const errorRef = messageRef(key, params);
  return { ok: false, error: englishText(errorRef), errorRef };
}
