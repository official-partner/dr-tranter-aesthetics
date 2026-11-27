import { centralIcon } from '../../ui/central/CentralIcon';
import { edit as centralEdit } from '../../ui/central/centralGeometry';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import LayerPopover from './LayerPopover';
import { displayOf } from './model/styleDisplay';
import { type Props, EffLabel } from './EffectsKit';
import { SkeletonRows } from '../../ui/Skeleton';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';



export const ClipPathEditor = lazy(() => import('./clipPath/ClipPath'));

export const ClipEditIcon = centralIcon(centralEdit);

export const CLIP_GLYPH_SHAPE_PATH = 'M8 .5c.4 4.3 2.8 6.8 7.5 7.5-4.7.7-7.1 3.2-7.5 7.5-.4-4.3-2.8-6.8-7.5-7.5' + 'C5.2 7.3 7.6 4.8 8 .5Z';

export function ClipGlyph({ type }: { type: string }) {
  const cls = 'embed-editor_clip-trigger-glyph';
  switch (type) {
    case 'None':
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 12 12 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'Polygon':
      return (
        <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" fill="currentColor" />
        </svg>
      );
    case 'Inset':
      return (
        <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" rx="2.5" fill="currentColor" />
        </svg>
      );
    case 'Circle':
      return (
        <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="4.75" fill="currentColor" />
        </svg>
      );
    case 'Ellipse':
      return (
        <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
          <ellipse cx="8" cy="8" rx="6" ry="4.25" fill="currentColor" />
        </svg>
      );
    case 'Shape':
      return (
        <svg className={cls} viewBox="0 0 16 16" aria-hidden="true">
          <path d={CLIP_GLYPH_SHAPE_PATH} fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 8Q5 4 8 8T13.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
  }
}

const CLIP_TYPE_KEYS: Readonly<Record<string, MessageKey>> = {
  None: 'style.clipPathRow.typeNone',
  Polygon: 'style.clipPathRow.typePolygon',
  Circle: 'style.clipPathRow.typeCircle',
  Ellipse: 'style.clipPathRow.typeEllipse',
  Inset: 'style.clipPathRow.typeInset',
  Path: 'style.clipPathRow.typePath',
  Shape: 'style.clipPathRow.typeShape',
  Variable: 'style.clipPathRow.typeVariable',
  Custom: 'style.clipPathRow.typeCustom',
};

export function clipPathType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'none') {
    return 'None';
  }
  if (normalized.startsWith('polygon')) {
    return 'Polygon';
  }
  if (normalized.startsWith('circle')) {
    return 'Circle';
  }
  if (normalized.startsWith('ellipse')) {
    return 'Ellipse';
  }
  if (normalized.startsWith('inset') || normalized.startsWith('rect') || normalized.startsWith('xywh')) {
    return 'Inset';
  }
  if (normalized.startsWith('path')) {
    return 'Path';
  }
  if (normalized.startsWith('shape')) {
    return 'Shape';
  }
  if (normalized.startsWith('url')) {
    return 'SVG';
  }
  if (normalized.startsWith('var')) {
    return 'Variable';
  }
  return 'Custom';
}

export function ClipPathModal({ props, anchor, onClose }: { props: Props; anchor: HTMLElement; onClose: () => void }) {
  const translate = useTranslate();
  const { important } = displayOf(props.read('clip-path'));
  const { onApply, onClear } = useSettledClipPath({
    clearProp: props.clearProp,
    setProp: (prop, value) => props.setProp(prop, value, important),
    liveSetProp: (prop, value) => props.liveSetProp(prop, value, important),
  });
  const [initialValue] = useState(() => clipPathValueOf(props));
  return (
    <LayerPopover anchorEl={anchor} onClose={onClose} ariaLabel={translate('style.clipPathRow.clipPath')}>
      <div className="embed-editor_clip-modal-head">
        <span className="embed-editor_clip-modal-title">{translate('style.clipPathRow.clipPath')}</span>
        <div className="embed-editor_clip-modal-actions">
          {}
          <div id="clip-path_header-shortcuts" />
          {}
        </div>
      </div>
      <div className="embed-editor_clip-modal-body">
        <Suspense
          fallback={
            <div className="embed-editor_clip-loading">
              <SkeletonRows count={4} />
            </div>
          }
        >
          <ClipPathEditor onApply={onApply} onClear={onClear} hideClassPicker initialValue={initialValue} />
        </Suspense>
      </div>
    </LayerPopover>
  );
}

export function useSettledClipPath({ setProp, liveSetProp, clearProp }: Pick<Props, 'setProp' | 'liveSetProp' | 'clearProp'>) {
  const pending = useRef<string | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const commit = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    if (pending.current !== undefined) {
      setProp('clip-path', pending.current, false);
      pending.current = undefined;
    }
  };
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => () => commitRef.current(), []);
  const onApply = (value: string) => {
    liveSetProp('clip-path', value, false);
    pending.current = value;
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(commit, 350);
  };
  const onClear = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    pending.current = undefined;
    clearProp('clip-path');
  };
  return { onApply, onClear };
}

function clipPathValueOf({ read }: Pick<Props, 'read'>): string {
  const display = displayOf(read('clip-path'));
  return display.present ? display.value : displayOf(read('-webkit-clip-path')).value;
}

export function ClipPathRow({ props }: { props: Props }) {
  const { busy } = props;
  const translate = useTranslate();
  const raw = clipPathValueOf(props);
  const [open, setOpen] = useState<HTMLElement | undefined>(undefined);
  const type = clipPathType(raw);
  return (
    <div className="embed-editor_size-row">
      <EffLabel label={translate('style.clipPathRow.clip')} prop="clip-path" props={props} />
      <button
        type="button"
        className="embed-editor_clip-trigger"
        disabled={busy}
        aria-haspopup="dialog"
        onClick={(event) => {
          const trigger = event.currentTarget;
          setOpen((current) => (current === undefined ? trigger : undefined));
        }}
      >
        <span className="embed-editor_clip-trigger-type">
          <ClipGlyph type={type} />
          <span className="embed-editor_clip-trigger-label">{CLIP_TYPE_KEYS[type] === undefined ? type : translate(CLIP_TYPE_KEYS[type])}</span>
        </span>
        <ClipEditIcon />
      </button>
      {open !== undefined ? <ClipPathModal props={props} anchor={open} onClose={() => setOpen(undefined)} /> : undefined}
    </div>
  );
}
