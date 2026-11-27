import { described, type Described, type MessageKey, type TypedMessageRef } from '../../shared/properties/i18n/messageRef';
import type { MessageParams } from '../../shared/core/i18n/catalog';
import type { Translator } from '../../shared/properties/i18n/messageRef';

export type Issue = Described & { readonly messageRef: TypedMessageRef };

export function issue(key: MessageKey, params?: MessageParams): Issue {
  return described(key, params);
}

export function spoken(value: Issue, translate: Translator): string {
  return value.messageRef.params === undefined ? translate(value.messageRef.key) : translate(value.messageRef.key, value.messageRef.params);
}
