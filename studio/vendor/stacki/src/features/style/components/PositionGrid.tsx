import { useTranslate } from '../../../lib/i18n/useTranslate';
import LiveInput from './LiveInput';


export function PositionGrid({
  x,
  y,
  busy,
  ariaLabel,
  onPick,
}: {
  x: string;
  y: string;
  busy: boolean;
  ariaLabel?: string;
  onPick: (px: string, py: string) => void;
}) {
  const translate = useTranslate();
  const cells = ['0%', '50%', '100%'];
  const activeX = cells.indexOf(x);
  const activeY = cells.indexOf(y);
  return (
    <div className="embed-editor_grad-grid" role="group" aria-label={ariaLabel ?? translate('styleModel.components.position.group')}>
      {cells.map((py, yi) =>
        cells.map((px, xi) => {
          const active = xi === activeX && yi === activeY;
          return (
            <button
              key={`${xi}-${yi}`}
              type="button"
              className={`embed-editor_grad-grid-cell ${active ? 'is-active' : ''}`}
              disabled={busy}
              aria-label={translate('styleModel.components.position.cell', { x: px, y: py })}
              aria-pressed={active}
              onClick={() => onPick(px, py)}
            >
              <span className="embed-editor_grad-grid-dot" />
            </button>
          );
        }),
      )}
    </div>
  );
}

export function NumberField({
  value,
  unit,
  label,
  busy,
  prop = 'left',
  onLive,
  onCommit,
}: {
  value: string;
  unit: string;
  label: string;
  busy: boolean;
  prop?: string;
  onLive: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const number = value.replace(/[a-z%]+$/i, '').trim();
  const withUnit = (text: string) => {
    const trimmed = text.trim();
    return trimmed === '' ? '' : /[a-z%]$/i.test(trimmed) ? trimmed : `${trimmed}${unit}`;
  };
  return (
    <LiveInput
      value={number}
      busy={busy}
      ariaLabel={label}
      prop={prop}
      suffix={unit}
      wrapClassName="embed-editor_field embed-editor_grad-num"
      onLive={(value) => onLive(withUnit(value))}
      onCommit={(value) => onCommit(withUnit(value))}
      onVariablePick={(binding) => onCommit(binding)}
    />
  );
}
