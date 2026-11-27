import { useLayoutEffect, useRef, useState } from 'react';

export default function SegmentPill() {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ x: number; width: number } | undefined>(undefined);
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const track = ref.current?.parentElement;
    if (!track) {
      return;
    }
    const watched = new ResizeObserver(() => measure());
    function measure() {
      const track2 = ref.current?.parentElement;
      if (!track2) {
        return;
      }
      const segs = [...track2.querySelectorAll<HTMLElement>('.embed-editor_display-seg')];
      for (const seg of segs) {
        watched.observe(seg);
      }
      const selected = segs.find((seg) => seg.classList.contains('is-selected'));
      setBox(selected ? { x: selected.offsetLeft, width: selected.offsetWidth } : undefined);
    }
    measure();
    const marks = new MutationObserver(() => measure());
    marks.observe(track, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
      childList: true,
    });
    watched.observe(track);
    const frame = window.requestAnimationFrame(() => setAnimated(true));
    return () => {
      marks.disconnect();
      watched.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <span
      ref={ref}
      className={`embed-editor_display-indicator${animated ? ' is-animated' : ''}`}
      aria-hidden="true"
      style={box ? { transform: `translateX(${box.x}px)`, width: `${box.width}px` } : { opacity: 0 }}
    />
  );
}
