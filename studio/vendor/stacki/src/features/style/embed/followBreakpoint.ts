
import { assert } from '../../../../shared/core/assert';
import type { ResolvedBreakpoint } from '../../../../shared/properties/projectBreakpoints';
import { detectConvention, existingQueryKey, queryFor, ADD_QUERY_ENTRIES_MAX } from './addQueryModel';

export interface FollowBreakpointContext {
  readonly key: string;
  readonly embedAtContext?: string | undefined;
}

export interface FollowBreakpoint {
  readonly breakpointId: string;
  readonly query: string;
  readonly existingKey: string | undefined;
}

export function desktopFirst(contexts: readonly FollowBreakpointContext[], breakpoints: readonly Pick<ResolvedBreakpoint, 'direction'>[]): boolean {
  assert(contexts.length <= ADD_QUERY_ENTRIES_MAX, 'desktopFirst: the context list is bounded');
  const convention = detectConvention(contexts.map((context) => context.embedAtContext ?? ''));
  if (convention === 'up') {
    return false;
  }
  if (convention === 'down') {
    return true;
  }
  return breakpoints.some((breakpoint) => breakpoint.direction === 'down');
}

export function followBreakpoint(
  contexts: readonly FollowBreakpointContext[],
  widthPx: number,
  breakpoints: readonly ResolvedBreakpoint[],
): FollowBreakpoint | undefined {
  assert(Number.isFinite(widthPx), 'followBreakpoint: a canvas width is a number');
  assert(breakpoints.length <= ADD_QUERY_ENTRIES_MAX, 'followBreakpoint: the breakpoint list is bounded');
  if (!desktopFirst(contexts, breakpoints)) {
    return undefined;
  }
  let narrowest: ResolvedBreakpoint | undefined;
  for (const breakpoint of breakpoints) {
    if (breakpoint.direction !== 'down') {
      continue;
    }
    if (widthPx > breakpoint.widthPx) {
      continue;
    }
    if (narrowest === undefined || breakpoint.widthPx < narrowest.widthPx) {
      narrowest = breakpoint;
    }
  }
  if (narrowest === undefined) {
    return undefined;
  }
  return {
    breakpointId: narrowest.id,
    query: queryFor(narrowest.setting, 'down'),
    existingKey: existingQueryKey(contexts, narrowest.setting, 'down'),
  };
}
