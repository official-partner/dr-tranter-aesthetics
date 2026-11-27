
import { assert } from '../../shared/core/assert';
import {
  CANVAS_SCROLLBAR_CSS,
  CANVAS_SCROLLBAR_LIMITS,
  pageScrollMessage,
  parseCanvasScrollbarMessage,
  parsePageScrollToMessage,
  type PageScroll,
} from '../../shared/properties/canvasScrollbar';

const STYLE_ID = 'avb-canvas-scrollbar';
const SCROLLING_OVERFLOWS: readonly string[] = ['auto', 'scroll', 'overlay'];

let told = false;
let post: ((message: unknown) => void) | undefined = undefined;
let reportScheduled = false;
let lastReport: PageScroll | undefined = undefined;

export function installPageScrollReport(send: (message: unknown) => void): void {
  if (post !== undefined) {
    return;
  }
  post = send;
  document.addEventListener('scroll', scheduleReport, { capture: true, passive: true });
  window.addEventListener('resize', scheduleReport);
  window.addEventListener('load', scheduleReport);
  document.addEventListener('avb:morphed', scheduleReport);
  observeRootWhenReady();
  scheduleReport();
  assert(post === send, 'installPageScrollReport: reports go to the sender');
}

function observeRootWhenReady(): void {
  if (typeof ResizeObserver !== 'function') {
    return;
  }
  const observer = new ResizeObserver(scheduleReport);
  let observed = false;
  const observe = (): void => {
    const root = document.documentElement;
    if (observed || root === null) {
      return;
    }
    observer.observe(root);
    observed = true;
  };
  observe();
  document.addEventListener('readystatechange', observe);
  window.addEventListener('DOMContentLoaded', observe);
}

export function receiveCanvasScrollbar(input: unknown): boolean {
  if (parseCanvasScrollbarMessage(input) !== undefined) {
    hidePageScrollbar();
    return true;
  }
  const scrollTo = parsePageScrollToMessage(input);
  if (scrollTo !== undefined) {
    scrollPageTo(scrollTo.topPx);
    scheduleReport();
    return true;
  }
  return false;
}

export function pageScrollNow(): PageScroll | undefined {
  const root = scrollRoot();
  if (root === undefined) {
    return undefined;
  }
  const viewHeightPx = bodyIsRoot(root) ? root.clientHeight : window.innerHeight;
  const scroll = {
    topPx: clampPagePx(root.scrollTop),
    heightPx: clampPagePx(root.scrollHeight),
    viewHeightPx: clampPagePx(viewHeightPx),
    chromium: !told,
  };
  assert(scroll.topPx >= 0, 'pageScrollNow: never above the page');
  assert(scroll.viewHeightPx >= 0, 'pageScrollNow: a view has a height');
  return scroll;
}

function scrollRoot(): Element | undefined {
  const root = document.scrollingElement ?? document.documentElement;
  if (root === null) {
    return undefined;
  }
  const body = document.body;
  if (body === null) {
    return root;
  }
  if (body === root) {
    return root;
  }
  if (root.scrollHeight > root.clientHeight) {
    return root;
  }
  return bodyScrolls(body) ? body : root;
}

function scrollPageTo(topPx: number): void {
  const root = scrollRoot();
  if (root === undefined) {
    return;
  }
  if (bodyIsRoot(root)) {
    root.scrollTo({ top: topPx, behavior: 'instant' });
  } else {
    window.scrollTo({ top: topPx, behavior: 'instant' });
  }
}

export function scrollPageBy(deltaPx: number): boolean {
  assert(Number.isFinite(deltaPx), 'scrollPageBy: a finite distance');
  const root = scrollRoot();
  if (root === undefined) {
    return false;
  }
  const before = root.scrollTop;
  scrollPageTo(before + deltaPx);
  return root.scrollTop !== before;
}

function bodyIsRoot(root: Element): boolean {
  if (root === document.body) {
    return root !== document.scrollingElement;
  }
  return false;
}

function bodyScrolls(body: HTMLElement): boolean {
  if (body.scrollHeight > body.clientHeight) {
    return SCROLLING_OVERFLOWS.includes(window.getComputedStyle(body).overflowY);
  }
  return false;
}

function hidePageScrollbar(): void {
  const style = styleElement();
  if (style === undefined) {
    return;
  }
  if (style.textContent !== CANVAS_SCROLLBAR_CSS) {
    style.textContent = CANVAS_SCROLLBAR_CSS;
  }
  told = true;
  assert(style.textContent === CANVAS_SCROLLBAR_CSS, 'hidePageScrollbar: the frame draws no bar of its own');
  scheduleReport();
}

function styleElement(): HTMLStyleElement | undefined {
  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }
  const parent = document.head ?? document.documentElement;
  if (parent === null) {
    return undefined;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  parent.appendChild(style);
  return style;
}

function scheduleReport(): void {
  if (reportScheduled) {
    return;
  }
  reportScheduled = true;
  requestAnimationFrame(report);
}

function report(): void {
  reportScheduled = false;
  const send = post;
  if (send === undefined) {
    return;
  }
  const scroll = pageScrollNow();
  if (scroll === undefined) {
    return;
  }
  if (lastReport !== undefined && sameScroll(lastReport, scroll)) {
    return;
  }
  lastReport = scroll;
  send(pageScrollMessage(scroll));
}

function sameScroll(previous: PageScroll, next: PageScroll): boolean {
  if (previous.topPx !== next.topPx) {
    return false;
  }
  if (previous.heightPx !== next.heightPx) {
    return false;
  }
  if (previous.viewHeightPx !== next.viewHeightPx) {
    return false;
  }
  return previous.chromium === next.chromium;
}

function clampPagePx(value: number): number {
  if (Number.isFinite(value)) {
    return Math.min(CANVAS_SCROLLBAR_LIMITS.pagePxMax, Math.max(0, value));
  }
  return 0;
}
