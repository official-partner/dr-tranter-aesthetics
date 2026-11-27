import { assert } from '../../../shared/core/assert';

export type EditorLayout = 'docked' | 'collapsed';

export const CANVAS_WIDTH_PX_MIN = 600;

export const CANVAS_WIDTH_PX_HYSTERESIS = 48;

const LAYOUT_WIDTH_PX_MAX = 100_000;

export interface EditorLayoutInput {
  readonly previous: EditorLayout;
  readonly viewportWidthPx: number;
  readonly dockedWidthPx: number;
}

export function editorLayoutFor(input: EditorLayoutInput): EditorLayout {
  assertLayoutWidth(input.viewportWidthPx, 'Viewport width');
  assertLayoutWidth(input.dockedWidthPx, 'Docked panel width');
  const canvasWidthPx = input.viewportWidthPx - input.dockedWidthPx;
  switch (input.previous) {
    case 'docked':
      if (canvasWidthPx < CANVAS_WIDTH_PX_MIN) {
        return 'collapsed';
      }
      return 'docked';
    case 'collapsed':
      if (canvasWidthPx < CANVAS_WIDTH_PX_MIN + CANVAS_WIDTH_PX_HYSTERESIS) {
        return 'collapsed';
      }
      return 'docked';
    default: {
      const exhaustive: never = input.previous;
      throw new Error(`Assertion failed: unknown editor layout ${String(exhaustive)}`);
    }
  }
}

function assertLayoutWidth(widthPx: number, name: string): void {
  assert(Number.isFinite(widthPx), `${name} must be finite`);
  assert(widthPx >= 0, `${name} must not be negative`);
  assert(widthPx <= LAYOUT_WIDTH_PX_MAX, `${name} exceeds the layout limit`);
}
