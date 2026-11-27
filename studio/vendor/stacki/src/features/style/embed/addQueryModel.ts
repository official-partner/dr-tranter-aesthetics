
import { assert } from '../../../../shared/core/assert';
import type { Result } from '../../../../shared/core/result';
import { findWidthBounds, formatNumber } from '../../../../shared/properties/mediaBreakpointSync';
import {
  boundaryPx,
  formatBreakpoint,
  parseBreakpointEntry,
  type BreakpointSetting,
  type ResolvedBreakpoint,
} from '../../../../shared/properties/projectBreakpoints';
import type { LengthUnit } from '../../../../shared/properties/lengthUnit';
import { queryWidthSides } from '../model/queryWidth';

export type QueryDirection = 'up' | 'down';

export const ADD_QUERY_ENTRIES_MAX = 512;

const ROOT_FONT_SIZE_PX = 16;

export function queryFor(setting: BreakpointSetting, direction: QueryDirection): string {
  return `@media (width ${direction === 'up' ? '>=' : '<'} ${formatBreakpoint(setting)})`;
}

export function conditionFor(setting: BreakpointSetting, direction: QueryDirection): string {
  return `width ${direction === 'up' ? '>=' : '<'} ${formatBreakpoint(setting)}`;
}

export function detectConvention(atContexts: readonly string[]): QueryDirection | undefined {
  assert(atContexts.length <= ADD_QUERY_ENTRIES_MAX, 'detectConvention: the context list is bounded');
  let up = 0;
  let down = 0;
  for (const atContext of atContexts) {
    const sides = queryWidthSides(atContext, ROOT_FONT_SIZE_PX);
    if (sides.kind !== 'sides') {
      continue;
    }
    if (sides.lower && !sides.upper) {
      up += 1;
    } else if (sides.upper && !sides.lower) {
      down += 1;
    }
  }
  if (up === down) {
    return undefined;
  }
  return up > down ? 'up' : 'down';
}

export function defaultDirection(atContexts: readonly string[]): QueryDirection {
  return detectConvention(atContexts) ?? 'up';
}

export function existingQueryKey(
  contexts: readonly { readonly key: string; readonly embedAtContext?: string | undefined }[],
  setting: BreakpointSetting,
  direction: QueryDirection,
): string | undefined {
  assert(contexts.length <= ADD_QUERY_ENTRIES_MAX, 'existingQueryKey: the context list is bounded');
  const wanted = boundaryPx(setting);
  for (const context of contexts) {
    const atContext = context.embedAtContext ?? '';
    if (context.key === '' || atContext === '') {
      continue;
    }
    const innermost = (atContext.split(' › ').pop() ?? '').trim();
    const sides = queryWidthSides(atContext, ROOT_FONT_SIZE_PX);
    if (sides.kind !== 'sides') {
      continue;
    }
    const bounds = findWidthBounds(innermost, { lineComments: false });
    const only = bounds.length === 1 ? bounds[0] : undefined;
    if (only === undefined) {
      continue;
    }
    const wantedSide = direction === 'up' ? 'lower' : 'upper';
    const wantedInclusive = direction === 'up';
    if (only.side === wantedSide && only.inclusive === wantedInclusive && Math.abs(boundaryPx({ value: only.value, unit: only.unit }) - wanted) < 1e-6) {
      return context.key;
    }
  }
  return undefined;
}

export interface BreakpointSuggestion {
  readonly breakpoint: ResolvedBreakpoint;
  readonly query: string;
  readonly condition: string;
  readonly existingKey: string | undefined;
}

export function suggestionsFor(
  resolved: readonly ResolvedBreakpoint[],
  direction: QueryDirection,
  contexts: readonly { readonly key: string; readonly embedAtContext?: string | undefined }[],
): BreakpointSuggestion[] {
  assert(resolved.length <= ADD_QUERY_ENTRIES_MAX, 'suggestionsFor: the breakpoint list is bounded');
  return resolved.map((breakpoint) => ({
    breakpoint,
    query: queryFor(breakpoint.setting, direction),
    condition: conditionFor(breakpoint.setting, direction),
    existingKey: existingQueryKey(contexts, breakpoint.setting, direction),
  }));
}

export type CustomQuery =
  | { readonly kind: 'empty' }
  | { readonly kind: 'raw'; readonly query: string }
  | { readonly kind: 'invalid'; readonly code: 'syntax' | 'pxWhole' | 'range' }
  | {
      readonly kind: 'width';
      readonly query: string;
      readonly setting: BreakpointSetting;
      readonly converted: boolean;
      readonly existingKey: string | undefined;
    };

export function parseCustom(
  text: string,
  options: {
    readonly direction: QueryDirection;
    readonly lengthUnit: LengthUnit;
    readonly contexts: readonly { readonly key: string; readonly embedAtContext?: string | undefined }[];
  },
): CustomQuery {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '@') {
    return { kind: 'empty' };
  }
  if (trimmed.startsWith('@')) {
    return { kind: 'raw', query: trimmed };
  }
  const parsed: Result<BreakpointSetting> = parseBreakpointEntry(trimmed);
  if (!parsed.ok) {
    const code = parsed.error.code;
    return { kind: 'invalid', code: code === 'breakpoints-pxWhole' ? 'pxWhole' : code === 'breakpoints-range' ? 'range' : 'syntax' };
  }
  const typed = parsed.value;
  let setting = typed;
  let converted = false;
  if (options.lengthUnit.kind === 'rem' && typed.unit === 'px') {
    setting = { value: Number(formatNumber(typed.value / options.lengthUnit.rootFontPx)), unit: 'rem' };
    converted = true;
  }
  return {
    kind: 'width',
    query: queryFor(setting, options.direction),
    setting,
    converted,
    existingKey: existingQueryKey(options.contexts, setting, options.direction),
  };
}

export function suggestionMatches(suggestion: BreakpointSuggestion, typed: string, name: string): boolean {
  const query = typed.trim().toLowerCase();
  if (query === '' || query.startsWith('@')) {
    return true;
  }
  return `${name} ${formatBreakpoint(suggestion.breakpoint.setting)} ${suggestion.breakpoint.widthPx}`.toLowerCase().includes(query);
}
