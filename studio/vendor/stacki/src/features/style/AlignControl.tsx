import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { SelectOption } from './components/Select';
import { VariableSelect } from './KeywordConnect';
import VariableConnect from './VariableConnect';
import { GroupLabel } from './TypographySection';
import type { ResolvedProp } from './model/resolved';
import { useHighlight } from './model/computedStyle';
import { commitInPlace } from './model/commitStyleInPlace';
import { assert } from '../../../shared/core/assert';
import ImportantMark from './components/ImportantMark';
import { displayOf } from './model/styleDisplay';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { useHoverPreview } from './connectFieldHelpers';


type Props = {
  justify: string;
  align: string;
  column: boolean;
  busy: boolean;
  read: (prop: string) => ResolvedProp | undefined;
  onSet: (prop: string, value: string) => void;
  onLive: (prop: string, value: string | undefined) => void;
  onClear: (prop: string) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
};

const CUSTOM = '__custom__';


function Icon({ children, rotate = 0 }: { children: ReactNode; rotate?: number }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {rotate ? <g transform={`rotate(${rotate} 8 8)`}>{children}</g> : children}
    </svg>
  );
}

const JUSTIFY_FLEX_START_PATH =
  'M2 14V1H3V5H11.5C11.7761 5 12 5.22386 12 5.5V6.5C12 6.77614 11.7761 7 11.5 7H3V8H7.5' + 'C7.77614 8 8 8.22386 8 8.5V9.5C8 9.77614 7.77614 10 7.5 10H3V14H2Z';
const JUSTIFY_CENTER_FIRST_PATH =
  'M7 14V10H4.5C4.22386 10 4 9.77614 4 9.5V8.5C4 8.22386 4.22386 8 4.5 8H7V7H2.5' + 'C2.22386 7 2 6.77614 2 6.5V5.5C2 5.22386 2.22386 5 2.5 5H7V1H8V14H7Z';
const JUSTIFY_FLEX_END_PATH =
  'M13 14V10H8.5C8.22386 10 8 9.77614 8 9.5V8.5C8 8.22386 8.22386 8 8.5 8H13V7H4.5' + 'C4.22386 7 4 6.77614 4 6.5V5.5C4 5.22386 4.22386 5 4.5 5H13V1H14V14H13Z';
const JUSTIFY_SPACE_BETWEEN_FIRST_PATH =
  'M14 4L14 1L15 1L15 14L14 14L14 11L12.5 11C12.2239 11 12 10.7761 12 10.5L12 4.5' + 'C12 4.22386 12.2239 4 12.5 4L14 4Z';
const JUSTIFY_SPACE_BETWEEN_SECOND_PATH =
  'M2 14L2 0.999999L3 0.999999L3 4L4.5 4C4.77614 4 5 4.22386 5 4.5L5 10.5' + 'C5 10.7761 4.77614 11 4.5 11L3 11L3 14L2 14Z';
const JUSTIFY_SPACE_AROUND_SECOND_PATH =
  'M4.5 4C4.22386 4 4 4.22386 4 4.5L4 10.5C4 10.7761 4.22386 11 4.5 11H5.5' + 'C5.77614 11 6 10.7761 6 10.5L6 4.5C6 4.22386 5.77614 4 5.5 4L4.5 4Z';
const JUSTIFY_SPACE_AROUND_THIRD_PATH =
  'M11.5 11C11.2239 11 11 10.7761 11 10.5V4.5C11 4.22386 11.2239 4 11.5 4L12.5 4' + 'C12.7761 4 13 4.22386 13 4.5V10.5C13 10.7761 12.7761 11 12.5 11H11.5Z';

