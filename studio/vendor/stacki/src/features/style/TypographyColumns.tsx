import { centralIcon } from '../../ui/central/CentralIcon';
import { close as centralClose } from '../../ui/central/centralGeometry';
import Popup from '../../ui/Popup';

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import FieldLabel from './components/FieldLabel';
import { PropTip, ProvenanceLabel } from './components/CssPropertyTip';
import SegmentedControl from '../../ui/SegmentedControl';
import { KeywordSegments } from './KeywordConnect';
import ColorSwatch from './components/ColorSwatch';
import { useLiveColor } from './model/liveColor';
import ProvenanceList from './ProvenanceList';
import { useHighlight } from './model/computedStyle';
import { displayOf, displayText, withImportant } from './model/styleDisplay';
import ImportantMark from './components/ImportantMark';
import { DecorNoneIcon } from './TypographyIcons';
import { type Props, LiveInput, StackedField, type Seg, SegBar, MoreIcon } from './TypographyKit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';


const AUTO_KEYWORD = 'Auto';

export const COLUMN_MORE_PROPS = ['column-gap', 'column-rule-style', 'column-rule-width', 'column-rule-color', 'column-span'] as const;
export function RuleSolidIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="7.25" y="2" width="1.5" height="12" fill="currentColor" />
    </svg>
  );
}
export function RuleDashedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="7.25" y="2.5" width="1.5" height="4" fill="currentColor" />
      <rect x="7.25" y="9.5" width="1.5" height="4" fill="currentColor" />
    </svg>
  );
}
export function RuleDottedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="3.5" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="8" cy="12.5" r="1" fill="currentColor" />
    </svg>
  );
}

export const ruleStyleSegments = (translate: Translator): readonly Seg[] => [
  { value: 'none', icon: <DecorNoneIcon />, label: translate('style.typographyColumns.ruleNone') },
  { value: 'solid', icon: <RuleSolidIcon />, label: translate('style.typographyColumns.ruleSolid') },
  { value: 'dashed', icon: <RuleDashedIcon />, label: translate('style.typographyColumns.ruleDashed') },
  { value: 'dotted', icon: <RuleDottedIcon />, label: translate('style.typographyColumns.ruleDotted') },
];

export function PopLabel({
  label,
  prop,
  read,
  busy,
  clearProp,
  onProvenance,
  onSelectSelector,
  active,
  onClear,
}: {
  label: string;
  prop: string;
  active?: boolean;
  onClear?: () => void;
} & Pick<Props, 'read' | 'busy' | 'clearProp' | 'onProvenance' | 'onSelectSelector'>) {
  const translate = useTranslate();
  const resolved = read(prop);
  const display = displayOf(resolved);
  if (display.present && !display.isSelected) {
    return <ProvenanceLabel label={label} props={[prop]} busy={busy} onProvenance={onProvenance} />;
  }
  return (
    <FieldLabel
      className={`embed-editor_size-label ${display.overridden ? 'is-overridden' : ''}`}
      active={active ?? display.isSelected}
      {...(display.present ? {} : { inheritedProp: prop })}
      disabled={busy}
      onReset={onClear ?? (() => clearProp(prop))}
      resetLabel={translate('style.typographyColumns.clear')}
      tooltip={<PropTip props={[prop]} />}
      {...(display.overridden ? { title: translate('style.typographyColumns.overriddenBy', { selector: display.winnerSelector }) } : {})}
      menuNote={(close) => (
        <ProvenanceList
          contributors={resolved?.contributors ?? []}
          prop={prop}
          onSelect={(selector, selectorProp) => {
            onSelectSelector(selector, selectorProp);
            close();
          }}
        />
      )}
    >
      {label}
    </FieldLabel>
  );
}

