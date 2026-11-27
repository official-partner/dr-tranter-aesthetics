
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { assert } from '../../../shared/core/assert';
import Select from './components/Select';
import type { Props as SelectProps, SelectOption } from './components/selectTypes';
import { MenuItem } from './components/MenuParts';
import { PlusIcon } from './VariableIcons';
import { VariablePicker } from './VariablePicker';
import { useSharedVars } from './sharedVars';
import { useFieldPreview } from './connectFieldHelpers';
import VariableConnect, { ConnectDot } from './VariableConnect';
import { commitInPlace } from './model/commitStyleInPlace';

export const VARIABLE_OPTION = '__variable__';
type VariableOption = typeof VARIABLE_OPTION;

export type KeywordDot = 'wrapper' | 'field';

const VAR_REFERENCE = /var\(\s*--[A-Za-z0-9_-]+[^)]*\)/i;

export function variableIn(value: string): string | undefined {
  return VAR_REFERENCE.exec(value)?.[0];
}

const OpenPickerContext = createContext<(() => void) | undefined>(undefined);

export function useOpenVariablePicker(): (() => void) | undefined {
  return useContext(OpenPickerContext);
}

type KeywordConnectProps = {
  readonly prop: string;
  readonly value: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly dot: KeywordDot;
  readonly className?: string;
  readonly children: ReactNode;
  readonly onPick: (binding: string) => void;
};

export default function KeywordConnect({ prop, value, ariaLabel, disabled, dot, className, children, onPick }: KeywordConnectProps) {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLButtonElement>(null);
  const { vars, loading } = useSharedVars({ active: open });
  const canvas = useFieldPreview(prop);
  const label = translate('styleModel.shared.connectVariable', { label: ariaLabel });
  const openPicker = (): void => {
    if (disabled) {
      return;
    }
    setOpen(true);
  };
  const closePicker = (): void => {
    canvas.takeBack();
    setOpen(false);
  };
  const pick = (binding: string): void => {
    assert(binding.length > 0, 'A picked variable has a binding');
    assert(binding.trim() === binding, 'A picked variable has no edge whitespace');
    canvas.handOver();
    setOpen(false);
    onPick(binding);
  };
  const selected = variableIn(value);
  const anchor = (dot === 'wrapper' ? dotRef.current : wrapRef.current) ?? wrapRef.current ?? undefined;
  return (
    <span ref={wrapRef} className={['embed-editor_varconnect', 'is-fill', 'is-keyword', className ?? ''].filter(Boolean).join(' ')}>
      <OpenPickerContext.Provider value={openPicker}>{children}</OpenPickerContext.Provider>
      {dot === 'wrapper' ? (
        <ConnectDot
          dotRef={dotRef}
          disabled={disabled}
          ariaLabel={label}
          open={open}
          onPress={() => undefined}
          onToggle={() => (open ? closePicker() : openPicker())}
        />
      ) : undefined}
      {open && anchor !== undefined ? (
        <VariablePicker
          anchor={anchor}
          within={wrapRef.current ?? undefined}
          vars={vars}
          loading={loading}
          prop={prop}
          {...(selected === undefined ? {} : { selectedBinding: selected })}
          onPreview={(binding) => canvas.show(binding)}
          onPreviewEnd={() => canvas.takeBack()}
          onPick={pick}
          onClose={closePicker}
        />
      ) : undefined}
    </span>
  );
}

export function VariableMenuItem({ onClose }: { readonly onClose: () => void }) {
  const translate = useTranslate();
  const openPicker = useOpenVariablePicker();
  if (openPicker === undefined) {
    return undefined;
  }
  return (
    <MenuItem
      label={translate('style.keywordConnect.variable')}
      selected={false}
      onClick={() => {
        onClose();
        openPicker();
      }}
    />
  );
}

export function withVariableOption<T extends string>(options: readonly SelectOption<T>[], label: string): SelectOption<T | VariableOption>[] {
  assert(
    options.every((option) => option.value !== VARIABLE_OPTION),
    'No keyword list already holds the variable row',
  );
  const row: SelectOption<VariableOption> = { value: VARIABLE_OPTION, label, title: label, icon: <PlusIcon /> };
  return [row, ...options];
}

type VariableSelectProps<T extends string> = SelectProps<T> & {
  readonly prop: string;
  readonly rawValue: string;
  readonly onVariable: (binding: string) => void;
};

export function VariableSelect<T extends string>({ prop, rawValue, onVariable, ...select }: VariableSelectProps<T>) {
  const dot: KeywordDot = select.customInput === undefined ? 'wrapper' : 'field';
  return (
    <KeywordConnect prop={prop} value={rawValue} ariaLabel={select.ariaLabel ?? prop} disabled={select.disabled ?? false} dot={dot} onPick={onVariable}>
      <VariableSelectList {...select} />
    </KeywordConnect>
  );
}

function VariableSelectList<T extends string>(select: SelectProps<T>) {
  const translate = useTranslate();
  const openPicker = useOpenVariablePicker();
  assert(openPicker !== undefined, 'A variable dropdown sits inside its connect wrapper');
  const { onChange, onPreview, options, ...rest } = select;
  return (
    <Select<T | VariableOption>
      {...rest}
      options={withVariableOption(options, translate('style.keywordConnect.variable'))}
      onChange={(choice) => {
        if (choice === VARIABLE_OPTION) {
          openPicker();
          return;
        }
        onChange(choice);
      }}
      {...(onPreview === undefined
        ? {}
        : {
            onPreview: (choice: T | VariableOption | undefined) => onPreview(choice === VARIABLE_OPTION ? undefined : choice),
          })}
    />
  );
}

type KeywordSegmentsProps = {
  readonly prop: string;
  readonly value: string;
  readonly important: boolean;
  readonly ariaLabel: string;
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly onWrite: (value: string, important: boolean) => void;
  readonly onClear: () => void;
};

export function KeywordSegments({ prop, value, important, ariaLabel, busy, children, onWrite, onClear }: KeywordSegmentsProps) {
  const variable = variableIn(value) !== undefined;
  return (
    <KeywordConnect
      prop={prop}
      value={value}
      ariaLabel={ariaLabel}
      disabled={busy}
      dot={variable ? 'field' : 'wrapper'}
      onPick={(binding) => onWrite(binding, important)}
    >
      {variable ? (
        <KeywordVariableField prop={prop} value={value} busy={busy} ariaLabel={ariaLabel} onCommit={(next) => onWrite(next, important)} onClear={onClear} />
      ) : (
        children
      )}
    </KeywordConnect>
  );
}

type KeywordVariableFieldProps = {
  readonly prop: string;
  readonly value: string;
  readonly busy: boolean;
  readonly ariaLabel: string;
  readonly onCommit: (value: string) => void;
  readonly onClear: () => void;
};

export function KeywordVariableField({ prop, value, busy, ariaLabel, onCommit, onClear }: KeywordVariableFieldProps) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      onClear();
      return;
    }
    if (trimmed !== value.trim()) {
      onCommit(trimmed);
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
        className="u-input embed-editor_size-input"
        value={draft}
        disabled={busy}
        spellCheck={false}
        aria-label={ariaLabel}
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
      />
    </VariableConnect>
  );
}
