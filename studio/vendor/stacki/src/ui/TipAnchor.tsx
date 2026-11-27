import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { assert } from '../../shared/core/assert';
import { tooltipAnchor, tooltipHost, useDelayedPlacement, type TooltipAnchor } from './delayedTooltip';
import FittedTooltip from './FittedTooltip';
import './infoHint.css';

interface TipAnchorProps {
  readonly text: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

export default function TipAnchor({ text, className, children }: TipAnchorProps) {
  assert(text === undefined || text.length > 0, 'TipAnchor: the explanation is not empty');
  const descriptionId = useId();
  const tip = useDelayedPlacement(measureAnchor);
  const wrapper = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={wrapper}
      className={className === undefined ? 'tip-anchor' : `tip-anchor ${className}`}
      aria-describedby={text === undefined ? undefined : descriptionId}
      title={text === undefined ? undefined : ''}
      onMouseEnter={(event) => tip.show(event.currentTarget)}
      onMouseLeave={tip.hide}
      onFocus={(event) => tip.showNow(event.currentTarget)}
      onBlur={tip.hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && tip.value !== undefined) {
          event.stopPropagation();
          tip.hide();
        }
      }}
    >
      {children}
      {text !== undefined && (
        <span id={descriptionId} className="info-hint-text">
          {text}
        </span>
      )}
      {text !== undefined &&
        tip.value !== undefined &&
        createPortal(
          <FittedTooltip className="settings-info-tip" role="tooltip" hidden anchor={tip.value}>
            {text}
          </FittedTooltip>,
          tooltipHost(wrapper.current ?? undefined),
        )}
    </span>
  );
}

function measureAnchor(element: HTMLElement): TooltipAnchor {
  const target = element.firstElementChild ?? element;
  return tooltipAnchor(target.getBoundingClientRect());
}
