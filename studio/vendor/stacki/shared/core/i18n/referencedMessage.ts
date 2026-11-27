import { parseOptionalMessageRef, type MessageRef } from './messageReference';
import { CATALOG_LIMITS } from './catalog';

export const REFERENCE_SEPARATOR = '⁣';

const REFERENCE_JSON_CHARS_MAX = (CATALOG_LIMITS.paramsMax + 1) * CATALOG_LIMITS.messageCharsMax * 2;

export function withReferencedMessage(message: string, reference: MessageRef | undefined): string {
  if (reference === undefined) {
    return message;
  }
  return `${message}${REFERENCE_SEPARATOR}${JSON.stringify(reference)}`;
}

export function splitReferencedMessage(text: string): { readonly message: string; readonly messageRef: MessageRef | undefined } {
  const at = text.lastIndexOf(REFERENCE_SEPARATOR);
  if (at < 0) {
    return { message: text, messageRef: undefined };
  }
  const json = text.slice(at + REFERENCE_SEPARATOR.length);
  const message = text.slice(0, at);
  if (json.length > REFERENCE_JSON_CHARS_MAX) {
    return { message, messageRef: undefined };
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return { message, messageRef: parseOptionalMessageRef(parsed) };
  } catch {
    return { message, messageRef: undefined };
  }
}

export function referenceOfError(error: unknown): MessageRef | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  return parseOptionalMessageRef(Reflect.get(error, 'messageRef'));
}