const JUSTIFY_PATHS: Record<string, ReactNode> = {
  'flex-start': <path d={JUSTIFY_FLEX_START_PATH} fill="currentColor" />,
  center: (
    <>
      <path d={JUSTIFY_CENTER_FIRST_PATH} fill="currentColor" />
      <path d="M14 5.5C14 5.22386 13.7761 5 13.5 5H9V7H13.5C13.7761 7 14 6.77614 14 6.5V5.5Z" fill="currentColor" />
      <path d="M12 8.5C12 8.22386 11.7761 8 11.5 8H9V10H11.5C11.7761 10 12 9.77614 12 9.5V8.5Z" fill="currentColor" />
    </>
  ),
  'flex-end': <path d={JUSTIFY_FLEX_END_PATH} fill="currentColor" />,
  'space-between': (
    <>
      <path d={JUSTIFY_SPACE_BETWEEN_FIRST_PATH} fill="currentColor" />
      <path d={JUSTIFY_SPACE_BETWEEN_SECOND_PATH} fill="currentColor" />
    </>
  ),
  'space-around': (
    <>
      <path d="M2 14V1H3V14H2Z" fill="currentColor" />
      <path d={JUSTIFY_SPACE_AROUND_SECOND_PATH} fill="currentColor" />
      <path d={JUSTIFY_SPACE_AROUND_THIRD_PATH} fill="currentColor" />
      <path d="M14 14V1H15V14H14Z" fill="currentColor" />
    </>
  ),
};

const ALIGN_FLEX_START_PATH =
  'M2 2H15V3H11V7.5C11 7.77614 10.7761 8 10.5 8L9.5 8C9.22386 8 9 7.77614 9 7.5V3L8 3L8 11.5' +
  'C8 11.7761 7.77614 12 7.5 12H6.5C6.22386 12 6 11.7761 6 11.5L6 3L2 3V2Z';
const ALIGN_CENTER_FIRST_PATH =
  'M8 7V2.5C8 2.22386 7.77614 2 7.5 2H6.5C6.22386 2 6 2.22386 6 2.5V7L2 7V8L15 8V7H11V4.5' +
  'C11 4.22386 10.7761 4 10.5 4L9.5 4C9.22386 4 9 4.22386 9 4.5V7H8Z';
const ALIGN_FLEX_END_PATH =
  'M8 13L8 4.5C8 4.22386 7.77614 4 7.5 4H6.5C6.22386 4 6 4.22386 6 4.5L6 13L2 13V14L15 14V13' +
  'H11V8.5C11 8.22386 10.7761 8 10.5 8L9.5 8C9.22386 8 9 8.22386 9 8.5V13H8Z';
const ALIGN_BASELINE_PATH =
  'M8 7V3.5C8 3.22386 7.77614 3 7.5 3H5.5C5.22386 3 5 3.22386 5 3.5L5 7H2V8H5V13.5' +
  'C5 13.7761 5.22386 14 5.5 14H7.5C7.77614 14 8 13.7761 8 13.5V8H9V10.5' +
  'C9 10.7761 9.22386 11 9.5 11H11.5C11.7761 11 12 10.7761 12 10.5V8L15 8V7L12 7V3.5' +
  'C12 3.22386 11.7761 3 11.5 3H9.5C9.22386 3 9 3.22386 9 3.5V7H8ZM6 4V7H7V4L6 4ZM10 7H11V4' +
  'L10 4V7Z';

const ALIGN_PATHS: Record<string, ReactNode> = {
  'flex-start': <path d={ALIGN_FLEX_START_PATH} fill="currentColor" />,
  center: (
    <>
      <path d={ALIGN_CENTER_FIRST_PATH} fill="currentColor" />
      <path d="M8 9V13.5C8 13.7761 7.77614 14 7.5 14H6.5C6.22386 14 6 13.7761 6 13.5V9H8Z" fill="currentColor" />
      <path d="M10.5 12C10.7761 12 11 11.7761 11 11.5V9H9V11.5C9 11.7761 9.22386 12 9.5 12H10.5Z" fill="currentColor" />
    </>
  ),
  'flex-end': <path d={ALIGN_FLEX_END_PATH} fill="currentColor" />,
  stretch: <path fillRule="evenodd" clipRule="evenodd" d="M6 3L2 3V2H15V3L11 3V13L15 13V14L2 14V13H6L6 3ZM8 3L9 3L9 13H8L8 3Z" fill="currentColor" />,
  baseline: <path fillRule="evenodd" clipRule="evenodd" d={ALIGN_BASELINE_PATH} fill="currentColor" />,
};

function iconFor(value: string, prop: string, axis: 'x' | 'y'): ReactNode {
  const isJustify = prop === 'justify-content';
  const paths = (isJustify ? JUSTIFY_PATHS : ALIGN_PATHS)[value];
  if (!paths) {
    return undefined;
  }
  const naturalAxis = isJustify ? 'x' : 'y';
  const rotate = axis === naturalAxis ? 0 : isJustify ? 90 : -90;
  return <Icon rotate={rotate}>{paths}</Icon>;
}

