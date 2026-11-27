import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { assert } from '../../shared/core/assert';
import { clampFloatingOffset, FLOATING_DRAG_HANDLE_ATTRIBUTE, FLOATING_DRAG_IGNORE_SELECTOR, FLOATING_OFFSET_NONE, type FloatingOffset } from './floatingDrag';
import { usePointerDrag } from './usePointerDrag';

export function useFloatingDrag() {
  const [offset, setOffset] = useState<FloatingOffset>(FLOATING_OFFSET_NONE);
  const startPointer = usePointerDrag();
  const surface = useRef<HTMLElement | undefined>(undefined);
  useEffect(() => {
    const refit = (): void => {
      const element = surface.current;
      if (element?.isConnected) {
        setOffset((current) => clampFloatingOffset(element.getBoundingClientRect(), current, current, viewportSize()));
      }
    };
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, []);
  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || event.isPrimary === false) {
      return;
    }
    if (!(event.target instanceof Element)) {
      return;
    }
    if (!event.target.closest(`[${FLOATING_DRAG_HANDLE_ATTRIBUTE}]`)) {
      return;
    }
    if (event.target.closest(FLOATING_DRAG_IGNORE_SELECTOR)) {
      return;
    }
    const element = event.currentTarget;
    assert(element.contains(event.target), 'A floating drag starts inside its own surface');
    event.preventDefault();
    surface.current = element;
    const box = element.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    const start = offset;
    startPointer(event, {
      cursor: 'move',
      onMove: (next) => {
        const desired = { x: start.x + next.clientX - origin.x, y: start.y + next.clientY - origin.y };
        setOffset(clampFloatingOffset(box, start, desired, viewportSize()));
      },
    });
  };
  return { offset, onPointerDown };
}

function viewportSize(): { readonly width: number; readonly height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}
