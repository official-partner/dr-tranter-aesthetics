import Popup from '../../ui/Popup';
import { useEffect, useRef, useState } from 'react';
import { useTranslate, useTranslateRich } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';
import SegmentPill from './components/SegmentPill';
import { commitInPlace } from './model/commitStyleInPlace';
import { ChevronIcon, MenuItem, tooltipArrowStyle } from './components/MenuParts';
import { parseImportant, withImportant } from './model/styleDisplay';
import VariableConnect from './VariableConnect';
import KeywordConnect, { VariableMenuItem } from './KeywordConnect';
import '../../ui/segmentedControl.css';


const PRIMARY = ['block', 'flex', 'grid'] as const;
const INLINE = ['inline-block', 'inline-flex', 'inline-grid', 'inline'] as const;
const BOXLESS = ['none', 'contents'] as const;
const OTHER = [...INLINE, ...BOXLESS] as const;

const SUPPORTED: ReadonlySet<string> = new Set<string>([...PRIMARY, ...OTHER]);
export const DISPLAY_VALUES: readonly string[] = [...PRIMARY, ...OTHER];

const SHORT: Record<string, string> = {
  none: 'None',
  contents: 'Contents',
  inline: 'Inline',
  'inline-block': 'In-block',
  'inline-flex': 'In-flex',
  'inline-grid': 'In-grid',
};
const FULL: Record<string, string> = {
  none: 'None',
  contents: 'Contents',
  inline: 'Inline',
  'inline-block': 'Inline-block',
  'inline-flex': 'Inline-flex',
  'inline-grid': 'Inline-grid',
};

const TOOLTIP_DELAY_MS = 500;
const TOOLTIPS: Record<string, MessageKey> = {
  block: 'style.displayControl.tooltipBlock',
  flex: 'style.displayControl.tooltipFlex',
  grid: 'style.displayControl.tooltipGrid',
  none: 'style.displayControl.tooltipNone',
  contents: 'style.displayControl.tooltipContents',
  'inline-block': 'style.displayControl.tooltipInlineBlock',
  'inline-flex': 'style.displayControl.tooltipInlineFlex',
  'inline-grid': 'style.displayControl.tooltipInlineGrid',
  inline: 'style.displayControl.tooltipInline',
};

const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function displayMenuLabel(value: string): string {
  return FULL[value] ?? cap(value);
}

export function isDisplayValueSupported(value: string): boolean {
  return SUPPORTED.has(value.trim().toLowerCase());
}

function CustomValueField({
  value,
  important,
  busy,
  inputRef,
  onCommit,
}: {
  value: string;
  important: boolean;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onCommit: (value: string, important: boolean) => void;
}) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(withImportant({ value, important }));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(withImportant({ value, important }));
    }
  }, [value, important]);

  const commit = () => {
    const parsed = parseImportant(draft);
    if (parsed.value && (parsed.value !== value.trim() || parsed.important !== important)) {
      onCommit(parsed.value, parsed.important);
    }
  };

  return (
    <VariableConnect
      className="is-fill"
      prop="display"
      canvasProperty="display"
      disabled={busy}
      ariaLabel={translate('styleModel.shared.connectVariable', { label: translate('style.displayControl.display') })}
      onPick={(binding) => {
        setDraft(withImportant({ value: binding, important }));
        onCommit(binding, important);
      }}
    >
      <input
        ref={inputRef}
        className="embed-editor_value-input embed-editor_display-input"
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
        aria-label={translate('style.displayControl.value')}
        placeholder={translate('style.displayControl.customValuePlaceholder')}
      />
    </VariableConnect>
  );
}

export default function DisplayControl({
  value,
  important,
  busy,
  onCommit,
}: {
  value: string;
  important: boolean;
  busy: boolean;
  onCommit: (value: string, important: boolean) => void;
}) {
  const translate = useTranslate();
  const current = value.trim().toLowerCase();
  const segmented = (current === '' || isDisplayValueSupported(current)) && !important;
  const customMode = !segmented;

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wantFocus = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (customMode && wantFocus.current && !busy) {
      wantFocus.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [customMode, busy]);

  const pick = (next: string) => {
    setOpen(false);
    if (next !== current || important) {
      onCommit(next, false);
    }
  };
  const enterCustom = () => {
    setOpen(false);
    wantFocus.current = true;
    onCommit('unset', false);
  };

  const tooltip = useSegmentTooltip(rootRef);

  return (
    <KeywordConnect
      prop="display"
      value={value}
      ariaLabel={translate('style.displayControl.display')}
      disabled={busy}
      dot={customMode ? 'field' : 'wrapper'}
      onPick={(binding) => onCommit(binding, important)}
    >
      <div
        ref={rootRef}
        className={`embed-editor_display ${customMode ? 'is-custom' : ''}`}
        role="group"
        aria-label={translate('style.displayControl.display')}
      >
        {customMode ? (
          <CustomValueField value={value} important={important} busy={busy} inputRef={inputRef} onCommit={onCommit} />
        ) : (
          <DisplaySegments current={current} busy={busy} tooltip={tooltip} pick={pick} />
        )}

        <MenuArrow open={open} busy={busy} onToggle={() => setOpen((value) => !value)} />
        {open ? <DisplayMenu onClose={() => setOpen(false)} customMode={customMode} current={current} pick={pick} enterCustom={enterCustom} /> : undefined}
        <SegmentTooltipBubble tooltip={tooltip} />
      </div>
    </KeywordConnect>
  );
}

