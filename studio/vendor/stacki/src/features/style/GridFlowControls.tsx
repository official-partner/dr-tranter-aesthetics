import Popup from '../../ui/Popup';
import { useTranslate } from '../../lib/i18n/useTranslate';

import { useEffect, useRef, useState } from 'react';
import SegmentedControl from '../../ui/SegmentedControl';
import { useHighlight } from './model/computedStyle';
import VariableConnect from './VariableConnect';
import KeywordConnect, { VariableMenuItem } from './KeywordConnect';
import { commitInPlace } from './model/commitStyleInPlace';
import { parseFlow, buildFlow, isPresetFlow } from './gridTracks';
import { gridFlowOptions, GRID_CONTENT, GRID_SYNONYMS, gridKeyword, contentLabels, cap, contentOptions, ChevUp, ChevDown, DenseIcon } from './GridIcons';

export function parseImportant(input: string): { value: string; important: boolean } {
  const match = input.match(/!\s*important\s*$/i);
  return match ? { value: input.slice(0, match.index).trim(), important: true } : { value: input.trim(), important: false };
}

export interface GridDirectionControlProps {
  value: string;
  busy: boolean;
  onSet: (value: string) => void;
  onCommitCustom: (value: string, important: boolean) => void;
}
export function GridDirectionControl({ value, busy, onSet, onCommitCustom }: GridDirectionControlProps) {
  const translate = useTranslate();
  const { direction, dense } = value ? parseFlow(value) : { direction: 'row', dense: false };
  const [forceCustom, setForceCustom] = useState(false);
  const customMode = forceCustom || (!!value.trim() && !isPresetFlow(value));
  const menu = useCustomMenu({ customMode, busy });

  const enterCustom = () => {
    menu.setOpen(false);
    setForceCustom(true);
    menu.requestFocus();
    onCommitCustom('unset', false);
  };
  const pickPreset = (next: string) => {
    menu.setOpen(false);
    setForceCustom(false);
    onSet(buildFlow({ direction: next, dense }));
  };

  return (
    <KeywordConnect
      prop="grid-auto-flow"
      value={value}
      ariaLabel={translate('style.gridFlowControls.gridDirection')}
      disabled={busy}
      dot={customMode ? 'field' : 'wrapper'}
      onPick={(binding) => {
        setForceCustom(false);
        onCommitCustom(binding, false);
      }}
    >
      <div ref={menu.rootRef} className="embed-editor_grid-direction">
        {}
        <div className={`embed-editor_grid-dir-bar ${customMode ? 'is-custom' : ''}`}>
          {customMode ? (
            <GridCustomInput
              prop="grid-auto-flow"
              value={value}
              busy={busy}
              inputRef={menu.inputRef}
              placeholder={translate('style.gridFlowControls.autoFlowPlaceholder')}
              ariaLabel={translate('style.gridFlowControls.autoFlow')}
              onCommitCustom={onCommitCustom}
            />
          ) : (
            <SegmentedControl
              value={direction}
              options={gridFlowOptions(translate)}
              ariaLabel={translate('style.gridFlowControls.gridDirection')}
              disabled={busy}
              onChange={(next) => onSet(buildFlow({ direction: next, dense }))}
            />
          )}
          <MenuArrow open={menu.open} busy={busy} ariaLabel={translate('style.gridFlowControls.moreDirectionOptions')} onToggle={menu.toggle} />
          {menu.open ? (
            <DirectionMenu onClose={() => menu.setOpen(false)} customMode={customMode} pickPreset={pickPreset} enterCustom={enterCustom} />
          ) : undefined}
        </div>
        {!customMode ? <DenseToggle dense={dense} busy={busy} onToggle={() => onSet(buildFlow({ direction, dense: !dense }))} /> : undefined}
      </div>
    </KeywordConnect>
  );
}

