import { centralIcon } from '../../ui/central/CentralIcon';
import { chevronDown as centralChevronDown, close as centralClose, more as centralMore } from '../../ui/central/centralGeometry';
import Popup from '../../ui/Popup';
import { useRef, useState } from 'react';
import { SegBar, StackedField, LiveInput, PropLabel, GroupLabel, type Props, type Seg } from './TypographySection';
import { parseFlexShorthand } from './model/webflow';
import { splitTopLevelSpaces } from './model/background';
import SegmentPill from './components/SegmentPill';
import KeywordConnect, { VariableMenuItem } from './KeywordConnect';
import { displayOf, displayText } from './model/styleDisplay';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import { useSelectorState } from './model/selectorScope';


const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');


const FLEX_SHRINK_ICON_SECOND_PATH =
  'M8.00004 10.7071L5.85359 12.8536L5.14648 12.1464L8.50004 8.79289L11.8536 12.1464' + 'L11.1465 12.8536L9.00004 10.7071V15H8.00004V10.7071Z';
const FLEX_SHRINK_ICON_THIRD_PATH =
  'M8.00004 4.29289L5.85359 2.14645L5.14648 2.85355L8.50004 6.20711L11.8536 2.85355' + 'L11.1465 2.14645L9.00004 4.29289V0L8.00004 4.37103e-08V4.29289Z';

function FlexShrinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M15 8L2 8L2 7L15 7V8Z" fill="currentColor" />
      <path d={FLEX_SHRINK_ICON_SECOND_PATH} fill="currentColor" />
      <path d={FLEX_SHRINK_ICON_THIRD_PATH} fill="currentColor" />
    </svg>
  );
}
const FLEX_GROW_ICON_SECOND_PATH =
  'M8.52731 3.70718L10.6738 5.85363L11.3809 5.14652L8.02731 1.79297L4.67375 5.14652' +
  'L5.38086 5.85363L7.52731 3.70718L7.52731 12.293L5.38086 10.1465L4.67375 10.8536' +
  'L8.02731 14.2072L11.3809 10.8536L10.6738 10.1465L8.52731 12.293L8.52731 3.70718Z';

function FlexGrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path opacity="0.4" fillRule="evenodd" clipRule="evenodd" d="M2 0.999999L14 1L14 2L2 2L2 0.999999ZM2 14L14 14L14 15L2 15L2 14Z" fill="currentColor" />
      <path d={FLEX_GROW_ICON_SECOND_PATH} fill="currentColor" />
    </svg>
  );
}
const FLEX_NONE_ICON_SECOND_PATH =
  'M7.29293 7.99996L5.14648 5.85352L5.85359 5.14641L8.00004 7.29286L10.1465 5.14641' +
  'L10.8536 5.85352L8.70714 7.99996L10.8536 10.1464L10.1465 10.8535L8.00004 8.70707' +
  'L5.85359 10.8535L5.14648 10.1464L7.29293 7.99996Z';

function FlexNoneIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 14H4L4 13H12V14ZM12 3L4 3L4 2L12 2V3Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d={FLEX_NONE_ICON_SECOND_PATH} fill="currentColor" />
    </svg>
  );
}
const CloseIcon = centralIcon(centralClose);
const MoreDotsIcon = centralIcon(centralMore);
const ChevronIcon = centralIcon(centralChevronDown);
function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="embed-editor_display-menu-item" onClick={onClick}>
      {label}
    </button>
  );
}
function AlignSelfStartIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 1V15H3V9H11.5C11.7761 9 12 8.77614 12 8.5V7.5C12 7.22386 11.7761 7 11.5 7H3V1H2Z" fill="currentColor" />
    </svg>
  );
}
function AlignSelfCenterIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M7 15V9H2.5C2.22386 9 2 8.77614 2 8.5V7.5C2 7.22386 2.22386 7 2.5 7H7V1H8V15H7Z" fill="currentColor" />
      <path d="M14 7.5C14 7.22386 13.7761 7 13.5 7H9V9H13.5C13.7761 9 14 8.77614 14 8.5V7.5Z" fill="currentColor" />
    </svg>
  );
}
function AlignSelfEndIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 9V15H14V1H13V7H4.5C4.22386 7 4 7.22386 4 7.5V8.5C4 8.77614 4.22386 9 4.5 9H13Z" fill="currentColor" />
    </svg>
  );
}
function AlignSelfStretchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 15V1H3V7H13V1H14V15H13V9H3V15H2Z" fill="currentColor" />
    </svg>
  );
}
const ALIGN_SELF_BASELINE_ICON_FIRST_PATH = 'M13 2V8.29289L14.6464 6.64645L15.3536 7.35355L12.5 10.2071L9.64645 7.35355L10.3536 6.64645' + 'L12 8.29289V2H13Z';
const ALIGN_SELF_BASELINE_ICON_THIRD_PATH =
  'M4.62582 2H6.37412L8.72712 10H7.68476L7.09649 7.99994H3.90349L3.31524 10H2.27288L4.62582 2' +
  'ZM6.80237 6.99994L5.62585 2.9999H5.37409L4.19761 6.99994H6.80237Z';

function AlignSelfBaselineIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={ALIGN_SELF_BASELINE_ICON_FIRST_PATH} fill="currentColor" />
      <path d="M16 12L1 12V13L16 13V12Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d={ALIGN_SELF_BASELINE_ICON_THIRD_PATH} fill="currentColor" />
    </svg>
  );
}


function flexSegs(translate: Translator): readonly Seg[] {
  return [
    { value: '0 1 auto', icon: <FlexShrinkIcon />, label: translate('style.flexChildSection.shrinkIfNeeded') },
    { value: '1 1 0%', icon: <FlexGrowIcon />, label: translate('style.flexChildSection.growIfPossible') },
    { value: '0 0 auto', icon: <FlexNoneIcon />, label: translate('style.flexChildSection.noShrinkOrGrow') },
  ];
}

function alignSelfSegs(translate: Translator): readonly Seg[] {
  return [
    { value: 'auto', icon: <CloseIcon />, label: translate('style.flexChildSection.auto') },
    { value: 'flex-start', icon: <AlignSelfStartIcon />, label: translate('style.flexChildSection.start') },
    { value: 'center', icon: <AlignSelfCenterIcon />, label: translate('style.flexChildSection.center') },
    { value: 'flex-end', icon: <AlignSelfEndIcon />, label: translate('style.flexChildSection.end') },
    { value: 'stretch', icon: <AlignSelfStretchIcon />, label: translate('style.flexChildSection.stretch') },
    { value: 'baseline', icon: <AlignSelfBaselineIcon />, label: translate('style.flexChildSection.baseline') },
  ];
}

function justifySelfSegs(translate: Translator): readonly Seg[] {
  return [
    { value: 'auto', icon: <CloseIcon />, label: translate('style.flexChildSection.auto') },
    { value: 'start', icon: <AlignSelfStartIcon />, label: translate('style.flexChildSection.start') },
    { value: 'center', icon: <AlignSelfCenterIcon />, label: translate('style.flexChildSection.center') },
    { value: 'end', icon: <AlignSelfEndIcon />, label: translate('style.flexChildSection.end') },
    { value: 'stretch', icon: <AlignSelfStretchIcon />, label: translate('style.flexChildSection.stretch') },
    { value: 'baseline', icon: <AlignSelfBaselineIcon />, label: translate('style.flexChildSection.baseline') },
  ];
}

function orderSegs(translate: Translator): readonly Seg[] {
  return [
    { value: '0', icon: <CloseIcon />, label: translate('style.flexChildSection.defaultOrder') },
    {
      value: '-1',
      icon: <span className="embed-editor_seg-text">{translate('style.flexChildSection.first')}</span>,
      label: translate('style.flexChildSection.first'),
    },
    {
      value: '1',
      icon: <span className="embed-editor_seg-text">{translate('style.flexChildSection.last')}</span>,
      label: translate('style.flexChildSection.last'),
    },
  ];
}

