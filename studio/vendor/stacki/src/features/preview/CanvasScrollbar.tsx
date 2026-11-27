
import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { assert } from '../../../shared/core/assert';
import {
  CANVAS_SCROLLBAR_LIMITS,
  canvasScrollbarMessage,
  pageScrollToMessage,
  parsePageScrollMessage,
  scrollThumb,
  scrollTopForThumb,
  type PageScroll,
} from '../../../shared/properties/canvasScrollbar';
import { usePointerDrag } from '../../ui/usePointerDrag';

const BAR_SCREEN_PX = {
  width: 5,
  gap: 2,
} as const satisfies Record<string, number>;

export interface CanvasScrollbarProps {
  readonly frameRef: RefObject<HTMLDivElement>;
  readonly scale: number;
}

export function CanvasScrollbar(props: CanvasScrollbarProps) {
  assert(props.scale > 0, 'CanvasScrollbar: the frame has a scale');
  assert(Number.isFinite(props.scale), 'CanvasScrollbar: the frame scale is finite');
  const scroll = usePageScroll(props.frameRef);
  const startDrag = usePointerDrag();
  if (scroll === undefined) {
    return undefined;
  }
  if (scroll.chromium) {
    return undefined;
  }
  const trackPx = scroll.viewHeightPx;
  const lengthPxMin = CANVAS_SCROLLBAR_LIMITS.thumbScreenPxMin / props.scale;
  const thumb = scrollThumb(scroll, trackPx, lengthPxMin);
  if (thumb === undefined) {
    return undefined;
  }
  const widthPx = BAR_SCREEN_PX.width / props.scale;
  const endPx = -(BAR_SCREEN_PX.gap / props.scale) - widthPx;
  const scrollTo = (offsetPx: number): void => {
    const topPx = scrollTopForThumb(scroll, trackPx, lengthPxMin, offsetPx);
    const frame = frameOf(props.frameRef);
    frame?.contentWindow?.postMessage(pageScrollToMessage(topPx), originOf(frame));
  };
  const press = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget.getBoundingClientRect();
    const pointerPx = (event.clientY - track.top) / props.scale;
    const onThumb = pointerPx >= thumb.offsetPx && pointerPx <= thumb.offsetPx + thumb.lengthPx;
    const grabPx = onThumb ? pointerPx - thumb.offsetPx : thumb.lengthPx / 2;
    if (!onThumb) {
      scrollTo(pointerPx - grabPx);
    }
    const frame = props.frameRef.current;
    frame?.classList.add('canvas-scrolling');
    startDrag(event, {
      onMove: (move) => scrollTo((move.clientY - track.top) / props.scale - grabPx),
      onEnd: () => frame?.classList.remove('canvas-scrolling'),
    });
  };
  return (
    <div className="canvas-scrollbar" style={{ width: widthPx, insetInlineEnd: endPx }} onPointerDown={press} aria-hidden="true">
      <div className="canvas-scrollbar-thumb" style={{ top: thumb.offsetPx, height: thumb.lengthPx, borderRadius: widthPx }} />
    </div>
  );
}

function usePageScroll(frameRef: RefObject<HTMLDivElement>): PageScroll | undefined {
  const [scroll, setScroll] = useState<PageScroll | undefined>(undefined);
  useEffect(() => {
    const holder = frameRef.current;
    if (holder === null) {
      return undefined;
    }
    const tell = (frame: HTMLIFrameElement | undefined): void => {
      frame?.contentWindow?.postMessage(canvasScrollbarMessage(), originOf(frame));
    };
    const loaded = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLIFrameElement && target.getAttribute('aria-hidden') !== 'true') {
        setScroll(undefined);
        tell(target);
      }
    };
    const heard = (event: MessageEvent<unknown>): void => {
      const frame = frameOf(frameRef);
      if (frame === undefined || event.source !== frame.contentWindow) {
        return;
      }
      const message = parsePageScrollMessage(event.data);
      if (message !== undefined) {
        setScroll({ topPx: message.topPx, heightPx: message.heightPx, viewHeightPx: message.viewHeightPx, chromium: message.chromium });
      }
    };
    holder.addEventListener('load', loaded, true);
    window.addEventListener('message', heard);
    tell(frameOf(frameRef));
    return () => {
      holder.removeEventListener('load', loaded, true);
      window.removeEventListener('message', heard);
    };
  }, [frameRef]);
  return scroll;
}

function frameOf(frameRef: RefObject<HTMLDivElement>): HTMLIFrameElement | undefined {
  const frame = frameRef.current?.querySelector('iframe');
  return frame ?? undefined;
}

function originOf(frame: HTMLIFrameElement | undefined): string {
  const source = frame?.src ?? '';
  try {
    const origin = new URL(source, window.location.href).origin;
    return origin === 'null' ? '*' : origin;
  } catch {
    return '*';
  }
}