export function DirectionMenu({
  onClose,
  customMode,
  pickPreset,
  enterCustom,
}: {
  customMode: boolean;
  pickPreset: (direction: string) => void;
  enterCustom: () => void;
  readonly onClose: () => void;
}) {
  const translate = useTranslate();
  return (
    <Popup mode="popover" portal={false} onClose={onClose} className="embed-editor_display-menu" role="menu">
      <VariableMenuItem onClose={onClose} />
      {customMode ? (
        <>
          <MenuButton label={translate('style.gridFlowControls.horizontal')} onClick={() => pickPreset('row')} />
          <MenuButton label={translate('style.gridFlowControls.vertical')} onClick={() => pickPreset('column')} />
        </>
      ) : (
        <MenuButton label={translate('style.gridFlowControls.custom')} onClick={enterCustom} />
      )}
    </Popup>
  );
}

export function DenseToggle({ dense, busy, onToggle }: { dense: boolean; busy: boolean; onToggle: () => void }) {
  const translate = useTranslate();
  return (
    <button
      type="button"
      className={`embed-editor_icon-btn ${dense ? 'is-active' : ''}`}
      disabled={busy}
      aria-pressed={dense}
      title={translate('style.gridFlowControls.dense')}
      onClick={onToggle}
    >
      <DenseIcon />
    </button>
  );
}

export function useCustomMenu({ customMode, busy }: { customMode: boolean; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wantFocus = useRef(false);
  useEffect(() => {
    if (customMode && wantFocus.current && !busy) {
      wantFocus.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [customMode, busy]);
  return {
    open,
    setOpen,
    toggle: () => setOpen((wasOpen) => !wasOpen),
    rootRef,
    inputRef,
    requestFocus: () => {
      wantFocus.current = true;
    },
  };
}

export function GridCustomInput({
  prop,
  value,
  busy,
  inputRef,
  placeholder,
  ariaLabel,
  onCommitCustom,
}: {
  prop: string;
  value: string;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  placeholder: string;
  ariaLabel: string;
  onCommitCustom: (value: string, important: boolean) => void;
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
    const parsed = parseImportant(draft);
    if (parsed.value) {
      onCommitCustom(parsed.value, parsed.important);
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
        onCommitCustom(binding, false);
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
          commitCustom();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitInPlace(event.currentTarget);
          }
        }}
        disabled={busy}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </VariableConnect>
  );
}

export function MenuArrow({ open, busy, ariaLabel, onToggle }: { open: boolean; busy: boolean; ariaLabel: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="embed-editor_display-arrow"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={ariaLabel}
      disabled={busy}
      onClick={onToggle}
    >
      <ChevDown />
    </button>
  );
}

export function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="embed-editor_display-menu-item" onClick={onClick}>
      {label}
    </button>
  );
}

export interface GridContentControlProps {
  value: string;
  prop: string;
  vertical: boolean;
  ariaLabel: string;
  busy: boolean;
  onSet: (value: string) => void;
  onCommitCustom: (value: string, important: boolean) => void;
}
export function GridContentControl(props: GridContentControlProps) {
  const translate = useTranslate();
  const { value, prop, vertical, ariaLabel, busy, onSet, onCommitCustom } = props;
  const current = gridKeyword(value.trim().toLowerCase());
  const shownContent = gridKeyword(useHighlight('', current ? '' : prop, [...GRID_CONTENT, ...Object.keys(GRID_SYNONYMS)], 'stretch'));
  const [forceCustom, setForceCustom] = useState(false);
  const customMode = forceCustom || (!!current && !GRID_CONTENT.includes(current));
  const menu = useCustomMenu({ customMode, busy });

  const enterCustom = () => {
    menu.setOpen(false);
    setForceCustom(true);
    menu.requestFocus();
  };
  const pickPreset = (option: string) => {
    menu.setOpen(false);
    setForceCustom(false);
    onSet(option);
  };
  const segValue = current ? (GRID_CONTENT.includes(current) ? current : '') : shownContent;

  return (
    <KeywordConnect
      prop={prop}
      value={value}
      ariaLabel={ariaLabel}
      disabled={busy}
      dot={customMode ? 'field' : 'wrapper'}
      onPick={(binding) => {
        setForceCustom(false);
        onCommitCustom(binding, false);
      }}
    >
      <div ref={menu.rootRef} className={`embed-editor_grid-dir-bar ${customMode ? 'is-custom' : ''}`}>
        {customMode ? (
          <GridCustomInput
            prop={prop}
            value={value}
            busy={busy}
            inputRef={menu.inputRef}
            placeholder={translate('style.gridFlowControls.customValuePlaceholder')}
            ariaLabel={ariaLabel}
            onCommitCustom={onCommitCustom}
          />
        ) : (
          <SegmentedControl value={segValue} options={contentOptions({ vertical }, translate)} ariaLabel={ariaLabel} disabled={busy} onChange={onSet} />
        )}
        <MenuArrow open={menu.open} busy={busy} ariaLabel={translate('style.gridFlowControls.moreOptions', { name: ariaLabel })} onToggle={menu.toggle} />
        {menu.open ? (
          <GridContentMenu customMode={customMode} pickPreset={pickPreset} enterCustom={enterCustom} onClose={() => menu.setOpen(false)} />
        ) : undefined}
      </div>
    </KeywordConnect>
  );
}

