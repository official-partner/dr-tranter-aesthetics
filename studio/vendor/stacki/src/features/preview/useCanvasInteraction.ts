import { useEffect, useRef, useState, type RefObject } from 'react';
import { parseCanvasLeaving, parseCanvasNavigation, type CanvasInteraction, type CanvasSitePages } from '../../../shared/properties/canvasInteraction';

interface Options {
  readonly projectKey: string | undefined;
  readonly url: string | undefined;
  readonly available: boolean;
  readonly frame: RefObject<HTMLIFrameElement>;
  readonly post: (message: unknown) => void;
  readonly subscribeLoad: (listener: () => void) => () => void;
  readonly editRoute: (route: string) => void;
  readonly offSite?: { readonly clearOverlays: () => void } | undefined;
  readonly pages?: CanvasSitePages | undefined;
}

export const CANVAS_RETURN_WAIT_MS = 1500;
const CANVAS_LEAVE_WAIT_MS_MAX = 10_000;

export function useCanvasInteraction(options: Options) {
  const [choice, setChoice] = useState<{
    readonly projectKey: string | undefined;
    readonly mode: CanvasInteraction;
  }>();
  const mode = options.available && choice && choice.projectKey === options.projectKey ? choice.mode : 'select';
  const { subscribeLoad } = options;
  const current = useRef({ ...options, mode });
  current.current = { ...options, mode };
  const pagesKey = options.pages === undefined ? '' : JSON.stringify(options.pages);
  useEffect(() => {
    const send = () => {
      const pages = current.current.pages;
      if (pages !== undefined) {
        current.current.post({ type: 'avb:site-pages', base: pages.base, routes: pages.routes });
      }
      current.current.post({ type: 'avb:interaction', mode });
    };
    send();
    return subscribeLoad(send);
  }, [mode, options.url, pagesKey, subscribeLoad]);
  useCanvasNavigation(current);
  useCanvasReturn(current, subscribeLoad);
  return {
    active: mode === 'interact',
    available: options.available,
    toggle: () =>
      setChoice({
        projectKey: options.projectKey,
        mode: mode === 'select' ? 'interact' : 'select',
      }),
  };
}

function useCanvasNavigation(current: RefObject<Options & { readonly mode: CanvasInteraction }>) {
  useEffect(() => {
    let previous: string | undefined;
    const receive = (event: MessageEvent<unknown>) => {
      const options = current.current;
      if (!options || options.mode !== 'interact' || !options.url) {
        return;
      }
      if (event.source !== options.frame.current?.contentWindow) {
        return;
      }
      const initial = new URL(options.url);
      if (event.origin !== initial.origin) {
        return;
      }
      const route = parseCanvasNavigation(event.data);
      if (route === undefined) {
        return;
      }
      const destination = route.split(/[?#]/)[0]?.replace(/\/$/, '') || '/';
      const key = JSON.stringify([options.projectKey, options.url, destination]);
      if (key === previous) {
        return;
      }
      previous = key;
      if ((initial.pathname.replace(/\/$/, '') || '/') !== destination) {
        options.editRoute(destination);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [current]);
}

function useCanvasReturn(current: RefObject<Options & { readonly mode: CanvasInteraction }>, subscribeLoad: Options['subscribeLoad']) {
  useEffect(() => {
    let leaving = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = (waitMs: number) => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (leaving) {
          leaving = false;
          returnToPage(current.current ?? undefined);
        }
      }, waitMs);
    };
    const settle = () => {
      leaving = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const receive = (event: MessageEvent<unknown>) => {
      const options = current.current;
      if (!options?.offSite || options.mode !== 'interact' || !options.url) {
        return;
      }
      if (event.source !== options.frame.current?.contentWindow) {
        return;
      }
      if (event.origin !== new URL(options.url).origin) {
        return;
      }
      if (parseCanvasLeaving(event.data)) {
        leaving = true;
        options.offSite.clearOverlays();
        wait(CANVAS_LEAVE_WAIT_MS_MAX);
      } else if (parseCanvasNavigation(event.data) !== undefined) {
        settle();
      }
    };
    window.addEventListener('message', receive);
    const unsubscribe = subscribeLoad(() => {
      if (leaving) {
        wait(CANVAS_RETURN_WAIT_MS);
      }
    });
    return () => {
      window.removeEventListener('message', receive);
      unsubscribe();
      settle();
    };
  }, [current, subscribeLoad]);
}

function returnToPage(options: (Options & { readonly mode: CanvasInteraction }) | undefined): void {
  const frame = options?.frame.current;
  if (!options?.url || !frame) {
    return;
  }
  options.offSite?.clearOverlays();
  frame.src = options.url.includes('#') ? options.url : `${options.url}#avb-design`;
}
