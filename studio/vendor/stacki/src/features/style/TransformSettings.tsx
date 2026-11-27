import { centralIcon } from '../../ui/central/CentralIcon';
import { help as centralHelp } from '../../ui/central/centralGeometry';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import SegmentedControl, { type SegmentedOption } from '../../ui/SegmentedControl';
import DragSlider from './components/DragSlider';
import { PositionGrid, NumberField } from './components/PositionGrid';
import FieldLabel from './components/FieldLabel';
import VariableConnect from './VariableConnect';
import { KeywordSegments } from './KeywordConnect';
import { PropTip, useHoverTip } from './components/CssPropertyTip';
import { useHighlight } from './model/computedStyle';
import { handleArrowStep } from './model/numberStep';
import { commitInPlace } from './model/commitStyleInPlace';
import { parseOrigin, serializeOrigin, type Origin } from './model/transformSettings';
import type { ResolvedProp } from './model/resolved';
import { displayOf } from './model/styleDisplay';
import ImportantMark from './components/ImportantMark';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { useLengthUnit } from './model/lengthUnit';
import { formatPxLength, lengthUnitName, pxPerLengthUnit, type LengthUnit, type LengthUnitName } from '../../../shared/properties/lengthUnit';


type Read = (prop: string) => ResolvedProp | undefined;
type SetProp = (prop: string, value: string, important: boolean) => void;
type ClearProp = (prop: string | string[]) => void;

const backfaceOptions = (translate: Translator): ReadonlyArray<SegmentedOption<string>> => [
  { value: 'visible', label: translate('style.transformSettings.visible') },
  { value: 'hidden', label: translate('style.transformSettings.hidden') },
];

const DISTANCE_PX_MAX = 2000;

const effectiveValue = (read: Read, prop: string): string => {
  const resolved = read(prop);
  if (!resolved) {
    return '';
  }
  return (resolved.source === 'selected' && resolved.selectedValue ? resolved.selectedValue.value : resolved.winner.value).trim();
};

const pxNumber = (value: string, lengthUnit: LengthUnit): number | undefined => {
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*(px|rem)$/i);
  if (!match) {
    return undefined;
  }
  const perUnit = pxPerLengthUnit(match[2] ?? '', lengthUnit);
  return perUnit === undefined ? undefined : parseFloat(match[1] ?? '') * perUnit;
};

function Heading({
  title,
  props,
  note,
  busy,
  onClear,
  cleared,
}: {
  title: string;
  props: readonly string[];
  note?: string;
  busy: boolean;
  onClear: () => void;
  cleared: boolean;
}) {
  const translate = useTranslate();
  const help = useHoverTip<HTMLSpanElement>(note ? <PropTip props={props} note={note} /> : undefined);
  return (
    <div className="embed-editor_tsettings-head">
      <FieldLabel
        className="embed-editor_tsettings-title"
        active={cleared}
        disabled={busy}
        onReset={onClear}
        resetLabel={translate('style.transformSettings.clear')}
        tooltip={<PropTip props={props} />}
      >
        {title}
      </FieldLabel>
      {note ? (
        <>
          <span className="embed-editor_tsettings-help" ref={help.ref} {...help.hoverProps} aria-label={note} role="img">
            <HelpIcon />
          </span>
          {help.tip}
        </>
      ) : undefined}
    </div>
  );
}

