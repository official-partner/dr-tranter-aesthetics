import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { tooltipAnchor, tooltipHost, type TooltipAnchor } from '../../ui/delayedTooltip';
import FittedTooltip from '../../ui/FittedTooltip';
import '../../ui/infoHint.css';

export const PLACEMENT_REASON_ID = 'insert-placement-reason';

interface InsertPlacementTipProps {
  readonly reason: string | undefined;
  readonly listRef: RefObject<HTMLElement>;
  readonly highlight: number;
}

export function InsertPlacementTip({ reason, listRef, highlight }: InsertPlacementTipProps) {
  const [anchor, setAnchor] = useState<TooltipAnchor | undefined>(undefined);
  const [host, setHost] = useState<HTMLElement | undefined>(undefined);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (reason === undefined || list === null) {
      setAnchor(undefined);
      return undefined;
    }
    const measure = () => {
      const row = list.querySelector<HTMLElement>('[data-refused] .insert-item.highlight');
      if (row === null) {
        setAnchor(undefined);
        return;
      }
      const rowBox = row.getBoundingClientRect();
      const listBox = list.getBoundingClientRect();
      if (rowBox.bottom < listBox.top || rowBox.top > listBox.bottom) {
        setAnchor(undefined);
        return;
      }
      setHost(tooltipHost(row));
      setAnchor(tooltipAnchor(rowBox));
    };
    measure();
    list.addEventListener('scroll', measure);
    return () => list.removeEventListener('scroll', measure);
  }, [reason, listRef, highlight]);
  if (reason === undefined) {
    return undefined;
  }
  return (
    <>
      <span id={PLACEMENT_REASON_ID} className="info-hint-text">
        {reason}
      </span>
      {anchor !== undefined &&
        host !== undefined &&
        createPortal(
          <FittedTooltip className="settings-info-tip" role="tooltip" hidden anchor={anchor}>
            {reason}
          </FittedTooltip>,
          host,
        )}
    </>
  );
}
