import { assert } from '../../shared/core/assert';


export interface FloatingOffset {
  readonly x: number;
  readonly y: number;
}
export interface FloatingBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export interface FloatingViewport {
  readonly width: number;
  readonly height: number;
}

export const FLOATING_OFFSET_NONE: FloatingOffset = { x: 0, y: 0 };
export const FLOATING_EDGE_PX = 8;
export const FLOATING_DRAG_IGNORE_SELECTOR = 'button, input, select, textarea, a, [contenteditable], [role=button]';
export const FLOATING_DRAG_HANDLE_ATTRIBUTE = 'data-floating-drag-handle';

export function clampFloatingOffset(box: FloatingBox, current: FloatingOffset, desired: FloatingOffset, viewport: FloatingViewport): FloatingOffset {
  assert(Number.isFinite(viewport.width), 'Floating viewport width must be finite');
  assert(Number.isFinite(viewport.height), 'Floating viewport height must be finite');
  assert(box.width >= 0, 'Floating box width must not be negative');
  assert(box.height >= 0, 'Floating box height must not be negative');
  assert(Number.isFinite(desired.x), 'Floating horizontal offset must be finite');
  assert(Number.isFinite(desired.y), 'Floating vertical offset must be finite');
  const baseLeft = box.left - current.x;
  const baseTop = box.top - current.y;
  const x = clampAxis(baseLeft + desired.x, box.width, viewport.width) - baseLeft;
  const y = clampAxis(baseTop + desired.y, box.height, viewport.height) - baseTop;
  return { x: Math.round(x), y: Math.round(y) };
}

function clampAxis(start: number, size: number, room: number): number {
  const startMin = FLOATING_EDGE_PX;
  const startMax = room - size - FLOATING_EDGE_PX;
  if (startMin < startMax) {
    return Math.min(Math.max(start, startMin), startMax);
  }
  return startMin;
}
