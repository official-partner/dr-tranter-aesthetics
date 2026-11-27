
import { useEffect, useRef, useState } from 'react';
import type { SelectOption } from './components/Select';
import { VariableSelect } from './KeywordConnect';
import useScrub from './components/useScrub';
import VariableConnect from './VariableConnect';
import { commitInPlace } from './model/commitStyleInPlace';
import { useDebouncedLive } from './model/fieldHooks';
import { displayOf, parseImportant } from './model/styleDisplay';
import { type SetProp, type ClearProp, type LiveSetProp, type Props, SizeLabel, withImportant, useFollowingDraft, stepSizeKey } from './SizeKit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey, Translator } from '../../lib/i18n/localeContext';
import { useHoverPreview } from './connectFieldHelpers';


export const RATIO_PRESETS: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: '2.39 / 1', labelKey: 'style.aspectRatioField.anamorphic' },
  { value: '2 / 1', labelKey: 'style.aspectRatioField.univisium' },
  { value: '16 / 9', labelKey: 'style.aspectRatioField.widescreen' },
  { value: '3 / 2', labelKey: 'style.aspectRatioField.landscape' },
  { value: '2 / 3', labelKey: 'style.aspectRatioField.portrait' },
  { value: '1 / 1', labelKey: 'style.aspectRatioField.square' },
];

export function parseRatio(value: string): { width: string; height: string } | undefined {
  const text = value.trim().toLowerCase();
  if (!text || text === 'auto') {
    return undefined;
  }
  if (text.includes('/')) {
    const [width, height] = text.split('/').map((part) => part.trim());
    if (width && /^[\d.]+$/.test(width) && (!height || /^[\d.]+$/.test(height))) {
      return { width, height: height || '1' };
    }
    return undefined;
  }
  return /^[\d.]+$/.test(text) ? { width: text, height: '1' } : undefined;
}

export function ratioKeyOf(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text || text === 'auto') {
    return 'auto';
  }
  const parsed = parseRatio(value);
  if (!parsed) {
    return 'other';
  }
  const match = RATIO_PRESETS.find((preset) => preset.value === `${parsed.width} / ${parsed.height}`);
  return match ? match.value : 'custom';
}

export function RatioNumberInput({
  value,
  busy,
  ariaLabel,
  onLive,
  onCommit,
}: {
  value: string;
  busy: boolean;
  ariaLabel: string;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const { draft, setDraft, focused } = useFollowingDraft(value);
  const sanitize = (raw: string) => raw.replace(/[^\d.]/g, '');
  const commitScrub = (text: string) => {
    setDraft(text);
    onCommit(text);
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: setDraft,
    onInput: onLive,
    onCommit: commitScrub,
  });

  return (
    <input
      {...scrub.input}
      className="u-input embed-editor_ratio-input"
      value={draft}
      inputMode="decimal"
      onChange={(event) => {
        const next = sanitize(event.target.value);
        setDraft(next);
        onLive(next);
      }}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        onCommit(draft);
      }}
      onKeyDown={(event) => {
        const stepped = stepSizeKey(event);
        if (stepped !== undefined) {
          setDraft(stepped);
          onLive(stepped);
        }
      }}
      disabled={busy}
      spellCheck={false}
      aria-label={ariaLabel}
    />
  );
}

export type RatioOtherInputProps = {
  value: string;
  busy: boolean;
  prop: string;
  autoFocus?: boolean;
  onCommit: (value: string, important: boolean) => void;
  onLiveCommit: (value: string, important: boolean) => void;
  onClear: () => void;
  ariaLabel?: string;
  placeholder?: string;
};

const FREE_VALUE_PLACEHOLDER = 'unset, var(--x)…';

export function RatioOtherInput({
  value,
  busy,
  prop,
  autoFocus = false,
  onCommit,
  onLiveCommit,
  onClear,
  ariaLabel,
  placeholder = FREE_VALUE_PLACEHOLDER,
}: RatioOtherInputProps) {
  const translate = useTranslate();
  const { draft, setDraft, focused } = useFollowingDraft(value);
  const { cancelLive, scheduleLive } = useDebouncedLive(onLiveCommit);
  const inputRef = useRef<HTMLInputElement>(null);
  const didFocus = useRef(false);
  const shownLabel = ariaLabel ?? translate('style.aspectRatioField.ratioValue');

  useEffect(() => {
    if (!autoFocus || didFocus.current || busy) {
      return;
    }
    didFocus.current = true;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [autoFocus, busy]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onClear();
      return;
    }
    const parsed = parseImportant(trimmed);
    onCommit(parsed.value, parsed.important);
  };

  return (
    <VariableConnect
      code
      ariaLabel={translate('style.aspectRatioField.connect', { name: shownLabel })}
      disabled={busy}
      prop={prop}
      canvasProperty={prop}
      onPick={(binding) => onCommit(binding, false)}
    >
      <input
        ref={inputRef}
        className="u-select-custom-input"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          scheduleLive(event.target.value);
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          cancelLive();
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitInPlace(event.currentTarget);
          }
        }}
        disabled={busy}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={shownLabel}
      />
    </VariableConnect>
  );
}

