import { inOwnedPopup, isTopPopupLayer, ownsTopPopupLayer } from './popupOwnership';
import { useEffect, useRef, type RefObject } from 'react';
import type { PopupProps, PopupActions } from './Popup';
import { toRecord } from '../../shared/core/record';
import { popupLayer } from './popupLayer';
interface DismissOptions extends Pick<PopupProps, 'dismissible' | 'keepOnScroll' | 'anchor' | 'within' | 'onEscape'> {
  readonly active: boolean;
  readonly mode: 'modal' | 'popover';
}
export const DISMISSED_BY_ATTRIBUTE = 'data-popup-dismissed';

let outsideDismissedAtMs: number | undefined;
const DISMISS_PRESS_SLACK_MS = 50;

export function outsideDismissedSince(pressedAtMs: number): boolean {
  return outsideDismissedAtMs !== undefined && outsideDismissedAtMs >= pressedAtMs - DISMISS_PRESS_SLACK_MS;
}

function dismissedBy(surface: RefObject<HTMLDivElement>, close: () => void): () => void {
  return () => {
    outsideDismissedAtMs = epochNowMs();
    surface.current?.setAttribute(DISMISSED_BY_ATTRIBUTE, 'outside');
    close();
  };
}

function takesTypedText(target: Event['target']): boolean {
  return target instanceof window.Element && target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null;
}

export function usePopupDismiss(surface: RefObject<HTMLDivElement>, options: DismissOptions, { close, finish }: PopupActions): void {
  const { active, anchor, within, dismissible = true, mode, onEscape } = options;
  usePopupEnvironment(surface, options, dismissedBy(surface, close));
  const openedAtRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    openedAtRef.current = active ? epochNowMs() : undefined;
  }, [active]);
  useEffect(() => {
    if (!active || !dismissible) {
      return undefined;
    }
    let outsidePress = false;
    const outside = (target: Event['target']): boolean =>
      target instanceof window.Node &&
      !(target instanceof window.Element && target.closest('.toast-stack')) &&
      !surface.current?.contains(target) &&
      !inOwnedPopup(target, surface.current ?? undefined) &&
      !anchor?.contains(target) &&
      !within?.contains(target);
    const down = (event: MouseEvent): void => {
      outsidePress = outside(event.target);
      if (mode === 'popover' && outsidePress && popupTakesOutsidePress(surface.current)) {
        if (!takesTypedText(event.target)) {
          event.preventDefault();
          consumePopupClick(event.target);
        }
        dismissedBy(surface, close)();
      }
    };
    const click = (event: MouseEvent): void => {
      if (mode === 'modal' && outsidePress && outside(event.target) && popupIsTop(surface.current)) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && popupIsTop(surface.current)) {
        event.preventDefault();
        event.stopPropagation();
        if (onEscape) {
          finish(onEscape);
        } else {
          close();
        }
      }
    };
    const message = (event: MessageEvent<unknown>): void => {
      if (mode === 'popover' && isCanvasPressMessage(event.data, { openedAtMs: openedAtRef.current })) {
        dismissedBy(surface, close)();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('mousedown', down, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key);
    window.addEventListener('message', message);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('message', message);
    };
  }, [active, anchor, within, close, finish, dismissible, mode, onEscape, surface]);
}

export function popupIsTop(surface: RefObject<HTMLDivElement>['current']): boolean {
  return isTopPopupLayer(surface ?? undefined);
}

function popupTakesOutsidePress(surface: RefObject<HTMLDivElement>['current']): boolean {
  return isTopPopupLayer(surface ?? undefined) || ownsTopPopupLayer(surface ?? undefined);
}

function usePopupEnvironment(surface: RefObject<HTMLDivElement>, options: DismissOptions, close: () => void): void {
  const { active, anchor, dismissible = true, keepOnScroll = false, mode } = options;
  useEffect(() => {
    if (!active || !dismissible || mode === 'modal') {
      return undefined;
    }
    const reference = scrollReference(surface.current ?? undefined, anchor);
    const origin = reference === undefined ? undefined : screenPosition(reference);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blur = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') {
          close();
        }
      }, 0);
    };
    const scroll = (event: Event): void => {
      if (keepOnScroll || (event.target instanceof window.Node && surface.current?.contains(event.target))) {
        return;
      }
      if (reference !== undefined && origin !== undefined && !movedOnScreen(origin, screenPosition(reference))) {
        return;
      }
      if (popupTakesOutsidePress(surface.current)) {
        close();
      }
    };
    window.addEventListener('blur', blur);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', blur);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [active, anchor, close, dismissible, keepOnScroll, mode, surface]);
}

const MOVED_PX_MIN = 0.5;

interface ScreenPosition {
  readonly left: number;
  readonly top: number;
}

function scrollReference(surface: HTMLElement | undefined, anchor: HTMLElement | undefined): HTMLElement | undefined {
  if (anchor !== undefined) {
    return anchor;
  }
  const parent = surface?.parentElement ?? undefined;
  if (parent === undefined || parent === popupLayer() || parent instanceof window.HTMLDialogElement) {
    return undefined;
  }
  return parent;
}

function screenPosition(element: HTMLElement): ScreenPosition {
  const box = element.getBoundingClientRect();
  return { left: box.left, top: box.top };
}

function movedOnScreen(before: ScreenPosition, after: ScreenPosition): boolean {
  if (Math.abs(after.top - before.top) >= MOVED_PX_MIN) {
    return true;
  }
  return Math.abs(after.left - before.left) >= MOVED_PX_MIN;
}

let pendingClickCleanup: (() => void) | undefined;

function consumePopupClick(target: Event['target']): void {
  pendingClickCleanup?.();
  const cleanup = (): void => {
    document.removeEventListener('click', consume, true);
    window.clearTimeout(timer);
    pendingClickCleanup = undefined;
  };
  const consume = (event: MouseEvent): void => {
    if (event.target === target) {
      event.preventDefault();
      event.stopPropagation();
    }
    cleanup();
  };
  const timer = window.setTimeout(cleanup, 400);
  pendingClickCleanup = cleanup;
  document.addEventListener('click', consume, { capture: true });
}

const CANVAS_PRESSES: ReadonlySet<string> = new Set(['avb:click-node', 'avb:open-node', 'avb:context-node', 'studio:select', 'studio:open']);

export function epochNowMs(): number {
  return performance.timeOrigin + performance.now();
}

export function isCanvasPressMessage(data: unknown, { openedAtMs }: { readonly openedAtMs?: number | undefined } = {}): boolean {
  const message = toRecord(data);
  const kind = message?.['type'];
  if (typeof kind !== 'string') {
    return false;
  }
  if (!CANVAS_PRESSES.has(kind)) {
    return false;
  }
  if (message?.['replay'] !== undefined) {
    return false;
  }
  if (openedAtMs === undefined) {
    return true;
  }
  const pressedAtMs = message?.['pressedAtMs'];
  if (typeof pressedAtMs !== 'number') {
    return true;
  }
  if (!Number.isFinite(pressedAtMs)) {
    return true;
  }
  return pressedAtMs >= openedAtMs;
}
