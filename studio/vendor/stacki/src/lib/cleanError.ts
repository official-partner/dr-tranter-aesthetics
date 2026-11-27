
import type { MessageRef } from '../../shared/core/i18n/messageReference';
import { splitReferencedMessage } from '../../shared/core/i18n/referencedMessage';
import { toRecord } from '../../shared/core/record';

export interface Failure {
  readonly ok: false;
  readonly error: string;
  readonly errorRef?: MessageRef | undefined;
}

export function cleanError(error: unknown): string {
  return splitReferencedMessage(cleanErrorKeepingReference(error)).message;
}

export function cleanErrorKeepingReference(error: unknown): string {
  const record = toRecord(error);
  const message = record?.['message'];
  const text = typeof message === 'string' && message ? message : String(error);
  return stripAnsi(text.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''));
}

export function failureOf(error: unknown): Failure {
  const { message, messageRef } = splitReferencedMessage(cleanErrorKeepingReference(error));
  return messageRef === undefined ? { ok: false, error: message } : { ok: false, error: message, errorRef: messageRef };
}

export function stripAnsi(text: unknown): string {
  return String(text)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b/g, '')
    .replace(/\[(\d{1,2})m/g, '');
}
