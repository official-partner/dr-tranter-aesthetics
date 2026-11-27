import Popup from '../../ui/Popup';
import { useEffect, useRef, useState } from 'react';
import type { SegmentedOption } from '../../ui/SegmentedControl';
import ColorSwatch from './components/ColorSwatch';
import { useLiveColor } from './model/liveColor';
import VariableConnect from './VariableConnect';
import KeywordConnect, { VariableMenuItem } from './KeywordConnect';
import { useHighlight } from './model/computedStyle';
import SegmentPill from './components/SegmentPill';
import { commitInPlace } from './model/commitStyleInPlace';
import { ChevronIcon, MenuItem } from './components/MenuParts';
import { displayOf, displayText, parseImportant, withImportant, type Display } from './model/styleDisplay';
import { type Read, type Props, stripImportant, PropLabel, LiveInput } from './BordersKit';
import { RadiusControl } from './RadiusControl';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey, Translator } from '../../lib/i18n/localeContext';

export { LiveInput } from './BordersKit';


type Side = 'all' | 'top' | 'right' | 'bottom' | 'left';
const SIDE_NAME_KEYS: Record<Side, MessageKey> = {
  all: 'style.bordersSection.sideNameAll',
  top: 'style.bordersSection.sideNameTop',
  right: 'style.bordersSection.sideNameRight',
  bottom: 'style.bordersSection.sideNameBottom',
  left: 'style.bordersSection.sideNameLeft',
};
type Facet = 'style' | 'width' | 'color';
const EDGES = ['top', 'right', 'bottom', 'left'] as const;

const facetClear = (facet: Facet, side: Side): string[] =>
  side === 'all' ? [`border-${facet}`, ...EDGES.map((edge) => `border-${edge}-${facet}`)] : [`border-${side}-${facet}`];
function facetRead(facet: Facet, side: Side, read: Read): { d: Display; prop: string } {
  const prop = side === 'all' ? `border-${facet}` : `border-${side}-${facet}`;
  return { d: displayOf(read(prop)), prop };
}
interface WriteOptions {
  readonly live: boolean;
}
type FacetWrite = (next: string, options: WriteOptions) => void;

function facetWrite(facet: Facet, side: Side, props: Props): FacetWrite {
  return (next, { live }) => {
    const trimmed = next.trim();
    if (!trimmed) {
      if (!live) {
        props.clearProp(facetClear(facet, side));
      }
      return;
    }
    const { value, important } = parseImportant(trimmed);
    const set = live ? props.liveSetProp : props.setProp;
    if (side === 'all') {
      set(`border-${facet}`, value, important);
      if (!live) {
        const strays = EDGES.map((edge) => `border-${edge}-${facet}`).filter((prop) => displayOf(props.read(prop)).present);
        if (strays.length) {
          props.clearProp(strays);
        }
      }
    } else {
      set(`border-${side}-${facet}`, value, important);
    }
  };
}

function appliedBorderSides(read: Read): Set<Side> {
  const applied = new Set<Side>();
  const owns = (prop: string) => displayOf(read(prop)).isSelected;
  if (['border', 'border-style', 'border-width', 'border-color'].some(owns)) {
    applied.add('all');
  }
  for (const side of EDGES) {
    if ([`border-${side}`, `border-${side}-style`, `border-${side}-width`, `border-${side}-color`].some(owns)) {
      applied.add(side);
    }
  }
  return applied;
}

function SideSelector({ side, applied, onPick }: { side: Side; applied: ReadonlySet<Side>; onPick: (s: Side) => void }) {
  const translate = useTranslate();
  const sideButton = (option: Side, label: string) => (
    <button
      type="button"
      className={`embed-editor_border-side is-${option} ${side === option ? 'is-active' : ''} ` + (applied.has(option) ? 'is-applied' : '')}
      aria-pressed={side === option}
      aria-label={option === 'all' ? translate('style.bordersSection.allBorders') : translate('style.bordersSection.sideBorder', { side: label })}
      onClick={() => onPick(option)}
    >
      <span className="embed-editor_border-side-mark" />
    </button>
  );
  return (
    <div className="embed-editor_border-sides" role="group" aria-label={translate('style.bordersSection.borderSide')}>
      {sideButton('top', translate('style.bordersSection.top'))}
      <div className="embed-editor_border-sides-mid">
        {sideButton('left', translate('style.bordersSection.left'))}
        {sideButton('all', translate('style.bordersSection.all'))}
        {sideButton('right', translate('style.bordersSection.right'))}
      </div>
      {sideButton('bottom', translate('style.bordersSection.bottom'))}
    </div>
  );
}