const BASELINE_LETTER = (
  <svg viewBox="0 0 14 16" width="14" height="16" fill="none" aria-hidden="true">
    <path d="M2.6 10 L7 3 L11.4 10 M4.1 7.6 H9.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="1.4" y1="13" x2="12.6" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const BASELINE_ARROW = (
  <svg viewBox="0 0 14 16" width="14" height="16" fill="none" aria-hidden="true">
    <path d="M7 3 V9.2 M4.4 6.9 L7 9.6 L9.6 6.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="1.4" y1="13" x2="12.6" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const JUSTIFY_VALUES = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'];
const ALIGN_VALUES = ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'];

function norm(value: string): string {
  const spelling = value.trim().toLowerCase();
  if (spelling === 'start' || spelling === 'self-start' || spelling === 'left') {
    return 'flex-start';
  }
  if (spelling === 'end' || spelling === 'self-end' || spelling === 'right') {
    return 'flex-end';
  }
  return spelling;
}

function axisLabel(value: string, axis: 'x' | 'y', translate: Translator): string {
  switch (value) {
    case 'flex-start':
      return axis === 'x' ? translate('style.alignControl.left') : translate('style.alignControl.top');
    case 'flex-end':
      return axis === 'x' ? translate('style.alignControl.right') : translate('style.alignControl.bottom');
    case 'center':
      return translate('style.alignControl.center');
    case 'space-between':
      return translate('style.alignControl.spaceBetween');
    case 'space-around':
      return translate('style.alignControl.spaceAround');
    case 'space-evenly':
      return translate('style.alignControl.spaceEvenly');
    case 'stretch':
      return translate('style.alignControl.stretch');
    case 'baseline':
      return translate('style.alignControl.baseline');
    default:
      return value;
  }
}

function CustomInput({
  prop,
  value,
  busy,
  ariaLabel,
  autoFocus,
  onCommit,
  onLive,
  onClear,
}: {
  prop: string;
  value: string;
  busy: boolean;
  ariaLabel: string;
  autoFocus: boolean;
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
  const { scheduleLive, cancelLive } = useLiveTimer(onLive);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      onCommit(trimmed);
    } else {
      onClear();
    }
  };
  const translate = useTranslate();
  return (
    <VariableConnect
      className="is-fill"
      prop={prop}
      canvasProperty={prop}
      disabled={busy}
      ariaLabel={translate('styleModel.shared.connectVariable', { label: ariaLabel })}
      onPick={(binding) => {
        cancelLive();
        setDraft(binding);
        onCommit(binding);
      }}
    >
      <input
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
        placeholder="unset"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
      />
    </VariableConnect>
  );
}

function useLiveTimer(onLive: (value: string) => void) {
  const liveTimer = useRef<number | undefined>(undefined);
  const cancelLive = () => {
    if (liveTimer.current !== undefined) {
      window.clearTimeout(liveTimer.current);
      liveTimer.current = undefined;
    }
  };
  useEffect(() => cancelLive, []);
  const scheduleLive = (text: string) => {
    cancelLive();
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined;
      const trimmed = text.trim();
      if (trimmed) {
        onLive(trimmed);
      }
    }, 100);
  };
  return { scheduleLive, cancelLive };
}

function axisOptions(values: readonly string[], prop: string, axis: 'x' | 'y', translate: Translator): SelectOption<string>[] {
  const options: SelectOption<string>[] = values.map((option) => ({
    value: option,
    label: axisLabel(option, axis, translate),
    icon: iconFor(option, prop, axis),
  }));
  options.push({ value: CUSTOM, label: translate('style.alignControl.custom') });
  return options;
}

