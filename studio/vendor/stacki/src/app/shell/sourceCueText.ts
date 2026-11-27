
import { assert } from '../../../shared/core/assert';

export const SOURCE_CUE_CHARS_MAX = 56;

export function truncateStart(text: string, max: number): string {
  assert(Number.isSafeInteger(max), 'truncateStart: max is a safe integer');
  assert(max >= 2, 'truncateStart: room for an ellipsis and a character');
  if (text.length <= max) {
    return text;
  }
  const out = `…${text.slice(text.length - (max - 1))}`;
  assert(out.length === max, 'truncateStart: the cut text is exactly max long');
  return out;
}

export function sourceCuePath(file: string, expression: string): string {
  return truncateStart(file === '' ? expression : `${file} › ${expression}`, SOURCE_CUE_CHARS_MAX);
}

export const SOURCE_CUE_GAP_PX = 6;
export const SOURCE_CUE_MARGIN_PX = 8;
interface SourceCueRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface SourceCueSize {
  readonly width: number;
  readonly height: number;
}

export function sourceCuePlace(box: SourceCueRect, cue: SourceCueSize, view: SourceCueSize): { readonly left: number; readonly top: number } {
  assert(cue.width >= 0, 'sourceCuePlace: the cue has a width');
  assert(cue.height >= 0, 'sourceCuePlace: the cue has a height');
  assert(view.height >= 0, 'sourceCuePlace: the window has a height');
  const leftMax = Math.max(SOURCE_CUE_MARGIN_PX, view.width - cue.width - SOURCE_CUE_MARGIN_PX);
  const left = Math.min(Math.max(SOURCE_CUE_MARGIN_PX, box.x), leftMax);
  const below = box.y + box.h + SOURCE_CUE_GAP_PX;
  const bottomMax = view.height - SOURCE_CUE_MARGIN_PX;
  if (below + cue.height <= bottomMax) {
    return { left, top: below };
  }
  const above = box.y - SOURCE_CUE_GAP_PX - cue.height;
  if (above >= SOURCE_CUE_MARGIN_PX) {
    return { left, top: above };
  }
  const pinned = Math.max(SOURCE_CUE_MARGIN_PX, bottomMax - cue.height);
  assert(pinned >= SOURCE_CUE_MARGIN_PX, 'sourceCuePlace: the pinned cue starts inside the window');
  return { left, top: pinned };
}
