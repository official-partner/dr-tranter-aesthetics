import { useEffect, type RefObject } from 'react';
import { inOwnedPopup } from './popupOwnership';


export function wheelBelongsTo(box: HTMLElement | undefined, target: EventTarget | undefined): boolean {
  if (box === undefined) {
    return false;
  }
  const NodeType = box.ownerDocument.defaultView?.Node;
  if (NodeType === undefined || !(target instanceof NodeType)) {
    return false;
  }
  if (box.contains(target)) {
    return true;
  }
  return inOwnedPopup(target, box);
}

export function usePopupScrollLock(boxRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const onWheel = (event: Event): void => {
      if (!wheelBelongsTo(boxRef.current ?? undefined, event.target ?? undefined)) {
        event.preventDefault();
      }
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('touchmove', onWheel, { passive: false, capture: true });
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true });
      document.removeEventListener('touchmove', onWheel, { capture: true });
    };
  }, [boxRef]);
}
