import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { GroupLabel } from './TypographySection';
import FieldLabel from './components/FieldLabel';
import { PropTip } from './components/CssPropertyTip';
import type { SelectOption } from './components/Select';
import { VariableSelect } from './KeywordConnect';
import VariableConnect from './VariableConnect';
import { HoverTooltip } from '../../ui/SegmentedControl';
import GridSettings from './GridSettings';
import type { ResolvedProp } from './model/resolved';
import { useHighlight } from './model/computedStyle';
import { commitInPlace } from './model/commitStyleInPlace';
import { NEW_COLUMN, NEW_ROW, repeatTracks } from './gridTracks';
import { classifyTrackCount } from './model/gridTemplate';
import GridTrackExpression from './GridTrackExpression';
import { GRID_ITEM_ALIGN, gridKeyword, GridAlignIcon, X_ALIGN_ICONS, Y_ALIGN_ICONS, xAlignLabels, yAlignLabels, cap, CustomizeIcon } from './GridIcons';
import { GridDirectionControl, GridContentControl, CountField } from './GridFlowControls';
import { displayOf, displayText, parseImportant, withImportant } from './model/styleDisplay';
import { useHoverPreview } from './connectFieldHelpers';
import { TOOLTIP_DELAY_MS } from '../../ui/delayedTooltip';


type SetProp = (prop: string, value: string, important: boolean) => void;
type LiveSetProp = (prop: string, value: string | undefined, important: boolean) => void;
type ClearProp = (prop: string | string[]) => void;
type Read = (prop: string) => ResolvedProp | undefined;

function GridAlignBox({
  justifyItems,
  alignItems,
  busy,
  onSet,
}: {
  justifyItems: string;
  alignItems: string;
  busy: boolean;
  onSet: (prop: string, value: string) => void;
}) {
  const translate = useTranslate();
  const xLabels = xAlignLabels(translate);
  const yLabels = yAlignLabels(translate);
  const ji = justifyItems || 'stretch';
  const ai = alignItems || 'stretch';
  const itemStyle: CSSProperties = {
    width: ji === 'stretch' ? 'auto' : '16px',
    height: ai === 'stretch' ? 'auto' : '16px',
  };
  const positions = ['start', 'center', 'end'];
  return (
    <div className="embed-editor_align-box">
      <div className="embed-editor_align-dots">
        {positions.map((ry) =>
          positions.map((cx) => (
            <button
              key={`${ry}-${cx}`}
              type="button"
              className="embed-editor_align-dot"
              disabled={busy}
              aria-label={translate('style.gridControls.alignAt', { horizontal: xLabels[cx] ?? cap(cx), vertical: yLabels[ry] ?? cap(ry) })}
              onClick={() => {
                onSet('justify-items', cx);
                onSet('align-items', ry);
              }}
            >
              <span />
            </button>
          )),
        )}
      </div>
      <div className="embed-editor_grid-align-preview" style={{ justifyItems: ji, alignItems: ai }} aria-hidden="true">
        <span className="embed-editor_grid-align-item" style={itemStyle} />
      </div>
    </div>
  );
}

const AXIS_CUSTOM = '__custom__';

