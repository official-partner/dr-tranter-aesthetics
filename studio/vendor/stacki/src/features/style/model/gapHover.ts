import { useEffect, useRef } from 'react';
import { getHost } from './host';


export type GapAxis = 'row' | 'column';

export function useGapHover(axes: GapAxis[], value: string) {
  const hovering = useRef(false);
  const holding = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  const show = (text?: string) => {
    const shown = (text ?? latest.current).trim() || '0';
    getHost().onSpacingHover?.({
      kind: 'gap',
      sides: axes,
      labels: Object.fromEntries(axes.map((axis) => [axis, shown])),
    });
  };

  const hide = () => {
    if (hovering.current || holding.current) {
      return;
    }
    getHost().onSpacingHover?.(undefined);
  };

  useEffect(
    () => () => {
      getHost().onSpacingHover?.(undefined);
    },
    [],
  );

  return {
    handlers: {
      onMouseEnter: () => {
        hovering.current = true;
        show();
      },
      onMouseLeave: () => {
        hovering.current = false;
        hide();
      },
    },
    onFocus: () => {
      holding.current = true;
      show();
    },
    onBlur: () => {
      holding.current = false;
      hide();
    },
    onValue: (text: string) => {
      if (hovering.current || holding.current) {
        show(text);
      }
    },
  };
}
