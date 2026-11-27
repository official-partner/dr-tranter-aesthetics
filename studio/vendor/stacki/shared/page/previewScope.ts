
import { assert } from '../core/assert';
import { data, type Data } from '../core/boundary';
import { toRecord } from '../core/record';

export const SCOPE_STORE_KEY = 'stacki.scope';

export const PREVIEW_SCOPE_LIMITS = {
  filesMax: 128,
  namesMax: 64,
} as const;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function parseScopeSamples(input: unknown): Readonly<Record<string, Data>> {
  const source = toRecord(input);
  if (source === undefined) {
    return {};
  }
  const out: Record<string, Data> = {};
  for (const name of Object.keys(source).slice(0, PREVIEW_SCOPE_LIMITS.namesMax)) {
    const value = source[name];
    if (!IDENTIFIER.test(name)) {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    out[name] = data(value);
  }
  assert(Object.keys(out).length <= PREVIEW_SCOPE_LIMITS.namesMax, 'Scope samples are bounded by name count');
  return out;
}
