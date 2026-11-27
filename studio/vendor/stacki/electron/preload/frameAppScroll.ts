
const COORDINATE_PX_MAX = 1_000_000;

interface AppScroll {
  readonly space: 'page' | 'viewport';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly block: 'start' | 'center';
}

const SCROLL_ANCESTORS_MAX = 256;

const WHEEL_LINE_PX = 40;

const WHEEL_DELTA_MODES = [0, 1, 2] as const;
type WheelDeltaMode = (typeof WHEEL_DELTA_MODES)[number];

export interface AppWheel {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: WheelDeltaMode;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export function receiveAppScroll(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Reflect.get(data, 'type') !== 'avb:app-scroll') {
    return false;
  }
  const scroll = parseAppScroll(data);
  if (scroll === undefined) {
    return true;
  }
  const target = scrollTarget(scroll, { x: window.scrollX, y: window.scrollY }, { width: window.innerWidth, height: window.innerHeight });
  window.scrollTo({ left: target.left, top: target.top, behavior: 'instant' });
  return true;
}

export function scrollTarget(
  scroll: AppScroll,
  scrolled: { readonly x: number; readonly y: number },
  viewport: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const originX = scroll.space === 'viewport' ? scrolled.x : 0;
  const originY = scroll.space === 'viewport' ? scrolled.y : 0;
  if (scroll.block === 'start') {
    return { left: originX + scroll.x, top: originY + scroll.y };
  }
  return { left: originX + scroll.x + scroll.w / 2 - viewport.width / 2, top: originY + scroll.y + scroll.h / 2 - viewport.height / 2 };
}

export function receiveAppWheel(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Reflect.get(data, 'type') !== 'avb:app-wheel') {
    return false;
  }
  const wheel = parseAppWheel(data);
  if (wheel === undefined) {
    return true;
  }
  const target = document.elementFromPoint(wheel.x, wheel.y) ?? document.documentElement;
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: wheel.x,
    clientY: wheel.y,
    deltaX: wheel.deltaX,
    deltaY: wheel.deltaY,
    deltaMode: wheel.deltaMode,
    ctrlKey: wheel.ctrlKey,
    shiftKey: wheel.shiftKey,
    altKey: wheel.altKey,
    metaKey: wheel.metaKey,
  });
  const unhandled = target.dispatchEvent(event);
  if (unhandled) {
    if (wheel.ctrlKey) {
      return true;
    }
    const pixels = wheelPixels(wheel, { width: window.innerWidth, height: window.innerHeight });
    const scroller = wheelScroller(target, pixels);
    if (scroller === undefined) {
      window.scrollBy({ left: pixels.x, top: pixels.y, behavior: 'instant' });
    } else {
      scroller.scrollBy({ left: pixels.x, top: pixels.y, behavior: 'instant' });
    }
  }
  return true;
}

export function wheelPixels(
  wheel: Pick<AppWheel, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>,
  viewport: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  const sideways = wheel.shiftKey && wheel.deltaX === 0;
  const deltaX = sideways ? wheel.deltaY : wheel.deltaX;
  const deltaY = sideways ? 0 : wheel.deltaY;
  switch (wheel.deltaMode) {
    case 0:
      return { x: deltaX, y: deltaY };
    case 1:
      return { x: deltaX * WHEEL_LINE_PX, y: deltaY * WHEEL_LINE_PX };
    case 2:
      return { x: deltaX * viewport.width, y: deltaY * viewport.height };
    default: {
      const exhaustive: never = wheel.deltaMode;
      return exhaustive;
    }
  }
}

function wheelScroller(target: Element, pixels: { readonly x: number; readonly y: number }): Element | undefined {
  let element: Element | undefined = target;
  for (let depth = 0; depth < SCROLL_ANCESTORS_MAX; depth += 1) {
    if (element === undefined || element === document.documentElement || element === document.body) {
      return undefined;
    }
    if (canScroll(element, pixels)) {
      return element;
    }
    element = element.parentElement ?? undefined;
  }
  return undefined;
}

function canScroll(element: Element, pixels: { readonly x: number; readonly y: number }): boolean {
  const style = getComputedStyle(element);
  if (pixels.y !== 0 && scrolls(style.overflowY) && roomFor(pixels.y, element.scrollTop, element.scrollHeight - element.clientHeight)) {
    return true;
  }
  if (pixels.x !== 0 && scrolls(style.overflowX)) {
    return roomFor(pixels.x, element.scrollLeft, element.scrollWidth - element.clientWidth);
  }
  return false;
}

function scrolls(overflow: string): boolean {
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
}

function roomFor(delta: number, position: number, positionMax: number): boolean {
  if (delta < 0) {
    return position > 0;
  }
  return position < positionMax - 0.5;
}

function parseAppWheel(data: object): AppWheel | undefined {
  const x = coordinateOf(Reflect.get(data, 'x'));
  const y = coordinateOf(Reflect.get(data, 'y'));
  const deltaX = coordinateOf(Reflect.get(data, 'deltaX'));
  const deltaY = coordinateOf(Reflect.get(data, 'deltaY'));
  const deltaMode = WHEEL_DELTA_MODES.find((mode) => mode === Reflect.get(data, 'deltaMode'));
  if (x === undefined || y === undefined || deltaX === undefined || deltaY === undefined || deltaMode === undefined) {
    return undefined;
  }
  const ctrlKey: unknown = Reflect.get(data, 'ctrlKey');
  const shiftKey: unknown = Reflect.get(data, 'shiftKey');
  const altKey: unknown = Reflect.get(data, 'altKey');
  const metaKey: unknown = Reflect.get(data, 'metaKey');
  if (typeof ctrlKey !== 'boolean' || typeof shiftKey !== 'boolean' || typeof altKey !== 'boolean' || typeof metaKey !== 'boolean') {
    return undefined;
  }
  return { x, y, deltaX, deltaY, deltaMode, ctrlKey, shiftKey, altKey, metaKey };
}

function parseAppScroll(data: object): AppScroll | undefined {
  const space: unknown = Reflect.get(data, 'space');
  const block: unknown = Reflect.get(data, 'block');
  const x = coordinateOf(Reflect.get(data, 'x'));
  const y = coordinateOf(Reflect.get(data, 'y'));
  const width = coordinateOf(Reflect.get(data, 'w'));
  const height = coordinateOf(Reflect.get(data, 'h'));
  if (space !== 'page' && space !== 'viewport') {
    return undefined;
  }
  if (block !== 'start' && block !== 'center') {
    return undefined;
  }
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width < 0 || height < 0) {
    return undefined;
  }
  return { space, x, y, w: width, h: height, block };
}

function coordinateOf(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return undefined;
  }
  return Math.abs(input) <= COORDINATE_PX_MAX ? input : undefined;
}
