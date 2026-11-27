import { assert } from '../../shared/core/assert';
import { APP_RPC_LIMITS } from '../../shared/properties/appsRpc';

export interface CanvasClickBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CanvasClickReport {
  readonly path: string | undefined;
  readonly occurrence: number;
  readonly x: number | undefined;
  readonly y: number | undefined;
  readonly box: CanvasClickBox | undefined;
}

export interface CanvasClickHandler {
  readonly capturing: () => boolean;
  readonly observing: () => boolean;
  readonly take: (click: CanvasClickReport) => void;
}

let handler: CanvasClickHandler | undefined;

export interface CanvasClickInterceptor {
  readonly capturing: () => boolean;
  readonly take: (click: CanvasClickReport) => void;
}

let interceptor: CanvasClickInterceptor | undefined;

export function setCanvasClickHandler(next: CanvasClickHandler | undefined): void {
  handler = next;
}

export function setCanvasClickInterceptor(next: CanvasClickInterceptor | undefined): void {
  interceptor = next;
}

export function canvasClicksIntercepted(): boolean {
  return interceptor?.capturing() === true;
}

export function canvasClicksCaptured(): boolean {
  return interceptor?.capturing() === true || handler?.capturing() === true;
}

export const OBSERVE_DOUBLE_CLICK_MS = 350;

let observed: ReturnType<typeof setTimeout> | undefined;

export function observeCanvasClick(click: CanvasClickReport): boolean {
  if (interceptor?.capturing() === true) {
    return false;
  }
  if (handler === undefined || !handler.observing()) {
    return false;
  }
  const observer = handler;
  clearTimeout(observed);
  observed = setTimeout(() => {
    observed = undefined;
    if (observer.observing()) {
      observer.take(click);
    }
  }, OBSERVE_DOUBLE_CLICK_MS);
  return true;
}

export function noteCanvasOpen(): void {
  clearTimeout(observed);
  observed = undefined;
}

export function takeCanvasClick(click: CanvasClickReport): boolean {
  if (interceptor !== undefined && interceptor.capturing()) {
    assert(click.occurrence >= 0, 'A click names a copy from the first');
    interceptor.take(click);
    return true;
  }
  if (handler === undefined || !handler.capturing()) {
    return false;
  }
  assert(Number.isSafeInteger(click.occurrence), 'A click names a whole copy');
  assert(click.occurrence >= 0, 'A click names a copy from the first');
  handler.take(click);
  return true;
}

export function canvasClickBox(input: unknown): CanvasClickBox | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const x = coordinateOf(Reflect.get(input, 'x'));
  const y = coordinateOf(Reflect.get(input, 'y'));
  const width = coordinateOf(Reflect.get(input, 'w'));
  const height = coordinateOf(Reflect.get(input, 'h'));
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width < 0 || height < 0) {
    return undefined;
  }
  return { x, y, w: width, h: height };
}

export function coordinateOf(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return undefined;
  }
  return Math.abs(input) <= APP_RPC_LIMITS.coordinatePxMax ? input : undefined;
}