function OriginRow({
  label,
  origin,
  busy,
  ariaLabel,
  onChange,
}: {
  label: string;
  origin: Origin;
  busy: boolean;
  ariaLabel: string;
  onChange: (next: Origin, live: boolean) => void;
}) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_size-row embed-editor_grad-pos-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{label}</span>
      <div className="embed-editor_grad-pos">
        <PositionGrid x={origin.x} y={origin.y} busy={busy} ariaLabel={ariaLabel} onPick={(px, py) => onChange({ ...origin, x: px, y: py }, false)} />
        <div className="embed-editor_grad-pos-fields">
          {}
          <div className="embed-editor_grad-pos-field">
            <span>{translate('style.transformSettings.left')}</span>
            <NumberField
              value={origin.x}
              unit="%"
              label={`${ariaLabel} left`}
              busy={busy}
              prop="left"
              onLive={(x) => onChange({ ...origin, x }, true)}
              onCommit={(x) => onChange({ ...origin, x }, false)}
            />
          </div>
          <div className="embed-editor_grad-pos-field">
            <span>{translate('style.transformSettings.top')}</span>
            <NumberField
              value={origin.y}
              unit="%"
              label={`${ariaLabel} top`}
              busy={busy}
              prop="top"
              onLive={(y) => onChange({ ...origin, y }, true)}
              onCommit={(y) => onChange({ ...origin, y }, false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DistanceRow({
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
  const translate = useTranslate();
  const lengthUnit = useLengthUnit();
  const distancePx = pxNumber(value, lengthUnit);
  const written = (amountPx: number): string => formatPxLength(amountPx, lengthUnit);
  const [draft, setDraft] = useState(value || '0');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(value || '0');
    }
  }, [value]);
  return (
    <div className="embed-editor_size-row">
      <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.transformSettings.distance')}</span>
      <div className="embed-editor_shadow-field">
        <DragSlider
          value={distancePx ?? 0}
          min={0}
          max={DISTANCE_PX_MAX}
          disabled={busy || (value.trim() !== '' && distancePx === undefined)}
          ariaLabel={ariaLabel}
          onPreview={(amount) => {
            if (!focused.current) {
              setDraft(written(amount));
            }
          }}
          onInput={(amount) => onLive(written(amount))}
          onCommit={(amount) => onCommit(amount === 0 ? '' : written(amount))}
        />
        {}
        <VariableConnect
          code
          ariaLabel={translate('style.transformSettings.connect', { name: ariaLabel })}
          disabled={busy}
          className="is-fill"
          prop="perspective"
          canvasProperty="perspective"
          onPick={(binding) => onCommit(binding)}
        >
          <input
            className="u-input embed-editor_size-input embed-editor_shadow-num"
            value={draft}
            spellCheck={false}
            disabled={busy}
            aria-label={ariaLabel}
            placeholder="0"
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              onCommit(distanceText(draft, lengthUnitName(lengthUnit)));
            }}
            onKeyDown={(event) => {
              const stepped = stepDistanceKey(event);
              if (stepped !== undefined) {
                setDraft(stepped);
              }
            }}
          />
        </VariableConnect>
        <span className="embed-editor_tsettings-unit">{lengthUnitName(lengthUnit).toUpperCase()}</span>
      </div>
    </div>
  );
}

function distanceText(draft: string, unit: LengthUnitName): string {
  const trimmed = draft.trim();
  if (!trimmed || /^0(?:px|rem)?$/i.test(trimmed)) {
    return '';
  }
  return /[a-z%)]$/i.test(trimmed) ? trimmed : `${trimmed}${unit}`;
}

