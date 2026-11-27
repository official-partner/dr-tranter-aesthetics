import { assert } from '../../../shared/core/assert';
import { DATA_TREE_HEIGHT_PX_MAX, DATA_TREE_WIDTH_PX_MIN } from '../../ui/DataTree';
import type { FieldPosition } from './bindingTypes';


export const DATA_PICKER_WIDTH_PX_MIN = DATA_TREE_WIDTH_PX_MIN;
export const DATA_PICKER_HEIGHT_PX_MAX = DATA_TREE_HEIGHT_PX_MAX;
const VIEWPORT_GUTTER_PX = 8;
const TOP_PX_MIN = 60;

export interface AnchorBounds {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
}
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export function dataPickerPosition(
  anchor: AnchorBounds,
  options: { readonly heightPxMax?: number; readonly widthPxMin?: number; readonly viewport?: ViewportSize } = {},
): Required<FieldPosition> {
  const viewport = options.viewport ?? { width: window.innerWidth, height: window.innerHeight };
  const heightPxMax = options.heightPxMax ?? DATA_PICKER_HEIGHT_PX_MAX;
  assert(Number.isFinite(anchor.left), 'dataPickerPosition: anchor left must be finite');
  assert(anchor.width >= 0, 'dataPickerPosition: anchor width must not be negative');
  assert(heightPxMax > 0, 'dataPickerPosition: height must be positive');
  const widthPxRoom = Math.max(0, viewport.width - VIEWPORT_GUTTER_PX * 2);
  const width = Math.min(Math.max(anchor.width, options.widthPxMin ?? DATA_PICKER_WIDTH_PX_MIN), widthPxRoom);
  const leftPxMax = viewport.width - VIEWPORT_GUTTER_PX - width;
  const left = Math.max(VIEWPORT_GUTTER_PX, Math.min(anchor.left, leftPxMax));
  const top = Math.min(anchor.bottom + 4, Math.max(TOP_PX_MIN, viewport.height - heightPxMax));
  assert(width <= widthPxRoom, 'dataPickerPosition: picker wider than the window');
  return { left, top, width };
}

export function popupHeightPxMax(top: number, heightPxMax: number, viewport: ViewportSize = { width: window.innerWidth, height: window.innerHeight }): number {
  assert(heightPxMax > 0, 'popupHeightPxMax: a pop-up asks for a positive height');
  assert(Number.isFinite(top), 'popupHeightPxMax: the top is a position');
  const room = Math.max(0, Math.floor(viewport.height - VIEWPORT_GUTTER_PX - top));
  return Math.min(heightPxMax, room);
}