type AxisSelectProps = Pick<Props, 'busy' | 'read' | 'onSet' | 'onLive' | 'onClear' | 'onProvenance' | 'onSelectSelector'> & {
  axis: 'x' | 'y';
  label: string;
  prop: string;
  value: string;
  values: string[];
  fallback: string;
};
function AxisSelect(props: AxisSelectProps) {
  const hoverPreview = useHoverPreview();
  const { axis, prop, value, values, fallback, busy, onSet, onLive, onClear } = props;
  const translate = useTranslate();
  const [forceCustom, setForceCustom] = useState(false);
  const ariaLabel = axis === 'x' ? translate('style.alignControl.horizontalAlignment') : translate('style.alignControl.verticalAlignment');
  const present = Boolean(value.trim());
  const normalized = norm(value);
  const known = values.includes(normalized);
  const shownComputed = useHighlight('', present ? '' : prop, values, fallback);
  const customMode = forceCustom || (present && !known);
  const options = axisOptions(values, prop, axis, translate);

  const pick = (choice: string) => {
    if (choice === CUSTOM) {
      setForceCustom(true);
      onSet(prop, 'unset');
      return;
    }
    setForceCustom(false);
    onSet(prop, choice);
  };
  const preview = (option: string | undefined) => hoverPreview(prop, option === CUSTOM ? undefined : option, false);

  return (
    <div className="embed-editor_align-axis">
      {}
      <GroupLabel
        label={props.label}
        props={[prop]}
        read={props.read}
        busy={busy}
        onClear={() => onClear(prop)}
        onProvenance={props.onProvenance}
        onSelectSelector={props.onSelectSelector}
      />
      <ImportantMark important={displayOf(props.read(prop)).important}>
        <VariableSelect
          prop={prop}
          rawValue={value}
          onVariable={(binding) => {
            setForceCustom(false);
            onSet(prop, binding);
          }}
          value={customMode ? CUSTOM : present ? normalized : shownComputed}
          options={options}
          ariaLabel={ariaLabel}
          disabled={busy}
          hideTriggerIcon
          onChange={pick}
          onPreview={(option) => preview(option ?? undefined)}
          customInput={
            customMode ? (
              <CustomInput
                prop={prop}
                value={value}
                busy={busy}
                ariaLabel={ariaLabel}
                autoFocus={forceCustom}
                onCommit={(next) => onSet(prop, next)}
                onLive={(next) => onLive(prop, next)}
                onClear={() => {
                  setForceCustom(false);
                  onClear(prop);
                }}
              />
            ) : undefined
          }
        />
      </ImportantMark>
    </div>
  );
}

const ALIGN_POSITIONS = ['flex-start', 'center', 'flex-end'] as const;
type AlignPosition = (typeof ALIGN_POSITIONS)[number];

export interface AlignBoxState {
  readonly justify: string;
  readonly align: string;
  readonly column: boolean;
}

export type AlignWrite = readonly [prop: string, value: string];

function axisProps(state: Pick<AlignBoxState, 'column'>): { readonly x: string; readonly y: string } {
  return state.column ? { x: 'align-items', y: 'justify-content' } : { x: 'justify-content', y: 'align-items' };
}

function positionIndex(value: string): number {
  return ALIGN_POSITIONS.findIndex((position) => position === value);
}

function valueOf(state: AlignBoxState, prop: string): string {
  return norm(prop === 'justify-content' ? state.justify : state.align);
}

function distributed(value: string): boolean {
  return value === 'space-between' || value === 'space-around';
}

export function alignDotWrites(state: AlignBoxState, x: AlignPosition, y: AlignPosition): readonly AlignWrite[] {
  const props = axisProps(state);
  const writes: AlignWrite[] = [];
  for (const [prop, position] of [
    [props.x, x],
    [props.y, y],
  ] as const) {
    if (!(prop === 'justify-content' && distributed(valueOf(state, prop)))) {
      writes.push([prop, position]);
    }
  }
  assert(writes.length >= 1, 'A dot always sets the cross axis');
  return writes;
}

export function alignArrowWrite(state: AlignBoxState, key: string): AlignWrite | undefined {
  const props = axisProps(state);
  const step = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : key === 'ArrowDown' || key === 'ArrowRight' ? 1 : 0;
  if (step === 0) {
    return undefined;
  }
  const prop = key === 'ArrowUp' || key === 'ArrowDown' ? props.y : props.x;
  const at = positionIndex(valueOf(state, prop));
  const next = at === -1 ? 'center' : ALIGN_POSITIONS[at + step];
  if (next === undefined) {
    return undefined;
  }
  assert(ALIGN_POSITIONS.includes(next), 'An arrow steps to a position');
  return [prop, next];
}

