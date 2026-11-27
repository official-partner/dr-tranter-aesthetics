
import { assert } from '../core/assert';

export const VARIANT_HEADER = 'x-avb-variant';

export const VARIANT_LIMITS = {
  pathCharsMax: 1_000,
  propCharsMax: 100,
  valueCharsMax: 500,
  headerCharsMax: 16_000,
} as const;

export interface VariantOverride {
  readonly component: string;
  readonly target: string;
  readonly prop: string;
  readonly value: string | number | undefined;
}

export type VariantMessage = { readonly kind: 'show'; readonly override: VariantOverride } | { readonly kind: 'cancel' } | { readonly kind: 'commit' };

export const VARIANT_MESSAGE_TYPES = {
  show: 'avb:variant',
  cancel: 'avb:variant-cancel',
  commit: 'avb:variant-commit',
} as const;

const PROP_NAME = /^[A-Za-z_$][\w$-]*$/;
const FORBIDDEN_PROPS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function boundedText(value: unknown, charsMax: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }
  return value.length <= charsMax ? value : undefined;
}

export function parseVariantOverride(input: unknown): VariantOverride | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  const component = boundedText(Reflect.get(input, 'component'), VARIANT_LIMITS.pathCharsMax);
  const target = boundedText(Reflect.get(input, 'target'), VARIANT_LIMITS.pathCharsMax);
  const prop = boundedText(Reflect.get(input, 'prop'), VARIANT_LIMITS.propCharsMax);
  if (component === undefined || target === undefined || prop === undefined) {
    return undefined;
  }
  if (!PROP_NAME.test(prop)) {
    return undefined;
  }
  if (FORBIDDEN_PROPS.has(prop)) {
    return undefined;
  }
  const raw: unknown = Reflect.get(input, 'value');
  let value: string | number | undefined;
  if (raw === undefined) {
    value = undefined;
  } else if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return undefined;
    }
    value = raw;
  } else if (typeof raw === 'string') {
    if (raw.length > VARIANT_LIMITS.valueCharsMax) {
      return undefined;
    }
    value = raw;
  } else {
    return undefined;
  }
  return { component, target, prop, value };
}

export function parseVariantMessage(input: unknown): VariantMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const type: unknown = Reflect.get(input, 'type');
  if (type === VARIANT_MESSAGE_TYPES.cancel) {
    return { kind: 'cancel' };
  }
  if (type === VARIANT_MESSAGE_TYPES.commit) {
    return { kind: 'commit' };
  }
  if (type === VARIANT_MESSAGE_TYPES.show) {
    const override = parseVariantOverride(Reflect.get(input, 'override'));
    return override === undefined ? undefined : { kind: 'show', override };
  }
  return undefined;
}

export function variantHeaderValue(override: VariantOverride): string {
  const encoded = encodeURIComponent(JSON.stringify(override));
  assert(encoded.length <= VARIANT_LIMITS.headerCharsMax, 'variantHeaderValue: the header is bounded');
  assert(parseVariantHeader(encoded) !== undefined, 'variantHeaderValue: the header parses back');
  return encoded;
}

export function parseVariantHeader(header: unknown): VariantOverride | undefined {
  if (typeof header !== 'string' || header.length > VARIANT_LIMITS.headerCharsMax) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    return parseVariantOverride(parsed);
  } catch {
    return undefined;
  }
}

export const VARIANT_SCOPE_GLOBAL = '__avbVariantScope';

export function variantOverrideStatement(component: string): string {
  assert(component.length > 0, 'variantOverrideStatement: names a component');
  assert(component.length <= VARIANT_LIMITS.pathCharsMax, 'variantOverrideStatement: the path is bounded');
  const scope = `globalThis[${JSON.stringify(VARIANT_SCOPE_GLOBAL)}]`;
  const statement =
    `{ const __avbScope = ${scope}; let __avbVariant = __avbScope && __avbScope.getStore(); ` +
    `if (!__avbScope) { ${variantHeaderReader()} } ` +
    `const __avbPath = Astro.props["data-avb-p"]; ` +
    `if (__avbVariant && __avbVariant.component === ${JSON.stringify(component)} && typeof __avbPath === "string" && __avbPath.split(" ")[0] === __avbVariant.target) { ` +
    `if (__avbVariant.value === undefined) { delete Astro.props[__avbVariant.prop]; } else { Astro.props[__avbVariant.prop] = __avbVariant.value; } } }`;
  assert(!statement.includes('\n'), 'variantOverrideStatement: one line');
  return statement;
}

function variantHeaderReader(): string {
  const forbidden = JSON.stringify([...FORBIDDEN_PROPS]);
  const valid =
    `__avbParsed && typeof __avbParsed === "object" && typeof __avbParsed.prop === "string" && __avbParsed.prop.length <= ${VARIANT_LIMITS.propCharsMax} && ` +
    `${PROP_NAME.toString()}.test(__avbParsed.prop) && !${forbidden}.includes(__avbParsed.prop) && ` +
    `(__avbParsed.value === undefined || (typeof __avbParsed.value === "string" && __avbParsed.value.length <= ${VARIANT_LIMITS.valueCharsMax}) || ` +
    `(typeof __avbParsed.value === "number" && Number.isFinite(__avbParsed.value)))`;
  return (
    `try { const __avbHeader = Astro.request && Astro.request.headers ? Astro.request.headers.get(${JSON.stringify(VARIANT_HEADER)}) : null; ` +
    `if (typeof __avbHeader === "string" && __avbHeader.length <= ${VARIANT_LIMITS.headerCharsMax}) { ` +
    `const __avbParsed = JSON.parse(decodeURIComponent(__avbHeader)); if (${valid}) { __avbVariant = __avbParsed; } } } catch { __avbVariant = undefined; }`
  );
}

export function withVariantOverride(marked: string, component: string): string {
  const statement = variantOverrideStatement(component);
  const opening = /^---\r?\n/.exec(marked);
  const result = opening === null ? `---\n${statement}\n---\n${marked}` : `${opening[0]}${statement}\n${marked.slice(opening[0].length)}`;
  assert(result.startsWith('---'), 'withVariantOverride: the frontmatter fence stays first');
  assert(result.includes(marked.slice(opening === null ? 0 : opening[0].length)), 'withVariantOverride: the marked text is kept whole');
  return result;
}
