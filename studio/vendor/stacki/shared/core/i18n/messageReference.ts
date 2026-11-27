import { assert } from '../assert';
import { err, ok, type Result } from '../result';
import { CATALOG_LIMITS, isMessageKey, type MessageParams } from './catalog';

export interface MessageRef<K extends string = string> {
  readonly key: K;
  readonly params?: MessageParams;
}

export function parseMessageRef(input: unknown): Result<MessageRef> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err({ code: 'bad-ref', message: 'A message reference is an object' });
  }
  const key: unknown = Reflect.get(input, 'key');
  if (typeof key !== 'string' || !isMessageKey(key)) {
    return err({ code: 'bad-ref', message: 'A message reference needs a message key' });
  }
  const rawParams: unknown = Reflect.get(input, 'params');
  if (rawParams === undefined) {
    return ok({ key });
  }
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    return err({ code: 'bad-ref', message: 'Message reference params are an object' });
  }
  const entries = Object.entries(rawParams);
  if (entries.length > CATALOG_LIMITS.paramsMax) {
    return err({ code: 'bad-ref', message: 'Message reference has too many params' });
  }
  const params: Record<string, string | number> = {};
  for (const [name, value] of entries) {
    if (typeof value === 'string' && value.length <= CATALOG_LIMITS.messageCharsMax) {
      params[name] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      params[name] = value;
    } else {
      return err({ code: 'bad-ref', message: `Message reference param "${name}" is not a bounded string or finite number` });
    }
  }
  assert(Object.keys(params).length === entries.length, 'parseMessageRef: every param was kept');
  return ok({ key, params });
}

export function parseOptionalMessageRef(input: unknown): MessageRef | undefined {
  if (input === undefined) {
    return undefined;
  }
  const parsed = parseMessageRef(input);
  return parsed.ok ? parsed.value : undefined;
}