function AlignDots({ justify, align, column, busy, onSet }: Pick<Props, 'justify' | 'align' | 'column' | 'busy' | 'onSet'>) {
  const translate = useTranslate();
  const state: AlignBoxState = { justify, align, column };
  return (
    <div className="embed-editor_align-dots">
      {ALIGN_POSITIONS.map((ry) =>
        ALIGN_POSITIONS.map((cx) => (
          <button
            key={`${ry}-${cx}`}
            type="button"
            className="embed-editor_align-dot"
            disabled={busy}
            aria-label={translate('style.alignControl.alignAt', { horizontal: axisLabel(cx, 'x', translate), vertical: axisLabel(ry, 'y', translate) })}
            title={norm(justify) === 'space-between' ? translate('style.alignControl.alignHere') : translate('style.alignControl.spaceBetweenHint')}
            onClick={() => {
              for (const [prop, value] of alignDotWrites(state, cx, ry)) {
                onSet(prop, value);
              }
            }}
            onDoubleClick={() => {
              const position = column ? ry : cx;
              onSet('justify-content', norm(justify) === 'space-between' ? position : 'space-between');
            }}
          >
            <span />
          </button>
        )),
      )}
    </div>
  );
}

function AlignBox({ justify, align, column, busy, onSet }: Pick<Props, 'justify' | 'align' | 'column' | 'busy' | 'onSet'>) {
  const translate = useTranslate();
  const justifyValue = norm(justify) || 'flex-start';
  const alignValue = norm(align) || 'stretch';
  const isBaseline = alignValue === 'baseline';
  const cross = alignValue === 'stretch' ? undefined : '28%';
  const barStyle: CSSProperties = column ? { height: 2, width: cross } : { width: 2, height: cross };
  const previewStyle: CSSProperties = {
    flexDirection: column ? 'column' : 'row',
    justifyContent: justifyValue,
    alignItems: isBaseline ? 'flex-start' : alignValue,
  };
  return (
    <div
      className="embed-editor_align-box"
      role="group"
      aria-label={translate('style.alignControl.alignment')}
      onKeyDown={(event) => {
        const write = busy ? undefined : alignArrowWrite({ justify, align, column }, event.key);
        if (write !== undefined) {
          event.preventDefault();
          onSet(write[0], write[1]);
        }
      }}
    >
      <AlignDots justify={justify} align={align} column={column} busy={busy} onSet={onSet} />
      <div className="embed-editor_align-preview" style={previewStyle} aria-hidden="true">
        {isBaseline ? (
          <>
            <span className="embed-editor_align-baseline">{BASELINE_LETTER}</span>
            <span className="embed-editor_align-baseline">{BASELINE_ARROW}</span>
          </>
        ) : (
          ALIGN_POSITIONS.map((position) => <span key={position} className="embed-editor_align-bar" style={barStyle} />)
        )}
      </div>
    </div>
  );
}

export default function AlignControl({ justify, align, column, busy, read, onSet, onLive, onClear, onProvenance, onSelectSelector }: Props) {
  const xProp = column ? 'align-items' : 'justify-content';
  const yProp = column ? 'justify-content' : 'align-items';
  const xValues = column ? ALIGN_VALUES : JUSTIFY_VALUES;
  const yValues = column ? JUSTIFY_VALUES : ALIGN_VALUES;
  const xValue = column ? align : justify;
  const yValue = column ? justify : align;
  const xFallback = column ? 'stretch' : 'flex-start';
  const yFallback = column ? 'flex-start' : 'stretch';
  return (
    <div className="embed-editor_align">
      <AlignBox justify={justify} align={align} column={column} busy={busy} onSet={onSet} />
      <div className="embed-editor_align-axes">
        <AxisSelect
          axis="x"
          label="X"
          prop={xProp}
          value={xValue}
          values={xValues}
          fallback={xFallback}
          busy={busy}
          read={read}
          onSet={onSet}
          onLive={onLive}
          onClear={onClear}
          onProvenance={onProvenance}
          onSelectSelector={onSelectSelector}
        />
        <AxisSelect
          axis="y"
          label="Y"
          prop={yProp}
          value={yValue}
          values={yValues}
          fallback={yFallback}
          busy={busy}
          read={read}
          onSet={onSet}
          onLive={onLive}
          onClear={onClear}
          onProvenance={onProvenance}
          onSelectSelector={onSelectSelector}
        />
      </div>
    </div>
  );
}
