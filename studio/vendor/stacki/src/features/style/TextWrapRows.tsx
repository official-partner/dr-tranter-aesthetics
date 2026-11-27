
import type { SelectOption } from './components/Select';
import { KeywordSegments, VariableSelect } from './KeywordConnect';
import SegmentedControl from '../../ui/SegmentedControl';
import { useHighlight } from './model/computedStyle';
import { displayOf, withImportant } from './model/styleDisplay';
import ImportantMark from './components/ImportantMark';
import { type Props, CUSTOM, PropLabel, LiveInput, useSegCustomFocus } from './TypographyKit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';
import { useSelectorState } from './model/selectorScope';
import { useHoverPreview } from './connectFieldHelpers';


export type BreakDefinition = {
  prop: string;
  labelKey: MessageKey;
  ariaLabelKey: MessageKey;
  fallback: string;
  options: ReadonlyArray<readonly [string, string]>;
};

export const WORD_BREAK: BreakDefinition = {
  prop: 'word-break',
  labelKey: 'style.textWrapRows.word',
  ariaLabelKey: 'style.textWrapRows.wordBreaking',
  fallback: 'normal',
  options: [
    ['normal', 'Normal'],
    ['break-all', 'Break all'],
    ['keep-all', 'Keep all'],
  ],
};
export const WHITE_SPACE: BreakDefinition = {
  prop: 'white-space',
  labelKey: 'style.textWrapRows.line',
  ariaLabelKey: 'style.textWrapRows.lineBreaking',
  fallback: 'normal',
  options: [
    ['normal', 'Normal'],
    ['nowrap', 'No wrap'],
    ['pre', 'Pre'],
    ['pre-wrap', 'Pre wrap'],
    ['pre-line', 'Pre line'],
    ['break-spaces', 'Break spaces'],
  ],
};

export type EnumSelectProps = {
  prop: string;
  ariaLabel: string;
  fallback: string;
  options: ReadonlyArray<readonly [string, string]>;
  forceCustom: boolean;
  setForceCustom: (value: boolean) => void;
} & Pick<Props, 'read' | 'busy' | 'setProp' | 'clearProp' | 'liveSetProp'>;

export function EnumSelect(props: EnumSelectProps) {
  const hoverPreview = useHoverPreview();
  const { prop, ariaLabel, fallback, options: choices, forceCustom, setForceCustom } = props;
  const { read, busy, setProp, clearProp, liveSetProp } = props;
  const translate = useTranslate();
  const display = displayOf(read(prop));
  const values = new Set(choices.map(([value]) => value));
  const current = display.present ? display.value.trim().toLowerCase() : '';
  const matched = values.has(current) ? current : undefined;
  const shownComputed = useHighlight(
    '',
    matched ? '' : prop,
    choices.map(([value]) => value),
    fallback,
  );
  const customMode = forceCustom || (display.present && !matched) || display.important;

  const options: SelectOption<string>[] = [
    ...choices.map(([value, optionLabel]) => ({ value, label: optionLabel })),
    { value: CUSTOM, label: translate('style.textWrapRows.custom') },
  ];

  const { inputRef, requestFocus } = useSegCustomFocus({ customMode, busy });

  const pick = (value: string) => {
    if (value === CUSTOM) {
      requestFocus();
      setForceCustom(true);
      setProp(prop, 'unset', false);
      return;
    }
    setForceCustom(false);
    setProp(prop, value, false);
  };

  return (
    <VariableSelect
      prop={prop}
      rawValue={display.present ? display.value : ''}
      onVariable={(binding) => {
        setForceCustom(false);
        setProp(prop, binding, display.important);
      }}
      value={customMode ? CUSTOM : (matched ?? shownComputed)}
      options={options}
      onChange={pick}
      onPreview={(value) => hoverPreview(prop, value === CUSTOM ? undefined : (value ?? undefined), false)}
      ariaLabel={ariaLabel}
      disabled={busy}
      customInput={
        customMode ? (
          <LiveInput
            inputRef={inputRef}
            value={display.present ? withImportant(display) : 'unset'}
            busy={busy}
            placeholder={prop}
            ariaLabel={ariaLabel}
            className="u-select-custom-input"
            prop={prop}
            onCommit={(value, important) => setProp(prop, value, important)}
            onLiveCommit={(value, important) => liveSetProp(prop, value, important)}
            onClear={() => {
              setForceCustom(false);
              clearProp(prop);
            }}
          />
        ) : undefined
      }
    />
  );
}