function stepDistanceKey(event: KeyboardEvent<HTMLInputElement>): string | undefined {
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

const HelpIcon = centralIcon(centralHelp);

export default function TransformSettings({
  read,
  busy,
  setProp,
  clearProp,
  selfPerspective,
  onSelfPerspective,
}: {
  read: Read;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  selfPerspective: string;
  onSelfPerspective: (distance: string, live: boolean) => void;
}) {
  const translate = useTranslate();
  const writeOrigin = (prop: string, next: Origin) => {
    const value = serializeOrigin(next);
    if (value) {
      setProp(prop, value, false);
    } else {
      clearProp(prop);
    }
  };

  return (
    <div className="embed-editor_tsettings">
      <TransformSection read={read} busy={busy} setProp={setProp} clearProp={clearProp} writeOrigin={writeOrigin} />

      <section className="embed-editor_tsettings-section">
        <Heading
          title={translate('style.transformSettings.selfPerspective')}
          props={['transform']}
          note={translate('style.transformSettings.selfPerspectiveNote')}
          busy={busy}
          cleared={!!selfPerspective}
          onClear={() => onSelfPerspective('', false)}
        />
        <DistanceRow
          value={selfPerspective}
          busy={busy}
          ariaLabel={translate('style.transformSettings.selfPerspectiveDistance')}
          onLive={(distance) => onSelfPerspective(distance, true)}
          onCommit={(distance) => onSelfPerspective(distance, false)}
        />
      </section>

      <ChildrenPerspectiveSection read={read} busy={busy} setProp={setProp} clearProp={clearProp} writeOrigin={writeOrigin} />
    </div>
  );
}

type SectionProps = {
  read: Read;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  writeOrigin: (prop: string, next: Origin) => void;
};

function TransformSection({ read, busy, setProp, clearProp, writeOrigin }: SectionProps) {
  const translate = useTranslate();
  const transformOrigin = parseOrigin(effectiveValue(read, 'transform-origin'));
  const backface = effectiveValue(read, 'backface-visibility').toLowerCase();
  const shownBackface = useHighlight(backface, 'backface-visibility', ['visible', 'hidden'], 'visible');
  const backfaceImportant = displayOf(read('backface-visibility')).important;
  return (
    <section className="embed-editor_tsettings-section">
      <Heading
        title={translate('style.transformSettings.transformSettings')}
        props={['transform-origin', 'backface-visibility']}
        busy={busy}
        cleared={!!effectiveValue(read, 'transform-origin') || !!backface}
        onClear={() => clearProp(['transform-origin', 'backface-visibility'])}
      />
      <OriginRow
        label={translate('style.transformSettings.origin')}
        origin={transformOrigin}
        busy={busy}
        ariaLabel={translate('style.transformSettings.transformOrigin')}
        onChange={(next) => writeOrigin('transform-origin', next)}
      />
      <div className="embed-editor_size-row">
        <span className="embed-editor_size-label embed-editor_bg-caption">{translate('style.transformSettings.backface')}</span>
        <ImportantMark important={backfaceImportant}>
          <KeywordSegments
            prop="backface-visibility"
            value={effectiveValue(read, 'backface-visibility')}
            important={backfaceImportant}
            ariaLabel={translate('style.transformSettings.backfaceVisibility')}
            busy={busy}
            onWrite={(value, important) => setProp('backface-visibility', value, important)}
            onClear={() => clearProp('backface-visibility')}
          >
            <SegmentedControl
              value={shownBackface}
              options={backfaceOptions(translate)}
              onChange={(value) => setProp('backface-visibility', value, backfaceImportant)}
              ariaLabel={translate('style.transformSettings.backfaceVisibility')}
              disabled={busy}
            />
          </KeywordSegments>
        </ImportantMark>
      </div>
    </section>
  );
}

function ChildrenPerspectiveSection({ read, busy, setProp, clearProp, writeOrigin }: SectionProps) {
  const translate = useTranslate();
  const perspectiveOrigin = parseOrigin(effectiveValue(read, 'perspective-origin'));
  const childDistance = effectiveValue(read, 'perspective');
  return (
    <section className="embed-editor_tsettings-section">
      <Heading
        title={translate('style.transformSettings.childrenPerspective')}
        props={['perspective', 'perspective-origin']}
        note={translate('style.transformSettings.childrenPerspectiveNote')}
        busy={busy}
        cleared={!!childDistance || !!effectiveValue(read, 'perspective-origin')}
        onClear={() => clearProp(['perspective', 'perspective-origin'])}
      />
      <DistanceRow
        value={childDistance}
        busy={busy}
        ariaLabel={translate('style.transformSettings.childrenPerspectiveDistance')}
        onLive={(distance) => {
          if (distance) {
            setProp('perspective', distance, false);
          }
        }}
        onCommit={(distance) => {
          if (distance) {
            setProp('perspective', distance, false);
          } else {
            clearProp('perspective');
          }
        }}
      />
      <OriginRow
        label={translate('style.transformSettings.origin')}
        origin={perspectiveOrigin}
        busy={busy}
        ariaLabel={translate('style.transformSettings.perspectiveOrigin')}
        onChange={(next) => writeOrigin('perspective-origin', next)}
      />
    </section>
  );
}
