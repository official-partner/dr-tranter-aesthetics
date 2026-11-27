
import DragSlider from './components/DragSlider';
import useScrub from './components/useScrub';
import { useComputedValue } from './model/computedStyle';
import { handleArrowStep } from './model/numberStep';
import VariableConnect from './VariableConnect';
import { useExternalDraft } from './model/fieldHooks';
import { displayOf, keepImportant, parseImportant, withImportant } from './model/styleDisplay';
import { assert } from '../../../shared/core/assert';
import { type SetProp, type Props, stepInPlace, EffLabel } from './EffectsKit';
import { useTranslate } from '../../lib/i18n/useTranslate';


export type OpacityUnit = 'number' | 'percent';

export interface OpacityValue {
  readonly value: number;
  readonly unit: OpacityUnit;
}

const OPACITY_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(%)?$/;

export const clampOpacity = (value: number) => Math.min(1, Math.max(0, value));

export function parseOpacity(value: string): OpacityValue | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = trimmed.match(OPACITY_PATTERN);
  if (!match) {
    return undefined;
  }
  const amount = Number.parseFloat(trimmed);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit: OpacityUnit = match[1] === '%' ? 'percent' : 'number';
  const normalized = unit === 'percent' ? amount / 100 : amount;
  return { value: clampOpacity(normalized), unit };
}

function opacityAmount(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export interface OpacityWrite {
  readonly opacity: OpacityValue;
  readonly important: boolean;
}

export function parseOpacityField(text: string): { readonly opacity: OpacityValue | undefined; readonly value: string; readonly important: boolean } {
  const typed = parseImportant(text);
  const opacity = parseOpacity(typed.value);
  assert(!/!\s*important/i.test(typed.value), 'parseOpacityField: the flag is split off the value');
  return { opacity, value: typed.value, important: typed.important };
}

export function opacityText(opacity: OpacityValue): string {
  const value = clampOpacity(opacity.value);
  if (opacity.unit === 'percent') {
    return `${opacityAmount(value * 100)}%`;
  }
  return String(opacityAmount(value));
}

export function OpacityRow({ props }: { props: Props }) {
  const { read, busy, setProp, liveSetProp } = props;
  const translate = useTranslate();
  const display = displayOf(read('opacity'));
  const raw = display.present ? display.value.trim() : '';
  const authored = parseOpacity(raw);
  const computed = parseOpacity(useComputedValue(authored === undefined && raw ? 'opacity' : ''));
  const opacity: OpacityValue = authored ?? computed ?? { value: 1, unit: 'number' };
  const unit = authored?.unit ?? 'number';
  const asNumber = authored !== undefined || !raw;
  const live = (next: OpacityWrite) => liveSetProp('opacity', opacityText(next.opacity), next.important);
  const commit = (next: OpacityWrite) => setProp('opacity', opacityText(next.opacity), next.important);
  const { important } = display;
  const sliderText = (value: number) => withImportant({ value: opacityText({ value, unit }), important });

  const fieldText = withImportant({ value: asNumber ? opacityText({ value: opacity.value, unit }) : raw, important });
  const field = useExternalDraft(fieldText);

  return (
    <div className="embed-editor_size-row">
      <EffLabel label={translate('style.opacityRow.opacity')} prop="opacity" props={props} />
      <div className="embed-editor_shadow-field">
        <DragSlider
          value={opacity.value}
          min={0}
          max={1}
          step={0.01}
          disabled={busy}
          ariaLabel={translate('style.opacityRow.opacity')}
          onPreview={(value) => {
            if (!field.focused.current) {
              field.setDraft(sliderText(value));
            }
          }}
          onInput={(value) => live({ opacity: { value, unit }, important })}
          onCommit={(value) => {
            if (!field.focused.current) {
              field.setDraft(sliderText(value));
            }
            commit({ opacity: { value, unit }, important });
          }}
        />
        <OpacityNumberField
          text={field.draft}
          setText={field.setDraft}
          focusedRef={field.focused}
          fieldText={fieldText}
          opacity={{ value: opacity.value, unit }}
          important={important}
          busy={busy}
          live={live}
          commit={commit}
          setProp={setProp}
        />
      </div>
    </div>
  );
}

export interface OpacityFieldProps {
  text: string;
  setText: (text: string) => void;
  focusedRef: React.MutableRefObject<boolean>;
  fieldText: string;
  opacity: OpacityValue;
  important: boolean;
  busy: boolean;
  live: (value: OpacityWrite) => void;
  commit: (value: OpacityWrite) => void;
  setProp: SetProp;
}

export function OpacityNumberField(props: OpacityFieldProps) {
  const translate = useTranslate();
  const { text, setText, focusedRef, busy, live, setProp, important } = props;
  const liveText = (next: string) => {
    const typed = parseOpacityField(next);
    if (typed.opacity !== undefined) {
      live({ opacity: typed.opacity, important: typed.important });
    }
  };
  const { scrub, commitTyped } = useOpacityField(props);
  return (
    <div className="embed-editor_field embed-editor_grad-num embed-editor_opacity-num">
      <VariableConnect
        className="is-fill"
        ariaLabel={translate('style.opacityRow.connectOpacity')}
        disabled={busy}
        prop="opacity"
        canvasProperty="opacity"
        onPick={(binding) => {
          const kept = keepImportant(binding, { important });
          setProp('opacity', kept.value, kept.important);
        }}
      >
        <input
          {...scrub.input}
          className="u-input embed-editor_size-input"
          value={text}
          inputMode="decimal"
          spellCheck={false}
          disabled={busy}
          aria-label={translate('style.opacityRow.opacity')}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(event) => {
            setText(event.target.value);
            liveText(event.target.value);
          }}
          onBlur={() => {
            focusedRef.current = false;
            commitTyped();
          }}
          onKeyDown={(event) => {
            const stepped = stepOpacityInPlace(event);
            if (stepped === undefined) {
              return;
            }
            setText(stepped);
            liveText(stepped);
          }}
        />
      </VariableConnect>
    </div>
  );
}

