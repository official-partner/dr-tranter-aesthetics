import { assert } from '../../shared/core/assert';
import { canvasPressStaysClick, pressedCanvasBox } from './frameCanvasPress';
import { isCanvasSitePage, type CanvasInteraction, type CanvasSitePages } from '../../shared/properties/canvasInteraction';


let canvas = location.hash.includes('avb-design');
let mode: CanvasInteraction = 'select';
let gesture: { readonly x: number; readonly y: number; readonly onBox: boolean; dragged: boolean } | undefined;
const DRAG_DISTANCE_PX = 6;
export const LINK_HOLD_MS = 350;
let heldLink: ReturnType<typeof setTimeout> | undefined;
let sitePages: CanvasSitePages | undefined;
let replaying = false;
let leavingReplay: { navigated: boolean } | undefined;

export function canvasSelects(): boolean {
  return canvas;
}

export function canvasInert(): boolean {
  if (canvas) {
    return mode === 'select';
  }
  return false;
}

export function trackCanvas(): void {
  canvas = true;
}

export function setCanvasInteraction(next: CanvasInteraction): void {
  canvas = true;
  mode = next;
  gesture = undefined;
  releaseHeldLink();
  const style = document.getElementById('avb-design-style');
  if (style instanceof HTMLStyleElement) {
    style.textContent = canvasCursorCSS();
    style.disabled = !canvasSelects();
  }
}

const DESIGN_CURSOR_CSS = ['*, *::before, *::after { cursor: default !important; }', 'iframe, embed, object { pointer-events: none !important; }'].join('\n');
const INTERACT_CURSOR_CSS = [
  ':where(html) { cursor: default; }',
  ':where(a[href], area[href], button, summary, label, select, [role="button"], [role="link"], [onclick]) { cursor: pointer; }',
  ':where(input:is([type="button" i], [type="submit" i], [type="reset" i], [type="checkbox" i], [type="radio" i], [type="file" i], [type="image" i], [type="color" i], [type="range" i])) { cursor: pointer; }',
  ':where(textarea, input:not([type="button" i], [type="submit" i], [type="reset" i], [type="checkbox" i], [type="radio" i], [type="file" i], [type="image" i], [type="color" i], [type="range" i], [type="hidden" i]), [contenteditable]:not([contenteditable="false" i])) { cursor: text; }',
].join('\n');

export function canvasCursorCSS(): string {
  return mode === 'interact' ? INTERACT_CURSOR_CSS : DESIGN_CURSOR_CSS;
}

export function setCanvasSitePages(next: CanvasSitePages): void {
  sitePages = next;
}

export function canvasDragged(): boolean {
  return gesture?.dragged ?? false;
}

export function replayingLinkClick(): boolean {
  return replaying;
}

export function holdLinkClick(event: MouseEvent): void {
  assert(!canvasInert(), 'Only interact mode passes clicks to the page');
  assert(!replaying, 'A replayed click is never held again');
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const anchor = target.closest('a[href]');
  if (anchor === null) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  releaseHeldLink();
  if (event.detail > 1) {
    return;
  }
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: event.button,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    detail: 1,
  };
  const destination = canvasLinkDestination(
    { href: anchor.getAttribute('href') ?? '', target: anchor.getAttribute('target') ?? '', download: anchor.hasAttribute('download') },
    location.href,
    { newContext: event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0, pages: sitePages },
  );
  heldLink = setTimeout(() => {
    heldLink = undefined;
    assert(!canvasInert(), 'A held link click outlives interact mode');
    switch (destination.kind) {
      case 'page': {
        const receiver = target.isConnected ? target : anchor;
        const address = canvasPageAddress(anchor.getAttribute('href') ?? '', location.href, sitePages);
        if (address === undefined) {
          if (receiver.isConnected) {
            replayLinkClick(receiver, init);
          }
          return;
        }
        if (pageTookLeavingClick(receiver, init)) {
          return;
        }
        location.assign(address);
        return;
      }
      case 'browser': {
        window.open(destination.url, '_blank', 'noopener,noreferrer');
        return;
      }
      case 'none': {
        return;
      }
      default: {
        const exhaustive: never = destination;
        return exhaustive;
      }
    }
  }, LINK_HOLD_MS);
}