function GridAxisCustomInput({
  prop,
  value,
  busy,
  ariaLabel,
  autoFocus,
  onCommit,
  onClear,
}: {
  prop: string;
  value: string;
  busy: boolean;
  ariaLabel: string;
  autoFocus: boolean;
  onCommit: (value: string) => void;
  onClear: () => void;
}) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      onCommit(trimmed);
    } else {
      onClear();
    }
  };
  return (
    <VariableConnect
      className="is-fill"
      prop={prop}
      canvasProperty={prop}
      disabled={busy}
      ariaLabel={translate('styleModel.shared.connectVariable', { label: ariaLabel })}
      onPick={(binding) => {
        setDraft(binding);
        onCommit(binding);
      }}
    >
      <input
        className="u-select-custom-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
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

function alignAxisOptions(axis: 'X' | 'Y', translate: Translator): SelectOption<string>[] {
  const labels = axis === 'X' ? xAlignLabels(translate) : yAlignLabels(translate);
  const icons = axis === 'X' ? X_ALIGN_ICONS : Y_ALIGN_ICONS;
  const options: SelectOption<string>[] = GRID_ITEM_ALIGN.map((option) => ({
    value: option,
    label: labels[option] ?? cap(option),
    icon: <GridAlignIcon paths={icons[option] ?? []} />,
  }));
  options.push({ value: AXIS_CUSTOM, label: translate('style.gridControls.custom') });
  return options;
}

interface GridAlignAxisProps {
  axis: 'X' | 'Y';
  prop: string;
  value: string;
  busy: boolean;
  read: Read;
  onSet: (value: string) => void;
  onPreview: (value: string | undefined) => void;
  onClear: () => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}
function GridAlignAxis(props: GridAlignAxisProps) {
  const { axis, prop, value, busy, onSet, onPreview, onClear } = props;
  const translate = useTranslate();
  const [forceCustom, setForceCustom] = useState(false);
  const present = Boolean(value);
  const shown = gridKeyword(value);
  const known = GRID_ITEM_ALIGN.includes(shown);
  const customMode = forceCustom || (present && !known);
  const shownAlign = useHighlight('', present ? '' : prop, GRID_ITEM_ALIGN, 'stretch');
  const options = alignAxisOptions(axis, translate);
  const preview = (option: string | undefined) => onPreview(option === AXIS_CUSTOM ? undefined : option);
  const pick = (choice: string) => {
    if (choice === AXIS_CUSTOM) {
      setForceCustom(true);
      onSet('unset');
      return;
    }
    setForceCustom(false);
    onSet(choice);
  };
  return (
    <div className="embed-editor_align-axis">
      <GroupLabel
        label={axis}
        props={[prop]}
        read={props.read}
        busy={busy}
        onClear={onClear}
        onProvenance={props.onProvenance}
        onSelectSelector={props.onSelectSelector}
      />
      {}
      <VariableSelect
        prop={prop}
        rawValue={value}
        onVariable={(binding) => {
          setForceCustom(false);
          onSet(binding);
        }}
        value={customMode ? AXIS_CUSTOM : known ? shown : shownAlign}
        options={options}
        ariaLabel={translate('style.gridControls.alignAxis', { axis })}
        disabled={busy}
        hideTriggerIcon
        onChange={pick}
        onPreview={(option) => preview(option ?? undefined)}
        customInput={
          customMode ? (
            <GridAxisCustomInput
              prop={prop}
              value={value}
              busy={busy}
              ariaLabel={translate('style.gridControls.alignAxis', { axis })}
              autoFocus={forceCustom}
              onCommit={(next) => onSet(next)}
              onClear={() => {
                setForceCustom(false);
                onClear();
              }}
            />
          ) : undefined
        }
      />
    </div>
  );
}

interface GridControlsProps {
  read: Read;
  busy: boolean;
  setProp: SetProp;
  clearProp: ClearProp;
  liveSetProp: LiveSetProp;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}

function resolvedText(read: Read, prop: string): string {
  return displayText(displayOf(read(prop))).trim();
}

function writeText(setProp: SetProp, prop: string, text: string): void {
  const parsed = parseImportant(text);
  setProp(prop, parsed.value, parsed.important);
}

function resolvedValue(read: Read, prop: string): string {
  const resolved = read(prop);
  if (!resolved) {
    return '';
  }
  const source = resolved.source === 'selected' && resolved.selectedValue ? resolved.selectedValue : resolved.winner;
  return withImportant({ value: source.value.trim(), important: source.important });
}

export default function GridControls(props: GridControlsProps) {
  const { read, busy, setProp, clearProp } = props;
  const translate = useTranslate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const labelProps = {
    read,
    busy,
    onProvenance: props.onProvenance,
    onSelectSelector: props.onSelectSelector,
  };
  return (
    <>
      <GridTracksRow props={props} onConfigure={() => setSettingsOpen(true)} />
      <div className="embed-editor_size-row">
        <GroupLabel label={translate('style.gridControls.direction')} props={['grid-auto-flow']} {...labelProps} onClear={() => clearProp('grid-auto-flow')} />
        <GridDirectionControl
          value={resolvedText(read, 'grid-auto-flow')}
          busy={busy}
          onSet={(next) => writeText(setProp, 'grid-auto-flow', next)}
          onCommitCustom={(next, important) => setProp('grid-auto-flow', next, important)}
        />
      </div>
      <GridAlignRow props={props} />
      <ContentRow label={translate('style.gridControls.columns')} prop="justify-content" vertical={false} props={props} />
      <ContentRow label={translate('style.gridControls.rows')} prop="align-content" vertical props={props} />
      {settingsOpen ? (
        <GridSettings
          read={read}
          busy={busy}
          setProp={setProp}
          clearProp={clearProp}
          onProvenance={props.onProvenance}
          onSelectSelector={props.onSelectSelector}
          onClose={() => setSettingsOpen(false)}
        />
      ) : undefined}
    </>
  );
}

function GridTracksRow({ props, onConfigure }: { props: GridControlsProps; onConfigure: () => void }) {
  const { read, busy, setProp, clearProp } = props;
  const translate = useTranslate();
  const labelProps = {
    read,
    busy,
    onProvenance: props.onProvenance,
    onSelectSelector: props.onSelectSelector,
  };
  const columns = classifyTrackCount(resolvedValue(read, 'grid-template-columns'));
  const rows = classifyTrackCount(resolvedValue(read, 'grid-template-rows'));
  const customTracks = columns.kind === 'expression' || rows.kind === 'expression';
  return (
    <div className="embed-editor_size-row embed-editor_bg-row-top">
      <GroupLabel
        label={translate('style.gridControls.grid')}
        props={['grid-template-columns', 'grid-template-rows']}
        {...labelProps}
        onClear={() => clearProp(['grid-template-columns', 'grid-template-rows'])}
      />
      <div className="embed-editor_grid-tracks">
        <div className="embed-editor_gap-cell">
          {}
          <TrackCountCell
            prop="grid-template-columns"
            value={resolvedValue(read, 'grid-template-columns')}
            ariaLabel={translate('style.gridControls.gridColumns')}
            cell={NEW_COLUMN}
            busy={busy}
            setProp={setProp}
          />
          <GroupLabel
            label={translate('style.gridControls.columns')}
            props={['grid-template-columns']}
            {...labelProps}
            onClear={() => clearProp('grid-template-columns')}
          />
        </div>
        <div className="embed-editor_gap-cell">
          <TrackCountCell
            prop="grid-template-rows"
            value={resolvedValue(read, 'grid-template-rows')}
            ariaLabel={translate('style.gridControls.gridRows')}
            cell={NEW_ROW}
            busy={busy}
            setProp={setProp}
          />
          <GroupLabel
            label={translate('style.gridControls.rows')}
            props={['grid-template-rows']}
            {...labelProps}
            onClear={() => clearProp('grid-template-rows')}
          />
        </div>
        <ConfigureGridButton busy={busy} customTracks={customTracks} onOpen={onConfigure} />
      </div>
    </div>
  );
}

function TrackCountCell({
  prop,
  value,
  ariaLabel,
  cell,
  busy,
  setProp,
}: {
  prop: string;
  value: string;
  ariaLabel: string;
  cell: string;
  busy: boolean;
  setProp: SetProp;
}) {
  const classified = classifyTrackCount(value);
  switch (classified.kind) {
    case 'count':
      return <CountField value={classified.count} busy={busy} ariaLabel={ariaLabel} onCommit={(count) => setProp(prop, repeatTracks(count, cell), false)} />;
    case 'expression':
      return <GridTrackExpression value={value} prop={prop} ariaLabel={ariaLabel} busy={busy} onCommit={(next, important) => setProp(prop, next, important)} />;
    default: {
      const exhaustive: never = classified;
      return exhaustive;
    }
  }
}

function ConfigureGridButton({ busy, customTracks, onOpen }: { busy: boolean; customTracks: boolean; onOpen: () => void }) {
  const translate = useTranslate();
  const gearRef = useRef<HTMLButtonElement>(null);
  const [gearTip, setGearTip] = useState(false);
  const gearTimer = useRef<number | undefined>(undefined);
  const clearGearTimer = () => {
    if (gearTimer.current !== undefined) {
      window.clearTimeout(gearTimer.current);
      gearTimer.current = undefined;
    }
  };
  useEffect(() => clearGearTimer, []);
  return (
    <>
      <button
        ref={gearRef}
        type="button"
        className={'embed-editor_icon-btn embed-editor_grid-gear ' + (customTracks ? 'is-active' : '')}
        disabled={busy}
        aria-label={translate('style.gridControls.configureGrid')}
        onMouseEnter={() => {
          clearGearTimer();
          gearTimer.current = window.setTimeout(() => setGearTip(true), TOOLTIP_DELAY_MS);
        }}
        onMouseLeave={() => {
          clearGearTimer();
          setGearTip(false);
        }}
        onClick={() => {
          clearGearTimer();
          setGearTip(false);
          onOpen();
        }}
      >
        <CustomizeIcon />
      </button>
      {gearTip && gearRef.current ? <HoverTooltip anchor={gearRef.current}>{translate('style.gridControls.configureGrid')}</HoverTooltip> : undefined}
    </>
  );
}

function GridAlignRow({ props }: { props: GridControlsProps }) {
  const hoverPreview = useHoverPreview();
  const { read, busy, setProp, clearProp } = props;
  const translate = useTranslate();
  const alignAxis = (axis: 'X' | 'Y', prop: string) => (
    <GridAlignAxis
      axis={axis}
      prop={prop}
      value={resolvedText(read, prop).toLowerCase()}
      busy={busy}
      read={read}
      onSet={(next) => writeText(setProp, prop, next)}
      onPreview={(next) => hoverPreview(prop, next, false)}
      onClear={() => clearProp(prop)}
      onProvenance={props.onProvenance}
      onSelectSelector={props.onSelectSelector}
    />
  );
  return (
    <div className="embed-editor_size-row embed-editor_bg-row-top embed-editor_align-row">
      {}
      <FieldLabel
        className="embed-editor_size-label"
        active={false}
        disabled={busy}
        onReset={() => {}}
        tooltip={<PropTip props={['justify-items', 'align-items']} />}
      >
        {translate('style.gridControls.align')}
      </FieldLabel>
      <div className="embed-editor_align">
        <GridAlignBox
          justifyItems={gridKeyword(resolvedValue(read, 'justify-items').toLowerCase())}
          alignItems={gridKeyword(resolvedValue(read, 'align-items').toLowerCase())}
          busy={busy}
          onSet={(prop, next) => setProp(prop, next, false)}
        />
        <div className="embed-editor_align-axes">
          {alignAxis('X', 'justify-items')}
          {alignAxis('Y', 'align-items')}
        </div>
      </div>
    </div>
  );
}

function ContentRow({ label, prop, vertical, props }: { label: string; prop: string; vertical: boolean; props: GridControlsProps }) {
  const { read, busy, setProp, clearProp } = props;
  return (
    <div className="embed-editor_size-row">
      <GroupLabel
        label={label}
        props={[prop]}
        read={read}
        busy={busy}
        onClear={() => clearProp(prop)}
        onProvenance={props.onProvenance}
        onSelectSelector={props.onSelectSelector}
      />
      <GridContentControl
        value={resolvedText(read, prop)}
        prop={prop}
        vertical={vertical}
        ariaLabel={label}
        busy={busy}
        onSet={(next) => writeText(setProp, prop, next)}
        onCommitCustom={(next, important) => setProp(prop, next, important)}
      />
    </div>
  );
}
