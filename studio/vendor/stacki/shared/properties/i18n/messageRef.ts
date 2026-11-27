import { assert } from '../../core/assert';
import { formatMessage, type MessageParams, type Translate } from '../../core/i18n/catalog';
import type { MessageRef } from '../../core/i18n/messageReference';
import { messages as english } from './messages/en/index';
import type { MessageKey } from './messages/en/index';

export type { MessageKey, MessageRef };
export type TypedMessageRef = MessageRef<MessageKey>;

export type Translator = Translate<MessageKey>;

export interface Described {
  readonly message: string;
  readonly messageRef?: MessageRef | undefined;
}

export function messageRef(key: MessageKey, params?: MessageParams): TypedMessageRef {
  return params === undefined ? { key } : { key, params };
}

export function englishText(ref: TypedMessageRef): string {
  const text = formatMessage('en', english[ref.key], ref.params ?? {});
  assert(text.ok, `englishText: "${ref.key}" formats with the parameters passed`);
  return text.value;
}

export function described(key: MessageKey, params?: MessageParams): Described & { readonly messageRef: TypedMessageRef } {
  const reference = messageRef(key, params);
  return { message: englishText(reference), messageRef: reference };
}