export function useOpacityField({ text, setText, fieldText, opacity, busy, live, commit, setProp }: OpacityFieldProps) {
  const commitScrub = (next: string) => {
    setText(next);
    const typed = parseOpacityField(next);
    if (typed.opacity !== undefined) {
      commit({ opacity: typed.opacity, important: typed.important });
    } else {
      setText(fieldText);
    }
  };
  const scrub = useScrub({
    value: text,
    disabled: busy,
    stepScale: opacity.unit === 'percent' ? 1 : 0.01,
    onPreview: setText,
    onInput: (next) => {
      const typed = parseOpacityField(next);
      if (typed.opacity !== undefined) {
        live({ opacity: typed.opacity, important: typed.important });
      }
    },
    onCommit: commitScrub,
  });
  const commitTyped = () => {
    const trimmed = text.trim();
    if (trimmed === fieldText) {
      return;
    }
    const typed = parseOpacityField(trimmed);
    if (typed.opacity !== undefined) {
      commit({ opacity: typed.opacity, important: typed.important });
      setText(withImportant({ value: opacityText(typed.opacity), important: typed.important }));
    } else if (typed.value) {
      setProp('opacity', typed.value, typed.important);
    } else {
      setText(fieldText);
    }
  };
  return { scrub, commitTyped };
}

function stepOpacityInPlace(event: React.KeyboardEvent<HTMLInputElement>): string | undefined {
  if (event.key === 'Enter') {
    stepInPlace(event);
    return undefined;
  }
  const scale = parseImportant(event.currentTarget.value).value.endsWith('%') ? 1 : 0.01;
  const stepped = handleArrowStep(event, 0, scale);
  if (stepped === undefined) {
    return undefined;
  }
  const typed = parseOpacityField(stepped.text);
  if (typed.opacity === undefined) {
    return undefined;
  }
  event.preventDefault();
  const amount = opacityText(typed.opacity);
  const text = withImportant({ value: amount, important: typed.important });
  const input = event.currentTarget;
  input.value = text;
  input.setSelectionRange(amount.length, amount.length);
  return text;
}
