
import { assert } from '../core/assert';

export const LIVE_RULE_MESSAGE = 'avb:live-rule';

export const LIVE_RULE_LIMITS = {
  entriesMax: 64,
  patchesMax: 32,
  sheetRulesMax: 20_000,
  sourceCharsMax: 1_000,
  selectorCharsMax: 2_000,
  contextMax: 8,
  contextCharsMax: 500,
  propertyCharsMax: 200,
  valueCharsMax: 2_000,
  settleFramesMax: 180,
} as const satisfies Record<string, number>;

export interface LiveRuleTarget {
  readonly source: string;
  readonly context: readonly string[];
  readonly selector: string;
  readonly property: string;
}

export type LiveRuleEdit = { readonly kind: 'value'; readonly value: string; readonly important: boolean } | { readonly kind: 'removed' };

export type LiveRuleMessage =
  | { readonly type: typeof LIVE_RULE_MESSAGE; readonly op: 'set'; readonly rule: LiveRuleTarget; readonly edit: LiveRuleEdit }
  | { readonly type: typeof LIVE_RULE_MESSAGE; readonly op: 'drop'; readonly rule: LiveRuleTarget; readonly until?: LiveRuleEdit | undefined };

export function liveRuleKey(rule: LiveRuleTarget): string {
  const context = rule.context.filter(isConditionAtRule).map(normalizeAtRule);
  const key = [rule.source, ...context, normalizeSelector(rule.selector), rule.property].join('\n');
  assert(key.length > 0, 'liveRuleKey: a key is never empty');
  assert(context.length <= rule.context.length, 'liveRuleKey: context is only ever filtered');
  return key;
}

const VALUE_BREAKOUT = /[{};!]/;
const SELECTOR_BREAKOUT = /[{};]/;
const PROPERTY = /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/;
const AT_RULE = /^@[a-z-]+(?:\s|\(|$)/i;

function fragment(input: unknown, charsMax: number, breakout: RegExp): string | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > charsMax) {
    return undefined;
  }
  if (breakout.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sourceOf(input: unknown): string | undefined {
  const source = fragment(input, LIVE_RULE_LIMITS.sourceCharsMax, /[\0?#\\]/);
  if (source === undefined) {
    return undefined;
  }
  if (source.startsWith('/')) {
    return undefined;
  }
  if (source.split('/').some((segment) => segment === '..' || segment === '')) {
    return undefined;
  }
  assert(source.length <= LIVE_RULE_LIMITS.sourceCharsMax, 'sourceOf: bounded');
  return source;
}

function contextOf(input: unknown): readonly string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const values: readonly unknown[] = input;
  if (values.length > LIVE_RULE_LIMITS.contextMax) {
    return undefined;
  }
  const context: string[] = [];
  for (const value of values) {
    const part = fragment(value, LIVE_RULE_LIMITS.contextCharsMax, SELECTOR_BREAKOUT);
    if (part === undefined) {
      return undefined;
    }
    if (!AT_RULE.test(part)) {
      return undefined;
    }
    context.push(part);
  }
  assert(context.length === values.length, 'contextOf: every entry parsed');
  return context;
}

export function parseLiveRuleTarget(input: unknown): LiveRuleTarget | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const source = 'source' in input ? sourceOf(input.source) : undefined;
  const context = 'context' in input ? contextOf(input.context) : undefined;
  const selector = 'selector' in input ? fragment(input.selector, LIVE_RULE_LIMITS.selectorCharsMax, SELECTOR_BREAKOUT) : undefined;
  const property = 'property' in input ? fragment(input.property, LIVE_RULE_LIMITS.propertyCharsMax, VALUE_BREAKOUT) : undefined;
  if (source === undefined || context === undefined || selector === undefined || property === undefined) {
    return undefined;
  }
  if (!PROPERTY.test(property)) {
    return undefined;
  }
  return { source, context, selector, property };
}

export function parseLiveRuleEdit(input: unknown): LiveRuleEdit | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('kind' in input)) {
    return undefined;
  }
  if (input.kind === 'removed') {
    return { kind: 'removed' };
  }
  if (input.kind !== 'value') {
    return undefined;
  }
  const value = 'value' in input ? fragment(input.value, LIVE_RULE_LIMITS.valueCharsMax, VALUE_BREAKOUT) : undefined;
  if (value === undefined) {
    return undefined;
  }
  if (!('important' in input) || typeof input.important !== 'boolean') {
    return undefined;
  }
  return { kind: 'value', value, important: input.important };
}

