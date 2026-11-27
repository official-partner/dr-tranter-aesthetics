import { useEffect, useLayoutEffect, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { assert } from '../../shared/core/assert';


export interface SegmentBox {
  readonly x: number;
  readonly width: number;
}

const segmentsMax = 64;

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export function measureSegmentIndicator(button: HTMLElement): SegmentBox {
  const box = { x: button.offsetLeft, width: button.offsetWidth };
  assert(Number.isFinite(box.x), 'segmentIndicator: offset is finite');
  assert(box.width >= 0, 'segmentIndicator: width is not negative');
  return box;
}

export function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(reducedMotionQuery).matches;
}

export function segmentIndicatorStyle(box: SegmentBox | undefined): { readonly transform?: string; readonly width?: string; readonly opacity?: number } {
  if (box === undefined) {
    return { opacity: 0 };
  }
  return { transform: `translateX(${box.x}px)`, width: `${box.width}px` };
}

interface SegmentIndicatorInput {
  readonly trackRef: RefObject<HTMLElement>;
  readonly buttonsRef: MutableRefObject<Array<HTMLButtonElement | undefined>>;
  readonly selectedIndex: number;
  readonly layoutKey: string;
}

export function useSegmentIndicator({ trackRef, buttonsRef, selectedIndex, layoutKey }: SegmentIndicatorInput): {
  readonly indicator: SegmentBox | undefined;
  readonly animated: boolean;
} {
  assert(selectedIndex >= -1, 'segmentIndicator: selected index is -1 or a position');
  assert(selectedIndex < segmentsMax, 'segmentIndicator: selected index is under the segment limit');
  const [indicator, setIndicator] = useState<SegmentBox | undefined>(undefined);
  const [animated, setAnimated] = useState(false);
  useLayoutEffect(() => {
    const track = trackRef.current;
    const button = selectedIndex >= 0 ? buttonsRef.current[selectedIndex] : undefined;
    if (!track || !button) {
      setIndicator(undefined);
      return;
    }
    const measure = () => setIndicator(measureSegmentIndicator(button));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    observer.observe(button);
    return () => observer.disconnect();
  }, [trackRef, buttonsRef, selectedIndex, layoutKey]);

  useEffect(() => {
    if (prefersReducedMotion()) {
      return;
    }
    if (typeof window.requestAnimationFrame !== 'function') {
      setAnimated(true);
      return;
    }
    const id = window.requestAnimationFrame(() => setAnimated(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  return { indicator, animated };
}
