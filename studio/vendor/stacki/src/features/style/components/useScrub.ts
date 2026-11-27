import { useCallback, useEffect, useRef, useState } from 'react';
import { assert } from '../../../../shared/core/assert';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import { caretAtX } from '../model/caretAtX';
import { findScrubTarget, hasScrubTarget, scrubNumber, stepModeOf } from '../model/numberStep';
import type { NumberRun, StepMode } from '../model/numberStep';
import { startTouchClaim, useTouchClaimGuard, type TouchClaim } from '../../../ui/touchClaim';


const DEAD_ZONE = 3;
const PX_PER_STEP = 1;
const WRITE_MS = 50;

type Surface = 'input' | 'label';

type Drag = {
  pointerId: number;
  startX: number;
  base: string;
  run: NumberRun;
  mode: StepMode;
  moved: boolean;
  latestX: number;
  raf: number | undefined;
  lastWriteAt: number;
  text: string;
  claim: TouchClaim;
};

export type ScrubHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
};

type ScrubOptions = {
  value: string;
  disabled?: boolean;
  stepScale?: number;
  onPreview?: (text: string) => void;
  onInput?: (text: string) => void;
  onCommit: (text: string) => void;
};

type DragRef = MutableRefObject<Drag | undefined>;
type LatestOptions = MutableRefObject<ScrubOptions>;

export default function useScrub(options: ScrubOptions): {
  input: ScrubHandlers;
  label: ScrubHandlers;
} {
  const latest = useRef(options);
  latest.current = options;
  useTouchClaimGuard();
  const drag = useRef<Drag | undefined>(undefined);
  const { frame, finish } = useDragFrames(drag, latest);
  const { onPointerMove, onPointerUp } = useDragMoves(drag, frame, finish);
  const hover = useScrubHover({ disabled: options.disabled ?? false, value: options.value });
  const { onInputPointerDown, onLabelPointerDown } = useScrubPresses(drag, latest);

  const shared = {
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
    onPointerLeave: hover.onPointerLeave,
  };
  return {
    input: {
      ...shared,
      onPointerDown: onInputPointerDown,
      onPointerEnter: hover.onInputPointerEnter,
    },
    label: {
      ...shared,
      onPointerDown: onLabelPointerDown,
      onPointerEnter: hover.onLabelPointerEnter,
    },
  };
}

function useDragFrames(dragRef: DragRef, latest: LatestOptions) {
  const frame = useCallback(() => {
    const state = dragRef.current;
    if (!state) {
      return;
    }
    state.raf = undefined;
    const steps = Math.round((state.latestX - state.startX) / PX_PER_STEP);
    const text = scrubNumber(state.base, state.run, steps, state.mode, latest.current.stepScale);
    if (text === state.text) {
      return;
    }
    state.text = text;
    latest.current.onPreview?.(text);
    const now = performance.now();
    if (now - state.lastWriteAt >= WRITE_MS) {
      state.lastWriteAt = now;
      latest.current.onInput?.(text);
    }
  }, [dragRef, latest]);

  const finish = useCallback(() => {
    const state = dragRef.current;
    if (!state) {
      return;
    }
    dragRef.current = undefined;
    state.claim.end();
    if (state.raf !== undefined) {
      cancelAnimationFrame(state.raf);
    }
    document.body.classList.remove('is-scrubbing');
    if (!state.moved) {
      return;
    }
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    latest.current.onCommit(state.text);
  }, [dragRef, latest]);

  useEffect(() => finish, [finish]);
  return { frame, finish };
}

function useDragMoves(dragRef: DragRef, frame: () => void, finish: () => void) {
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }
      const claim = state.claim.move(event);
      if (claim === 'released') {
        assert(!state.moved, 'useScrub: a released touch never scrubbed');
        finish();
        return;
      }
      if (claim === 'pending') {
        return;
      }
      state.latestX = event.clientX;
      state.mode = stepModeOf(event);
      if (!state.moved) {
        if (Math.abs(event.clientX - state.startX) < DEAD_ZONE) {
          return;
        }
        state.moved = true;
        document.body.classList.add('is-scrubbing');
      }
      if (state.raf === undefined) {
        state.raf = requestAnimationFrame(frame);
      }
    },
    [dragRef, finish, frame],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragRef.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }
      if (state.moved) {
        state.latestX = event.clientX;
        if (state.raf !== undefined) {
          cancelAnimationFrame(state.raf);
          state.raf = undefined;
        }
        frame();
      }
      finish();
    },
    [dragRef, finish, frame],
  );
  return { onPointerMove, onPointerUp };
}

function useScrubHover({ disabled, value }: { readonly disabled: boolean; readonly value: string }) {
  const hoverElement = useRef<HTMLElement | undefined>(undefined);
  const hoverSurface = useRef<Surface>('input');
  const [hovering, setHovering] = useState(false);
  const [modifierHeld, setModifierHeld] = useState(false);

  const enter = useCallback((surface: Surface, event: ReactPointerEvent<HTMLElement>) => {
    hoverElement.current = event.currentTarget;
    hoverSurface.current = surface;
    setModifierHeld(event.altKey || event.shiftKey);
    setHovering(true);
  }, []);
  const onInputPointerEnter = useCallback((event: ReactPointerEvent<HTMLElement>) => enter('input', event), [enter]);
  const onLabelPointerEnter = useCallback((event: ReactPointerEvent<HTMLElement>) => enter('label', event), [enter]);
  const onPointerLeave = useCallback(() => {
    hoverElement.current = undefined;
    setHovering(false);
  }, []);

  useEffect(() => {
    if (!hovering || hoverSurface.current === 'label') {
      return;
    }
    const sync = (event: KeyboardEvent) => setModifierHeld(event.altKey || event.shiftKey);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
    };
  }, [hovering]);

  useEffect(() => {
    const element = hoverElement.current;
    if (!element || !hovering) {
      return;
    }
    const armed = !disabled && hasScrubTarget(value) && (hoverSurface.current === 'label' || modifierHeld);
    element.style.cursor = armed ? 'ew-resize' : '';
    return () => {
      element.style.cursor = '';
    };
  }, [hovering, modifierHeld, disabled, value]);
  return { onInputPointerEnter, onLabelPointerEnter, onPointerLeave };
}

function useScrubPresses(dragRef: DragRef, latest: LatestOptions) {
  const begin = useCallback(
    (event: ReactPointerEvent<HTMLElement>, base: string, run: NumberRun) => {
      if (dragRef.current) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        base,
        run,
        mode: stepModeOf(event),
        moved: false,
        latestX: event.clientX,
        raf: undefined,
        lastWriteAt: performance.now(),
        text: base,
        claim: startTouchClaim(event, { axis: 'x' }),
      };
    },
    [dragRef],
  );

  const onInputPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (latest.current.disabled || event.button !== 0) {
        return;
      }
      if (!event.altKey && !event.shiftKey) {
        return;
      }
      const element = event.currentTarget;
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
        return;
      }
      const run = findScrubTarget(element.value, caretAtX(element, event.clientX));
      if (!run) {
        return;
      }
      event.preventDefault();
      begin(event, element.value, run);
    },
    [begin, latest],
  );

  const onLabelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (latest.current.disabled || event.button !== 0) {
        return;
      }
      const run = findScrubTarget(latest.current.value, 0);
      if (!run) {
        return;
      }
      begin(event, latest.current.value, run);
    },
    [begin, latest],
  );
  return { onInputPointerDown, onLabelPointerDown };
}