export function parseLiveRuleMessage(input: unknown): LiveRuleMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('type' in input) || input.type !== LIVE_RULE_MESSAGE || !('op' in input)) {
    return undefined;
  }
  const rule = 'rule' in input ? parseLiveRuleTarget(input.rule) : undefined;
  if (rule === undefined) {
    return undefined;
  }
  if (input.op === 'set') {
    const edit = 'edit' in input ? parseLiveRuleEdit(input.edit) : undefined;
    return edit === undefined ? undefined : { type: LIVE_RULE_MESSAGE, op: 'set', rule, edit };
  }
  if (input.op !== 'drop') {
    return undefined;
  }
  if (!('until' in input) || input.until === undefined) {
    return { type: LIVE_RULE_MESSAGE, op: 'drop', rule };
  }
  const until = parseLiveRuleEdit(input.until);
  return until === undefined ? undefined : { type: LIVE_RULE_MESSAGE, op: 'drop', rule, until };
}



export const HOVER_STYLE_MESSAGE = 'avb:hover-style';

export const HOVER_STYLE_LIMITS = {
  elementsMax: 64,
  pathCharsMax: 1_000,
  declarationsMax: 8,
  settleFramesMax: 180,
} as const satisfies Record<string, number>;

export interface HoverDeclaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

export type HoverStyleMessage =
  | {
      readonly type: typeof HOVER_STYLE_MESSAGE;
      readonly op: 'show';
      readonly path: string;
      readonly declarations: readonly HoverDeclaration[];
    }
  | { readonly type: typeof HOVER_STYLE_MESSAGE; readonly op: 'clear' }
  | { readonly type: typeof HOVER_STYLE_MESSAGE; readonly op: 'settle' };

export function parseHoverStyleMessage(input: unknown): HoverStyleMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('type' in input) || input.type !== HOVER_STYLE_MESSAGE || !('op' in input)) {
    return undefined;
  }
  if (input.op === 'clear') {
    return { type: HOVER_STYLE_MESSAGE, op: 'clear' };
  }
  if (input.op === 'settle') {
    return { type: HOVER_STYLE_MESSAGE, op: 'settle' };
  }
  if (input.op !== 'show') {
    return undefined;
  }
  const path = 'path' in input ? fragment(input.path, HOVER_STYLE_LIMITS.pathCharsMax, /[\0-\x1f]/) : undefined;
  if (path === undefined) {
    return undefined;
  }
  const declarations = 'declarations' in input ? hoverDeclarationsOf(input.declarations) : undefined;
  if (declarations === undefined) {
    return undefined;
  }
  return { type: HOVER_STYLE_MESSAGE, op: 'show', path, declarations };
}

function hoverDeclarationsOf(input: unknown): readonly HoverDeclaration[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const values: readonly unknown[] = input;
  if (values.length === 0) {
    return undefined;
  }
  if (values.length > HOVER_STYLE_LIMITS.declarationsMax) {
    return undefined;
  }
  const declarations: HoverDeclaration[] = [];
  for (const value of values) {
    const declaration = hoverDeclarationOf(value);
    if (declaration === undefined) {
      return undefined;
    }
    if (declarations.some((known) => known.property === declaration.property)) {
      return undefined;
    }
    declarations.push(declaration);
  }
  assert(declarations.length === values.length, 'hoverDeclarationsOf: every entry parsed');
  return declarations;
}

function hoverDeclarationOf(input: unknown): HoverDeclaration | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const property = 'property' in input ? fragment(input.property, LIVE_RULE_LIMITS.propertyCharsMax, VALUE_BREAKOUT) : undefined;
  if (property === undefined) {
    return undefined;
  }
  if (!PROPERTY.test(property)) {
    return undefined;
  }
  const edit = parseLiveRuleEdit({
    kind: 'value',
    value: 'value' in input ? input.value : undefined,
    important: 'important' in input ? input.important : undefined,
  });
  if (edit === undefined) {
    return undefined;
  }
  assert(edit.kind === 'value', 'hoverDeclarationOf: a value edit parses as one');
  return { property, value: edit.value, important: edit.important };
}


export function isConditionAtRule(prelude: string): boolean {
  return !/^@layer\b/i.test(prelude.trim());
}