export function installPreviewLinks(): void {
  window.addEventListener('click', previewLinkCapture, true);
  window.addEventListener('click', previewLinkBubble, false);
}

function previewLinkCapture(event: MouseEvent): void {
  const link = previewLinkOf(event);
  if (link === undefined) {
    return;
  }
  if (link.destination.kind === 'browser') {
    if (new URL(link.destination.url).origin === location.origin) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openPreviewTab(link.destination.url);
    }
  }
}

function previewLinkBubble(event: MouseEvent): void {
  if (event.defaultPrevented) {
    return;
  }
  const link = previewLinkOf(event);
  if (link === undefined) {
    return;
  }
  if (link.destination.kind === 'browser') {
    event.preventDefault();
    openPreviewTab(link.destination.url);
  }
}

function previewLinkOf(event: MouseEvent): { readonly destination: CanvasLinkDestination } | undefined {
  if (canvas) {
    return undefined;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return undefined;
  }
  const anchor = target.closest('a[href]');
  if (anchor === null) {
    return undefined;
  }
  const href = anchor.getAttribute('href') ?? '';
  const destination = canvasLinkDestination({ href, target: anchor.getAttribute('target') ?? '', download: anchor.hasAttribute('download') }, location.href, {
    newContext: event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0,
    pages: sitePages,
  });
  return { destination };
}

function openPreviewTab(url: string): void {
  assert(!canvas, 'Only the interactive preview opens its links for the visitor');
  window.open(url, '_blank', 'noopener,noreferrer');
}

function replayLinkClick(receiver: Element, init: MouseEventInit): void {
  replaying = true;
  try {
    receiver.dispatchEvent(new MouseEvent('click', init));
  } finally {
    replaying = false;
  }
}

function pageTookLeavingClick(receiver: Element, init: MouseEventInit): boolean {
  if (!receiver.isConnected) {
    return false;
  }
  if (clientRouted()) {
    return false;
  }
  return replayLeavingClick(receiver, init) === 'taken';
}

function clientRouted(): boolean {
  return document.querySelector('meta[name="astro-view-transitions-enabled"]') !== null;
}

function replayLeavingClick(receiver: Element, init: MouseEventInit): 'taken' | 'left' {
  assert(!replaying, 'replayLeavingClick: one replay at a time');
  assert(leavingReplay === undefined, 'replayLeavingClick: no leaving replay is under way');
  const click = new MouseEvent('click', init);
  const replay = { navigated: false };
  let seenByWindow: { readonly cancelled: boolean } | undefined;
  const last = (event: Event): void => {
    if (event === click) {
      seenByWindow = { cancelled: event.defaultPrevented };
      event.preventDefault();
    }
  };
  window.addEventListener('click', last, false);
  replaying = true;
  leavingReplay = replay;
  try {
    receiver.dispatchEvent(click);
  } finally {
    replaying = false;
    leavingReplay = undefined;
    window.removeEventListener('click', last, false);
  }
  if (replay.navigated) {
    return 'left';
  }
  const cancelled = seenByWindow === undefined ? click.defaultPrevented : seenByWindow.cancelled;
  return cancelled ? 'taken' : 'left';
}

const DESIGN_HASH = '#avb-design';

export function canvasPageAddress(href: string, frameURL: string, pages?: CanvasSitePages): string | undefined {
  assert(URL.canParse(frameURL), 'canvasPageAddress: the frame has a URL');
  if (!URL.canParse(href, frameURL)) {
    return undefined;
  }
  const destination = new URL(href, frameURL);
  const current = new URL(frameURL);
  if (destination.origin !== current.origin) {
    return undefined;
  }
  destination.pathname = canvasBasePath(destination.pathname, pages?.base ?? '');
  if (destination.pathname === current.pathname) {
    if (destination.search === current.search) {
      if (destination.href.includes('#')) {
        return undefined;
      }
    }
  }
  destination.hash = DESIGN_HASH;
  return destination.href;
}

function canvasBasePath(pathname: string, base: string): string {
  if (base === '') {
    return pathname;
  }
  if (pathname === base || pathname.startsWith(`${base}/`)) {
    return pathname;
  }
  const last = pathname.split('/').at(-1) ?? '';
  const folder = pathname.endsWith('/') || last.includes('.') ? pathname : `${pathname}/`;
  return `${base}${folder}`;
}

