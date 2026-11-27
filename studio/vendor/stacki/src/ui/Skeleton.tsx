import type { CSSProperties, ReactNode } from 'react';
import { assert } from '../../shared/core/assert';
import { useTranslate } from '../lib/i18n/useTranslate';
import './skeleton.css';

export const SKELETON_ROWS_MAX = 12;

export const SKELETON_WIDTHS_PERCENT = [62, 48, 74, 55, 68, 44] as const;

export interface SkeletonOptions {
  readonly width?: string;
  readonly height?: string;
  readonly radius?: string;
}

export function Skeleton({ width, height, radius }: SkeletonOptions) {
  const style: CSSProperties = {};
  if (width !== undefined) {
    style.width = width;
  }
  if (height !== undefined) {
    style.height = height;
  }
  if (radius !== undefined) {
    style.borderRadius = radius;
  }
  return <span className="ui-skeleton" aria-hidden="true" style={style} />;
}

export interface SkeletonRowsOptions {
  readonly count: number;
  readonly row?: (widthPercent: number, index: number) => ReactNode;
}

export function SkeletonRows({ count, row }: SkeletonRowsOptions) {
  const translate = useTranslate();
  assert(Number.isSafeInteger(count), 'SkeletonRows: the count is a whole number');
  assert(count >= 1, 'SkeletonRows: draws at least one row');
  assert(count <= SKELETON_ROWS_MAX, 'SkeletonRows: the count stays within the bound');
  const rows: ReactNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const widthPercent = SKELETON_WIDTHS_PERCENT[index % SKELETON_WIDTHS_PERCENT.length] ?? SKELETON_WIDTHS_PERCENT[0];
    rows.push(<div key={index}>{row === undefined ? <Skeleton width={`${widthPercent}%`} /> : row(widthPercent, index)}</div>);
  }
  assert(rows.length === count, 'SkeletonRows: drew the rows it was asked for');
  return (
    <div className="ui-skeleton-rows" role="status" aria-busy="true">
      <span className="ui-skeleton-status">{translate('ui.loading')}</span>
      {rows}
    </div>
  );
}
