import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { assert } from '../../shared/core/assert';

export type ScrollEdge = 'fade' | 'flush';
export interface ScrollEdges {
  readonly top: ScrollEdge;
  readonly bottom: ScrollEdge;
}
export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

const SCROLL_EDGE_SLACK_PX = 1;
export const SCROLL_EDGES_FLUSH: ScrollEdges = { top: 'flush', bottom: 'flush' };

export function scrollEdges(metrics: ScrollMetrics): ScrollEdges {
  assert(Number.isFinite(metrics.scrollTop), 'scrollEdges: scrollTop is finite');
  assert(metrics.scrollHeight >= 0, 'scrollEdges: scrollHeight is not negative');
  assert(metrics.clientHeight >= 0, 'scrollEdges: clientHeight is not negative');
  const hidden = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const above = Math.min(hidden, Math.max(0, metrics.scrollTop));
  const below = hidden - above;
  return {
    top: above > SCROLL_EDGE_SLACK_PX ? 'fade' : 'flush',
    bottom: below > SCROLL_EDGE_SLACK_PX ? 'fade' : 'flush',
  };
}

export function useScrollEdges(area: RefObject<HTMLElement>): { readonly edges: ScrollEdges; readonly measure: () => void } {
  const [edges, setEdges] = useState<ScrollEdges>(SCROLL_EDGES_FLUSH);
  const measure = useCallback(() => {
    const element = area.current;
    if (element === null) {
      return;
    }
    const next = scrollEdges(element);
    setEdges((previous) => (previous.top === next.top && previous.bottom === next.bottom ? previous : next));
  }, [area]);
  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) {
      return undefined;
    }
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    for (const child of element.children) {
      observer?.observe(child);
    }
    return () => {
      element.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [area, measure]);
  return { edges, measure };
}
