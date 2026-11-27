import { useEffect, useLayoutEffect, useState } from 'react';
import { panelSpan } from '../model/panelBox';

export function useAnchoredPosition(ref: React.RefObject<HTMLDivElement>, anchor: DOMRect) {
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: anchor.left,
    top: anchor.bottom + 6,
  });
  useLayoutEffect(() => {
    const popover = ref.current;
    if (!popover) {
      return;
    }
    const margin = 8;
    const { width, height } = popover.getBoundingClientRect();
    const span = panelSpan(popover);
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (left + width > span.left + span.width) {
      left = span.left + span.width - width;
    }
    if (left < span.left) {
      left = span.left;
    }
    if (top + height > window.innerHeight - margin) {
      const above = anchor.top - 6 - height;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - height);
    }
    setPosition({ left, top });
  }, [anchor, ref]);
  return position;
}

export function useProvenanceDismiss({
  ref,
  anchor,
  prop,
  onClose,
  onAnchorReclick,
}: {
  ref: React.RefObject<HTMLDivElement>;
  anchor: DOMRect;
  prop: string;
  onClose: () => void;
  onAnchorReclick: (prop: string) => void;
}) {
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return;
      }
      if (event.clientX >= anchor.left && event.clientX <= anchor.right && event.clientY >= anchor.top && event.clientY <= anchor.bottom) {
        onAnchorReclick(prop);
      }
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, onAnchorReclick, anchor, prop, ref]);
}
