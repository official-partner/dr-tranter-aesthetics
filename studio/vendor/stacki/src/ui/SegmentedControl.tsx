import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { segmentIndicatorStyle, useSegmentIndicator } from './segmentIndicator';
import { tooltipHost } from './delayedTooltip';
import './segmentedControl.css';

function tooltipStyle(style: CSSProperties, arrowLeft: number): CSSProperties & { readonly '--tip-arrow-left': string } {
  return { ...style, '--tip-arrow-left': `${arrowLeft}px` };
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  tooltip?: ReactNode;
};

const TOOLTIP_DELAY_MS = 500;

type Props<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  widthMode?: 'fill' | 'hug';
  disabled?: boolean;
};

export default function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, className, widthMode = 'fill', disabled = false }: Props<T>) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | undefined>>([]);
  const { indicator, animated } = useSegmentIndicator({
    trackRef: rootRef,
    buttonsRef,
    selectedIndex,
    layoutKey: `${options.length}:${widthMode}`,
  });
  const { hovered, startHover, endHover } = useSegmentHover(options);
  const hoveredButton = hovered !== undefined ? buttonsRef.current[hovered] : undefined;
  const activeTooltip = hovered !== undefined ? options[hovered]?.tooltip : undefined;

  return (
    <div
      ref={rootRef}
      className={segmentedClass({ widthMode, disabled, className })}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
    >
      <span className={`u-segmented-indicator${animated ? ' is-animated' : ''}`} aria-hidden="true" style={segmentIndicatorStyle(indicator)} />
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            buttonsRef.current[index] = element ?? undefined;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.ariaLabel}
          className={`u-segmented-button${option.value === value ? ' is-selected' : ''}`}
          disabled={disabled}
          onClick={() => {
            endHover();
            onChange(option.value);
          }}
          onMouseEnter={() => startHover(index)}
          onMouseLeave={endHover}
        >
          {option.label}
        </button>
      ))}

      {activeTooltip && hoveredButton ? <HoverTooltip anchor={hoveredButton}>{activeTooltip}</HoverTooltip> : undefined}
    </div>
  );
}

function segmentedClass({
  widthMode,
  disabled,
  className,
}: {
  readonly widthMode: 'fill' | 'hug';
  readonly disabled: boolean;
  readonly className: string | undefined;
}): string {
  return ['u-segmented', widthMode === 'hug' ? 'is-hug' : '', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ');
}

function useSegmentHover<T extends string>(options: ReadonlyArray<SegmentedOption<T>>) {
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);
  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== undefined) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = undefined;
    }
  }, []);
  useEffect(() => clearHoverTimer, [clearHoverTimer]);
  const startHover = (index: number) => {
    if (!options[index]?.tooltip) {
      return;
    }
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      setHovered(index);
    }, TOOLTIP_DELAY_MS);
  };
  const endHover = () => {
    clearHoverTimer();
    setHovered(undefined);
  };
  return { hovered, startHover, endHover };
}

export function HoverTooltip({ anchor, children }: { anchor: HTMLElement; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    visibility: 'hidden',
  });
  const [arrow, setArrow] = useState<{ left: number; above: boolean }>({ left: 0, above: true });

  useLayoutEffect(() => {
    const place = () => {
      const element = ref.current;
      if (!element) {
        return;
      }
      const margin = 8;
      const gap = 8;
      const anchorRect = anchor.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      const centerX = anchorRect.left + anchorRect.width / 2;
      const left = Math.max(margin, Math.min(centerX - width / 2, window.innerWidth - margin - width));
      const fitsAbove = anchorRect.top - gap - height >= margin;
      const below = Math.max(margin, Math.min(anchorRect.bottom + gap, window.innerHeight - margin - height));
      const top = fitsAbove ? anchorRect.top - gap - height : below;
      const arrowLeft = Math.max(12, Math.min(centerX - left, width - 12));
      setArrow({ left: arrowLeft, above: fitsAbove });
      setStyle({ position: 'fixed', top, left, visibility: 'visible' });
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(() => place()) : undefined;
    if (ref.current) {
      ro?.observe(ref.current);
    }
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  return createPortal(
    <div ref={ref} className={`u-segmented-popup ${arrow.above ? 'is-above' : 'is-below'}`} role="tooltip" style={tooltipStyle(style, arrow.left)}>
      {children}
      <span className="u-segmented-popup-arrow" aria-hidden="true" />
    </div>,
    tooltipHost(anchor),
  );
}