const styleOptions = (translate: Translator): ReadonlyArray<SegmentedOption<string>> => [
  { value: 'none', label: '✕', ariaLabel: translate('style.bordersSection.styleNone') },
  {
    value: 'solid',
    label: <span className="embed-editor_border-style-line is-solid" />,
    ariaLabel: translate('style.bordersSection.styleSolid'),
  },
  {
    value: 'dashed',
    label: <span className="embed-editor_border-style-line is-dashed" />,
    ariaLabel: translate('style.bordersSection.styleDashed'),
  },
  {
    value: 'dotted',
    label: <span className="embed-editor_border-style-line is-dotted" />,
    ariaLabel: translate('style.bordersSection.styleDotted'),
  },
];
const STYLE_VALUES = new Set(['none', 'solid', 'dashed', 'dotted']);

function StyleControl({
  value,
  important,
  prop,
  busy,
  write,
  clear,
}: {
  value: string;
  important: boolean;
  prop: string;
  busy: boolean;
  write: FacetWrite;
  clear: () => void;
}) {
  const translate = useTranslate();
  const lower = value.trim().toLowerCase();
  const shown = useHighlight(lower, prop, [...STYLE_VALUES], 'none');
  const customMode = important || (!!lower && !STYLE_VALUES.has(lower));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestFocus = useFocusOnceReady({ customMode, busy, inputRef });

  const pick = (next: string) => {
    setOpen(false);
    if (next !== lower || important) {
      write(next, { live: false });
    }
  };
  const enterCustom = () => {
    setOpen(false);
    requestFocus();
    write('unset', { live: false });
  };

  return (
    <KeywordConnect
      prop="border-style"
      value={value}
      ariaLabel={translate('style.bordersSection.borderStyle')}
      disabled={busy}
      dot={customMode ? 'field' : 'wrapper'}
      onPick={(binding) => write(binding, { live: false })}
    >
      <div
        ref={rootRef}
        className={`embed-editor_display embed-editor_border-style ${customMode ? 'is-custom' : ''}`}
        role="group"
        aria-label={translate('style.bordersSection.borderStyle')}
      >
        <SegmentPill />
        {customMode ? (
          <StyleCustomField value={withImportant({ value, important })} busy={busy} inputRef={inputRef} write={write} clear={clear} />
        ) : (
          <StyleSegments shown={shown} busy={busy} pick={pick} />
        )}
        <StyleMenu
          open={open}
          customMode={customMode}
          shown={shown}
          busy={busy}
          onToggle={() => setOpen((wasOpen) => !wasOpen)}
          pick={pick}
          enterCustom={enterCustom}
        />
      </div>
    </KeywordConnect>
  );
}

function StyleSegments({ shown, busy, pick }: { shown: string; busy: boolean; pick: (next: string) => void }) {
  const translate = useTranslate();
  return styleOptions(translate).map((seg) => (
    <button
      key={seg.value}
      type="button"
      role="radio"
      aria-checked={shown === seg.value}
      className={`embed-editor_display-seg ${shown === seg.value ? 'is-selected' : ''}`}
      disabled={busy}
      title={seg.ariaLabel}
      aria-label={seg.ariaLabel}
      onClick={() => pick(seg.value)}
    >
      {seg.label}
    </button>
  ));
}

function useFocusOnceReady({ customMode, busy, inputRef }: { customMode: boolean; busy: boolean; inputRef: React.RefObject<HTMLInputElement> }) {
  const wantFocus = useRef(false);
  useEffect(() => {
    if (customMode && wantFocus.current && !busy) {
      wantFocus.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [customMode, busy, inputRef]);
  return () => {
    wantFocus.current = true;
  };
}

function StyleCustomField({
  value,
  busy,
  inputRef,
  write,
  clear,
}: {
  value: string;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  write: FacetWrite;
  clear: () => void;
}) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);
  const commitCustom = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      clear();
      return;
    }
    write(withImportant(parseImportant(trimmed)), { live: false });
  };
  return (
    <VariableConnect
      ariaLabel={translate('style.bordersSection.connectBorderStyle')}
      disabled={busy}
      prop="border-style"
      canvasProperty="border-style"
      onPick={(binding) => write(binding, { live: false })}
    >
      <input
        ref={inputRef}
        className="embed-editor_value-input embed-editor_display-input"
        value={draft}
        placeholder={translate('style.bordersSection.customValuePlaceholder')}
        spellCheck={false}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value);
          const trimmed = event.target.value.trim();
          if (trimmed) {
            write(trimmed, { live: true });
          }
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commitCustom();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitInPlace(event.currentTarget);
          }
        }}
        aria-label={translate('style.bordersSection.borderStyleValue')}
      />
    </VariableConnect>
  );
}

