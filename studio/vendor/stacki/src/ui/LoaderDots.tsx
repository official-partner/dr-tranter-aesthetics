import type { CSSProperties } from 'react';
import './loaderDots.css';

export interface LoaderDotsProps {
  readonly label?: string;
  readonly dotPx?: number;
}

export function LoaderDots(props: LoaderDotsProps) {
  const dotPx = props.dotPx ?? 4;
  const style: CSSProperties & { readonly '--loader-dot': string } = { '--loader-dot': `${dotPx}px` };
  return (
    <span
      className="loader-dots"
      role={props.label === undefined ? undefined : 'img'}
      aria-label={props.label}
      aria-hidden={props.label === undefined ? true : undefined}
      style={style}
    >
      <span className="loader-dot" />
      <span className="loader-dot" />
      <span className="loader-dot" />
      <span className="loader-dot" />
    </span>
  );
}
