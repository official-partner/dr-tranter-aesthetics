import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { assert } from '../../../../shared/core/assert';
import { startTouchClaim, useTouchClaimGuard, type TouchClaim } from '../../../ui/touchClaim';

function sliderStyle(percent: number): CSSProperties & { readonly '--pct': string } {
  return { '--pct': `${percent}%` };
}

export default function DragSlider({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  ariaLabel,
  className,
  onPreview,
  onInput,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  onPreview?: (n: number) => void;
  onInput: (n: number) => void;
  onCommit: (n: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) {
      setLocal(value);
    }
  }, [value]);

  const { down, move, up, key } = useSliderDrag({
    trackRef,
    dragging,
    local,
    setLocal,
    min,
    max,
    step,
    disabled,
    onPreview,
    onInput,
    onCommit,
  });
  const percent = max > min ? Math.min(100, Math.max(0, ((local - min) / (max - min)) * 100)) : 0;
  return (
    <div
      ref={trackRef}
      className={['u-drag-slider', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={local}
      aria-disabled={disabled || undefined}
      style={sliderStyle(percent)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <span className="u-drag-slider-fill" aria-hidden="true" />
      <span className="u-drag-slider-thumb" aria-hidden="true" />
    </div>
  );
}

function sliderKeyHandler(drag: SliderDrag) {
  return (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (drag.disabled) {
      return;
    }
    const next = keyedValue(event, drag.local, drag.min, drag.max, drag.step);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const clamped = Math.min(drag.max, Math.max(drag.min, next));
    drag.setLocal(clamped);
    drag.onCommit(clamped);
  };
}

function keyedValue(event: ReactKeyboardEvent<HTMLDivElement>, local: number, min: number, max: number, step: number): number | undefined {
  assert(step > 0, 'DragSlider: keyboard step is positive');
  const delta = event.shiftKey ? step * 10 : step;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    return local - delta;
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    return local + delta;
  }
  if (event.key === 'Home') {
    return min;
  }
  if (event.key === 'End') {
    return max;
  }
  return undefined;
}

function valueAtX(
  track: HTMLDivElement | undefined,
  clientX: number,
  range: {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly fallback: number;
  },
): number {
  assert(range.step > 0, 'DragSlider: pointer step is positive');
  if (!track) {
    return range.fallback;
  }
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) {
    return range.fallback;
  }
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const continuous = range.min + ratio * (range.max - range.min);
  const stepped = range.min + Math.round((continuous - range.min) / range.step) * range.step;
  const rounded = Math.round(stepped * 1e8) / 1e8;
  return Math.min(range.max, Math.max(range.min, rounded));
}

type SliderDrag = {
  readonly trackRef: RefObject<HTMLDivElement>;
  readonly dragging: MutableRefObject<boolean>;
  readonly local: number;
  readonly setLocal: (value: number) => void;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly onPreview: ((n: number) => void) | undefined;
  readonly onInput: (n: number) => void;
  readonly onCommit: (n: number) => void;
};

function useSliderDrag(drag: SliderDrag) {
  const { trackRef, dragging, local, setLocal, min, max, step, disabled } = drag;
  const WRITE_MS = 50;
  const rafId = useRef<number | undefined>(undefined);
  const latestX = useRef(0);
  const lastWriteAt = useRef(0);
  const claim = useRef<TouchClaim | undefined>(undefined);
  useTouchClaimGuard();
  useEffect(
    () => () => {
      if (rafId.current !== undefined) {
        cancelAnimationFrame(rafId.current);
      }
      claim.current?.end();
    },
    [],
  );
  const endClaim = () => {
    claim.current?.end();
    claim.current = undefined;
  };
  const range = { min, max, step, fallback: local };
  const valueAt = (clientX: number) => valueAtX(trackRef.current ?? undefined, clientX, range);

  const frame = () => {
    rafId.current = undefined;
    const next = valueAt(latestX.current);
    setLocal(next);
    drag.onPreview?.(next);
    const now = performance.now();
    if (now - lastWriteAt.current >= WRITE_MS) {
      lastWriteAt.current = now;
      drag.onInput(next);
    }
  };
  const grab = (element: HTMLDivElement, clientX: number) => {
    assert(!dragging.current, 'DragSlider: a drag is grabbed once');
    element.focus();
    dragging.current = true;
    latestX.current = clientX;
    lastWriteAt.current = performance.now();
    const next = valueAt(clientX);
    setLocal(next);
    drag.onPreview?.(next);
    drag.onInput(next);
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    endClaim();
    const element = event.currentTarget;
    const clientX = event.clientX;
    const pressClaim = startTouchClaim(event, { axis: 'x' }, () => grab(element, clientX));
    claim.current = pressClaim;
    if (pressClaim.state() === 'claimed') {
      grab(element, clientX);
    }
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const state = claim.current?.move(event) ?? 'claimed';
    if (state === 'released') {
      assert(!dragging.current, 'DragSlider: a released touch never dragged');
      event.currentTarget.releasePointerCapture(event.pointerId);
      endClaim();
      return;
    }
    if (state === 'pending') {
      return;
    }
    if (!dragging.current) {
      grab(event.currentTarget, event.clientX);
    }
    latestX.current = event.clientX;
    if (rafId.current === undefined) {
      rafId.current = requestAnimationFrame(frame);
    }
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    const state = claim.current?.state() ?? 'claimed';
    endClaim();
    if (rafId.current !== undefined) {
      cancelAnimationFrame(rafId.current);
      rafId.current = undefined;
    }
    if (!dragging.current) {
      assert(state !== 'claimed', 'DragSlider: a claimed press is dragging');
      if (state === 'pending') {
        if (event.type === 'pointerup') {
          const tapped = valueAt(event.clientX);
          setLocal(tapped);
          drag.onPreview?.(tapped);
          drag.onCommit(tapped);
        }
      }
      return;
    }
    dragging.current = false;
    const next = valueAt(event.clientX);
    setLocal(next);
    drag.onCommit(next);
  };
  const key = sliderKeyHandler(drag);
  return { down, move, up, key };
}
