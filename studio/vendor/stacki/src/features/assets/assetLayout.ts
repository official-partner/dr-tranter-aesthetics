import { assert } from '../../../shared/core/assert';
import type { AssetView } from './assetOrder';

export interface ViewMetrics {
  readonly tileWidthPxMin: number;
  readonly gapPx: number;
  readonly rowHeightPx: number;
  readonly nameTailChars: number;
}

export const GRID_NAME_BLOCK_PX = 18;

export const VIEW_METRICS = {
  grid: { tileWidthPxMin: 72, gapPx: 8, rowHeightPx: 0, nameTailChars: 5 },
  list: { tileWidthPxMin: 0, gapPx: 2, rowHeightPx: 72, nameTailChars: 12 },
  compact: { tileWidthPxMin: 0, gapPx: 2, rowHeightPx: 56, nameTailChars: 12 },
} as const satisfies Record<AssetView, ViewMetrics>;

export const OVERSCAN_ROWS = 3;

export const VIEWPORT_PX_FALLBACK = 1200;

export interface ItemGeometry {
  readonly columnCount: number;
  readonly rowPitchPx: number;
  readonly tileWidthPx: number;
}

export function itemGeometry(view: AssetView, widthPx: number): ItemGeometry {
  assert(Number.isFinite(widthPx), 'The measured width is a number');
  assert(widthPx >= 0, 'A width is never negative');
  const metrics: ViewMetrics = VIEW_METRICS[view];
  if (view !== 'grid') {
    return { columnCount: 1, rowPitchPx: metrics.rowHeightPx + metrics.gapPx, tileWidthPx: widthPx };
  }
  const columnCount = Math.max(1, Math.floor((widthPx + metrics.gapPx) / (metrics.tileWidthPxMin + metrics.gapPx)));
  const tileWidthPx = Math.max(0, (widthPx - metrics.gapPx * (columnCount - 1)) / columnCount);
  const rowPitchPx = Math.ceil(tileWidthPx + GRID_NAME_BLOCK_PX + metrics.gapPx);
  assert(columnCount >= 1, 'A grid has a column');
  assert(rowPitchPx > 0, 'A grid row has height');
  return { columnCount, rowPitchPx, tileWidthPx };
}

export interface ItemWindow {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly itemStart: number;
  readonly itemEnd: number;
  readonly rowCount: number;
}

export function itemWindow(input: {
  readonly itemCount: number;
  readonly geometry: ItemGeometry;
  readonly viewportTopPx: number;
  readonly viewportHeightPx: number;
}): ItemWindow {
  const { itemCount, geometry } = input;
  assert(Number.isSafeInteger(itemCount), 'The item count is whole');
  assert(itemCount >= 0, 'The item count is not negative');
  const rowCount = Math.ceil(itemCount / geometry.columnCount);
  const viewportHeightPx = input.viewportHeightPx > 0 ? input.viewportHeightPx : VIEWPORT_PX_FALLBACK;
  const firstSeen = Math.floor(Math.max(0, input.viewportTopPx) / geometry.rowPitchPx);
  const lastSeen = Math.ceil(Math.max(0, input.viewportTopPx + viewportHeightPx) / geometry.rowPitchPx);
  const rowStart = Math.min(rowCount, Math.max(0, firstSeen - OVERSCAN_ROWS));
  const rowEnd = Math.min(rowCount, Math.max(rowStart, lastSeen + OVERSCAN_ROWS));
  const itemStart = rowStart * geometry.columnCount;
  const itemEnd = Math.min(itemCount, rowEnd * geometry.columnCount);
  assert(rowStart <= rowEnd, 'The window starts before it ends');
  assert(itemEnd - itemStart <= (rowEnd - rowStart) * geometry.columnCount, 'The window holds only its rows');
  return { rowStart, rowEnd, itemStart, itemEnd, rowCount };
}

export function nextIndex(key: string, index: number, itemCount: number, columnCount: number): number | undefined {
  assert(itemCount > 0, 'Moving needs an item to move to');
  assert(columnCount >= 1, 'A layout has a column');
  const last = itemCount - 1;
  const clamp = (target: number): number => Math.min(last, Math.max(0, target));
  switch (key) {
    case 'ArrowRight':
      return clamp(index + 1);
    case 'ArrowLeft':
      return clamp(index - 1);
    case 'ArrowDown':
      return clamp(index + columnCount);
    case 'ArrowUp':
      return clamp(index - columnCount);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return undefined;
  }
}
