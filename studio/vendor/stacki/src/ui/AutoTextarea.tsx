import type { TextareaHTMLAttributes } from 'react';
interface AutoTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly minRows?: number;
  readonly heightPxMax?: number;
}
import { useLayoutEffect, useRef } from 'react';
import { assert } from '../../shared/core/assert';

const HEIGHT_PX_MAX = 360;

export default function AutoTextarea({ value, minRows: rowsMin = 1, heightPxMax = HEIGHT_PX_MAX, style, ...props }: AutoTextareaProps) {
  assert(Number.isFinite(heightPxMax), 'A textarea height bound is a number');
  assert(heightPxMax > 0, 'A textarea height bound is positive');
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => fitTextarea(ref.current ?? undefined, heightPxMax), [value, heightPxMax]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver(() => fitTextarea(element, heightPxMax));
    ro.observe(element);
    return () => ro.disconnect();
  }, [heightPxMax]);

  return <textarea ref={ref} rows={rowsMin} value={value} style={{ overflowX: 'hidden', resize: 'none', scrollbarGutter: 'stable', ...style }} {...props} />;
}

function fitTextarea(element: HTMLTextAreaElement | undefined, heightPxMax: number): void {
  if (element === undefined) {
    return;
  }
  element.style.height = 'auto';
  const fullPx = element.scrollHeight + 2;
  element.style.height = Math.min(fullPx, heightPxMax) + 'px';
  element.style.overflowY = fullPx > heightPxMax ? 'auto' : 'hidden';
}
