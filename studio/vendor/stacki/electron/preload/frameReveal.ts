
import { assert } from '../../shared/core/assert';
import { splitPseudoPath } from '../../shared/page/pseudoPath';
import type { Rect } from './frameBasics';
import { isElement } from './frameBasics';
import { rectsForPath } from './frameMeasure';
import { elementsWithPath, runsOf, taggedPlaces } from './frameRegions';
import type { GlideMove } from './frameRevealGlide';
import { startGlide, TAKEOVER_EVENTS } from './frameRevealGlide';
import { boxComfortable, INSET_FRACTION_MAX, landingTop } from './frameRevealMath';

export const revealPath = (nodePath: string, occurrence: number): void => {
  assert(Number.isSafeInteger(occurrence), 'revealPath: an occurrence is an integer');
  assert(occurrence >= 0, 'revealPath: an occurrence is never negative');
  cancelReveal();
  assert(stopWatch === undefined, 'revealPath: no earlier reveal is still watching');
  const box = boxOf(nodePath, occurrence);
  if (box === undefined) {
    undrawn = { nodePath, occurrence };
    return;
  }
  if (pathIsPageRoot(box.measuredPath)) {
    return;
  }
  const anchor = anchorOf(nodePath, occurrence);
  if (anchor !== undefined && isPinned(anchor)) {
    return;
  }
  const scroller = anchor === undefined ? undefined : nearestScroller(anchor);
  const scrollports = scroller === undefined ? [PAGE_SCROLLPORT] : [elementScrollport(scroller), PAGE_SCROLLPORT];
  const pageInsetTop = stickyInsetOf(anchor);
  const insetOf = (scrollport: Scrollport): number => (scrollport === PAGE_SCROLLPORT ? pageInsetTop : 0);
  const moves: GlideMove[] = [];
  let watched: Scrollport | undefined;
  let shiftPx = 0;
  for (const scrollport of scrollports) {
    const rect = boxOf(nodePath, occurrence)?.rect;
    const landing = landingOf(scrollport, rect === undefined ? undefined : { ...rect, y: rect.y - shiftPx }, insetOf(scrollport));
    if (landing === undefined) {
      return;
    }
    if (!landing.showing) {
      moves.push({ from: landing.position, to: landing.top, scrollTo: (top) => scrollport.scrollTo(top), events: scrollport.events });
      shiftPx += landing.top - landing.position;
      watched = scrollport;
    }
  }
  if (watched === undefined) {
    return;
  }
  const moved = watched;
  const watchMoved = (): void => watchReveal(moved, () => landingOf(moved, boxOf(nodePath, occurrence)?.rect, insetOf(moved)));
  if (prefersReducedMotion() || moves.every((move) => move.from === move.to)) {
    for (const move of moves) {
      move.scrollTo(move.to);
    }
    watchMoved();
    return;
  }
  const stopGlide = startGlide(moves, (outcome) => {
    stopWatch = undefined;
    if (outcome === 'arrived') {
      watchMoved();
    }
  });
  const stopGlideAndForget = (): void => {
    stopGlide();
    if (stopWatch === stopGlideAndForget) {
      stopWatch = undefined;
    }
  };
  stopWatch = stopGlideAndForget;
};

let undrawn: { readonly nodePath: string; readonly occurrence: number } | undefined;

export const revealWhenDrawn = (): void => {
  if (undrawn !== undefined) {
    revealPath(undrawn.nodePath, undrawn.occurrence);
  }
};

export const cancelReveal = (): void => {
  undrawn = undefined;
  stopWatch?.();
  assert(stopWatch === undefined, 'cancelReveal: a stopped watch forgets itself');
};

interface Scrollport {
  readonly position: () => number;
  readonly positionMax: () => number;
  readonly viewTop: () => number;
  readonly viewHeight: () => number;
  readonly scrollTo: (top: number) => void;
  readonly events: EventTarget;
  readonly moves: EventTarget;
}

const PAGE_SCROLLPORT: Scrollport = {
  position: () => window.scrollY,
  positionMax: () => {
    const page = document.scrollingElement ?? document.documentElement;
    return Math.max(0, page.scrollHeight - page.clientHeight);
  },
  viewTop: () => 0,
  viewHeight: () => window.innerHeight || document.documentElement.clientHeight,
  scrollTo: (top) => window.scrollTo({ top, behavior: 'instant' }),
  get events(): EventTarget {
    return window;
  },
  get moves(): EventTarget {
    return window;
  },
};

