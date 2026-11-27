
import { assert } from '../core/assert';

export const CANVAS_SCROLLBAR_MESSAGE = 'avb:canvas-scrollbar';
export const PAGE_SCROLL_MESSAGE = 'avb:page-scroll';
export const PAGE_SCROLL_TO_MESSAGE = 'avb:page-scroll-to';

export const CANVAS_SCROLLBAR_LIMITS = {
  pagePxMax: 10_000_000,
  thumbScreenPxMin: 24,
} as const satisfies Record<string, number>;

export const CANVAS_SCROLLBAR_CSS = 'html, body { scrollbar-width: none !important; }';


export interface CanvasScrollbarMessage {
  readonly type: typeof CANVAS_SCROLLBAR_MESSAGE;
}

export function canvasScrollbarMessage(): CanvasScrollbarMessage {
  const message: CanvasScrollbarMessage = { type: CANVAS_SCROLLBAR_MESSAGE };
  assert(parseCanvasScrollbarMessage(message) !== undefined, 'canvasScrollbarMessage: the message parses');
  return message;
}

export function parseCanvasScrollbarMessage(input: unknown): CanvasScrollbarMessage | undefined {
  if (messageOfType(input, CANVAS_SCROLLBAR_MESSAGE)) {
    return { type: CANVAS_SCROLLBAR_MESSAGE };
  }
  return undefined;
}


export interface PageScroll {
  readonly topPx: number;
  readonly heightPx: number;
  readonly viewHeightPx: number;
  readonly chromium: boolean;
}

export interface PageScrollMessage extends PageScroll {
  readonly type: typeof PAGE_SCROLL_MESSAGE;
}

export function pageScrollMessage(scroll: PageScroll): PageScrollMessage {
  const message = { type: PAGE_SCROLL_MESSAGE, ...scroll } as const;
  assert(parsePageScrollMessage(message) !== undefined, 'pageScrollMessage: the message parses');
  return message;
}

export function parsePageScrollMessage(input: unknown): PageScrollMessage | undefined {
  if (!messageOfType(input, PAGE_SCROLL_MESSAGE)) {
    return undefined;
  }
  const topPx = pagePx(Reflect.get(input, 'topPx'));
  const heightPx = pagePx(Reflect.get(input, 'heightPx'));
  const viewHeightPx = pagePx(Reflect.get(input, 'viewHeightPx'));
  const chromium: unknown = Reflect.get(input, 'chromium');
  if (topPx === undefined || heightPx === undefined || viewHeightPx === undefined) {
    return undefined;
  }
  if (typeof chromium !== 'boolean') {
    return undefined;
  }
  return { type: PAGE_SCROLL_MESSAGE, topPx, heightPx, viewHeightPx, chromium };
}


export interface PageScrollToMessage {
  readonly type: typeof PAGE_SCROLL_TO_MESSAGE;
  readonly topPx: number;
}

export function pageScrollToMessage(topPx: number): PageScrollToMessage {
  const message = { type: PAGE_SCROLL_TO_MESSAGE, topPx } as const;
  assert(parsePageScrollToMessage(message) !== undefined, 'pageScrollToMessage: the message parses');
  return message;
}

export function parsePageScrollToMessage(input: unknown): PageScrollToMessage | undefined {
  if (!messageOfType(input, PAGE_SCROLL_TO_MESSAGE)) {
    return undefined;
  }
  const topPx = pagePx(Reflect.get(input, 'topPx'));
  return topPx === undefined ? undefined : { type: PAGE_SCROLL_TO_MESSAGE, topPx };
}


export interface ScrollThumb {
  readonly offsetPx: number;
  readonly lengthPx: number;
}

export function scrollThumb(scroll: Pick<PageScroll, 'topPx' | 'heightPx' | 'viewHeightPx'>, trackPx: number, lengthPxMin: number): ScrollThumb | undefined {
  assert(trackPx >= 0, 'scrollThumb: a track has a length');
  assert(lengthPxMin >= 0, 'scrollThumb: a thumb has a length');
  const rangePx = scroll.heightPx - scroll.viewHeightPx;
  if (rangePx > 0) {
    const lengthPx = Math.min(trackPx, Math.max(lengthPxMin, (trackPx * scroll.viewHeightPx) / scroll.heightPx));
    const share = Math.min(1, Math.max(0, scroll.topPx / rangePx));
    const thumb = { offsetPx: (trackPx - lengthPx) * share, lengthPx };
    assert(thumb.offsetPx + thumb.lengthPx <= trackPx + 1e-6, 'scrollThumb: the thumb stays on its track');
    return thumb;
  }
  return undefined;
}

export function scrollTopForThumb(scroll: Pick<PageScroll, 'heightPx' | 'viewHeightPx'>, trackPx: number, lengthPxMin: number, offsetPx: number): number {
  const rangePx = Math.max(0, scroll.heightPx - scroll.viewHeightPx);
  const thumb = scrollThumb({ topPx: 0, ...scroll }, trackPx, lengthPxMin);
  if (thumb === undefined) {
    return 0;
  }
  const travelPx = trackPx - thumb.lengthPx;
  if (travelPx > 0) {
    const topPx = (Math.min(travelPx, Math.max(0, offsetPx)) / travelPx) * rangePx;
    assert(topPx >= 0, 'scrollTopForThumb: never above the page');
    assert(topPx <= rangePx, 'scrollTopForThumb: never past the page');
    return topPx;
  }
  return 0;
}


function messageOfType(input: unknown, type: string): input is object {
  if (typeof input !== 'object' || input === null) {
    return false;
  }
  return Reflect.get(input, 'type') === type;
}

function pagePx(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return undefined;
  }
  if (input < 0) {
    return undefined;
  }
  return input <= CANVAS_SCROLLBAR_LIMITS.pagePxMax ? input : undefined;
}
