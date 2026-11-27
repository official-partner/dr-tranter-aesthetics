import Popup from '../../ui/Popup';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import SegmentPill from './components/SegmentPill';
import { commitInPlace } from './model/commitStyleInPlace';
import { ChevronIcon, MenuItem, tooltipArrowStyle } from './components/MenuParts';
import { useCustomFocus, useDebouncedLive } from './model/fieldHooks';
import { parseImportant } from './model/styleDisplay';
import VariableConnect from './VariableConnect';
import KeywordConnect, { VariableMenuItem } from './KeywordConnect';
import { useFollowingDraft } from './SizeKit';
import { useTranslate } from '../../lib/i18n/useTranslate';
import '../../ui/segmentedControl.css';

export function SegmentCustomInput({
  prop,
  value,
  busy,
  inputRef,
  onCommit,
  onLiveCommit,
  onClear,
  ariaLabel,
  placeholder,
}: {
  prop: string;
  value: string;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onCommit: (value: string, important: boolean) => void;
  onLiveCommit: (value: string, important: boolean) => void;
  onClear: () => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const translate = useTranslate();
  const { draft, setDraft, focused } = useFollowingDraft(value);
  const { cancelLive, scheduleLive } = useDebouncedLive(onLiveCommit);
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
      className="is-fill"
      prop={prop}
      canvasProperty={prop}
      disabled={busy}
      ariaLabel={translate('styleModel.shared.connectVariable', { label: ariaLabel })}
      onPick={(binding) => {
        cancelLive();
        setDraft(binding);
        onCommit(binding, false);
      }}
    >
      <input
        ref={inputRef}
        className="embed-editor_value-input embed-editor_display-input"
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
        aria-label={ariaLabel}
        placeholder={placeholder ?? translate('style.sizeSegmentBar.customValuePlaceholder')}
      />
    </VariableConnect>
  );
}

export const TOOLTIP_DELAY_MS = 500;

export type BarSegment = {
  value: string;
  content: ReactNode;
  ariaLabel: string;
  menuLabel: string;
};

export type SegmentBarConfig = {
  segments: readonly BarSegment[];
  fallback: string;
  tooltips: Record<string, ReactNode>;
  groupLabel: string;
  moreLabel: string;
  customLabel: string;
};

export type SegmentBarProps = {
  prop: string;
  config: SegmentBarConfig;
  value: string;
  busy: boolean;
  onCommit: (value: string, important: boolean) => void;
  onLiveCommit: (value: string, important: boolean) => void;
  onClear: () => void;
};

export function SegmentBar(props: SegmentBarProps) {
  const { prop, config, value, busy, onCommit, onLiveCommit, onClear } = props;
  const current = value.trim().toLowerCase() || config.fallback;
  const customMode = current !== '' && !config.segments.some((segment) => segment.value === current);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { inputRef, requestFocus } = useCustomFocus({ customMode, busy });
  const tip = useSegmentTooltip({ rootRef, tooltips: config.tooltips });

  const pick = (next: string) => {
    setOpen(false);
    if (next !== current) {
      onCommit(next, false);
    }
  };
  const enterCustom = () => {
    setOpen(false);
    requestFocus();
    onCommit('unset', false);
  };

  return (
    <KeywordConnect
      prop={prop}
      value={value}
      ariaLabel={config.groupLabel}
      disabled={busy}
      dot={customMode ? 'field' : 'wrapper'}
      onPick={(binding) => onCommit(binding, false)}
    >
      <div ref={rootRef} className={`embed-editor_display ${customMode ? 'is-custom' : ''}`} role="group" aria-label={config.groupLabel}>
        <SegmentPill />
        {customMode ? (
          <SegmentCustomInput
            prop={prop}
            value={value}
            busy={busy}
            inputRef={inputRef}
            onCommit={onCommit}
            onLiveCommit={onLiveCommit}
            onClear={onClear}
            ariaLabel={config.customLabel}
          />
        ) : (
          <SegmentButtons segments={config.segments} current={current} busy={busy} onPick={pick} onHoverStart={tip.startHover} onHoverEnd={tip.endHover} />
        )}
        <SegmentMenu
          open={open}
          moreLabel={config.moreLabel}
          busy={busy}
          customMode={customMode}
          current={current}
          segments={config.segments}
          onToggle={() => setOpen((previous) => !previous)}
          onPick={pick}
          onEnterCustom={enterCustom}
        />
        <SegmentTooltip content={tip.hoveredValue === undefined ? undefined : config.tooltips[tip.hoveredValue]} arrowRight={tip.arrowRight} />
      </div>
    </KeywordConnect>
  );
}

export function SegmentTooltip({ content, arrowRight }: { content: ReactNode; arrowRight: number }) {
  if (!content) {
    return undefined;
  }
  return (
    <div className="u-segmented-tooltip" role="tooltip" style={tooltipArrowStyle(arrowRight)}>
      {content}
      <span className="u-segmented-tooltip-arrow" aria-hidden="true" />
    </div>
  );
}

export function SegmentButtons({
  segments,
  current,
  busy,
  onPick,
  onHoverStart,
  onHoverEnd,
}: {
  segments: readonly BarSegment[];
  current: string;
  busy: boolean;
  onPick: (value: string) => void;
  onHoverStart: (value: string, element: HTMLElement) => void;
  onHoverEnd: () => void;
}) {
  return segments.map((segment) => (
    <button
      key={segment.value}
      type="button"
      role="radio"
      aria-checked={current === segment.value}
      className={`embed-editor_display-seg ${current === segment.value ? 'is-selected' : ''}`}
      disabled={busy}
      aria-label={segment.ariaLabel}
      onClick={() => {
        onHoverEnd();
        onPick(segment.value);
      }}
      onMouseEnter={(event) => onHoverStart(segment.value, event.currentTarget)}
      onMouseLeave={onHoverEnd}
    >
      {segment.content}
    </button>
  ));
}

export function SegmentMenu({
  open,
  moreLabel,
  busy,
  customMode,
  current,
  segments,
  onToggle,
  onPick,
  onEnterCustom,
}: {
  open: boolean;
  moreLabel: string;
  busy: boolean;
  customMode: boolean;
  current: string;
  segments: readonly BarSegment[];
  onToggle: () => void;
  onPick: (value: string) => void;
  onEnterCustom: () => void;
}) {
  const translate = useTranslate();
  return (
    <>
      <button
        type="button"
        className="embed-editor_display-arrow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={moreLabel}
        disabled={busy}
        onClick={onToggle}
      >
        <ChevronIcon />
      </button>
      {open ? (
        <Popup mode="popover" portal={false} onClose={onToggle} className="embed-editor_display-menu" role="menu">
          <VariableMenuItem onClose={onToggle} />
          {customMode ? (
            segments.map((segment) => (
              <MenuItem key={segment.value} label={segment.menuLabel} selected={current === segment.value} onClick={() => onPick(segment.value)} />
            ))
          ) : (
            <MenuItem label={translate('style.sizeSegmentBar.custom')} selected={false} onClick={onEnterCustom} />
          )}
        </Popup>
      ) : undefined}
    </>
  );
}

export function useSegmentTooltip({ rootRef, tooltips }: { rootRef: React.RefObject<HTMLDivElement>; tooltips: Record<string, ReactNode> }) {
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
    if (!tooltips[segmentValue]) {
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
