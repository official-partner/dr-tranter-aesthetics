import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { HoverTooltip } from '../../../ui/SegmentedControl';


const TIP_DELAY_MS = 500;

export function PropTip({ props, note }: { props: readonly string[]; note?: ReactNode }) {
  return (
    <>
      <span className="u-prop-tip">{props.join(', ')}</span>
      {note ? <div className="u-prop-tip-note">{note}</div> : undefined}
    </>
  );
}

export function useHoverTip<T extends HTMLElement>(content: ReactNode) {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const cancel = useCallback(() => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);
  useEffect(() => cancel, [cancel]);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);
  const hoverProps = content
    ? {
        onMouseEnter: () => {
          cancel();
          timer.current = window.setTimeout(() => {
            timer.current = undefined;
            setOpen(true);
          }, TIP_DELAY_MS);
        },
        onMouseLeave: hide,
      }
    : {};

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const away = (event: Event) => {
      const element = ref.current;
      if (!element || !element.isConnected || !(event.target instanceof Node) || !element.contains(event.target)) {
        hide();
      }
    };
    const close = () => hide();
    document.addEventListener('pointermove', away, true);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointermove', away, true);
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
    };
  }, [open, hide]);

  return {
    ref,
    hoverProps,
    hide,
    tip: open && content && ref.current ? <HoverTooltip anchor={ref.current}>{content}</HoverTooltip> : undefined,
  };
}

export function ProvenanceLabel({
  label,
  props,
  className = 'embed-editor_size-label',
  busy,
  anchorProp,
  onProvenance,
}: {
  label: ReactNode;
  props: readonly string[];
  className?: string;
  busy: boolean;
  anchorProp?: string;
  onProvenance: (prop: string, anchor: DOMRect) => void;
}) {
  const { ref, hoverProps, hide, tip } = useHoverTip<HTMLButtonElement>(<PropTip props={props} />);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${className} embed-editor_prop-orange`}
        aria-disabled={busy ? true : undefined}
        {...hoverProps}
        onClick={(event) => {
          if (busy) {
            return;
          }
          const property = anchorProp ?? props[0];
          if (property === undefined) {
            return;
          }
          hide();
          onProvenance(property, event.currentTarget.getBoundingClientRect());
        }}
      >
        {label}
      </button>
      {tip}
    </>
  );
}
