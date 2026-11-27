
import { assert } from '../../../../shared/core/assert';

export function panelBox(anchor: Element): HTMLElement | undefined {
  return anchor.closest<HTMLElement>('.app_body') ?? anchor.closest<HTMLElement>('.embed-editor_root') ?? undefined;
}

export function panelBounds(anchor: Element): DOMRect {
  const box = panelBox(anchor);
  return (box ?? document.documentElement).getBoundingClientRect();
}

export function panelSpan(anchor: Element): { left: number; width: number } {
  const box = panelBox(anchor);
  if (box) {
    const bounds = box.getBoundingClientRect();
    return { left: bounds.left, width: bounds.width };
  }
  const root = getComputedStyle(document.documentElement);
  const left = parseFloat(root.getPropertyValue('--style-panel-left'));
  const width = parseFloat(root.getPropertyValue('--style-panel-width'));
  if (Number.isFinite(left) && Number.isFinite(width) && width > 0) {
    return { left, width };
  }
  return { left: 0, width: window.innerWidth };
}

export const MENU_EDGE_MARGIN_PX = 8;

export function menuPlacement(input: {
  readonly anchorLeftPx: number;
  readonly menuWidthPx: number;
  readonly boundsLeftPx: number;
  readonly boundsRightPx: number;
}): { readonly shiftPx: number } {
  assert(Number.isFinite(input.anchorLeftPx), 'menuPlacement: the anchor has a position');
  assert(input.menuWidthPx >= 0, 'menuPlacement: a menu width is not negative');
  assert(input.boundsLeftPx <= input.boundsRightPx, 'menuPlacement: the panel has a width');
  const leftLimitPx = input.boundsLeftPx + MENU_EDGE_MARGIN_PX;
  const rightLimitPx = input.boundsRightPx - MENU_EDGE_MARGIN_PX;
  const naturalRightPx = input.anchorLeftPx + input.menuWidthPx;
  const pullLeftPx = naturalRightPx > rightLimitPx ? rightLimitPx - naturalRightPx : 0;
  const shiftPx = input.anchorLeftPx + pullLeftPx < leftLimitPx ? leftLimitPx - input.anchorLeftPx : pullLeftPx;
  assert(Number.isFinite(shiftPx), 'menuPlacement: the shift is a number');
  return { shiftPx };
}

export function menuWidthMaxPx(bounds: { readonly left: number; readonly right: number }): number {
  assert(bounds.left <= bounds.right, 'menuWidthMaxPx: the panel has a width');
  const widthPx = Math.max(0, bounds.right - bounds.left - 2 * MENU_EDGE_MARGIN_PX);
  assert(widthPx >= 0, 'menuWidthMaxPx: a width is not negative');
  return widthPx;
}