const SPAN_ONE_PLACEHOLDER = 'span 1';

function canonBasis(basis: string): string {
  return /^0(?:px|%|r?em|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/.test(basis) ? '0%' : basis;
}

function flexCurrent(read: Props['read']): string {
  const shorthand = displayOf(read('flex'));
  let grow: string, shrink: string, basis: string;
  if (shorthand.important) {
    return norm(displayText(shorthand));
  }
  if (shorthand.present) {
    const parsed = parseFlexShorthand(shorthand.value);
    if (!parsed) {
      return norm(shorthand.value);
    }
    grow = parsed['flex-grow'] ?? '0';
    shrink = parsed['flex-shrink'] ?? '1';
    basis = parsed['flex-basis'] ?? 'auto';
  } else {
    const growDisplay = displayOf(read('flex-grow'));
    const shrinkDisplay = displayOf(read('flex-shrink'));
    const basisDisplay = displayOf(read('flex-basis'));
    if (!growDisplay.present && !shrinkDisplay.present && !basisDisplay.present) {
      return '0 1 auto';
    }
    grow = growDisplay.present ? norm(growDisplay.value) : '0';
    shrink = shrinkDisplay.present ? norm(shrinkDisplay.value) : '1';
    basis = basisDisplay.present ? norm(basisDisplay.value) : 'auto';
  }
  return `${grow} ${shrink} ${canonBasis(basis)}`;
}

const FLEX_PROPS = ['flex', 'flex-grow', 'flex-shrink', 'flex-basis'] as const;
function flexLabelProp(read: Props['read']): string {
  return FLEX_PROPS.find((prop) => read(prop)?.source === 'selected') ?? FLEX_PROPS.find((prop) => read(prop) !== undefined) ?? 'flex';
}

function alignSelfCurrent(read: Props['read']): string {
  const display = displayOf(read('align-self'));
  if (!display.present) {
    return 'auto';
  }
  if (display.important) {
    return norm(displayText(display));
  }
  const normalized = norm(display.value);
  if (normalized === 'start' || normalized === 'self-start') {
    return 'flex-start';
  }
  if (normalized === 'end' || normalized === 'self-end') {
    return 'flex-end';
  }
  return normalized || 'auto';
}

function justifySelfCurrent(read: Props['read']): string {
  const display = displayOf(read('justify-self'));
  if (!display.present) {
    return 'auto';
  }
  if (display.important) {
    return norm(displayText(display));
  }
  const normalized = norm(display.value);
  if (normalized === 'flex-start' || normalized === 'self-start' || normalized === 'left') {
    return 'start';
  }
  if (normalized === 'flex-end' || normalized === 'self-end' || normalized === 'right') {
    return 'end';
  }
  return normalized || 'auto';
}

function orderCurrent(read: Props['read']): string {
  const display = displayOf(read('order'));
  return display.present ? norm(displayText(display)) : '0';
}


const FLEX_SEG_VALUES = new Set(['0 1 auto', '1 1 0%', '0 0 auto']);

function SizingControl(props: Props) {
  const translate = useTranslate();
  const { read, busy, setProp, liveSetProp, onProvenance, onSelectSelector } = props;
  const sizing = useFlexSizing(props);
  const { current, showSingle, showPanel, clearFlex, pickPreset } = sizing;
  const flexProp = flexLabelProp(read);

  return (
    <>
      <div className="embed-editor_size-row">
        <PropLabel
          label={translate('style.flexChildSection.sizing')}
          prop={flexProp}
          display={displayOf(read(flexProp))}
          contributors={read(flexProp)?.contributors ?? []}
          busy={busy}
          onClear={clearFlex}
          onProvenance={onProvenance}
          onSelectSelector={onSelectSelector}
        />
        <KeywordConnect
          prop="flex"
          value={current}
          ariaLabel={translate('style.flexChildSection.flexSizing')}
          disabled={busy}
          dot={showSingle ? 'field' : 'wrapper'}
          onPick={pickPreset}
        >
          <div
            ref={sizing.rootRef}
            className={`embed-editor_display ${showSingle ? 'is-custom' : ''}`}
            role="group"
            aria-label={translate('style.flexChildSection.flexSizing')}
          >
            <SegmentPill />
            {showSingle ? (
              <LiveInput
                value={current}
                busy={busy}
                placeholder="unset, var(…)"
                ariaLabel={translate('style.flexChildSection.flexSizing')}
                className="embed-editor_value-input embed-editor_display-input"
                prop="flex"
                onCommit={(value, important) => setProp('flex', value, important)}
                onLiveCommit={(value, important) => liveSetProp('flex', value, important)}
                onClear={sizing.clearSingle}
              />
            ) : (
              <FlexSegments current={current} busy={busy} customized={sizing.customized} pickPreset={pickPreset} togglePanel={sizing.togglePanel} />
            )}
            <FlexSizingMenu
              open={sizing.menuOpen}
              showSingle={showSingle}
              busy={busy}
              onToggle={sizing.toggleMenu}
              pickPreset={pickPreset}
              enterSingleCustom={sizing.enterSingleCustom}
            />
          </div>
        </KeywordConnect>
      </div>
      {showPanel ? (
        <div className="embed-editor_type-triple embed-editor_flex-custom">
          <StackedField prop="flex-grow" label={translate('style.flexChildSection.grow')} placeholder="0" {...props} />
          <StackedField prop="flex-shrink" label={translate('style.flexChildSection.shrink')} placeholder="1" {...props} />
          <StackedField prop="flex-basis" label={translate('style.flexChildSection.basis')} placeholder="auto" {...props} />
        </div>
      ) : undefined}
    </>
  );
}

function useFlexSizing({ read, setProp, clearProp }: Props) {
  const current = flexCurrent(read);
  const isPreset = FLEX_SEG_VALUES.has(current);
  const isTriple = splitTopLevelSpaces(current).length === 3;
  const [panelOpen, setPanelOpen] = useState(false);
  const [singleCustom, setSingleCustom] = useSelectorState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const showSingle = singleCustom || (!isPreset && !isTriple);
  const showPanel = !showSingle && panelOpen;
  const clearFlex = () => clearProp(['flex', 'flex-grow', 'flex-shrink', 'flex-basis']);

  const pickPreset = (value: string) => {
    setMenuOpen(false);
    setSingleCustom(false);
    setPanelOpen(false);
    setProp('flex', value, false);
  };
  const togglePanel = () => {
    if (!panelOpen && isPreset) {
      setProp('flex', '1 0 auto', false);
    }
    setPanelOpen((value) => !value);
  };
  const enterSingleCustom = () => {
    setMenuOpen(false);
    setPanelOpen(false);
    setSingleCustom(true);
  };
  const clearSingle = () => {
    setSingleCustom(false);
    clearFlex();
  };
  return {
    current,
    rootRef,
    menuOpen,
    showSingle,
    showPanel,
    customized: showPanel || (!isPreset && isTriple),
    clearFlex,
    clearSingle,
    pickPreset,
    togglePanel,
    enterSingleCustom,
    toggleMenu: () => setMenuOpen((value) => !value),
  };
}

function FlexSegments({
  current,
  busy,
  customized,
  pickPreset,
  togglePanel,
}: {
  current: string;
  busy: boolean;
  customized: boolean;
  pickPreset: (value: string) => void;
  togglePanel: () => void;
}) {
  const translate = useTranslate();
  return (
    <>
      {flexSegs(translate).map((seg) => (
        <button
          key={seg.value}
          type="button"
          role="radio"
          aria-checked={current === seg.value}
          className={'embed-editor_display-seg ' + (current === seg.value ? 'is-selected' : '')}
          disabled={busy}
          aria-label={seg.label}
          title={seg.label}
          onClick={() => pickPreset(seg.value)}
        >
          {seg.icon}
        </button>
      ))}
      <button
        type="button"
        className={'embed-editor_display-seg ' + (customized ? 'is-selected' : '')}
        disabled={busy}
        aria-pressed={customized}
        aria-label={translate('style.flexChildSection.customizeGrowShrink')}
        title={translate('style.flexChildSection.customizeGrowShrink')}
        onClick={togglePanel}
      >
        <MoreDotsIcon />
      </button>
    </>
  );
}

function FlexSizingMenu({
  open,
  showSingle,
  busy,
  onToggle,
  pickPreset,
  enterSingleCustom,
}: {
  open: boolean;
  showSingle: boolean;
  busy: boolean;
  onToggle: () => void;
  pickPreset: (value: string) => void;
  enterSingleCustom: () => void;
}) {
  const translate = useTranslate();
  return (
    <>
      <button
        type="button"
        className="embed-editor_display-arrow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={translate('style.flexChildSection.moreSizingOptions')}
        disabled={busy}
        onClick={onToggle}
      >
        <ChevronIcon />
      </button>
      {open ? (
        <Popup mode="popover" portal={false} onClose={onToggle} className="embed-editor_display-menu" role="menu">
          <VariableMenuItem onClose={onToggle} />
          {showSingle ? (
            flexSegs(translate).map((seg) => <MenuItem key={seg.value} label={seg.label} onClick={() => pickPreset(seg.value)} />)
          ) : (
            <MenuItem label={translate('style.flexChildSection.custom')} onClick={enterSingleCustom} />
          )}
        </Popup>
      ) : undefined}
    </>
  );
}


const rawOf = displayText;

function splitSlash(value: string): [string, string] {
  const i = value.indexOf('/');
  return i < 0 ? [value.trim(), ''] : [value.slice(0, i).trim(), value.slice(i + 1).trim()];
}

function buildLine(start: string, end: string): string {
  const startLine = start.trim() || 'auto';
  const endLine = end.trim() || 'auto';
  if (startLine === 'auto' && endLine === 'auto') {
    return '';
  }
  return endLine === 'auto' ? startLine : `${startLine} / ${endLine}`;
}

function AxisRow({ axis, label, props: sp }: { axis: 'column' | 'row'; label: string; props: Props }) {
  const { read, busy, setProp, clearProp, liveSetProp, onProvenance, onSelectSelector } = sp;
  const translate = useTranslate();
  const startProp = `grid-${axis}-start`;
  const endProp = `grid-${axis}-end`;
  const shortProp = `grid-${axis}`;
  const siblingProp = axis === 'column' ? 'grid-row' : 'grid-column';
  const startDisplay = displayOf(read(startProp));
  const endDisplay = displayOf(read(endProp));
  const shorthandDisplay = displayOf(read(shortProp));
  const [shStart, shEnd] = shorthandDisplay.present ? splitSlash(shorthandDisplay.value) : ['', ''];
  const startValue = shorthandDisplay.present ? shStart : startDisplay.present ? rawOf(startDisplay) : '';
  const endValue = shorthandDisplay.present ? shEnd : endDisplay.present ? rawOf(endDisplay) : '';

  const clearAxis = () => {
    clearProp([shortProp, startProp, endProp]);
    const sib = displayOf(read(siblingProp));
    if (sib.present && sib.value.trim()) {
      setProp(siblingProp, sib.value.trim(), sib.important);
    }
  };

  const commit = (which: 'start' | 'end', value: string, options: CommitOptions) => {
    const { important, live } = options;
    const start = (which === 'start' ? value : startValue).trim();
    const end = (which === 'end' ? value : endValue).trim();
    const line = buildLine(start, end);
    if (live) {
      if (line) {
        liveSetProp(shortProp, line, important);
      }
      return;
    }
    if (!line) {
      clearAxis();
      return;
    }
    setProp(shortProp, line, important);
    if (startDisplay.present || endDisplay.present) {
      clearProp([startProp, endProp]);
    }
  };

  const cellProps = { axisLabel: label, busy, commit };
  return (
    <div className="embed-editor_size-row embed-editor_line-row">
      <GroupLabel
        label={label}
        props={[shortProp, startProp, endProp]}
        read={read}
        busy={busy}
        onClear={clearAxis}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <div className="embed-editor_line-cells">
        <LineCell which="start" caption={translate('style.flexChildSection.start')} value={startValue} {...cellProps} />
        <LineCell which="end" caption={translate('style.flexChildSection.end')} value={endValue} {...cellProps} />
      </div>
    </div>
  );
}

interface CommitOptions {
  readonly important: boolean;
  readonly live: boolean;
}

function LineCell({
  which,
  caption,
  value,
  axisLabel,
  busy,
  commit,
}: {
  which: 'start' | 'end';
  caption: string;
  value: string;
  axisLabel: string;
  busy: boolean;
  commit: (which: 'start' | 'end', value: string, options: CommitOptions) => void;
}) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_line-cell">
      <LiveInput
        value={value}
        busy={busy}
        placeholder={which === 'end' ? SPAN_ONE_PLACEHOLDER : 'auto'}
        ariaLabel={translate('style.flexChildSection.lineAria', { axis: axisLabel, caption })}
        className="u-input embed-editor_size-input"
        onCommit={(next, important) => commit(which, next, { important, live: false })}
        onLiveCommit={(next, important) => commit(which, next, { important, live: true })}
        onClear={() => commit(which, '', { important: false, live: false })}
      />
      <span className="embed-editor_line-caption">{caption}</span>
    </div>
  );
}

