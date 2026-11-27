
import { useEffect, useId, useRef } from 'react';
import { getHost } from './model/host';
import { getModifiers, onModifiers, setModifiers } from '../../editor/heldModifiers';
import { assert } from '../../../shared/core/assert';
import { type SetProp, type LiveSetProp, type Read, type Side, type Display, displayOf } from './spacingTypes';
import { withImportant } from './model/styleDisplay';
import { projectLengthUnit } from './model/lengthUnit';
import { formatPxLength, projectLength, type LengthUnit } from '../../../shared/properties/lengthUnit';
import { startTouchClaim, useTouchClaimGuard, type TouchClaim } from '../../ui/touchClaim';



export const SIDE_AXIS: Record<Side, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
  top: { axis: 'y', sign: -1 },
  bottom: { axis: 'y', sign: 1 },
  left: { axis: 'x', sign: -1 },
  right: { axis: 'x', sign: 1 },
};

export const ALL_SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
export const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

export function affectedSides(side: Side, event: { shiftKey: boolean; altKey: boolean }): Side[] {
  if (event.shiftKey) {
    return ALL_SIDES;
  }
  if (event.altKey) {
    return [side, OPPOSITE[side]];
  }
  return [side];
}

export function siblingProps(prop: string, side: Side, sides: Side[]): string[] {
  if (!prop.endsWith(side)) {
    return [prop];
  }
  const prefix = prop.slice(0, prop.length - side.length);
  return sides.map((sibling) => `${prefix}${sibling}`);
}

export const DRAG_SENSITIVITY = 0.5;

export function parseAmountUnit(value: string): { amount: number; unit: string } {
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*([a-z%]*)$/i);
  if (!match) {
    return { amount: 0, unit: '' };
  }
  return { amount: parseFloat(match[1] ?? ''), unit: (match[2] ?? '').toLowerCase() };
}

export function pxPerUnit(unit: string): number {
  switch (unit) {
    case 'px':
      return 1;
    case 'rem':
    case 'em':
      return 16;
    case 'pt':
      return 96 / 72;
    default:
      return 16;
  }
}

export function formatLength(amount: number, unit: string, lengthUnit: LengthUnit = projectLengthUnit()): string {
  if (lengthUnit.kind === 'rem' && unit === 'rem') {
    return formatPxLength(Math.round(amount * lengthUnit.rootFontPx), lengthUnit);
  }
  const rounded = unit === 'px' || unit === '%' ? Math.round(amount) : Math.round(amount * 100) / 100;
  return `${rounded}${unit}`;
}

export const FRAMES = {
  margin: {
    w: 224,
    h: 112,
    or: 4,
    ir: 4,
    mask: { x: 35, y: 23, w: 154, h: 66 },
    paths: {
      top: 'm0,0 h224 l-36,24 h-152 l-36,-24z',
      right: 'm224,0 v112 l-36,-24 v-64 l36,-24z',
      bottom: 'm0,112 h224 l-36,-24 h-152 l-36,24z',
      left: 'm0,0 v112 l36,-24 v-64 l-36,-24z',
    },
  },
  padding: {
    w: 150,
    h: 60,
    or: 2,
    ir: 2,
    mask: { x: 35, y: 23, w: 80, h: 14 },
    paths: {
      top: 'm0,0 h150 l-36,24 h-78 l-36,-24z',
      right: 'm150,0 v60 l-36,-24 v-12 l36,-24z',
      bottom: 'm0,60 h150 l-36,-24 h-78 l-36,24z',
      left: 'm0,0 v60 l36,-24 v-12 l-36,-24z',
    },
  },
  position: {
    w: 172,
    h: 56,
    or: 4,
    ir: 4,
    mask: { x: 35, y: 23, w: 102, h: 10 },
    paths: {
      top: 'm0,0 h172 l-36,24 h-100 l-36,-24z',
      right: 'm172,0 v56 l-36,-24 v-8 l36,-24z',
      bottom: 'm0,56 h172 l-36,-24 h-100 l-36,24z',
      left: 'm0,0 v56 l36,-24 v-8 l-36,-24z',
    },
  },
} as const;

export type FrameKey = keyof typeof FRAMES;

export type FillProps = {
  frame: FrameKey;
  propFor: (side: Side) => string;
  inward?: boolean;
  read: Read;
  busy: boolean;
  setProp: SetProp;
  liveSetProp: LiveSetProp;
  onLive: (props: string[], display: string) => void;
  onLiveEnd: () => void;
};

