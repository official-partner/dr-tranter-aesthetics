import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import DragSlider from './components/DragSlider';
import ColorSwatch from './components/ColorSwatch';
import useScrub from './components/useScrub';
import VariableConnect from './VariableConnect';
import { handleArrowStep } from './model/numberStep';
import { useLiveColor } from './model/liveColor';
import { sliderLength, useLengthUnit } from './model/lengthUnit';
import { projectDefaultUnit } from '../../../shared/properties/lengthUnit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { commitInPlace } from './model/commitStyleInPlace';


export const SHADOW_RANGE: Record<string, { min: number; max: number }> = {
  X: { min: -50, max: 50 },
  Y: { min: -50, max: 50 },
  Blur: { min: 0, max: 50 },
  Size: { min: -50, max: 50 },
};

function parseLength(value: string, bareUnit: string): { amount: number; unit: string } | undefined {
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*([a-z%]*)$/i);
  if (!match) {
    return undefined;
  }
  return { amount: parseFloat(match[1] ?? ''), unit: match[2] || bareUnit };
}

function ShadowTextInput({
  value,
  busy,
  ariaLabel,
  placeholder,
  className,
  prop,
  onCommit,
  onLive,
  onClear,
}: {
  value: string;
  busy: boolean;
  ariaLabel: string;
  placeholder: string;
  className: string;
  prop: string;
  onCommit: (value: string) => void;
  onLive: (value: string) => void;
  onClear: () => void;
}) {
  const translate = useTranslate();
  const field = useShadowDraft({ value, busy, onCommit, onLive, onClear });
  return (
    <VariableConnect
      code
      ariaLabel={translate('style.shadowFields.connect', { name: ariaLabel })}
      disabled={busy}
      className="is-fill"
      prop={prop}
      onPick={(binding) => onCommit(binding)}
    >
      <input
        {...field.scrub.input}
        className={className}
        value={field.draft}
        onChange={(event) => field.change(event.target.value)}
        onFocus={field.focus}
        onBlur={field.blur}
        onKeyDown={field.keyDown}
        disabled={busy}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </VariableConnect>
  );
}

function useShadowDraft({
  value,
  busy,
  onCommit,
  onLive,
  onClear,
}: {
  value: string;
  busy: boolean;
  onCommit: (value: string) => void;
  onLive: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);
  const { cancel, liveNow, live } = useDebouncedLive(onLive);
  const commit = (text = draft) => {
    const trimmed = text.trim();
    if (!trimmed) {
      onClear();
      return;
    }
    onCommit(trimmed);
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: setDraft,
    onInput: liveNow,
    onCommit: (text) => {
      setDraft(text);
      commit(text);
    },
  });
  return {
    draft,
    scrub,
    change: (text: string) => {
      setDraft(text);
      live(text);
    },
    focus: () => {
      focused.current = true;
    },
    blur: () => {
      focused.current = false;
      cancel();
      commit();
    },
    keyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      const stepped = stepShadowKey(event);
      if (stepped !== undefined) {
        setDraft(stepped);
        live(stepped);
      }
    },
  };
}

function useDebouncedLive(onLive: (value: string) => void) {
  const timer = useRef<number | undefined>(undefined);
  const cancel = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  };
  useEffect(() => cancel, []);
  const liveNow = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) {
      onLive(trimmed);
    }
  };
  const live = (text: string) => {
    cancel();
    timer.current = window.setTimeout(() => liveNow(text), 100);
  };
  return { cancel, liveNow, live };
}

function stepShadowKey(event: KeyboardEvent<HTMLInputElement>): string | undefined {
  if (event.key === 'Enter') {
    commitInPlace(event.currentTarget);
    return undefined;
  }
  const stepped = handleArrowStep(event);
  if (!stepped) {
    return undefined;
  }
  event.preventDefault();
  const input = event.currentTarget;
  input.value = stepped.text;
  input.setSelectionRange(stepped.caret, stepped.caret);
  return stepped.text;
}

export function ShadowLength({
  label,
  value,
  busy,
  onCommit,
  onLive,
  range,
  defaultUnit = 'px',
}: {
  label: string;
  value: string;
  busy: boolean;
  onCommit: (value: string) => void;
  onLive: (value: string) => void;
  range?: { min: number; max: number };
  defaultUnit?: string;
}) {
  const lengthUnit = useLengthUnit();
  const bareUnit = projectDefaultUnit(defaultUnit, lengthUnit);
  const parsed = parseLength(value, bareUnit);
  const slider = sliderLength(parsed, defaultUnit, range ?? SHADOW_RANGE[label] ?? { min: -50, max: 50 }, lengthUnit);
  const unit = slider.unit;
  const [live, setLive] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLive(undefined);
  }, [value]);
  const withUnit = (text: string): string => (/^-?[\d.]+$/.test(text.trim()) ? `${text.trim()}${unit}` : text);
  return (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{label}</span>
      <div className="embed-editor_shadow-field">
        <DragSlider
          value={slider.position ?? 0}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          disabled={busy || !parsed}
          ariaLabel={label}
          onPreview={(position) => setLive(slider.format(position))}
          onInput={(position) => onLive(slider.format(position))}
          onCommit={(position) => onCommit(slider.format(position))}
        />
        <ShadowTextInput
          value={live ?? value}
          busy={busy}
          ariaLabel={label}
          placeholder={`0${bareUnit}`}
          className="u-input embed-editor_size-input embed-editor_shadow-num"
          prop="width"
          onCommit={(text) => onCommit(withUnit(text))}
          onLive={(text) => onLive(withUnit(text))}
          onClear={() => onCommit(`0${bareUnit}`)}
        />
      </div>
    </div>
  );
}

export function ShadowColorRow({ color, busy, onChange }: { color: string; busy: boolean; onChange: (color: string, live: boolean) => void }) {
  const translate = useTranslate();
  const [shown, noteLive] = useLiveColor(color);
  return (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.shadowFields.color')}</span>
      <div className="embed-editor_type-field">
        <ColorSwatch
          value={shown}
          busy={busy}
          ariaLabel={translate('style.shadowFields.shadowColor')}
          onChange={(next, live) => {
            noteLive(live ? next : undefined);
            onChange(next, live);
          }}
        />
        <ShadowTextInput
          value={shown}
          busy={busy}
          ariaLabel={translate('style.shadowFields.shadowColor')}
          placeholder="rgba(0, 0, 0, 0.2)"
          className="u-input embed-editor_size-input"
          prop="color"
          onCommit={(next) => {
            noteLive(undefined);
            onChange(next, false);
          }}
          onLive={(next) => onChange(next, true)}
          onClear={() => {
            noteLive(undefined);
            onChange('', false);
          }}
        />
      </div>
    </div>
  );
}
