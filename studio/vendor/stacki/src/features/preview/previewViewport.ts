import { assert } from '../../../shared/core/assert';

export const PREVIEW_WIDTH_LIMITS = { minimum: 280, maximum: 7_680 } as const;

export function parsePreviewWidth(input: string): number | undefined {
  if (!/^\d{3,4}$/.test(input.trim())) {
    return undefined;
  }
  const width = Number(input);
  if (width < PREVIEW_WIDTH_LIMITS.minimum || width > PREVIEW_WIDTH_LIMITS.maximum) {
    return undefined;
  }
  return width;
}

const FRAMED_GUTTER_PX = { side: 24, vertical: 32 } as const;
export const FLUID_GUTTER_PX = { side: 18 } as const;

export const FLUID_FRAME_WIDTH = `calc(100% - ${FLUID_GUTTER_PX.side}px)`;

export interface FillBounds {
  readonly widthPxMin: number;
  readonly widthPxMax: number | undefined;
}

export const FILL_UNBOUNDED: FillBounds = { widthPxMin: 0, widthPxMax: undefined };

export function fluidFrameStyle(bounds: FillBounds): { readonly width: string; readonly minWidth?: string; readonly maxWidth?: string } {
  assert(bounds.widthPxMax === undefined || bounds.widthPxMax >= bounds.widthPxMin, 'fluidFrameStyle: the bounds are ordered');
  return {
    width: FLUID_FRAME_WIDTH,
    ...(bounds.widthPxMin > 0 ? { minWidth: `min(100%, ${bounds.widthPxMin}px)` } : {}),
    ...(bounds.widthPxMax === undefined ? {} : { maxWidth: `${bounds.widthPxMax}px` }),
  };
}

export function fluidFrameWidthPx(paneWidthPx: number, bounds: FillBounds): number {
  assert(Number.isFinite(paneWidthPx), 'fluidFrameWidthPx: the pane width is finite');
  const guttered = Math.max(0, paneWidthPx - FLUID_GUTTER_PX.side);
  const floored = Math.max(guttered, Math.min(Math.max(0, paneWidthPx), bounds.widthPxMin));
  const widthPx = bounds.widthPxMax === undefined ? floored : Math.min(floored, bounds.widthPxMax);
  assert(widthPx <= Math.max(0, paneWidthPx), 'fluidFrameWidthPx: the frame never outgrows its pane');
  return widthPx;
}

export function previewViewport(
  width: number | undefined,
  available: { readonly width: number; readonly height: number },
  height: number | undefined,
  bounds: FillBounds = FILL_UNBOUNDED,
) {
  assert(Number.isFinite(available.width), 'Preview container width must be finite');
  assert(Number.isFinite(available.height), 'Preview container height must be finite');
  const fixed = width !== undefined;
  const viewportWidth = fixed ? width : Math.max(1, fluidFrameWidthPx(available.width, bounds));
  assert(viewportWidth > 0, 'Preview width must be positive');
  const scale = fixed ? Math.min(1, Math.max(1, available.width - FRAMED_GUTTER_PX.side) / viewportWidth) : 1;
  const viewportHeight = height ?? Math.max(1, available.height - (fixed ? FRAMED_GUTTER_PX.vertical : 0)) / scale;
  return { width: viewportWidth, height: viewportHeight, scale };
}

export interface PreviewSize {
  readonly width: number;
  readonly height: number;
}
