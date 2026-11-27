import { assert } from '../../../../shared/core/assert';
import type { ProjectVariable } from './webflow';


export const ROOT_COLOR_BATCH_MAX = 256;
export const ROOT_COLOR_CHARS_MAX = 512;
export const LITERAL_DEPTH_MAX = 16;

const COMPUTED_COLOR = /^(?:(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^;{}<>()]*\)|#[0-9a-f]{3,8}|transparent)$/i;
const REFERENCE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]*))?\)$/i;

type Reply = Readonly<Record<string, unknown>> | undefined;

export interface RootColorQuery {
  readonly setScope: (next: readonly unknown[]) => void;
  readonly read: (path: string, key: string) => { readonly kind: 'pending' } | { readonly kind: 'settled'; readonly answer: string | undefined };
  readonly request: (path: string, key: string) => Promise<string | undefined>;
  readonly subscribe: (listener: () => void) => () => void;
}

export function rootColorQuery(ask: (values: string[]) => Promise<Reply>): (path: string, values: string[]) => Promise<Reply> {
  return async (_path, values) => {
    const asked = values.filter((value) => value.length <= ROOT_COLOR_CHARS_MAX);
    assert(asked.length <= values.length, 'rootColorQuery: only asked values are kept');
    const merged: Record<string, unknown> = {};
    const batches = Math.ceil(asked.length / ROOT_COLOR_BATCH_MAX);
    for (let batch = 0; batch < batches; batch++) {
      const slice = asked.slice(batch * ROOT_COLOR_BATCH_MAX, (batch + 1) * ROOT_COLOR_BATCH_MAX);
      assert(slice.length <= ROOT_COLOR_BATCH_MAX, 'rootColorQuery: a batch is bounded');
      const reply = await ask(slice);
      for (const value of slice) {
        merged[value] = reply?.[value];
      }
    }
    return merged;
  };
}

export function parseComputedColor(answer: unknown): string | undefined {
  if (typeof answer !== 'string') {
    return undefined;
  }
  const trimmed = answer.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > ROOT_COLOR_CHARS_MAX) {
    return undefined;
  }
  return COMPUTED_COLOR.test(trimmed) ? trimmed : undefined;
}

export function declaredValues(variables: readonly ProjectVariable[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const variable of variables) {
    const name = /--[A-Za-z0-9_-]+/.exec(variable.binding)?.[0];
    if (name !== undefined && !values.has(name)) {
      values.set(name, variable.value);
    }
  }
  return values;
}

export function literalColorOf(value: string, declared: ReadonlyMap<string, string>): string | undefined {
  let current = value.trim();
  if (current.startsWith('--')) {
    current = `var(${current})`;
  }
  for (let depth = 0; depth < LITERAL_DEPTH_MAX; depth++) {
    const match = REFERENCE.exec(current);
    if (match === null) {
      return current === '' ? undefined : current;
    }
    const name = match[1];
    assert(name !== undefined, 'literalColorOf: a reference has a name');
    const next = declared.get(name) ?? match[2];
    if (next === undefined) {
      return undefined;
    }
    current = next.trim();
  }
  return undefined;
}
