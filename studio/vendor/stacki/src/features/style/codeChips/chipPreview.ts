
import { useContext, useEffect, useRef } from 'react';
import { previewNowhere, PreviewPropContext, type PreviewProp } from '../connectFieldHelpers';
import { canvasPreviewProp, SELECTED_ELEMENT_PREVIEW } from '../embed/canvasPreview';
import { writtenValue } from '../model/lengthUnit';
import { hoverStyle } from '../model/liveRuleEdits';
import { useExitRestore } from '../pickerExit';
import type { PreviewEndTiming } from '../VariablePicker';
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { reportErrorToast } from '../../../ui/errorNotices';
import { assert } from '../../../../shared/core/assert';

export interface ChipPreview {
  readonly onPreview: (value: string, epoch: number) => void;
  readonly previewEpoch: () => number;
  readonly onPreviewEnd: (timing: PreviewEndTiming) => void;
  readonly handOver: (value: string) => void;
  readonly restore: () => void;
}

export type ChipPreviewExits = 'window' | 'leave';

export const CANVAS_WRITER: PreviewProp = canvasPreviewProp(SELECTED_ELEMENT_PREVIEW);

export function useChipPreview(
  target: { readonly property: string | undefined; readonly valueWith: (value: string) => string | undefined },
  options: { readonly exits: ChipPreviewExits },
): ChipPreview {
  const translate = useTranslate();
  const outer = useContext(PreviewPropContext);
  const write = outer === previewNowhere ? CANVAS_WRITER : outer;
  const latest = useRef({ write, target, translate });
  latest.current = { write, target, translate };
  const epochRef = useRef(0);
  const shownRef = useRef<string | undefined>(undefined);
  const failedRef = useRef(false);

  const attempt = (action: () => void): void => {
    try {
      action();
    } catch (error: unknown) {
      console.error('[code chips] the canvas preview failed', error);
      if (!failedRef.current) {
        failedRef.current = true;
        reportErrorToast(latest.current.translate('style.variablePicker.previewFailed'));
      }
    }
  };
  const restore = (): void => {
    epochRef.current += 1;
    const shown = shownRef.current;
    if (shown === undefined) {
      return;
    }
    shownRef.current = undefined;
    attempt(() => latest.current.write(shown, undefined, false));
    assert(shownRef.current === undefined, 'useChipPreview: a restore leaves no preview marked as up');
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const onPreview = (value: string, epoch: number): void => {
    const { property, valueWith } = latest.current.target;
    if (property === undefined) {
      return;
    }
    if (epoch !== epochRef.current) {
      return;
    }
    if (failedRef.current) {
      return;
    }
    const text = valueWith(value);
    if (text === undefined) {
      return;
    }
    shownRef.current = property;
    attempt(() => latest.current.write(property, text, false));
  };
  const handOver = (value: string): void => {
    epochRef.current += 1;
    const { property, valueWith } = latest.current.target;
    const shown = shownRef.current;
    shownRef.current = undefined;
    if (property === undefined || shown === undefined) {
      return;
    }
    const text = valueWith(value);
    if (text === undefined) {
      attempt(() => latest.current.write(shown, undefined, false));
      return;
    }
    attempt(() => hoverStyle.settle(property, writtenValue(property, text)));
  };
  useEffect(() => () => restoreRef.current(), []);
  useExitRestore({ active: options.exits === 'window', restore: () => restoreRef.current() });
  return {
    onPreview,
    previewEpoch: () => epochRef.current,
    onPreviewEnd: () => restoreRef.current(),
    handOver,
    restore: () => restoreRef.current(),
  };
}

export function valueAround(
  chip: { readonly from: number; readonly to: number; readonly declaration: { readonly from: number; readonly to: number } },
  value: string,
  slice: (from: number, to: number) => string,
): string | undefined {
  assert(chip.declaration.from <= chip.from, 'valueAround: the reference sits in its declaration');
  assert(chip.to <= chip.declaration.to, 'valueAround: the reference ends in its declaration');
  const text = `${slice(chip.declaration.from, chip.from)}${value}${slice(chip.to, chip.declaration.to)}`.trim();
  return text.length === 0 ? undefined : text;
}
