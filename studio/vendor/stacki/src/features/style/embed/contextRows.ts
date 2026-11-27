
import { assert } from '../../../../shared/core/assert';
import { classifyBound, findWidthBounds, type WidthBound } from '../../../../shared/properties/mediaBreakpointSync';
import { activeDeviceFor, deviceIconOf, type DeviceIconKind } from '../../../../shared/properties/breakpointIcon';
import { boundaryPx, formatBreakpoint, type ResolvedBreakpoint } from '../../../../shared/properties/projectBreakpoints';
import { queryWidthMatch, queryWidthSides } from '../model/queryWidth';

export const CONTEXT_ROWS_MAX = 512;

const ROOT_FONT_SIZE_PX = 16;

export type ConditionKind =
  | {
      readonly kind: 'width';
      readonly condition: string;
      readonly direction: 'up' | 'down';
      readonly boundaryPx: number;
      readonly breakpoint: ResolvedBreakpoint | undefined;
    }
  | { readonly kind: 'other' };

export function describeCondition(atContext: string, resolved: readonly ResolvedBreakpoint[]): ConditionKind {
  const sides = queryWidthSides(atContext, ROOT_FONT_SIZE_PX);
  if (sides.kind !== 'sides') {
    return { kind: 'other' };
  }
  const innermost = (atContext.split(' › ').pop() ?? '').trim();
  const bounds = findWidthBounds(innermost, { lineComments: false });
  if (bounds.length === 0) {
    return { kind: 'other' };
  }
  const direction = sides.upper ? 'down' : 'up';
  const single = bounds.length === 1 ? bounds[0] : undefined;
  const breakpoint = single === undefined ? undefined : breakpointOf(single, resolved);
  const condition =
    breakpoint === undefined ? lowerFirst(bounds).map(symbolic).join(', ') : `${direction === 'up' ? '≥' : '<'} ${formatBreakpoint(breakpoint.setting)}`;
  const ordering = direction === 'down' ? bounds.filter((bound) => bound.side === 'upper') : bounds;
  const reference = ordering.map(pixelsOf).reduce((smallest, next) => Math.min(smallest, next), Number.POSITIVE_INFINITY);
  assert(Number.isFinite(reference), 'describeCondition: a width query has a boundary');
  return { kind: 'width', condition, direction, boundaryPx: reference, breakpoint };
}

export interface CanvasDevice {
  readonly device: string;
  readonly widthPx: number | undefined;
}

export function canvasTriggerIcon(atContext: string, canvas: CanvasDevice, resolved: readonly ResolvedBreakpoint[]): DeviceIconKind | undefined {
  assert(canvas.device.length > 0, 'canvasTriggerIcon: the canvas device is named');
  assert(resolved.length <= CONTEXT_ROWS_MAX, 'canvasTriggerIcon: the breakpoint list is bounded');
  if (canvas.widthPx === undefined) {
    return undefined;
  }
  if (canvas.device === 'canvas') {
    return undefined;
  }
  if (queryWidthMatch(atContext, canvas.widthPx, ROOT_FONT_SIZE_PX).kind === 'match') {
    return deviceIconOf(activeDeviceFor(canvas.device, canvas.widthPx, resolved), resolved);
  }
  return undefined;
}

function breakpointOf(bound: WidthBound, resolved: readonly ResolvedBreakpoint[]): ResolvedBreakpoint | undefined {
  const matching = resolved.filter((breakpoint) => classifyBound(bound, breakpoint) !== undefined);
  const sameSide = bound.side === 'lower' ? 'up' : 'down';
  return matching.find((breakpoint) => breakpoint.direction === sameSide) ?? matching[0];
}

function lowerFirst(bounds: readonly WidthBound[]): WidthBound[] {
  return [...bounds].sort((left, right) => (left.side === right.side ? 0 : left.side === 'lower' ? -1 : 1));
}

function symbolic(bound: WidthBound): string {
  const symbol = bound.side === 'lower' ? (bound.inclusive ? '≥' : '>') : bound.inclusive ? '≤' : '<';
  return `${symbol} ${bound.value}${bound.unit}`;
}

function pixelsOf(bound: WidthBound): number {
  return boundaryPx({ value: bound.value, unit: bound.unit });
}

export interface OrderedCondition {
  readonly index: number;
  readonly condition: ConditionKind;
}

export function orderByBar<T extends OrderedCondition>(items: readonly T[]): T[] {
  assert(items.length <= CONTEXT_ROWS_MAX, 'orderByBar: a context list is bounded');
  const widths = items.filter((item) => item.condition.kind === 'width');
  const rank = (item: T): number => (item.condition.kind === 'width' && item.condition.direction === 'up' ? 0 : 1);
  const boundary = (item: T): number => (item.condition.kind === 'width' ? item.condition.boundaryPx : 0);
  return [...widths].sort((left, right) => rank(left) - rank(right) || boundary(right) - boundary(left) || left.index - right.index);
}