export function ContentPresetItems({ pickPreset }: { pickPreset: (option: string) => void }) {
  const labels = contentLabels(useTranslate());
  return GRID_CONTENT.map((option) => <MenuButton key={option} label={labels[option] ?? cap(option)} onClick={() => pickPreset(option)} />);
}

export const clampCount = (count: number) => Math.min(500, Math.max(1, count));

export function CountField({ value, busy, ariaLabel, onCommit }: { value: number; busy: boolean; ariaLabel: string; onCommit: (n: number) => void }) {
  const [text, setText] = useState(value > 0 ? String(value) : '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(value > 0 ? String(value) : '');
    }
  }, [value]);
  const commit = (entered: string) => {
    const parsed = parseInt(entered, 10);
    if (Number.isNaN(parsed)) {
      setText(value > 0 ? String(value) : '');
      return;
    }
    onCommit(clampCount(parsed));
  };
  const step = (delta: number) => {
    const base = parseInt(text, 10);
    const next = clampCount((Number.isNaN(base) ? value || 0 : base) + delta);
    setText(String(next));
    onCommit(next);
  };
  return (
    <div className="embed-editor_grid-count">
      <input
        className="u-input embed-editor_size-input"
        value={text}
        inputMode="numeric"
        spellCheck={false}
        disabled={busy}
        aria-label={ariaLabel}
        placeholder="0"
        onChange={(event) => setText(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commit(text);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitInPlace(event.currentTarget);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            step(1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            step(-1);
          }
        }}
      />
      <CountSteppers busy={busy} step={step} />
    </div>
  );
}

export function CountSteppers({ busy, step }: { busy: boolean; step: (delta: number) => void }) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_grid-count-steppers">
      <button type="button" tabIndex={-1} disabled={busy} aria-label={translate('style.gridFlowControls.increase')} onClick={() => step(1)}>
        <ChevUp />
      </button>
      <button type="button" tabIndex={-1} disabled={busy} aria-label={translate('style.gridFlowControls.decrease')} onClick={() => step(-1)}>
        <ChevDown />
      </button>
    </div>
  );
}

function GridContentMenu({
  customMode,
  pickPreset,
  enterCustom,
  onClose,
}: {
  readonly customMode: boolean;
  readonly pickPreset: (value: string) => void;
  readonly enterCustom: () => void;
  readonly onClose: () => void;
}) {
  const translate = useTranslate();
  return (
    <Popup mode="popover" portal={false} onClose={onClose} className="embed-editor_display-menu" role="menu">
      <VariableMenuItem onClose={onClose} />
      {customMode ? <ContentPresetItems pickPreset={pickPreset} /> : <MenuButton label={translate('style.gridFlowControls.custom')} onClick={enterCustom} />}
    </Popup>
  );
}