export type SideDragOptions = {
  propFor: (side: Side) => string;
  inward: boolean;
  kind: 'padding' | 'margin';
  read: Read;
  busy: boolean;
  setProp: SetProp;
  liveSetProp: LiveSetProp;
  onLive: (props: string[], display: string) => void;
  onLiveEnd: () => void;
  threshold?: number;
};

let dragReporting = false;

function reportDrag(
  box: { readonly kind: 'padding' | 'margin'; readonly propFor: (side: Side) => string },
  sides: readonly Side[],
  held: { readonly value: string; readonly live: boolean },
): void {
  dragReporting = held.live;
  const labels: Record<string, string> = {};
  const ahead: Record<string, string> = {};
  for (const side of sides) {
    labels[side] = held.value;
    if (held.live && /^(padding|margin)-/.test(box.propFor(side))) {
      ahead[side] = held.value;
    }
  }
  getHost().onSpacingHover?.({
    kind: box.kind,
    sides: [...sides],
    labels,
    ...(Object.keys(ahead).length > 0 ? { live: ahead } : {}),
  });
}

function useDragReport(
  dragRef: React.MutableRefObject<SideDrag | undefined>,
  box: { readonly kind: 'padding' | 'margin'; readonly propFor: (side: Side) => string },
) {
  useEffect(
    () => () => {
      if (dragRef.current) {
        dragReporting = false;
      }
    },
    [dragRef],
  );
  return {
    live: (drag: SideDrag, display: string): void => {
      const value = display.replace(/ !important$/, '');
      reportDrag(box, affectedSides(drag.side, drag), { value, live: true });
    },
    release: (drag: SideDrag, value: string): void => {
      reportDrag(box, affectedSides(drag.side, drag), { value, live: false });
    },
  };
}

