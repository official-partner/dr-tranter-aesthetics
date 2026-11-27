import { useTranslate } from '../../../lib/i18n/useTranslate';
import type { MessageKey } from '../../../../shared/properties/i18n/messageRef';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { chevronDown as centralChevronDown } from '../../../ui/central/centralGeometry';

const ChevronDownGlyph = centralIcon(centralChevronDown, 12);

import { useRef } from 'react';
import Popup from '../../../ui/Popup';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import FieldLabel from '../components/FieldLabel';
import { PropTip, ProvenanceLabel } from '../components/CssPropertyTip';
import type { SelectOption } from '../components/Select';
import { KeywordVariableField, VariableSelect, variableIn } from '../KeywordConnect';
import DisplayControl, { DISPLAY_VALUES } from '../DisplayControl';
import { useAnchoredPosition } from '../components/provenancePosition';
export { useAnchoredPosition } from '../components/provenancePosition';
import { useHighlight } from '../model/computedStyle';
import ProvenanceList from '../ProvenanceList';
import { type ResolvedProp } from '../model/resolved';
import { splitTopLevelSpaces } from '../model/background';
import { type LiveSetProp } from './EditorBasics';
import { ValueField } from './AddProperty';
import { keepImportant } from '../model/styleDisplay';
import ImportantMark from '../components/ImportantMark';

export function SectionBlock({
  label,
  headerAction,
  open,
  mark,
  onToggle,
  children,
}: {
  readonly label: string;
  readonly headerAction?: ReactNode;
  readonly open: boolean;
  readonly mark?: 'own' | 'other' | undefined;
  readonly onToggle: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly children: ReactNode;
}) {
  const translate = useTranslate();
  return (
    <div className={`embed-editor_section-block ${open ? '' : 'is-collapsed'}`}>
      {}
      <div className="embed-editor_section-header">
        <button type="button" className="embed-editor_section-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="embed-editor_section-title">{label}</span>
        </button>
        {headerAction}
        {}
        {!open && mark ? (
          <span
            className={`embed-editor_section-dot ${mark === 'own' ? 'is-own' : ''}`}
            role="img"
            aria-label={translate(mark === 'own' ? 'styleModel.embed.row.hasOwnStyles' : 'styleModel.embed.row.hasOtherStyles', { label })}
            title={translate(mark === 'own' ? 'styleModel.embed.row.setOnThis' : 'styleModel.embed.row.setOnOther')}
          />
        ) : undefined}
        <button
          type="button"
          className="embed-editor_section-chevron-btn"
          aria-expanded={open}
          aria-label={translate(open ? 'styleModel.embed.row.collapse' : 'styleModel.embed.row.expand', { label })}
          onClick={onToggle}
        >
          <ChevronDownGlyph className="embed-editor_section-chevron" />
        </button>
      </div>
      {open ? <div className="embed-editor_section-body">{children}</div> : undefined}
    </div>
  );
}


