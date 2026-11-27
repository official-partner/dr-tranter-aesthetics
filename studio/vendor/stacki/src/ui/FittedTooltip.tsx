import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { assert } from '../../shared/core/assert';
import { fitTooltip, type TooltipAnchor, type TooltipSide } from './delayedTooltip';

interface FittedTooltipProps {
  readonly anchor: TooltipAnchor;
  readonly preferred?: TooltipSide;
  readonly className?: string;
  readonly id?: string;
  readonly role?: 'tooltip';
  readonly hidden?: boolean;
  readonly children: ReactNode;
}

export default function FittedTooltip({ anchor, preferred = 'below', className, id, role, hidden, children }: FittedTooltipProps) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    assert(node !== null, 'FittedTooltip: the tip is mounted');
    node.style.left = '0px';
    node.style.top = '0px';
    const box = node.getBoundingClientRect();
    const fit = fitTooltip({
      anchor,
      preferred,
      tip: { width: box.width, height: box.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    node.style.left = `${fit.left}px`;
    node.style.top = `${fit.top}px`;
    node.style.setProperty('--tip-arrow', `${fit.arrowOffset}px`);
    node.dataset['side'] = fit.side;
  });
  return (
    <div
      ref={element}
      className={className === undefined ? 'rail-tooltip' : `rail-tooltip ${className}`}
      data-fitted="true"
      data-side={preferred}
      id={id}
      role={role}
      aria-hidden={hidden}
    >
      {children}
    </div>
  );
}
