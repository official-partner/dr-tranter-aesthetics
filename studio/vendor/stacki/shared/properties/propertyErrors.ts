import { assert } from '../core/assert';
import { object, text } from '../core/boundary';
import { parseOptionalMessageRef } from '../core/i18n/messageReference';
import { toRecord } from '../core/record';
import type { MessageParams } from '../core/i18n/catalog';
import type { MessageRef } from '../core/i18n/messageReference';
import type { AppError, Result } from '../core/result';
import { described, messageRef, type Described, type MessageKey } from './i18n/messageRef';

export interface PropertyError extends AppError {
  readonly leadRef?: MessageRef | undefined;
}

export type PropertyResult<T> = Result<T, PropertyError>;

export function refusal(code: string, key: MessageKey, params?: MessageParams): PropertyError {
  return { code, ...described(key, params) };
}

export function withLead(lead: Described, error: PropertyError): PropertyError {
  assert(lead.messageRef !== undefined, 'withLead: the lead sentence has a reference');
  assert(error.leadRef === undefined, 'withLead: a refusal has one lead');
  const cause = error.messageRef ?? messageRef('props.edit.detail', { detail: error.message });
  return { code: error.code, message: `${lead.message} ${error.message}`, messageRef: cause, leadRef: lead.messageRef };
}

export function inFile(file: string, error: PropertyError): PropertyError {
  return withLead(described('props.edit.inFile', { file }), error);
}

export type RefSayer = (message: string, ref: MessageRef | undefined) => string;

export function propertyErrorText(error: PropertyError, say: RefSayer): string {
  if (error.leadRef === undefined) {
    return say(error.message, error.messageRef);
  }
  const lead = say('', error.leadRef);
  const cause = say('', error.messageRef);
  return lead === '' || cause === '' ? error.message : `${lead} ${cause}`;
}

export function parseRefusal(input: unknown): PropertyError {
  const error = object({ code: text, message: text })(input);
  const wire = toRecord(input);
  const messageRef = parseOptionalMessageRef(wire?.['messageRef']);
  const leadRef = parseOptionalMessageRef(wire?.['leadRef']);
  return { ...error, ...(messageRef === undefined ? {} : { messageRef }), ...(leadRef === undefined ? {} : { leadRef }) };
}