const elementScrollport = (element: Element): Scrollport => ({
  position: () => element.scrollTop,
  positionMax: () => Math.max(0, element.scrollHeight - element.clientHeight),
  viewTop: () => element.getBoundingClientRect().top + element.clientTop,
  viewHeight: () => element.clientHeight,
  scrollTo: (top) => element.scrollTo({ top, behavior: 'instant' }),
  events: window,
  moves: element,
});

interface Landing {
  readonly position: number;
  readonly showing: boolean;
  readonly top: number;
}

const landingOf = (scrollport: Scrollport, rect: Rect | undefined, insetTop: number): Landing | undefined => {
  if (rect === undefined) {
    return undefined;
  }
  const viewHeight = scrollport.viewHeight();
  const position = scrollport.position();
  const inView = { ...rect, y: rect.y - scrollport.viewTop() };
  const top = Math.min(landingTop(inView, viewHeight, position, insetTop), scrollport.positionMax());
  assert(Number.isFinite(top), 'landingOf: a landing is a number');
  assert(top >= 0, 'landingOf: a landing is never above the top');
  return { position, showing: boxComfortable(inView, viewHeight, insetTop), top };
};

const REVEAL_CHECK_MS = 100;
const REVEAL_CHECKS_MAX = 600;
const REVEAL_JUMPS_MAX = 20;
const JUMP_QUIET_MS_MIN = 300;
const REST_QUIET_MS_MIN = 2_000;
const FRAME_GAP_MS_MAX = 5_000;
const ARRIVED_PX = 1;

let stopWatch: (() => void) | undefined;

const watchReveal = (scrollport: Scrollport, measure: () => Landing | undefined): void => {
  assert(stopWatch === undefined, 'watchReveal: the reveal before it was cancelled');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checks = 0;
  let jumps = 1;
  let last = scrollport.position();
  let movedAt = performance.now();
  let frameGapMs = 0;
  const moved = (): void => {
    const now = performance.now();
    const gapMs = now - movedAt;
    if (gapMs <= FRAME_GAP_MS_MAX) {
      frameGapMs = Math.max(frameGapMs, gapMs);
    }
    movedAt = now;
  };
  const stop = (): void => {
    clearTimeout(timer);
    for (const type of TAKEOVER_EVENTS) {
      scrollport.events.removeEventListener(type, stop, true);
    }
    scrollport.moves.removeEventListener('scroll', moved);
    if (stopWatch === stop) {
      stopWatch = undefined;
    }
  };
  const check = (): void => {
    checks += 1;
    assert(checks <= REVEAL_CHECKS_MAX, 'watchReveal: the watch is bounded');
    const landing = measure();
    if (landing === undefined) {
      stop();
      return;
    }
    if (Math.abs(landing.position - last) > ARRIVED_PX) {
      movedAt = Math.max(movedAt, performance.now() - REVEAL_CHECK_MS);
    }
    last = landing.position;
    const step = revealStep({
      arrived: Math.abs(landing.position - landing.top) <= ARRIVED_PX,
      quietMs: performance.now() - movedAt,
      jumpQuietMs: Math.max(JUMP_QUIET_MS_MIN, frameGapMs * 2),
      restQuietMs: Math.max(REST_QUIET_MS_MIN, frameGapMs * 3),
      checksLeft: REVEAL_CHECKS_MAX - checks,
      jumpsLeft: REVEAL_JUMPS_MAX - jumps,
    });
    switch (step) {
      case 'done':
        stop();
        return;
      case 'wait':
        break;
      case 'jump':
        jumps += 1;
        scrollport.scrollTo(landing.top);
        last = scrollport.position();
        movedAt = performance.now();
        break;
      default: {
        const exhaustive: never = step;
        return exhaustive;
      }
    }
    if (checks < REVEAL_CHECKS_MAX) {
      timer = setTimeout(check, REVEAL_CHECK_MS);
    } else {
      stop();
    }
  };
  for (const type of TAKEOVER_EVENTS) {
    scrollport.events.addEventListener(type, stop, { capture: true, passive: true });
  }
  scrollport.moves.addEventListener('scroll', moved, { passive: true });
  stopWatch = stop;
  timer = setTimeout(check, REVEAL_CHECK_MS);
};

type RevealStep = 'done' | 'wait' | 'jump';