export function LengthRow({
  prop,
  label,
  placeholder,
  read,
  busy,
  setProp,
  clearProp,
  liveSetProp,
  onProvenance,
  onSelectSelector,
}: {
  prop: string;
  label: string;
  placeholder: string;
} & Pick<Props, 'read' | 'busy' | 'setProp' | 'clearProp' | 'liveSetProp' | 'onProvenance' | 'onSelectSelector'>) {
  const display = displayOf(read(prop));
  const external = display.present ? withImportant(display) : '';
  return (
    <div className="embed-editor_size-row">
      <PopLabel label={label} prop={prop} read={read} busy={busy} clearProp={clearProp} onProvenance={onProvenance} onSelectSelector={onSelectSelector} />
      <LiveInput
        value={external}
        busy={busy}
        placeholder={placeholder}
        ariaLabel={label}
        className="u-input embed-editor_size-input"
        dataProp={prop}
        prop={prop}
        onCommit={(value, important) => setProp(prop, value, important)}
        onLiveCommit={(value, important) => liveSetProp(prop, value, important)}
        onClear={() => clearProp(prop)}
      />
    </div>
  );
}

export function RuleStyleRow({
  read,
  busy,
  setProp,
  clearProp,
  liveSetProp,
  onProvenance,
  onSelectSelector,
}: Pick<Props, 'read' | 'busy' | 'setProp' | 'clearProp' | 'liveSetProp' | 'onProvenance' | 'onSelectSelector'>) {
  const translate = useTranslate();
  const ruleSegments = ruleStyleSegments(translate);
  const display = displayOf(read('column-rule-style'));
  const current = useHighlight(
    displayText(display).trim().toLowerCase(),
    'column-rule-style',
    ruleSegments.map((segment) => segment.value),
    'none',
  );
  return (
    <div className="embed-editor_size-row">
      <PopLabel
        label={translate('style.typographyColumns.style')}
        prop="column-rule-style"
        read={read}
        busy={busy}
        clearProp={clearProp}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <SegBar
        segs={ruleSegments}
        current={current}
        ariaLabel={translate('style.typographyColumns.dividerStyle')}
        prop="column-rule-style"
        busy={busy}
        onCommit={(value, important) => setProp('column-rule-style', value, important)}
        onLiveCommit={(value, important) => liveSetProp('column-rule-style', value, important)}
        onClear={() => clearProp('column-rule-style')}
      />
    </div>
  );
}

export function RuleColorRow({
  read,
  busy,
  setProp,
  clearProp,
  liveSetProp,
  onProvenance,
  onSelectSelector,
}: Pick<Props, 'read' | 'busy' | 'setProp' | 'clearProp' | 'liveSetProp' | 'onProvenance' | 'onSelectSelector'>) {
  const translate = useTranslate();
  const display = displayOf(read('column-rule-color'));
  const external = displayText(display);
  const [shown, noteLive] = useLiveColor(external);
  const swatch = (
    <ColorSwatch
      value={shown}
      busy={busy}
      ariaLabel={translate('style.typographyColumns.dividerColor')}
      onChange={(color, live) => {
        noteLive(live ? withImportant({ value: color, important: display.important }) : undefined);
        if (live) {
          liveSetProp('column-rule-color', color, display.important);
        } else {
          setProp('column-rule-color', color, display.important);
        }
      }}
    />
  );
  return (
    <div className="embed-editor_size-row">
      <PopLabel
        label={translate('style.typographyColumns.color')}
        prop="column-rule-color"
        read={read}
        busy={busy}
        clearProp={clearProp}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <div className="embed-editor_type-field">
        {swatch}
        <LiveInput
          value={shown}
          busy={busy}
          placeholder={translate('style.typographyColumns.setColor')}
          ariaLabel={translate('style.typographyColumns.dividerColor')}
          className="u-input embed-editor_size-input"
          dataProp="column-rule-color"
          prop="column-rule-color"
          onCommit={(value, important) => setProp('column-rule-color', value, important)}
          onLiveCommit={(value, important) => liveSetProp('column-rule-color', value, important)}
          onClear={() => clearProp('column-rule-color')}
        />
      </div>
    </div>
  );
}