export function ProvenancePopover({
  prop,
  anchor,
  resolved,
  onClose,
  onSelectSelector,
}: {
  prop: string;
  anchor: DOMRect;
  resolved: ResolvedProp;
  onClose: () => void;
  onAnchorReclick: (prop: string) => void;
  onSelectSelector: (selectorText: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  const ref = useRef<HTMLDivElement>(null);
  const headerLabel = prop;
  const position = useAnchoredPosition(ref, anchor);

  return (
    <Popup
      mode="popover"
      onClose={onClose}
      ref={ref}
      className="embed-editor_provenance"
      role="dialog"
      label={translate('styleModel.embed.row.selectorsSetting', { property: headerLabel })}
      style={{ left: position.left, top: position.top }}
    >
      <div className="embed-editor_provenance-head">
        <code>{headerLabel}</code>
        <button type="button" className="embed-editor_icon-btn" onClick={onClose} aria-label={translate('ui.close')}>
          ✕
        </button>
      </div>
      <ProvenanceList
        contributors={resolved.contributors}
        prop={prop}
        onSelect={(selector, selectedProp) => {
          onSelectSelector(selector, selectedProp);
          onClose();
        }}
      />
    </Popup>
  );
}


export function ResolvedRow({
  prop,
  resolved,
  busy,
  setProp,
  clearProp,
  liveSetProp,
  onProvenance,
  onSelectSelector,
}: {
  prop: string;
  resolved: ResolvedProp;
  busy: boolean;
  setProp: (prop: string, value: string, important: boolean) => void;
  clearProp: (prop: string | string[]) => void;
  liveSetProp: LiveSetProp;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const isSelected = resolved.source === 'selected';
  const display = isSelected && resolved.selectedValue ? resolved.selectedValue : { value: resolved.winner.value, important: resolved.winner.important };
  const isDisplay = prop === 'display';

  return (
    <div className={`embed-editor_decl ${isDisplay ? 'is-control' : ''}`}>
      <ResolvedRowLabel prop={prop} resolved={resolved} busy={busy} clearProp={clearProp} onProvenance={onProvenance} onSelectSelector={onSelectSelector} />
      {isDisplay ? (
        <DisplayControl value={display.value} important={display.important} busy={busy} onCommit={(value, important) => setProp(prop, value, important)} />
      ) : (
        <ValueField
          prop={prop}
          value={display.value}
          important={display.important}
          busy={busy}
          onCommit={(value, important) => setProp(prop, value, important)}
          onLiveCommit={(value, important) => liveSetProp(prop, value, important)}
          onPick={(binding) => {
            const kept = keepImportant(binding, display);
            setProp(prop, kept.value, kept.important);
          }}
        />
      )}
    </div>
  );
}

export function ResolvedRowLabel({
  prop,
  resolved,
  busy,
  clearProp,
  onProvenance,
  onSelectSelector,
}: {
  prop: string;
  resolved: ResolvedProp;
  busy: boolean;
  clearProp: (prop: string | string[]) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  if (resolved.source !== 'selected') {
    return (
      <button
        type="button"
        className="embed-editor_prop-label embed-editor_prop-orange"
        disabled={busy}
        title={translate('styleModel.embed.row.setBy', { selector: resolved.winner.selectorText })}
        onClick={(event) => onProvenance(prop, event.currentTarget.getBoundingClientRect())}
      >
        {prop}
      </button>
    );
  }
  return (
    <FieldLabel
      className={'embed-editor_prop-label is-blue ' + (resolved.overridden ? 'is-overridden' : '')}
      active
      disabled={busy}
      onReset={() => clearProp(prop)}
      resetLabel={translate('styleModel.embed.row.removeProperty')}
      {...(resolved.overridden ? { title: translate('styleModel.embed.row.overriddenBy', { selector: resolved.winner.selectorText }) } : {})}
      menuNote={(close) => (
        <ProvenanceList
          contributors={resolved.contributors}
          prop={prop}
          onSelect={(selector, selectedProp) => {
            onSelectSelector(selector, selectedProp);
            close();
          }}
        />
      )}
    >
      {prop}
    </FieldLabel>
  );
}

export function SizeRowLabel({
  label,
  prop,
  resolved,
  busy,
  showOverride,
  clearProp,
  onProvenance,
  onSelectSelector,
}: {
  label: string;
  prop: string;
  resolved: ResolvedProp | undefined;
  busy: boolean;
  showOverride: boolean;
  clearProp: (prop: string | string[]) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  if (!resolved) {
    return (
      <FieldLabel className="embed-editor_size-label" active={false} disabled={busy} onReset={() => {}} tooltip={<PropTip props={[prop]} />}>
        {label}
      </FieldLabel>
    );
  }
  if (resolved.source !== 'selected') {
    return <ProvenanceLabel label={label} props={[prop]} busy={busy} onProvenance={onProvenance} />;
  }
  const overridden = showOverride && resolved.overridden;
  return (
    <FieldLabel
      className={overridden ? 'embed-editor_size-label is-overridden' : 'embed-editor_size-label'}
      active
      disabled={busy}
      onReset={() => clearProp(prop)}
      resetLabel={translate('styleModel.embed.row.removeProperty')}
      tooltip={<PropTip props={[prop]} />}
      {...(overridden ? { title: translate('styleModel.embed.row.overriddenBy', { selector: resolved.winner.selectorText }) } : {})}
      menuNote={(close) => (
        <ProvenanceList
          contributors={resolved.contributors}
          prop={prop}
          onSelect={(selector, selectedProp) => {
            onSelectSelector(selector, selectedProp);
            close();
          }}
        />
      )}
    >
      {label}
    </FieldLabel>
  );
}

export function DisplayRow({
  resolved,
  busy,
  setProp,
  clearProp,
  onProvenance,
  onSelectSelector,
}: {
  resolved: ResolvedProp | undefined;
  busy: boolean;
  setProp: (prop: string, value: string, important: boolean) => void;
  clearProp: (prop: string | string[]) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  const isSelected = resolved?.source === 'selected';
  const shown = useHighlight('', resolved ? '' : 'display', DISPLAY_VALUES, 'block');
  const current = resolved
    ? isSelected && resolved.selectedValue
      ? resolved.selectedValue
      : { value: resolved.winner.value, important: resolved.winner.important }
    : { value: shown, important: false };
  return (
    <div className="embed-editor_size-row">
      <SizeRowLabel
        label={translate('styleModel.embed.row.display')}
        prop="display"
        resolved={resolved}
        busy={busy}
        showOverride={false}
        clearProp={clearProp}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <DisplayControl value={current.value} important={current.important} busy={busy} onCommit={(value, important) => setProp('display', value, important)} />
    </div>
  );
}

export const VALIGN_OPTIONS: readonly SelectOption<string>[] = [
  { value: 'baseline', label: 'Baseline' },
  { value: 'sub', label: 'Sub' },
  { value: 'super', label: 'Super' },
  { value: 'top', label: 'Top' },
  { value: 'text-top', label: 'Text top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'text-bottom', label: 'Text bottom' },
];
export const VALIGN_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  baseline: 'styleModel.embed.row.valign.baseline',
  sub: 'styleModel.embed.row.valign.sub',
  super: 'styleModel.embed.row.valign.super',
  top: 'styleModel.embed.row.valign.top',
  'text-top': 'styleModel.embed.row.valign.textTop',
  middle: 'styleModel.embed.row.valign.middle',
  bottom: 'styleModel.embed.row.valign.bottom',
  'text-bottom': 'styleModel.embed.row.valign.textBottom',
};
export const VALIGN_VALUES = new Set(VALIGN_OPTIONS.map((option) => option.value));
export const VALIGN_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'table-cell']);

export function VerticalAlignRow({
  resolved,
  dimmed,
  busy,
  setProp,
  clearProp,
  onProvenance,
  onSelectSelector,
}: {
  resolved: ResolvedProp | undefined;
  dimmed: boolean;
  busy: boolean;
  setProp: (prop: string, value: string, important: boolean) => void;
  clearProp: (prop: string | string[]) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  const prop = 'vertical-align';
  const isSelected = resolved?.source === 'selected';
  const effective = resolved ? (isSelected && resolved.selectedValue ? resolved.selectedValue : resolved.winner) : undefined;
  const raw = effective ? effective.value.trim() : '';
  const matched = VALIGN_VALUES.has(raw.toLowerCase()) ? raw.toLowerCase() : undefined;

  const shownOptions = VALIGN_OPTIONS.map((option) => {
    const key = VALIGN_LABEL_KEYS[option.value];
    return key === undefined ? option : { ...option, label: translate(key) };
  });
  const variable = variableIn(raw) !== undefined;
  const options: SelectOption<string>[] = matched === undefined && raw && !variable ? [...shownOptions, { value: raw, label: raw }] : [...shownOptions];
  const important = effective?.important ?? false;
  const pick = (value: string) => setProp(prop, value, important);

  return (
    <div className={`embed-editor_size-row ${dimmed ? 'is-inactive' : ''}`} title={dimmed ? translate('styleModel.embed.row.alignYApplies') : undefined}>
      <SizeRowLabel
        label={translate('styleModel.embed.row.alignY')}
        prop={prop}
        resolved={resolved}
        busy={busy}
        showOverride
        clearProp={clearProp}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <ImportantMark important={important}>
        <VariableSelect
          prop={prop}
          rawValue={raw}
          onVariable={pick}
          customInput={
            variable ? (
              <KeywordVariableField
                prop={prop}
                value={raw}
                busy={busy}
                ariaLabel={translate('styleModel.embed.row.alignY')}
                onCommit={pick}
                onClear={() => clearProp(prop)}
              />
            ) : undefined
          }
          value={matched ?? (raw || 'baseline')}
          options={options}
          onChange={pick}
          ariaLabel={translate('styleModel.embed.row.alignY')}
          disabled={busy}
        />
      </ImportantMark>
    </div>
  );
}

export { isSupportedCssValue } from '../model/supportedCssValue';

export function effectiveValue(resolved: ResolvedProp | undefined): string {
  if (!resolved) {
    return '';
  }
  const effective = resolved.source === 'selected' && resolved.selectedValue ? resolved.selectedValue.value : resolved.winner.value;
  return effective.trim().toLowerCase();
}

export function rawEffective(resolved: ResolvedProp | undefined): {
  value: string;
  important: boolean;
} {
  if (!resolved) {
    return { value: '', important: false };
  }
  const effective = resolved.source === 'selected' && resolved.selectedValue ? resolved.selectedValue : resolved.winner;
  return { value: effective.value, important: effective.important };
}

export const FLEX_DIRECTIONS = ['row', 'row-reverse', 'column', 'column-reverse'];
export const FLEX_WRAPS = ['nowrap', 'wrap', 'wrap-reverse'];
export function currentFlexFlow(read: (prop: string) => ResolvedProp | undefined): string {
  let direction = 'row';
  let wrap = 'nowrap';
  const flowTokens = splitTopLevelSpaces(effectiveValue(read('flex-flow')));
  const directionValue = effectiveValue(read('flex-direction'));
  const wr = effectiveValue(read('flex-wrap'));
  if (FLEX_DIRECTIONS.includes(directionValue)) {
    direction = directionValue;
  } else {
    const directionToken = flowTokens.find((token) => FLEX_DIRECTIONS.includes(token));
    if (directionToken) {
      direction = directionToken;
    }
  }
  if (FLEX_WRAPS.includes(wr)) {
    wrap = wr;
  } else {
    const wrapToken = flowTokens.find((token) => FLEX_WRAPS.includes(token));
    if (wrapToken) {
      wrap = wrapToken;
    }
  }
  return wrap === 'nowrap' ? direction : `${direction} ${wrap}`;
}

export const LAYOUT_CONTROL_PROPS = new Set([
  'display',
  'vertical-align',
  'flex-flow',
  'flex-direction',
  'flex-wrap',
  'gap',
  'row-gap',
  'column-gap',
  'grid-gap',
  'grid-row-gap',
  'grid-column-gap',
]);

export const EMBED_ONLY_PROPS = new Set(['transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay']);
export const EFFECTS_CONTROL_PROPS = new Set([
  'mix-blend-mode',
  'opacity',
  'outline-style',
  'outline-width',
  'outline-offset',
  'outline-color',
  'box-shadow',
  'transform',
  'filter',
  'backdrop-filter',
  'clip-path',
  '-webkit-clip-path',
  'cursor',
  'pointer-events',
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  'transition-behavior',
]);

export const TYPOGRAPHY_CONTROL_PROPS = new Set([
  'font-family',
  'font-weight',
  'font-size',
  'line-height',
  'color',
  'text-align',
  'letter-spacing',
  'text-indent',
  'column-count',
  'font-style',
  'text-transform',
  'direction',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-decoration-thickness',
  'text-decoration-skip-ink',
  'word-break',
  'white-space',
  'overflow-wrap',
  'column-gap',
  'column-rule-style',
  'column-rule-width',
  'column-rule-color',
  'column-span',
  'text-overflow',
  '-webkit-text-stroke',
  '-webkit-text-stroke-width',
  '-webkit-text-stroke-color',
  'text-shadow',
]);