export function normalizeAtRule(prelude: string): string {
  const normalized = prelude.replace(/\s+/g, '').toLowerCase();
  assert(normalized.length <= prelude.length, 'normalizeAtRule: only removes');
  assert(!/\s/.test(normalized), 'normalizeAtRule: no spacing left');
  return normalized;
}

export function normalizeSelector(selector: string): string {
  const normalized = selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/(^|[^:]):(before|after|first-line|first-letter)\b/g, '$1::$2')
    .replace(/\[\s*([\w-]+)\s*([~|^$*]?=)\s*([^"'\]\s]+)\s*\]/g, '[$1$2"$3"]')
    .trim();
  assert(!normalized.startsWith(' '), 'normalizeSelector: trimmed at the start');
  assert(!normalized.endsWith(' '), 'normalizeSelector: trimmed at the end');
  return normalized;
}

export type SelectorScope = 'scoped' | 'global';

export function sourceSelectorKey(selector: string): { readonly scope: SelectorScope; readonly selector: string } {
  const trimmed = selector.trim();
  const whole = /^:global\(([^()]*(?:\([^()]*\)[^()]*)*)\)$/.exec(trimmed);
  const unwrapped = trimmed.replace(/:global\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, '$1');
  const key = { scope: whole === null ? ('scoped' as const) : ('global' as const), selector: normalizeSelector(unwrapped) };
  assert(!key.selector.includes(':global('), 'sourceSelectorKey: :global is unwrapped');
  assert(key.selector.length <= trimmed.length + 64, 'sourceSelectorKey: normalizing adds little');
  return key;
}

const SCOPE = /\[data-astro-cid-([a-z0-9]+)\]|:where\(\.astro-([a-z0-9]+)\)/gi;

export function sheetScopeOf(selectors: readonly string[]): string | undefined {
  const scopes = new Set<string>();
  for (const selector of selectors) {
    for (const match of selector.matchAll(SCOPE)) {
      scopes.add((match[1] ?? match[2] ?? '').toLowerCase());
    }
    if (scopes.size > 1) {
      return undefined;
    }
  }
  const [scope] = scopes;
  assert(scopes.size <= 1, 'sheetScopeOf: at most one scope');
  assert(scope === undefined || scope.length > 0, 'sheetScopeOf: a scope is never empty');
  return scope;
}

export function selectorKeyOf(selectorText: string, ownScope: string | undefined): { readonly scope: SelectorScope; readonly selector: string } {
  if (ownScope === undefined) {
    return { scope: 'global', selector: normalizeSelector(selectorText) };
  }
  let found = false;
  const stripped = selectorText.replace(SCOPE, (whole: string, attribute: string | undefined, where: string | undefined) => {
    const scope = (attribute ?? where ?? '').toLowerCase();
    if (scope === ownScope) {
      found = true;
      return '';
    }
    return whole;
  });
  const key = { scope: found ? ('scoped' as const) : ('global' as const), selector: normalizeSelector(stripped) };
  assert(key.selector.length <= selectorText.length + 64, 'selectorKeyOf: normalizing adds little');
  assert(ownScope.length > 0, 'selectorKeyOf: an own scope is never empty');
  return key;
}

export function sheetPathIsSource(sheetPath: string, source: string): boolean {
  assert(source.length > 0, 'sheetPathIsSource: a source is never empty');
  assert(!source.startsWith('/'), 'sheetPathIsSource: a source is project-relative');
  const queryAt = sheetPath.indexOf('?');
  const path = (queryAt < 0 ? sheetPath : sheetPath.slice(0, queryAt)).replace(/\\/g, '/');
  if (path === source) {
    return true;
  }
  if (path.endsWith(`/${source}`)) {
    return true;
  }
  if (source.startsWith('public/')) {
    return path === `/${source.slice('public/'.length)}`;
  }
  return false;
}

export function sheetPathIsAstroStyle(sheetPath: string): boolean {
  const queryAt = sheetPath.indexOf('?');
  if (queryAt < 0) {
    return false;
  }
  const query = new URLSearchParams(sheetPath.slice(queryAt + 1));
  assert(queryAt < sheetPath.length, 'sheetPathIsAstroStyle: the query starts inside the path');
  assert(query instanceof URLSearchParams, 'sheetPathIsAstroStyle: the query parses');
  return sheetPath.slice(0, queryAt).endsWith('.astro') && query.has('astro') && query.get('type') === 'style';
}