export function SpanRow({
  read,
  busy,
  setProp,
  clearProp,
  onProvenance,
  onSelectSelector,
}: Pick<Props, 'read' | 'busy' | 'setProp' | 'clearProp' | 'onProvenance' | 'onSelectSelector'>) {
  const translate = useTranslate();
  const display = displayOf(read('column-span'));
  const value = useHighlight(display.present ? display.value.trim().toLowerCase() : '', 'column-span', ['none', 'all'], 'none') === 'all' ? 'all' : 'none';
  return (
    <div className="embed-editor_size-row">
      <PopLabel
        label={translate('style.typographyColumns.span')}
        prop="column-span"
        read={read}
        busy={busy}
        clearProp={clearProp}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      {}
      <ImportantMark important={display.important}>
        <KeywordSegments
          prop="column-span"
          value={display.present ? display.value : ''}
          important={display.important}
          ariaLabel={translate('style.typographyColumns.columnSpan')}
          busy={busy}
          onWrite={(next, important) => setProp('column-span', next, important)}
          onClear={() => clearProp('column-span')}
        >
          <SegmentedControl
            options={[
              { value: 'none', label: translate('style.typographyColumns.spanNo') },
              { value: 'all', label: translate('style.typographyColumns.spanYes') },
            ]}
            value={value}
            onChange={(next) => setProp('column-span', next, display.important)}
            ariaLabel={translate('style.typographyColumns.columnSpan')}
            disabled={busy}
          />
        </KeywordSegments>
      </ImportantMark>
    </div>
  );
}

export const CloseIcon = centralIcon(centralClose);

export function MorePopover({ title, active, busy, children }: { title: string; active: boolean; busy: boolean; children: ReactNode }) {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef} className="embed-editor_more">
      <button
        type="button"
        className={`embed-editor_more-btn ${open ? 'is-open' : ''} ${active ? 'is-set' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={title}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <Popup mode="popover" portal={false} onClose={() => setOpen(false)} className="embed-editor_more-popover" role="dialog" label={title}>
          <div className="embed-editor_more-head">
            <span className="embed-editor_more-title">{title}</span>
            <button type="button" className="embed-editor_more-close" aria-label={translate('style.typographyColumns.close')} onClick={() => setOpen(false)}>
              <CloseIcon />
            </button>
          </div>
          {children}
        </Popup>
      ) : undefined}
    </div>
  );
}

export function ColumnsPopover(props: Props) {
  const translate = useTranslate();
  return (
    <>
      <div className="embed-editor_more-group">
        <LengthRow prop="column-gap" label={translate('style.typographyColumns.gap')} placeholder="0px" {...props} />
      </div>
      <div className="embed-editor_more-group">
        <p className="embed-editor_more-heading">{translate('style.typographyColumns.dividerSettings')}</p>
        <RuleStyleRow {...props} />
        <LengthRow prop="column-rule-width" label={translate('style.typographyColumns.width')} placeholder="0px" {...props} />
        <RuleColorRow {...props} />
      </div>
      <div className="embed-editor_more-group">
        <p className="embed-editor_more-heading">{translate('style.typographyColumns.columnChild')}</p>
        <SpanRow {...props} />
      </div>
    </>
  );
}

export function ColumnsRow(props: Props) {
  const translate = useTranslate();
  const anySet = COLUMN_MORE_PROPS.some((prop) => props.read(prop)?.source === 'selected');
  return (
    <div className="embed-editor_columns">
      <div className="embed-editor_type-triple">
        <StackedField prop="letter-spacing" label={translate('style.typographyColumns.letterSpacing')} placeholder="0em" {...props} />
        <StackedField prop="text-indent" label={translate('style.typographyColumns.textIndent')} placeholder="0px" {...props} />
        <StackedField prop="column-count" label={translate('style.typographyColumns.columns')} placeholder={AUTO_KEYWORD} {...props} />
      </div>
      <MorePopover title={translate('style.typographyColumns.columns')} active={anySet} busy={props.busy}>
        <ColumnsPopover {...props} />
      </MorePopover>
    </div>
  );
}
