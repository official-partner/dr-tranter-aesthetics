import type { CSSProperties, RefObject } from 'react';
interface TipPosition {
  readonly left: number;
  readonly top: number;
  readonly below: boolean;
  readonly arrow?: number;
  readonly clamped?: boolean;
}
interface TipSurfaceProps {
  readonly text: string;
  readonly pos: TipPosition | undefined;
  readonly iconRef: RefObject<HTMLSpanElement>;
  readonly tipRef: RefObject<HTMLDivElement>;
  readonly show: () => void;
  readonly hide: () => void;
}
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HelpCircleIcon } from '../../ui/Icons';

const DELAY = 120;
const MARGIN = 8;

export default function PropTip({ text }: { readonly text?: string | undefined }) {
  const [position, setPosition] = useState<TipPosition | undefined>(undefined);
  const iconRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const show = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const element = iconRef.current;
      if (!element) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const below = rect.top < 120;
      setPosition({
        left: Math.round(rect.left + rect.width / 2),
        top: below ? Math.round(rect.bottom + 8) : Math.round(rect.top - 8),
        below,
      });
    }, DELAY);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setPosition(undefined);
  };

  useLayoutEffect(() => {
    const tip = tipRef.current;
    const icon = iconRef.current;
    if (!tip || !icon || !position || position.clamped) {
      return;
    }
    const half = tip.getBoundingClientRect().width / 2;
    const center = position.left;
    const left = Math.min(Math.max(center, MARGIN + half), window.innerWidth - MARGIN - half);
    if (left === center) {
      setPosition({ ...position, clamped: true });
      return;
    }
    const arrow = Math.max(Math.min(center - left, half - 12), -(half - 12));
    setPosition({ ...position, left, arrow, clamped: true });
  }, [position]);

  if (!text) {
    return undefined;
  }

  return <TipSurface text={text} pos={position} iconRef={iconRef} tipRef={tipRef} show={show} hide={hide} />;
}
function TipSurface({ text, pos: position, iconRef, tipRef, show, hide }: TipSurfaceProps) {
  const style: CSSProperties & { readonly '--tip-arrow': string } = {
    left: position?.left,
    top: position?.top,
    '--tip-arrow': `${position?.arrow || 0}px`,
  };
  return (
    <>
      <span
        ref={iconRef}
        className="prop-tip-icon"
        onMouseEnter={show}
        onMouseLeave={hide}
        tabIndex={0}
        onFocus={show}
        onBlur={hide}
        role="note"
        aria-label={text}
      >
        <HelpCircleIcon size={13} />
      </span>
      {position && (
        <div ref={tipRef} className={`prop-tip ${position.below ? 'below' : ''}`} style={style}>
          {text}
        </div>
      )}
    </>
  );
}
