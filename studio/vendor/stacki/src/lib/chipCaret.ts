
import { assert } from '../../shared/core/assert';

export interface ChipBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const CHIPS_MAX = 512;

export function caretAtPoint(boxes: readonly ChipBox[], point: Point): number {
  assert(boxes.length <= CHIPS_MAX, 'caretAtPoint: a bounded chip count');
  if (boxes.length === 0) {
    return 0;
  }
  const bottomMax = Math.max(...boxes.map((box) => box.bottom));
  if (point.y > bottomMax) {
    return boxes.length;
  }
  const distances = boxes.map((box) => verticalDistance(box, point.y));
  const distanceMin = Math.min(...distances);
  let lastInRow = -1;
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    const distance = distances[index];
    if (box === undefined || distance === undefined) {
      continue;
    }
    if (distance - distanceMin < 0.5) {
      if (point.x < (box.left + box.right) / 2) {
        return index;
      }
      lastInRow = index;
    }
  }
  assert(lastInRow >= 0, 'caretAtPoint: the nearest row holds a chip');
  return lastInRow + 1;
}

export function caretStep(caret: number, chipCount: number, step: -1 | 1): number {
  assert(Number.isSafeInteger(caret), 'caretStep: the caret is an integer gap');
  assert(chipCount >= 0, 'caretStep: a chip count is not negative');
  return Math.min(Math.max(clampCaret(caret, chipCount) + step, 0), chipCount);
}

export function clampCaret(caret: number, chipCount: number): number {
  assert(chipCount >= 0, 'clampCaret: a chip count is not negative');
  assert(Number.isSafeInteger(caret), 'clampCaret: the caret is an integer gap');
  return Math.min(Math.max(caret, 0), chipCount);
}

function verticalDistance(box: ChipBox, y: number): number {
  if (y < box.top) {
    return box.top - y;
  }
  if (y > box.bottom) {
    return y - box.bottom;
  }
  return 0;
}