export function useSideDrag({ propFor, inward, kind, read, busy, setProp, liveSetProp, onLive, onLiveEnd, threshold = 0 }: SideDragOptions) {
  const dragRef = useRef<SideDrag | undefined>(undefined);
  const dragged = useRef(false);
  const claimRef = useRef<TouchClaim | undefined>(undefined);
  useTouchClaimGuard();
  useEffect(() => () => claimRef.current?.end(), []);
  const endClaim = () => {
    claimRef.current?.end();
    claimRef.current = undefined;
  };
  const report = useDragReport(dragRef, { kind, propFor });
  const frame = useLiveFrame(dragRef, liveSetProp, (props, display, drag) => {
    onLive(props, display);
    report.live(drag, display);
  });

  const apply = useDragApply({
    dragRef,
    draggedRef: dragged,
    propFor,
    inward,
    liveSetProp,
    frame,
  });
  useDragModifiers(dragRef, apply);

  const onPointerDown = (side: Side) => (event: React.PointerEvent) => {
    if (busy) {
      return;
    }
    if (threshold === 0) {
      event.preventDefault();
    }
    const shown = displayOf(read(propFor(side)));
    const drag = startSideDrag({ side, shown, inward, threshold, event });
    endClaim();
    const claim = startTouchClaim(event, { axis: SIDE_AXIS[side].axis === 'x' ? 'x' : 'hold' }, () => {
      if (threshold === 0 && dragRef.current === drag) {
        drag.active = true;
      }
    });
    if (claim.state() !== 'claimed') {
      drag.active = false;
    }
    assert(claim.state() === 'claimed' || !drag.active, 'useSideDrag: an unclaimed touch is not a drag yet');
    dragRef.current = drag;
    claimRef.current = claim;
    dragged.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const claim = claimRef.current?.move(event) ?? 'claimed';
    if (claim === 'released') {
      assert(!dragged.current, 'useSideDrag: a released touch never dragged');
      dragRef.current = undefined;
      endClaim();
      return;
    }
    if (claim === 'pending') {
      return;
    }
    if (threshold === 0) {
      drag.active = true;
    }
    if (followPointer(dragRef, event, threshold)) {
      apply();
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    endClaim();
    if (!drag) {
      return;
    }
    frame.cancel();
    if (drag.active) {
      followPointer(dragRef, event, threshold);
      apply();
      frame.cancel();
    }
    const value = drag.active ? dragValue(drag, { inward }) : undefined;
    dragRef.current = undefined;
    if (value === undefined) {
      return;
    }
    onLiveEnd();
    report.release(drag, value);
    drag.props.forEach((prop) => setProp(prop, value, drag.important));
  };

  return { onPointerDown, onPointerMove, onPointerUp, wasDrag: () => dragged.current };
}

export function useDragApply({
  dragRef,
  draggedRef,
  propFor,
  inward,
  liveSetProp,
  frame,
}: {
  dragRef: React.MutableRefObject<SideDrag | undefined>;
  draggedRef: React.MutableRefObject<boolean>;
  propFor: (side: Side) => string;
  inward: boolean;
  liveSetProp: LiveSetProp;
  frame: { queue: (value: string) => void };
}) {
  return () => {
    const drag = dragRef.current;
    if (!drag?.active) {
      return;
    }
    draggedRef.current = true;
    const next = affectedSides(drag.side, drag).map((side) => propFor(side));
    for (const prop of drag.written) {
      if (!next.includes(prop)) {
        liveSetProp(prop, undefined, drag.important);
        drag.written.delete(prop);
      }
    }
    drag.props = next;
    for (const prop of next) {
      drag.written.add(prop);
    }
    const value = dragValue(drag, { inward });
    frame.queue(value);
  };
}

export type SideDrag = {
  side: Side;
  props: string[];
  written: Set<string>;
  unit: string;
  startAmount: number;
  axis: 'x' | 'y';
  sign: 1 | -1;
  startX: number;
  startY: number;
  x: number;
  y: number;
  shiftKey: boolean;
  altKey: boolean;
  important: boolean;
  active: boolean;
};

export function startSideDrag({
  side,
  shown,
  inward,
  threshold,
  event,
}: {
  side: Side;
  shown: Display;
  inward: boolean;
  threshold: number;
  event: React.PointerEvent;
}): SideDrag {
  const authored = parseAmountUnit(shown.value);
  const { amount, unit } = projectLength(authored.amount, authored.unit, projectLengthUnit());
  const sideAxis = SIDE_AXIS[side];
  const sign: 1 | -1 = inward ? (sideAxis.sign === 1 ? -1 : 1) : sideAxis.sign;
  return {
    side,
    props: [],
    written: new Set(),
    unit: unit || 'rem',
    startAmount: amount,
    axis: sideAxis.axis,
    sign,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    important: shown.important,
    active: threshold === 0,
  };
}

export function dragValue(drag: SideDrag, { inward }: { inward: boolean }): string {
  assert(drag.unit !== '', 'dragValue: a drag always carries a unit (rem when none was set)');
  const px = (drag.axis === 'x' ? drag.x - drag.startX : drag.y - drag.startY) * drag.sign;
  const next = drag.startAmount + (px * DRAG_SENSITIVITY) / pxPerUnit(drag.unit);
  if (inward && next < 0) {
    return formatLength(0, drag.unit);
  }
  return formatLength(next, drag.unit);
}

export function followPointer(
  dragRef: React.MutableRefObject<SideDrag | undefined>,
  event: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean },
  threshold: number,
): boolean {
  const drag = dragRef.current;
  if (!drag) {
    return false;
  }
  drag.x = event.clientX;
  drag.y = event.clientY;
  drag.shiftKey = event.shiftKey;
  drag.altKey = event.altKey;
  if (drag.active) {
    return true;
  }
  const far = Math.abs(event.clientX - drag.startX) >= threshold || Math.abs(event.clientY - drag.startY) >= threshold;
  if (far) {
    drag.active = true;
  }
  return far;
}

export function useLiveFrame(
  dragRef: React.MutableRefObject<SideDrag | undefined>,
  liveSetProp: LiveSetProp,
  onLive: (props: string[], display: string, drag: SideDrag) => void,
) {
  const raf = useRef<number | undefined>(undefined);
  const pending = useRef<string | undefined>(undefined);
  const cancel = () => {
    if (raf.current !== undefined) {
      cancelAnimationFrame(raf.current);
      raf.current = undefined;
    }
    pending.current = undefined;
  };
  useEffect(() => cancel, []);
  const flush = () => {
    raf.current = undefined;
    const drag = dragRef.current;
    const value = pending.current;
    if (drag && value !== undefined) {
      onLive(drag.props, withImportant({ value, important: drag.important }), drag);
      liveSetProp(drag.props, value, drag.important);
    }
  };
  const queue = (value: string) => {
    pending.current = value;
    if (raf.current === undefined) {
      raf.current = requestAnimationFrame(flush);
    }
  };
  return { queue, cancel };
}

export function useDragModifiers(dragRef: React.MutableRefObject<SideDrag | undefined>, apply: () => void): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const follow = ({ shiftKey, altKey }: { shiftKey: boolean; altKey: boolean }) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      if (drag.shiftKey === shiftKey && drag.altKey === altKey) {
        return;
      }
      drag.shiftKey = shiftKey;
      drag.altKey = altKey;
      applyRef.current();
    };
    const onKey = (event: KeyboardEvent) => setModifiers({ shiftKey: event.shiftKey, altKey: event.altKey });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    const offModifiers = onModifiers(follow);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      offModifiers();
    };
  }, [dragRef]);
}

