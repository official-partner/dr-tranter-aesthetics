import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { assert } from '../../shared/core/assert';


export const TOOLTIP_DELAY_MS = 500;

export type TooltipAnchor = Pick<DOMRect, 'left' | 'width' | 'top' | 'bottom'>;

const TOOLTIP_GAP_PX = 8;
const TOOLTIP_SIDE_GAP_PX = 10;

export function useDelayedTooltip(): {
  readonly value: TooltipAnchor | undefined;
  readonly show: (event: React.MouseEvent<HTMLElement>) => void;
  readonly hide: () => void;
} {
  const [value, setValue] = useState<TooltipAnchor | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback((event: React.MouseEvent<HTMLElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setValue(tooltipAnchor(rect)), TOOLTIP_DELAY_MS);
  }, []);
  const hide = useCallback((): void => {
    clearTimeout(timer.current);
    setValue(undefined);
  }, []);
  return { value, show, hide };
}

export function tooltipHost(from: Element | undefined): HTMLElement {
  return from?.closest<HTMLElement>('dialog[open]') ?? document.body;
}

export function tooltipAnchor(rect: TooltipAnchor): TooltipAnchor {
  return { left: rect.left, width: rect.width, top: rect.top, bottom: rect.bottom };
}

export function useDelayedPlacement<T>(place: (element: HTMLElement) => T): {
  readonly value: T | undefined;
  readonly show: (element: HTMLElement) => void;
  readonly showNow: (element: HTMLElement) => void;
  readonly hide: () => void;
} {
  const [value, setValue] = useState<T | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback(
    (element: HTMLElement): void => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(place(element)), TOOLTIP_DELAY_MS);
    },
    [place],
  );
  const showNow = useCallback(
    (element: HTMLElement): void => {
      clearTimeout(timer.current);
      setValue(place(element));
    },
    [place],
  );
  const hide = useCallback((): void => {
    clearTimeout(timer.current);
    setValue(undefined);
  }, []);
  return { value, show, showNow, hide };
}

export const TOOLTIP_EDGE_MARGIN_PX = 8;

const TOOLTIP_ARROW_INSET_PX = 14;

export type TooltipSide = 'below' | 'above' | 'right' | 'left';

export interface TooltipFitInput {
  readonly anchor: TooltipAnchor;
  readonly tip: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
  readonly preferred: TooltipSide;
}

export interface TooltipFit {
  readonly side: TooltipSide;
  readonly left: number;
  readonly top: number;
  readonly arrowOffset: number;
}

export function fitTooltip(input: TooltipFitInput): TooltipFit {
  const { anchor, tip, viewport, preferred } = input;
  assert(tip.width >= 0, 'fitTooltip: the tip width is not negative');
  assert(tip.height >= 0, 'fitTooltip: the tip height is not negative');
  assert(viewport.width > 0, 'fitTooltip: the viewport has a width');
  assert(viewport.height > 0, 'fitTooltip: the viewport has a height');
  const vertical = preferred === 'below' || preferred === 'above';
  if (vertical) {
    const spaceBelow = viewport.height - anchor.bottom - TOOLTIP_GAP_PX - TOOLTIP_EDGE_MARGIN_PX;
    const spaceAbove = anchor.top - TOOLTIP_GAP_PX - TOOLTIP_EDGE_MARGIN_PX;
    const side = chooseSide(preferred, 'below', 'above', tip.height, spaceBelow, spaceAbove);
    const along = centredWithin(anchor.left + anchor.width / 2, tip.width, viewport.width);
    const top = side === 'below' ? anchor.bottom + TOOLTIP_GAP_PX : anchor.top - TOOLTIP_GAP_PX - tip.height;
    return { side, left: along.start, top, arrowOffset: along.arrow };
  }
  const spaceRight = viewport.width - anchor.left - anchor.width - TOOLTIP_SIDE_GAP_PX - TOOLTIP_EDGE_MARGIN_PX;
  const spaceLeft = anchor.left - TOOLTIP_SIDE_GAP_PX - TOOLTIP_EDGE_MARGIN_PX;
  const side = chooseSide(preferred, 'right', 'left', tip.width, spaceRight, spaceLeft);
  const along = centredWithin((anchor.top + anchor.bottom) / 2, tip.height, viewport.height);
  const left = side === 'right' ? anchor.left + anchor.width + TOOLTIP_SIDE_GAP_PX : anchor.left - TOOLTIP_SIDE_GAP_PX - tip.width;
  return { side, left, top: along.start, arrowOffset: along.arrow };
}

function chooseSide<T extends TooltipSide>(preferred: TooltipSide, first: T, second: T, size: number, spaceFirst: number, spaceSecond: number): T {
  const preferredSpace = preferred === first ? spaceFirst : spaceSecond;
  const otherSpace = preferred === first ? spaceSecond : spaceFirst;
  const other = preferred === first ? second : first;
  const own = preferred === first ? first : second;
  if (size <= preferredSpace) {
    return own;
  }
  return otherSpace > preferredSpace ? other : own;
}

function centredWithin(centre: number, size: number, extent: number): { readonly start: number; readonly arrow: number } {
  const margin = TOOLTIP_EDGE_MARGIN_PX;
  const startMax = extent - margin - size;
  const start = startMax < margin ? margin : Math.min(Math.max(centre - size / 2, margin), startMax);
  const arrowMax = Math.max(size - TOOLTIP_ARROW_INSET_PX, TOOLTIP_ARROW_INSET_PX);
  return { start, arrow: Math.min(Math.max(centre - start, TOOLTIP_ARROW_INSET_PX), arrowMax) };
}