export type CanvasLinkDestination = { readonly kind: 'page' } | { readonly kind: 'browser'; readonly url: string } | { readonly kind: 'none' };

const SCRIPT_PROTOCOL = 'javascript:';

export function canvasLinkDestination(
  link: { readonly href: string; readonly target: string; readonly download: boolean },
  frameURL: string,
  options: { readonly newContext: boolean; readonly pages: CanvasSitePages | undefined },
): CanvasLinkDestination {
  assert(URL.canParse(frameURL), 'canvasLinkDestination: the frame has a URL');
  if (!URL.canParse(link.href, frameURL)) {
    return { kind: 'none' };
  }
  const destination = new URL(link.href, frameURL);
  if (destination.protocol === SCRIPT_PROTOCOL) {
    return { kind: 'page' };
  }
  const web = destination.protocol === 'http:' || destination.protocol === 'https:';
  if (web) {
    const sameFrame = !options.newContext && ['', '_self'].includes(link.target.trim().toLowerCase());
    if (sameFrame) {
      if (destination.origin === new URL(frameURL).origin) {
        if (canvasLinkStays(destination, new URL(frameURL), link, options.pages)) {
          return { kind: 'page' };
        }
      }
    }
    return { kind: 'browser', url: destination.href };
  }
  return { kind: 'none' };
}

function canvasLinkStays(destination: URL, frame: URL, link: { readonly download: boolean }, pages: CanvasSitePages | undefined): boolean {
  if (destination.pathname === frame.pathname) {
    if (destination.search === frame.search) {
      return true;
    }
  }
  if (link.download) {
    return false;
  }
  if (pages === undefined) {
    return true;
  }
  return isCanvasSitePage(destination.pathname, pages);
}

export function guardCanvasNavigation(): void {
  const navigation: unknown = Reflect.get(window, 'navigation');
  if (typeof navigation !== 'object' || navigation === null) {
    return;
  }
  const listen: unknown = Reflect.get(navigation, 'addEventListener');
  if (typeof listen !== 'function') {
    return;
  }
  Reflect.apply(listen, navigation, ['navigate', guardCanvasNavigationEvent]);
}

function guardCanvasNavigationEvent(event: Event): void {
  if (!canvas) {
    return;
  }
  if (!event.cancelable) {
    return;
  }
  const destination: unknown = Reflect.get(event, 'destination');
  const url: unknown = typeof destination === 'object' && destination !== null ? Reflect.get(destination, 'url') : undefined;
  if (typeof url !== 'string') {
    return;
  }
  if (leavingReplay !== undefined) {
    if (canvasLeavesDocument(url, location.href)) {
      leavingReplay.navigated = true;
      event.preventDefault();
      return;
    }
  }
  if (canvasLeavesOrigin(url, location.href)) {
    event.preventDefault();
  }
}

export function canvasLeavesDocument(url: string, frameURL: string): boolean {
  assert(URL.canParse(frameURL), 'canvasLeavesDocument: the frame has a URL');
  if (!URL.canParse(url, frameURL)) {
    return true;
  }
  const destination = new URL(url, frameURL);
  const current = new URL(frameURL);
  destination.hash = '';
  current.hash = '';
  return destination.href !== current.href;
}

export function canvasLeavesOrigin(url: string, frameURL: string): boolean {
  assert(URL.canParse(frameURL), 'canvasLeavesOrigin: the frame has a URL');
  if (URL.canParse(url, frameURL)) {
    return new URL(url, frameURL).origin !== new URL(frameURL).origin;
  }
  return true;
}

function releaseHeldLink(): void {
  if (heldLink !== undefined) {
    clearTimeout(heldLink);
    heldLink = undefined;
  }
}

export function trackCanvasGesture(): void {
  window.addEventListener(
    'pointerdown',
    (event) => {
      gesture = event.button === 0 ? { x: event.clientX, y: event.clientY, onBox: pressedCanvasBox(event.target), dragged: false } : undefined;
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      if (gesture && !canvasPressStaysClick(gesture, document.documentElement)) {
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= DRAG_DISTANCE_PX) {
          gesture.dragged = true;
        }
      }
    },
    true,
  );
  window.addEventListener(
    'pointercancel',
    () => {
      gesture = undefined;
    },
    true,
  );
}