export function BreakSelect({
  definition,
  read,
  busy,
  setProp,
  clearProp,
  liveSetProp,
  onProvenance,
  onSelectSelector,
}: { definition: BreakDefinition } & Props) {
  const { prop, labelKey, ariaLabelKey, fallback, options } = definition;
  const translate = useTranslate();
  const [forceCustom, setForceCustom] = useSelectorState(false);
  const display = displayOf(read(prop));
  const onClear = () => {
    setForceCustom(false);
    clearProp(prop);
  };
  return (
    <div className="embed-editor_type-cell">
      <EnumSelect
        prop={prop}
        ariaLabel={translate(ariaLabelKey)}
        fallback={fallback}
        options={options}
        forceCustom={forceCustom}
        setForceCustom={setForceCustom}
        read={read}
        busy={busy}
        setProp={setProp}
        clearProp={clearProp}
        liveSetProp={liveSetProp}
      />
      <PropLabel
        label={translate(labelKey)}
        prop={prop}
        display={display}
        contributors={read(prop)?.contributors ?? []}
        busy={busy}
        onClear={onClear}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
    </div>
  );
}

export function BreakingRow(props: Props) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_break-row">
      <span className="embed-editor_size-label embed-editor_break-title">{translate('style.textWrapRows.breaking')}</span>
      <div className="embed-editor_break-pair">
        <BreakSelect definition={WORD_BREAK} {...props} />
        <BreakSelect definition={WHITE_SPACE} {...props} />
      </div>
    </div>
  );
}

export const TEXT_OVERFLOW_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'clip', label: 'Clip' },
  { value: 'ellipsis', label: 'Ellipsis' },
];


export const WRAP_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['normal', 'Normal'],
  ['anywhere', 'Anywhere'],
  ['break-word', 'Break word'],
];

export function WrapRow({ read, busy, setProp, clearProp, liveSetProp, onProvenance, onSelectSelector }: Props) {
  const translate = useTranslate();
  const [forceCustom, setForceCustom] = useSelectorState(false);
  const display = displayOf(read('overflow-wrap'));
  const onClear = () => {
    setForceCustom(false);
    clearProp('overflow-wrap');
  };
  return (
    <div className="embed-editor_size-row">
      <PropLabel
        label={translate('style.textWrapRows.wrap')}
        prop="overflow-wrap"
        display={display}
        contributors={read('overflow-wrap')?.contributors ?? []}
        busy={busy}
        onClear={onClear}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <EnumSelect
        prop="overflow-wrap"
        ariaLabel={translate('style.textWrapRows.textWrap')}
        fallback="normal"
        options={WRAP_OPTIONS}
        forceCustom={forceCustom}
        setForceCustom={setForceCustom}
        read={read}
        busy={busy}
        setProp={setProp}
        clearProp={clearProp}
        liveSetProp={liveSetProp}
      />
    </div>
  );
}



export function TruncateRow({ read, busy, setProp, clearProp, onProvenance, onSelectSelector }: Props) {
  const translate = useTranslate();
  const display = displayOf(read('text-overflow'));
  const shownOverflow = useHighlight('', display.present ? '' : 'text-overflow', ['clip', 'ellipsis'], 'clip');
  const current = display.present ? (display.value.trim().toLowerCase() === 'ellipsis' ? 'ellipsis' : 'clip') : shownOverflow;
  return (
    <div className="embed-editor_size-row">
      <PropLabel
        label={translate('style.textWrapRows.truncate')}
        prop="text-overflow"
        display={display}
        contributors={read('text-overflow')?.contributors ?? []}
        busy={busy}
        onClear={() => clearProp('text-overflow')}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      {}
      <ImportantMark important={display.important}>
        <KeywordSegments
          prop="text-overflow"
          value={display.present ? display.value : ''}
          important={display.important}
          ariaLabel={translate('style.textWrapRows.truncate')}
          busy={busy}
          onWrite={(value, important) => setProp('text-overflow', value, important)}
          onClear={() => clearProp('text-overflow')}
        >
          <SegmentedControl
            options={TEXT_OVERFLOW_OPTIONS}
            value={current}
            onChange={(value) => setProp('text-overflow', value, display.important)}
            ariaLabel={translate('style.textWrapRows.truncate')}
            disabled={busy}
          />
        </KeywordSegments>
      </ImportantMark>
    </div>
  );
}
