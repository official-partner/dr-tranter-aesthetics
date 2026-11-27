
import { assert } from '../../../../shared/core/assert';
import { canvasWidthForQuery, QUERY_WIDTH_LIMITS, queryWidthSides } from './queryWidth';

export type BaseCanvasTarget = { readonly kind: 'width'; readonly widthPx: number } | { readonly kind: 'desktop' } | { readonly kind: 'keep' };

export const BASE_WIDTH_QUERIES_MAX = 256;

export function baseCanvasTarget(atContexts: readonly string[], rootFontSizePx: number): BaseCanvasTarget {
  assert(rootFontSizePx > 0, 'baseCanvasTarget: a root font size is positive');
  const lowerWidths: number[] = [];
  const upperWidths: number[] = [];
  for (const atContext of atContexts.slice(0, BASE_WIDTH_QUERIES_MAX)) {
    if (atContext === '') {
      continue;
    }
    const sides = queryWidthSides(atContext, rootFontSizePx);
    if (sides.kind === 'none') {
      if (sides.reason === 'not-media' || sides.reason === 'no-width') {
        continue;
      }
      return { kind: 'desktop' };
    }
    if (sides.lower && sides.upper) {
      return { kind: 'desktop' };
    }
    const boundary = canvasWidthForQuery(atContext, rootFontSizePx);
    if (boundary.kind === 'none') {
      return { kind: 'desktop' };
    }
    if (sides.lower) {
      lowerWidths.push(boundary.widthPx);
    } else {
      upperWidths.push(boundary.widthPx);
    }
  }
  if (lowerWidths.length > 0 && upperWidths.length > 0) {
    return { kind: 'desktop' };
  }
  if (lowerWidths.length > 0) {
    return insideCanvas(Math.min(...lowerWidths) - 1);
  }
  if (upperWidths.length > 0) {
    return insideCanvas(Math.max(...upperWidths) + 1);
  }
  return { kind: 'desktop' };
}

function insideCanvas(widthPx: number): BaseCanvasTarget {
  assert(Number.isSafeInteger(widthPx), 'baseCanvasTarget: a width is whole pixels');
  if (widthPx < QUERY_WIDTH_LIMITS.widthPxMin) {
    return { kind: 'keep' };
  }
  if (widthPx > QUERY_WIDTH_LIMITS.widthPxMax) {
    return { kind: 'keep' };
  }
  return { kind: 'width', widthPx };
}