interface SegmentTooltip {
  readonly hoveredValue: string | undefined;
  readonly arrowRight: number;
  readonly startHover: (segmentValue: string, element: HTMLElement) => void;
  readonly endHover: () => void;
}

function useSegmentTooltip(rootRef: React.RefObject<HTMLDivElement>): SegmentTooltip {
  const [hoveredValue, setHoveredValue] = useState<string | undefined>(undefined);
  const [arrowRight, setArrowRight] = useState(0);
  const hoverTimer = useRef<number | undefined>(undefined);
  const clearHoverTimer = () => {
    if (hoverTimer.current !== undefined) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = undefined;
    }
  };
  useEffect(() => clearHoverTimer, []);
  const startHover = (segmentValue: string, element: HTMLElement) => {
    if (!TOOLTIPS[segmentValue]) {
      return;
    }
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = undefined;
      const root = rootRef.current;
      if (root) {
        const trackRect = root.getBoundingClientRect();
        const buttonRect = element.getBoundingClientRect();
        setArrowRight(trackRect.right - (buttonRect.left + buttonRect.width / 2));
      }
      setHoveredValue(segmentValue);
    }, TOOLTIP_DELAY_MS);
  };
  const endHover = () => {
    clearHoverTimer();
    setHoveredValue(undefined);
  };
  return { hoveredValue, arrowRight, startHover, endHover };
}

function MenuArrow({ open, busy, onToggle }: { open: boolean; busy: boolean; onToggle: () => void }) {
  const translate = useTranslate();
  return (
    <button
      type="button"
      className="embed-editor_display-arrow"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={translate('style.displayControl.moreOptions')}
      disabled={busy}
      onClick={onToggle}
    >
      <ChevronIcon />
    </button>
  );
}

function SegmentTooltipBubble({ tooltip }: { tooltip: SegmentTooltip }) {
  const translateRich = useTranslateRich();
  if (tooltip.hoveredValue === undefined) {
    return undefined;
  }
  const tooltipKey = TOOLTIPS[tooltip.hoveredValue];
  if (!tooltipKey) {
    return undefined;
  }
  const text = translateRich(tooltipKey, { strong: (content) => <strong>{content}</strong> });
  return (
    <div className="u-segmented-tooltip" role="tooltip" style={tooltipArrowStyle(tooltip.arrowRight)}>
      {text}
      <span className="u-segmented-tooltip-arrow" aria-hidden="true" />
    </div>
  );
}

function DisplaySegments({ current, busy, tooltip, pick }: { current: string; busy: boolean; tooltip: SegmentTooltip; pick: (next: string) => void }) {
  const isPrimary = PRIMARY.some((value) => value === current);
  const isFourth = current !== '' && !isPrimary;
  const fourth = isFourth ? current : 'none';
  return (
    <>
      <SegmentPill />
      {PRIMARY.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={current === option}
          className={`embed-editor_display-seg ${current === option ? 'is-selected' : ''}`}
          disabled={busy}
          onClick={() => {
            tooltip.endHover();
            pick(option);
          }}
          onMouseEnter={(event) => tooltip.startHover(option, event.currentTarget)}
          onMouseLeave={tooltip.endHover}
        >
          {cap(option)}
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={isFourth}
        className={`embed-editor_display-seg ${isFourth ? 'is-selected' : ''}`}
        disabled={busy}
        onClick={() => {
          tooltip.endHover();
          pick(fourth);
        }}
        onMouseEnter={(event) => tooltip.startHover(fourth, event.currentTarget)}
        onMouseLeave={tooltip.endHover}
      >
        {SHORT[fourth]}
      </button>
    </>
  );
}

function DisplayMenu(props: Parameters<typeof DisplayMenuContent>[0]) {
  return (
    <Popup mode="popover" portal={false} role="menu" className="embed-editor_display-menu" onClose={props.onClose}>
      <DisplayMenuContent {...props} />
    </Popup>
  );
}

function DisplayMenuContent({
  customMode,
  current,
  pick,
  enterCustom,
  onClose,
}: {
  customMode: boolean;
  current: string;
  pick: (next: string) => void;
  enterCustom: () => void;
  readonly onClose: () => void;
}) {
  const translate = useTranslate();
  return (
    <>
      <VariableMenuItem onClose={onClose} />
      {customMode ? (
        <>
          {PRIMARY.map((option) => (
            <MenuItem key={option} label={cap(option)} selected={current === option} onClick={() => pick(option)} />
          ))}
          <div className="embed-editor_display-menu-divider" />
          {INLINE.map((option) => (
            <MenuItem key={option} label={FULL[option] ?? cap(option)} selected={current === option} onClick={() => pick(option)} />
          ))}
          <div className="embed-editor_display-menu-divider" />
          {BOXLESS.map((option) => (
            <MenuItem key={option} label={FULL[option] ?? cap(option)} selected={current === option} onClick={() => pick(option)} />
          ))}
        </>
      ) : (
        <>
          {INLINE.map((option) => (
            <MenuItem key={option} label={FULL[option] ?? cap(option)} selected={current === option} onClick={() => pick(option)} />
          ))}
          <div className="embed-editor_display-menu-divider" />
          {BOXLESS.map((option) => (
            <MenuItem key={option} label={FULL[option] ?? cap(option)} selected={current === option} onClick={() => pick(option)} />
          ))}
          <div className="embed-editor_display-menu-divider" />
          <MenuItem label={translate('style.displayControl.custom')} selected={false} onClick={enterCustom} />
        </>
      )}
    </>
  );
}
