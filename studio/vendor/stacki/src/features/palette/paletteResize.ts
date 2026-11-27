import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { assert } from '../../../shared/core/assert';
import { prefersReducedMotion } from '../../ui/segmentIndicator';


export const paletteResizeMs = 240;

const sizeEpsilonPx = 0.5;

export interface PaletteSize {
  readonly width: number;
  readonly height: number;
}

export type PaletteMotion = 'full' | 'reduced';

export type PaletteResizePlan = { readonly kind: 'none' } | { readonly kind: 'animate'; readonly from: PaletteSize; readonly to: PaletteSize };

export function planPaletteResize(from: PaletteSize | undefined, to: PaletteSize, motion: PaletteMotion): PaletteResizePlan {
  assertSize(to);
  if (from === undefined) {
    return { kind: 'none' };
  }
  assertSize(from);
  if (motion === 'reduced') {
    return { kind: 'none' };
  }
  const widthSame = Math.abs(from.width - to.width) < sizeEpsilonPx;
  const heightSame = Math.abs(from.height - to.height) < sizeEpsilonPx;
  if (widthSame) {
    if (heightSame) {
      return { kind: 'none' };
    }
  }
  return { kind: 'animate', from, to };
}

export function usePaletteResize(paletteRef: RefObject<HTMLElement>, layoutKey: string): void {
  const lastSize = useRef<PaletteSize | undefined>(undefined);
  const previousKey = useRef(layoutKey);
  const timer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const palette = paletteRef.current;
    assert(palette !== null, 'paletteResize: the palette is mounted');
    lastSize.current = measurePalette(palette);
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      lastSize.current = measurePalette(palette);
    });
    observer.observe(palette);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer.current);
    };
  }, [paletteRef]);

  useLayoutEffect(() => {
    if (previousKey.current === layoutKey) {
      return;
    }
    previousKey.current = layoutKey;
    const palette = paletteRef.current;
    assert(palette !== null, 'paletteResize: the palette is mounted');
    const from = lastSize.current;
    window.clearTimeout(timer.current);
    endPaletteResize(palette);
    const to = measurePalette(palette);
    const contentWidth = palette.clientWidth;
    lastSize.current = to;
    const plan = planPaletteResize(from, to, prefersReducedMotion() ? 'reduced' : 'full');
    if (plan.kind === 'none') {
      return;
    }
    startPaletteResize(palette, plan, contentWidth);
    timer.current = window.setTimeout(() => endPaletteResize(palette), paletteResizeMs);
  }, [paletteRef, layoutKey]);
}

function measurePalette(palette: HTMLElement): PaletteSize {
  return { width: palette.offsetWidth, height: palette.offsetHeight };
}

function startPaletteResize(palette: HTMLElement, plan: Extract<PaletteResizePlan, { kind: 'animate' }>, contentWidth: number): void {
  assert(contentWidth >= 0, 'paletteResize: content width is not negative');
  palette.style.setProperty('--insert-palette-content-width', `${contentWidth}px`);
  palette.style.setProperty('--insert-palette-resize-ms', `${paletteResizeMs}ms`);
  palette.style.setProperty('width', `${plan.from.width}px`);
  palette.style.setProperty('height', `${plan.from.height}px`);
  palette.classList.add('is-resizing');
  assert(palette.offsetWidth >= 0, 'paletteResize: the start size is laid out');
  palette.classList.add('is-resizing-run');
  palette.style.setProperty('width', `${plan.to.width}px`);
  palette.style.setProperty('height', `${plan.to.height}px`);
}

function endPaletteResize(palette: HTMLElement): void {
  palette.classList.remove('is-resizing', 'is-resizing-run');
  palette.style.removeProperty('width');
  palette.style.removeProperty('height');
  palette.style.removeProperty('--insert-palette-content-width');
  palette.style.removeProperty('--insert-palette-resize-ms');
}

function assertSize(size: PaletteSize): void {
  assert(Number.isFinite(size.width), 'paletteResize: width is finite');
  assert(Number.isFinite(size.height), 'paletteResize: height is finite');
  assert(size.width >= 0, 'paletteResize: width is not negative');
  assert(size.height >= 0, 'paletteResize: height is not negative');
}
