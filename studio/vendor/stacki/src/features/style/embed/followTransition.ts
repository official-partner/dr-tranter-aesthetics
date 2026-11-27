
import { assert } from '../../../../shared/core/assert';
import type { ResolvedBreakpoint } from '../../../../shared/properties/projectBreakpoints';
import { baseCanvasTarget } from '../model/baseWidth';
import { FOLLOW_CONTEXTS_MAX, type FollowContext } from '../model/followWidth';
import { canvasWidthForQuery } from '../model/queryWidth';
import { describeCondition } from './contextRows';

export interface FollowState {
  readonly following: boolean;
  readonly targetIsBase: boolean;
}

export type RowPlacement = { readonly kind: 'width'; readonly widthPx: number } | { readonly kind: 'desktop' } | { readonly kind: 'none' };

export type FollowAction =
  | { readonly kind: 'toggle' }
  | {
      readonly kind: 'pick';
      readonly holdsAtCanvas: boolean;
      readonly placement: RowPlacement;
    };

export interface FollowOutcome {
  readonly following: boolean;
  readonly target: 'keep' | 'base' | 'row' | 'matched';
  readonly canvas: 'keep' | 'move';
}

export function followTransition(state: FollowState, action: FollowAction): FollowOutcome {
  switch (action.kind) {
    case 'toggle':
      if (state.following) {
        return { following: false, target: state.targetIsBase ? 'keep' : 'base', canvas: 'keep' };
      }
      return { following: true, target: 'matched', canvas: 'keep' };
    case 'pick':
      return pickOutcome(state, action);
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

function pickOutcome(state: FollowState, action: Extract<FollowAction, { readonly kind: 'pick' }>): FollowOutcome {
  if (action.holdsAtCanvas) {
    return { following: true, target: 'row', canvas: 'keep' };
  }
  if (state.following) {
    if (action.placement.kind === 'none') {
      return { following: false, target: 'row', canvas: 'keep' };
    }
    return { following: true, target: 'row', canvas: 'move' };
  }
  return { following: false, target: 'row', canvas: 'keep' };
}

export function rowPlacement(
  row: FollowContext,
  rows: readonly FollowContext[],
  breakpoints: readonly ResolvedBreakpoint[],
  rootFontSizePx: number,
  followKeyAt: (widthPx: number) => string,
): RowPlacement {
  assert(rows.length <= FOLLOW_CONTEXTS_MAX, 'rowPlacement: the row list is within its bound');
  assert(rootFontSizePx > 0, 'rowPlacement: a root font size is positive');
  const atContext = row.embedAtContext ?? '';
  if (row.key === '') {
    const base = baseCanvasTarget(
      rows.map((entry) => entry.embedAtContext ?? ''),
      rootFontSizePx,
    );
    switch (base.kind) {
      case 'width':
        return followKeyAt(base.widthPx) === '' ? base : { kind: 'desktop' };
      case 'desktop':
        return base;
      case 'keep':
        return { kind: 'none' };
      default: {
        const exhaustive: never = base;
        return exhaustive;
      }
    }
  }
  if (atContext === '') {
    return { kind: 'none' };
  }
  const condition = describeCondition(atContext, breakpoints);
  if (condition.kind !== 'width') {
    return { kind: 'none' };
  }
  if (condition.breakpoint === undefined) {
    return { kind: 'none' };
  }
  const own = canvasWidthForQuery(atContext, rootFontSizePx);
  const candidates = own.kind === 'width' ? [condition.breakpoint.widthPx, own.widthPx] : [condition.breakpoint.widthPx];
  for (const widthPx of candidates) {
    if (followKeyAt(widthPx) === row.key) {
      assert(Number.isSafeInteger(widthPx), 'rowPlacement: a canvas width is whole pixels');
      return { kind: 'width', widthPx };
    }
  }
  return { kind: 'none' };
}
