import { useLayoutEffect, useRef, useState } from 'react';
import Popup from '../../ui/Popup';
import type { ReactNode, RefObject } from 'react';
import { panelSpan } from './model/panelBox';
import { assert } from '../../../shared/core/assert';

export default function LayerPopover({
  anchorEl: anchorElement,
  onClose,
  ariaLabel,
  span: placedSpan,
  children,
}: {
  anchorEl: HTMLElement;
  onClose: () => void;
  ariaLabel?: string;
  span?: { readonly left: number; readonly width: number };
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const scrolls = usePopoverOverflow(boxRef);
  const [span] = useState(() => placedSpan ?? openerSpan(anchorElement) ?? panelSpan(anchorElement));
  const top = usePopoverTop(ref, anchorElement);
  return (
    <Popup
      mode="popover"
      anchor={anchorElement}
      onClose={onClose}
      ref={ref}
      className="embed-editor_layer-popover"
      role="dialog"
      label={ariaLabel}
      style={{
        position: 'fixed',
        left: span.left,
        width: span.width,
        top: top ?? 0,
        visibility: top === undefined ? 'hidden' : 'visible',
      }}
    >
      {}
      <div ref={boxRef} className={'embed-editor_layer-popover-box style-panel-surface u-surface-surface' + (scrolls ? ' is-scrolling' : '')}>
        {children}
      </div>
    </Popup>
  );
}

function openerSpan(anchorElement: HTMLElement): { readonly left: number; readonly width: number } | undefined {
  const opener = anchorElement.closest<HTMLElement>('.embed-editor_layer-popover');
  if (opener === null) {
    return undefined;
  }
  const bounds = opener.getBoundingClientRect();
  return bounds.width > 0 ? { left: bounds.left, width: bounds.width } : undefined;
}

function usePopoverTop(ref: RefObject<HTMLDivElement>, anchorElement: HTMLElement): number | undefined {
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const place = (): void => setTop(popoverTopFor(anchorElement.getBoundingClientRect(), element.offsetHeight, window.innerHeight));
    place();
    const resize = new ResizeObserver(place);
    resize.observe(element);
    return () => resize.disconnect();
  }, [ref, anchorElement]);
  return top;
}

const POPOVER_GAP_PX = 6;

export function popoverTopFor(anchor: Pick<DOMRect, 'top' | 'bottom'>, heightPx: number, windowHeightPx: number): number {
  assert(heightPx >= 0, 'popoverTopFor: a height is not negative');
  const roomBelowPx = windowHeightPx - anchor.bottom - POPOVER_GAP_PX;
  const roomAbovePx = anchor.top - POPOVER_GAP_PX;
  if (heightPx <= roomBelowPx) {
    return anchor.bottom + POPOVER_GAP_PX;
  }
  if (heightPx <= roomAbovePx) {
    return anchor.top - POPOVER_GAP_PX - heightPx;
  }
  const top = Math.max(POPOVER_GAP_PX, windowHeightPx - POPOVER_GAP_PX - heightPx);
  assert(top >= POPOVER_GAP_PX, 'popoverTopFor: the popover starts inside the window');
  return top;
}

function usePopoverOverflow(boxRef: RefObject<HTMLDivElement>): boolean {
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return undefined;
    }
    const measure = () => setScrolls(box.scrollHeight > window.innerHeight * 0.94);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(box);
    const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(measure);
    mutations?.observe(box, { attributes: true, childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => {
      mutations?.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [boxRef]);
  return scrolls;
}
