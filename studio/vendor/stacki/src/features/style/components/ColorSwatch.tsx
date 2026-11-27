import { useTranslate } from '../../../lib/i18n/useTranslate';
import { useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import { useResolvedColor } from '../model/computedColor';
import { useLiveColor } from '../model/liveColor';
import { parseImportant } from '../model/styleDisplay';
import { assert } from '../../../../shared/core/assert';

export default function ColorSwatch({
  value,
  busy,
  onChange,
  ariaLabel,
}: {
  value: string;
  busy?: boolean;
  onChange: (color: string, live: boolean) => void;
  ariaLabel?: string;
}) {
  const translate = useTranslate();
  const color = parseImportant(value).value;
  assert(!/!\s*important\s*$/i.test(color), 'ColorSwatch: the painted colour carries no flag');
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | undefined>(undefined);
  const [shown, noteLive] = useLiveColor(color);
  const fill = useResolvedColor(shown);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="u-color-swatch"
        disabled={busy}
        aria-label={ariaLabel ?? translate('styleModel.components.colorSwatch.label')}
        onClick={() => setAnchor((previous) => (previous ? undefined : (ref.current?.getBoundingClientRect() ?? undefined)))}
      >
        <span className="u-color-swatch-fill" style={{ background: fill.trim() || 'transparent' }} />
      </button>
      {anchor ? (
        <ColorPicker
          value={color}
          anchor={anchor}
          trigger={ref.current ?? undefined}
          onChange={(color, live) => {
            noteLive(live ? color : undefined);
            onChange(color, live);
          }}
          onClose={() => setAnchor(undefined)}
        />
      ) : undefined}
    </>
  );
}