export function useSideHover({ propFor, kind, read }: { propFor: (side: Side) => string; kind: 'padding' | 'margin'; read: Read }) {
  const overRef = useRef<HoveredSide | undefined>(undefined);

  const report = () => {
    if (dragReporting) {
      return;
    }
    const hovered = overRef.current;
    if (!hovered) {
      getHost().onSpacingHover?.(undefined);
      return;
    }
    const sides = affectedSides(hovered.side, hovered);
    const labels: Record<string, string> = {};
    for (const side of sides) {
      try {
        const shown = displayOf(read(propFor(side)));
        labels[side] = shown.present ? shown.value : '0';
      } catch {
      }
    }
    getHost().onSpacingHover?.({ kind, sides, labels });
  };
  useHoverModifiers(overRef, report);

  return {
    onEnter: (side: Side) => (event: React.MouseEvent | React.PointerEvent) => {
      const held = getModifiers();
      overRef.current = {
        side,
        shiftKey: event.shiftKey || held.shiftKey,
        altKey: event.altKey || held.altKey,
      };
      report();
    },
    onLeave: () => {
      if (!overRef.current) {
        return;
      }
      overRef.current = undefined;
      report();
    },
    onOver: (event: React.MouseEvent | React.PointerEvent) => {
      const hovered = overRef.current;
      if (!hovered) {
        return;
      }
      if (hovered.shiftKey === event.shiftKey && hovered.altKey === event.altKey) {
        return;
      }
      hovered.shiftKey = event.shiftKey;
      hovered.altKey = event.altKey;
      report();
    },
  };
}

export type HoveredSide = { side: Side; shiftKey: boolean; altKey: boolean };

export function useHoverModifiers(overRef: React.MutableRefObject<HoveredSide | undefined>, report: () => void): void {
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    const follow = ({ shiftKey, altKey }: { shiftKey: boolean; altKey: boolean }) => {
      const hovered = overRef.current;
      if (!hovered) {
        return;
      }
      if (hovered.shiftKey === shiftKey && hovered.altKey === altKey) {
        return;
      }
      hovered.shiftKey = shiftKey;
      hovered.altKey = altKey;
      reportRef.current();
    };
    const onKey = (event: KeyboardEvent) => setModifiers({ shiftKey: event.shiftKey, altKey: event.altKey });
    const onBlur = () => setModifiers({ shiftKey: false, altKey: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    const offModifiers = onModifiers(follow);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
      offModifiers();
      if (overRef.current) {
        overRef.current = undefined;
        getHost().onSpacingHover?.(undefined);
      }
    };
  }, [overRef]);
}

export function SpacingFill({ frame, inward = false, ...dragOptions }: FillProps) {
  const geometry = FRAMES[frame];
  const maskId = 'sp-' + useId().replace(/:/g, '');
  const kind = inward ? 'padding' : 'margin';
  const { onPointerDown, onPointerMove, onPointerUp } = useSideDrag({
    ...dragOptions,
    inward,
    kind,
  });
  const hover = useSideHover({ propFor: dragOptions.propFor, kind, read: dragOptions.read });

  return (
    <svg className="embed-editor_spacing-fill" viewBox={`0 0 ${geometry.w} ${geometry.h}`} preserveAspectRatio="none" aria-hidden="true">
      <mask id={maskId} maskContentUnits="userSpaceOnUse">
        <rect x="0" y="0" width={geometry.w} height={geometry.h} rx={geometry.or} ry={geometry.or} fill="#fff" />
        <rect x={geometry.mask.x} y={geometry.mask.y} width={geometry.mask.w} height={geometry.mask.h} rx={geometry.ir} ry={geometry.ir} fill="#000" />
      </mask>
      <g mask={`url(#${maskId})`}>
        {(['top', 'right', 'bottom', 'left'] satisfies Side[]).map((side) => (
          <path
            key={side}
            className={`embed-editor_spacing-tri is-${side}`}
            d={geometry.paths[side]}
            onPointerDown={onPointerDown(side)}
            onPointerMove={(event) => {
              hover.onOver(event);
              onPointerMove(event);
            }}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerEnter={hover.onEnter(side)}
            onPointerLeave={hover.onLeave}
          />
        ))}
      </g>
    </svg>
  );
}
