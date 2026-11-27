
import React from 'react';
import { assert } from '../../shared/core/assert';
import { useTranslate } from '../lib/i18n/useTranslate';
import { useDelayedTooltip, tooltipHost } from './delayedTooltip';
import FittedTooltip from './FittedTooltip';
import { createPortal } from 'react-dom';

export const DATA_CHIP_CHARS_MAX = 30;

export function pathEnd(path: string, max: number): string {
  assert(Number.isSafeInteger(max), 'pathEnd: max is a safe integer');
  assert(max >= 2, 'pathEnd: room for an ellipsis and a character');
  return path.length <= max ? path : `…${path.slice(path.length - (max - 1))}`;
}

export interface DataChipProps {
  readonly path: string;
  readonly onPick?: ((chip: HTMLElement) => void) | undefined;
  readonly valuePreview?: string | undefined;
}

export default function DataChip({ path, onPick, valuePreview }: DataChipProps) {
  const translate = useTranslate();
  const tooltip = useDelayedTooltip();
  assert(path.length > 0, 'DataChip: a chip names a path');
  const label = translate('structure.binding.label', { path });
  const tip = valuePreview === undefined ? path : `${path} = ${valuePreview}`;
  const pick = (element: HTMLElement): void => onPick?.(element);
  return (
    <>
      <span
        className="expr-chip data-chip"
        data-expr={path}
        aria-label={label}
        {...(onPick === undefined
          ? { role: 'img' }
          : {
              role: 'button',
              tabIndex: 0,
              onClick: (event: React.MouseEvent<HTMLElement>) => {
                event.stopPropagation();
                pick(event.currentTarget);
              },
              onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  pick(event.currentTarget);
                }
              },
            })}
        onMouseEnter={tooltip.show}
        onMouseLeave={tooltip.hide}
      >
        {pathEnd(path, DATA_CHIP_CHARS_MAX)}
      </span>
      {tooltip.value !== undefined &&
        createPortal(
          <FittedTooltip role="tooltip" anchor={tooltip.value}>
            {tip}
          </FittedTooltip>,
          tooltipHost(undefined),
        )}
    </>
  );
}
