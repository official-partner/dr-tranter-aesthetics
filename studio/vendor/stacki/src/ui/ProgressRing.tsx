import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { assert } from '../../shared/core/assert';
import Popup from './Popup';
import './progressRing.css';

export type RingTone = 'neutral' | 'amber' | 'red';

export const RING_AMBER_FROM = 0.7;
export const RING_RED_FROM = 0.9;

export function ringToneFor(value: number | undefined): RingTone {
  if (value === undefined) {
    return 'neutral';
  }
  assert(Number.isFinite(value), 'ringToneFor: value is finite');
  if (value >= RING_RED_FROM) {
    return 'red';
  }
  if (value >= RING_AMBER_FROM) {
    return 'amber';
  }
  return 'neutral';
}

const VIEW_BOX_PX = 20;
const FULL_LENGTH = 100;
const STROKE_SCREEN_PX_MIN = 2;
const STROKE_SCREEN_PX_MAX = 3;

function strokeUnits(sizePx: number): number {
  const screenPx = Math.min(STROKE_SCREEN_PX_MAX, Math.max(STROKE_SCREEN_PX_MIN, sizePx / 8));
  return (screenPx * VIEW_BOX_PX) / sizePx;
}

export function ringDrawnLength(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  assert(Number.isFinite(value), 'ringDrawnLength: value is finite');
  return Math.min(1, Math.max(0, value)) * FULL_LENGTH;
}

export interface ProgressRingProps {
  readonly value: number | undefined;
  readonly indeterminate?: boolean;
  readonly tone?: RingTone;
  readonly sizePx?: number;
  readonly label: string;
  readonly tooltip?: ReactNode;
}

type TooltipState = { readonly kind: 'closed' } | { readonly kind: 'open' | 'closing'; readonly left: number; readonly bottom: number };

export function ProgressRing(props: ProgressRingProps) {
  const sizePx = props.sizePx ?? 16;
  assert(sizePx > 0, 'ProgressRing: positive size');
  const tone = props.tone ?? ringToneFor(props.value);
  const stroke = strokeUnits(sizePx);
  const radius = (VIEW_BOX_PX - stroke) / 2;
  const indeterminate = props.indeterminate === true;
  const drawn = indeterminate ? FULL_LENGTH / 4 : ringDrawnLength(props.value);
  const identifier = useId();
  const [tooltip, setTooltip] = useState<TooltipState>({ kind: 'closed' });
  const hasTooltip = props.tooltip !== undefined;
  const show = (element: HTMLElement): void => {
    const rectangle = element.getBoundingClientRect();
    setTooltip({ kind: 'open', left: rectangle.left + rectangle.width / 2, bottom: window.innerHeight - rectangle.top + 8 });
  };
  const hide = (): void => setTooltip((previous) => (previous.kind === 'closed' ? previous : { ...previous, kind: 'closing' }));
  return (
    <>
      <span
        className="progress-ring"
        data-tone={tone}
        role="img"
        aria-label={props.label}
        aria-describedby={tooltip.kind === 'open' ? identifier : undefined}
        tabIndex={hasTooltip ? 0 : undefined}
        style={{ width: sizePx, height: sizePx }}
        onMouseEnter={hasTooltip ? (event) => show(event.currentTarget) : undefined}
        onMouseLeave={hasTooltip ? hide : undefined}
        onFocus={hasTooltip ? (event) => show(event.currentTarget) : undefined}
        onBlur={hasTooltip ? hide : undefined}
      >
        <svg
          className={indeterminate ? 'progress-ring-turning' : undefined}
          width={sizePx}
          height={sizePx}
          viewBox={`0 0 ${VIEW_BOX_PX} ${VIEW_BOX_PX}`}
          aria-hidden="true"
          focusable="false"
        >
          <circle className="progress-ring-track" cx={VIEW_BOX_PX / 2} cy={VIEW_BOX_PX / 2} r={radius} strokeWidth={stroke} fill="none" />
          {}
          {drawn > 0 && (
            <circle
              className="progress-ring-fill"
              cx={VIEW_BOX_PX / 2}
              cy={VIEW_BOX_PX / 2}
              r={radius}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              pathLength={FULL_LENGTH}
              strokeDasharray={`${drawn} ${FULL_LENGTH}`}
              transform={`rotate(-90 ${VIEW_BOX_PX / 2} ${VIEW_BOX_PX / 2})`}
            />
          )}
        </svg>
      </span>
      {tooltip.kind !== 'closed' && hasTooltip && (
        <Popup
          mode="popover"
          role="tooltip"
          id={identifier}
          open={tooltip.kind === 'open'}
          dismissible={false}
          onClose={() => setTooltip({ kind: 'closed' })}
          className="popup-tooltip progress-ring-tooltip"
          style={{ position: 'fixed', left: tooltip.left, bottom: tooltip.bottom, transform: 'translateX(-50%)' }}
        >
          {props.tooltip}
        </Popup>
      )}
    </>
  );
}