export const ratioOptions = (translate: Translator): SelectOption<string>[] => [
  { value: 'auto', label: translate('style.aspectRatioField.auto') },
  ...RATIO_PRESETS.map((preset) => ({ value: preset.value, label: translate(preset.labelKey) })),
  { value: 'custom', label: translate('style.aspectRatioField.custom') },
  { value: 'other', label: translate('style.aspectRatioField.other') },
];

export function AspectRatioField({ read, busy, setProp, clearProp, liveSetProp, onProvenance, onSelectSelector }: Props) {
  const hoverPreview = useHoverPreview();
  const translate = useTranslate();
  const display = displayOf(read('aspect-ratio'));
  const current = display.present ? display.value : '';
  const derivedKey = display.important ? 'other' : display.present ? ratioKeyOf(current) : 'auto';
  const { key, askedForOther, onSelect, onVariable, clear } = useRatioMode({
    current,
    derivedKey,
    setProp,
    clearProp,
  });

  return (
    <>
      <div className="embed-editor_size-row">
        <SizeLabel
          label={translate('style.aspectRatioField.ratio')}
          prop="aspect-ratio"
          display={{ ...display, value: current }}
          contributors={read('aspect-ratio')?.contributors ?? []}
          busy={busy}
          onClear={clear}
          onProvenance={onProvenance}
          onSelectSelector={onSelectSelector}
        />
        <VariableSelect
          prop="aspect-ratio"
          rawValue={current}
          onVariable={onVariable}
          className="embed-editor_ratio-select"
          value={key}
          options={ratioOptions(translate)}
          ariaLabel={translate('style.aspectRatioField.aspectRatio')}
          disabled={busy}
          onChange={onSelect}
          onPreview={(choice) => hoverPreview('aspect-ratio', choice === 'custom' || choice === 'other' ? undefined : (choice ?? undefined), false)}
          customInput={
            key === 'other' ? (
              <RatioOtherInput
                value={display.present ? withImportant({ ...display, value: current }) : ''}
                busy={busy}
                prop="aspect-ratio"
                autoFocus={askedForOther.current}
                onCommit={(value, important) => setProp('aspect-ratio', value, important)}
                onLiveCommit={(value, important) => liveSetProp('aspect-ratio', value, important)}
                onClear={clear}
              />
            ) : undefined
          }
        />
      </div>
      {key === 'custom' ? <RatioPair current={current} busy={busy} setProp={setProp} liveSetProp={liveSetProp} /> : undefined}
    </>
  );
}

export function useRatioMode({ current, derivedKey, setProp, clearProp }: { current: string; derivedKey: string; setProp: SetProp; clearProp: ClearProp }) {
  const [forced, setForced] = useState<'custom' | 'other' | undefined>(undefined);
  const askedForOther = useRef(false);
  const onSelect = (choice: string) => {
    askedForOther.current = false;
    if (choice === 'auto') {
      setForced(undefined);
      setProp('aspect-ratio', 'auto', false);
      return;
    }
    if (choice === 'custom') {
      setForced('custom');
      const ratio = parseRatio(current);
      setProp('aspect-ratio', ratio ? `${ratio.width} / ${ratio.height}` : '1 / 1', false);
      return;
    }
    if (choice === 'other') {
      setForced('other');
      askedForOther.current = true;
      if (ratioKeyOf(current) !== 'other') {
        setProp('aspect-ratio', 'unset', false);
      }
      return;
    }
    setForced(undefined);
    setProp('aspect-ratio', choice, false);
  };
  const clear = () => {
    setForced(undefined);
    clearProp('aspect-ratio');
  };
  const onVariable = (binding: string) => {
    askedForOther.current = false;
    setForced(undefined);
    setProp('aspect-ratio', binding, false);
  };
  return { key: forced ?? derivedKey, askedForOther, onSelect, onVariable, clear };
}

export function RatioPair({ current, busy, setProp, liveSetProp }: { current: string; busy: boolean; setProp: SetProp; liveSetProp: LiveSetProp }) {
  const translate = useTranslate();
  const parsed = parseRatio(current) ?? { width: '1', height: '1' };
  const write = (width: string, height: string, mode: 'live' | 'commit') => {
    const value = `${width || '0'} / ${height || '0'}`;
    if (mode === 'live') {
      liveSetProp('aspect-ratio', value, false);
    } else {
      setProp('aspect-ratio', value, false);
    }
  };
  return (
    <div className="embed-editor_ratio-custom">
      <div className="embed-editor_ratio-pair">
        <div className="embed-editor_ratio-cell">
          <RatioNumberInput
            value={parsed.width}
            busy={busy}
            ariaLabel={translate('style.aspectRatioField.ratioWidth')}
            onLive={(width) => write(width, parsed.height, 'live')}
            onCommit={(width) => write(width, parsed.height, 'commit')}
          />
          <span className="embed-editor_ratio-caption">{translate('style.aspectRatioField.width')}</span>
        </div>
        <span className="embed-editor_ratio-colon">:</span>
        <div className="embed-editor_ratio-cell">
          <RatioNumberInput
            value={parsed.height}
            busy={busy}
            ariaLabel={translate('style.aspectRatioField.ratioHeight')}
            onLive={(height) => write(parsed.width, height, 'live')}
            onCommit={(height) => write(parsed.width, height, 'commit')}
          />
          <span className="embed-editor_ratio-caption">{translate('style.aspectRatioField.height')}</span>
        </div>
      </div>
    </div>
  );
}