function PositionControl(props: Props) {
  const translate = useTranslate();
  return (
    <>
      <AxisRow axis="column" label={translate('style.flexChildSection.column')} props={props} />
      <AxisRow axis="row" label={translate('style.flexChildSection.row')} props={props} />
    </>
  );
}


export default function FlexChildSection(props: Props) {
  const { read } = props;
  const translate = useTranslate();
  return (
    <>
      <SizingControl {...props} />
      <PositionControl {...props} />
      <SelfRow
        label={translate('style.flexChildSection.align')}
        prop="align-self"
        segs={alignSelfSegs(translate)}
        current={alignSelfCurrent(read)}
        ariaLabel={translate('style.flexChildSection.alignSelf')}
        props={props}
      />
      <SelfRow
        label={translate('style.flexChildSection.justify')}
        prop="justify-self"
        segs={justifySelfSegs(translate)}
        current={justifySelfCurrent(read)}
        ariaLabel={translate('style.flexChildSection.justifySelf')}
        props={props}
      />
      <SelfRow
        label={translate('style.flexChildSection.order')}
        prop="order"
        segs={orderSegs(translate)}
        current={orderCurrent(read)}
        ariaLabel={translate('style.flexChildSection.order')}
        more={{ value: '2' }}
        props={props}
      />
    </>
  );
}

function SelfRow({
  label,
  prop,
  segs,
  current,
  ariaLabel,
  more,
  props,
}: {
  label: string;
  prop: string;
  segs: readonly Seg[];
  current: string;
  ariaLabel: string;
  more?: { readonly value: string };
  props: Props;
}) {
  const { read, busy, setProp, clearProp, liveSetProp, onProvenance, onSelectSelector } = props;
  return (
    <div className="embed-editor_size-row">
      <PropLabel
        label={label}
        prop={prop}
        display={displayOf(read(prop))}
        contributors={read(prop)?.contributors ?? []}
        busy={busy}
        onClear={() => clearProp(prop)}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <SegBar
        segs={segs}
        current={current}
        ariaLabel={ariaLabel}
        prop={prop}
        busy={busy}
        {...(more === undefined ? {} : { moreSegment: true, moreValue: more.value })}
        onCommit={(value, important) => setProp(prop, value, important)}
        onLiveCommit={(value, important) => liveSetProp(prop, value, important)}
        onClear={() => clearProp(prop)}
      />
    </div>
  );
}