const revealStep = (look: {
  readonly arrived: boolean;
  readonly quietMs: number;
  readonly jumpQuietMs: number;
  readonly restQuietMs: number;
  readonly checksLeft: number;
  readonly jumpsLeft: number;
}): RevealStep => {
  assert(look.checksLeft >= 0, 'revealStep: the watch has checks left to count');
  assert(look.jumpsLeft >= 0, 'revealStep: the watch never jumps past its bound');
  assert(look.jumpQuietMs >= JUMP_QUIET_MS_MIN, 'revealStep: a jump never waits less than the minimum');
  assert(look.restQuietMs > look.jumpQuietMs, 'revealStep: letting go waits longer than jumping');
  if (look.arrived) {
    if (look.quietMs >= look.restQuietMs) {
      return 'done';
    }
    return look.checksLeft === 0 ? 'done' : 'wait';
  }
  if (look.jumpsLeft === 0) {
    return 'done';
  }
  if (look.quietMs >= look.jumpQuietMs) {
    return 'jump';
  }
  return look.checksLeft === 0 ? 'jump' : 'wait';
};

const anchorOf = (nodePath: string, occurrence: number): Element | undefined => {
  const hostPath = splitPseudoPath(nodePath)?.nodePath ?? nodePath;
  const runs = runsOf(hostPath);
  if (runs !== undefined) {
    const run = runs[occurrence] ?? runs[0];
    const first = run?.[0];
    if (first === undefined) {
      return undefined;
    }
    const element = run?.find(isElement);
    return element ?? first.parentElement ?? undefined;
  }
  const places = taggedPlaces(hostPath);
  return (places[occurrence] ?? places[0])?.el;
};

const boxOf = (nodePath: string, occurrence: number): { readonly rect: Rect; readonly measuredPath: string } | undefined => {
  const measuredPath = rectsForPath(nodePath) === undefined ? (splitPseudoPath(nodePath)?.nodePath ?? nodePath) : nodePath;
  const rects = rectsForPath(measuredPath);
  const rect = rects?.[occurrence] ?? rects?.[0];
  return rect === undefined ? undefined : { rect, measuredPath };
};

const pathIsPageRoot = (nodePath: string): boolean => {
  const roots: readonly Element[] = [document.documentElement, document.body];
  return elementsWithPath(nodePath).some((element) => roots.includes(element));
};

const ANCESTORS_MAX = 512;

const nearestScroller = (element: Element): Element | undefined => {
  const root = document.documentElement;
  const page = document.scrollingElement ?? root;
  let ancestor = element.parentElement;
  for (let depth = 0; depth < ANCESTORS_MAX; depth += 1) {
    if (ancestor === null) {
      return undefined;
    }
    if (ancestor === page) {
      return undefined;
    }
    if (ancestor === root) {
      return undefined;
    }
    if (scrollsItself(ancestor, root)) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return undefined;
};

const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set(['auto', 'scroll', 'overlay']);

const scrollsItself = (element: Element, root: Element): boolean => {
  assert(element !== root, 'scrollsItself: the page root is the window, never an inner scroller');
  if (element.scrollHeight <= element.clientHeight + ARRIVED_PX) {
    return false;
  }
  if (!SCROLLING_OVERFLOW.has(getComputedStyle(element).overflowY)) {
    return false;
  }
  if (element === document.body) {
    return getComputedStyle(root).overflowY !== 'visible';
  }
  return true;
};

const prefersReducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const isPinned = (element: Element): boolean => {
  let ancestor: Element | undefined = element;
  for (let depth = 0; depth < ANCESTORS_MAX; depth += 1) {
    if (ancestor === undefined) {
      return false;
    }
    if (getComputedStyle(ancestor).position === 'fixed') {
      return true;
    }
    ancestor = ancestor.parentElement ?? undefined;
  }
  return false;
};

const STACK_MAX = 32;

const stickyInsetOf = (anchor: Element | undefined): number => {
  if (typeof document.elementsFromPoint !== 'function') {
    return 0;
  }
  const viewHeight = PAGE_SCROLLPORT.viewHeight();
  const heightMax = Math.floor(viewHeight * INSET_FRACTION_MAX);
  const stack = document.elementsFromPoint(Math.floor(window.innerWidth / 2), 1).slice(0, STACK_MAX);
  let insetTop = 0;
  for (const element of stack) {
    if (anchor !== undefined && (element.contains(anchor) || anchor.contains(element))) {
      continue;
    }
    const position = getComputedStyle(element).position;
    if (position === 'fixed' || position === 'sticky') {
      const rect = element.getBoundingClientRect();
      if (rect.top <= 1 && rect.bottom > 0 && rect.height <= heightMax) {
        insetTop = Math.max(insetTop, Math.ceil(rect.bottom));
      }
    }
  }
  assert(insetTop >= 0, 'stickyInsetOf: a bar covers no negative height');
  return Math.min(insetTop, heightMax);
};