function StyleMenu({
  open,
  customMode,
  shown,
  busy,
  onToggle,
  pick,
  enterCustom,
}: {
  open: boolean;
  customMode: boolean;
  shown: string;
  busy: boolean;
  onToggle: () => void;
  pick: (next: string) => void;
  enterCustom: () => void;
}) {
  const translate = useTranslate();
  return (
    <>
      <button
        type="button"
        className="embed-editor_display-arrow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={translate('style.bordersSection.moreStyleOptions')}
        disabled={busy}
        onClick={onToggle}
      >
        <ChevronIcon />
      </button>
      {open ? (
        <Popup mode="popover" portal={false} onClose={onToggle} className="embed-editor_display-menu" role="menu">
          <VariableMenuItem onClose={onToggle} />
          {customMode ? (
            styleOptions(translate).map((seg) => (
              <MenuItem key={seg.value} label={seg.ariaLabel ?? seg.value} selected={shown === seg.value} onClick={() => pick(seg.value)} />
            ))
          ) : (
            <MenuItem label={translate('style.bordersSection.custom')} selected={false} onClick={enterCustom} />
          )}
        </Popup>
      ) : undefined}
    </>
  );
}

export function ColorVariableInput({
  value,
  swatchValue = value,
  busy,
  ariaLabel,
  prop = 'color',
  onLive,
  onCommit,
  onVariablePick,
}: {
  value: string;
  swatchValue?: string;
  busy: boolean;
  ariaLabel: string;
  prop?: string;
  onLive: (value: string) => void;
  onCommit: (value: string) => void;
  onVariablePick?: (binding: string) => void;
}) {
  const [shown, noteLive] = useLiveColor(value);
  const { important } = parseImportant(value);
  return (
    <div className="embed-editor_border-color">
      <ColorSwatch
        value={stripImportant(shown === value ? swatchValue : shown)}
        busy={busy}
        ariaLabel={ariaLabel}
        onChange={(color, live) => {
          const emitted = withImportant({ value: color, important });
          noteLive(live ? emitted : undefined);
          if (live) {
            onLive(emitted);
          } else {
            onCommit(emitted);
          }
        }}
      />
      <LiveInput
        value={shown}
        busy={busy}
        ariaLabel={ariaLabel}
        placeholder="black"
        prop={prop}
        onLive={onLive}
        onCommit={onCommit}
        {...(onVariablePick === undefined ? {} : { onVariablePick })}
      />
    </div>
  );
}

function ColorField({ side, props }: { side: Side; props: Props }) {
  const translate = useTranslate();
  const value = displayText(facetRead('color', side, props.read).d);
  const write = facetWrite('color', side, props);
  return (
    <ColorVariableInput
      value={value}
      busy={props.busy}
      ariaLabel={translate('style.bordersSection.sideBorderColor', { side: translate(SIDE_NAME_KEYS[side]) })}
      prop="border-color"
      onLive={(next) => write(next, { live: true })}
      onCommit={(next) => write(next, { live: false })}
    />
  );
}

function BorderControl(props: Props) {
  const { busy } = props;
  const translate = useTranslate();
  const [side, setSide] = useState<Side>('all');
  const applied = appliedBorderSides(props.read);
  const styleFacet = facetRead('style', side, props.read);
  const widthFacet = facetRead('width', side, props.read);
  const colorFacet = facetRead('color', side, props.read);
  const writeStyle = facetWrite('style', side, props);
  const writeWidth = facetWrite('width', side, props);

  return (
    <div className="embed-editor_border-body">
      <SideSelector side={side} applied={applied} onPick={setSide} />
      <div className="embed-editor_border-fields">
        <div className="embed-editor_size-row">
          <PropLabel label={translate('style.bordersSection.style')} prop={styleFacet.prop} clearProps={facetClear('style', side)} {...props} />
          <StyleControl
            value={styleFacet.d.present ? styleFacet.d.value.trim() : ''}
            important={styleFacet.d.important}
            prop={styleFacet.prop}
            busy={busy}
            write={writeStyle}
            clear={() => props.clearProp(facetClear('style', side))}
          />
        </div>
        <div className="embed-editor_size-row">
          <PropLabel label={translate('style.bordersSection.width')} prop={widthFacet.prop} clearProps={facetClear('width', side)} {...props} />
          <LiveInput
            value={displayText(widthFacet.d)}
            busy={busy}
            ariaLabel={translate('style.bordersSection.sideBorderWidth', { side: translate(SIDE_NAME_KEYS[side]) })}
            prop="border-width"
            onLive={(next) => writeWidth(next, { live: true })}
            onCommit={(next) => writeWidth(next, { live: false })}
          />
        </div>
        <div className="embed-editor_size-row">
          <PropLabel label={translate('style.bordersSection.color')} prop={colorFacet.prop} clearProps={facetClear('color', side)} {...props} />
          <ColorField side={side} props={props} />
        </div>
      </div>
    </div>
  );
}

export default function BordersSection(props: Props) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_borders">
      <RadiusControl {...props} />
      <div className="embed-editor_border-heading">{translate('style.bordersSection.borders')}</div>
      <BorderControl {...props} />
    </div>
  );
}
