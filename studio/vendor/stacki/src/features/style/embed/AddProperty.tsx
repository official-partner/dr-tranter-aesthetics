
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Popup from '../../../ui/Popup';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import useScrub from '../components/useScrub';
import { filterCssProperties, isNonNegative } from '../model/cssProperties';
import { panelSpan } from '../model/panelBox';
import VariableConnect, { useSharedVars } from '../VariableConnect';
import { useExternalDraft } from '../model/fieldHooks';
import { parseImportant, withImportant } from '../model/styleDisplay';


export function ValueField({
  prop,
  value,
  important,
  busy,
  onCommit,
  onLiveCommit,
  onPick,
}: {
  prop: string;
  value: string;
  important: boolean;
  busy: boolean;
  onCommit: (value: string, important: boolean) => void;
  onLiveCommit: (value: string, important: boolean) => void;
  onPick: (binding: string) => void;
}) {
  const translate = useTranslate();
  const external = withImportant({ value, important });
  const { draft, setDraft, focused } = useExternalDraft(external);

  const liveNow = (text: string) => {
    const parsed = parseImportant(text);
    if (parsed.value) {
      onLiveCommit(parsed.value, parsed.important);
    }
  };
  const { scheduleLive, cancelLive } = useLiveTimer(liveNow);

  const commit = (text = draft) => {
    const parsed = parseImportant(text);
    if (parsed.value && (parsed.value !== value || parsed.important !== important)) {
      onCommit(parsed.value, parsed.important);
    }
  };
  const commitScrub = (text: string) => {
    setDraft(text);
    commit(text);
  };
  const scrub = useScrub({
    value: draft,
    disabled: busy,
    onPreview: setDraft,
    onInput: liveNow,
    onCommit: commitScrub,
  });

  return (
    <VariableConnect
      code
      {...(isNonNegative(prop) ? { stepMin: 0 } : {})}
      ariaLabel={translate('styleModel.shared.connectVariable', { label: prop })}
      disabled={busy}
      prop={prop}
      canvasProperty={prop}
      onPick={onPick}
    >
      <textarea
        {...scrub.input}
        data-prop={prop}
        className="u-input embed-editor_value-input"
        rows={1}
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
        disabled={busy}
        spellCheck={false}
        aria-label={translate('styleModel.embed.add.value')}
      />
    </VariableConnect>
  );
}

export function useLiveTimer(liveNow: (text: string) => void) {
  const liveTimer = useRef<number | undefined>(undefined);
  const cancelLive = () => {
    if (liveTimer.current !== undefined) {
      window.clearTimeout(liveTimer.current);
      liveTimer.current = undefined;
    }
  };
  const scheduleLive = (text: string) => {
    cancelLive();
    liveTimer.current = window.setTimeout(() => {
      liveTimer.current = undefined;
      liveNow(text);
    }, 100);
  };
  useEffect(() => cancelLive, []);
  return { scheduleLive, cancelLive };
}


export interface PropertyComboboxProps {
  value: string;
  custom: readonly string[];
  busy: boolean;
  onChange: (value: string) => void;
  onPick: (prop: string) => void;
  onEnter: () => void;
  onEscape: () => void;
}
export function PropertyCombobox(props: PropertyComboboxProps) {
  const translate = useTranslate();
  const { value, custom, busy, onChange, onPick, onEnter, onEscape } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterCssProperties(value, custom), [value, custom]);
  const position = useSuggestPosition({ open, inputRef, matchCount: matches.length, value });

  useEffect(() => {
    setActive(0);
  }, [value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const element = listRef.current?.children[active];
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'nearest' });
    }
  }, [active, open]);

  const choose = (prop: string) => {
    onPick(prop);
    setOpen(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) =>
    comboKeyDown(event, { open, active, matches, setOpen, setActive, choose, onEnter, onEscape });

  return (
    <div className="embed-editor_propcombo">
      <input
        ref={inputRef}
        className="u-input embed-editor_prop-input"
        value={value}
        autoFocus
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        disabled={busy}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={translate('styleModel.embed.add.propertyPlaceholder')}
        spellCheck={false}
        aria-label={translate('styleModel.embed.add.newName')}
      />
      {open && matches.length ? (
        <PropertySuggestions
          onClose={() => setOpen(false)}
          listRef={listRef}
          position={position}
          matches={matches}
          active={active}
          setActive={setActive}
          choose={choose}
        />
      ) : undefined}
    </div>
  );
}

export function PropertySuggestions({
  onClose,
  listRef,
  position,
  matches,
  active,
  setActive,
  choose,
}: {
  readonly onClose: () => void;
  listRef: React.RefObject<HTMLDivElement>;
  position: CSSProperties;
  matches: readonly string[];
  active: number;
  setActive: (index: number) => void;
  choose: (prop: string) => void;
}) {
  const translate = useTranslate();
  return (
    <Popup
      mode="popover"
      onClose={onClose}
      ref={listRef}
      className="embed-editor_propsuggest"
      style={position}
      role="listbox"
      label={translate('styleModel.embed.add.suggestions')}
    >
      {matches.map((prop, i) => (
        <button
          key={prop}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`embed-editor_propsuggest-item${i === active ? ' is-active' : ''}`}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(event) => {
            event.preventDefault();
            choose(prop);
          }}
        >
          {prop}
        </button>
      ))}
    </Popup>
  );
}

export function useSuggestPosition({
  open,
  inputRef,
  matchCount,
  value,
}: {
  open: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  matchCount: number;
  value: string;
}): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
  });
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const rect = input.getBoundingClientRect();
    const span = panelSpan(input);
    const margin = 8;
    const gap = 4;
    const spaceAbove = rect.top - margin;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const up = spaceAbove >= spaceBelow;
    const heightMax = Math.max(120, Math.min(340, (up ? spaceAbove : spaceBelow) - gap));
    const box = {
      position: 'fixed',
      left: span.left,
      width: span.width,
      visibility: 'visible',
    } as const;
    setPosition(up ? { ...box, bottom: window.innerHeight - rect.top + gap, maxHeight: heightMax } : { ...box, top: rect.bottom + gap, maxHeight: heightMax });
  }, [open, matchCount, value, inputRef]);
  return position;
}

export function comboKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  combo: {
    open: boolean;
    active: number;
    matches: readonly string[];
    setOpen: (open: boolean) => void;
    setActive: React.Dispatch<React.SetStateAction<number>>;
    choose: (prop: string) => void;
    onEnter: () => void;
    onEscape: () => void;
  },
) {
  const { open, matches, setActive } = combo;
  const highlighted = open ? matches[combo.active] : undefined;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (!open) {
        combo.setOpen(true);
        return;
      }
      setActive((previous) => Math.min(previous + 1, matches.length - 1));
      return;
    case 'ArrowUp':
      event.preventDefault();
      if (open) {
        setActive((previous) => Math.max(previous - 1, 0));
      }
      return;
    case 'Enter':
      if (highlighted) {
        event.preventDefault();
        combo.choose(highlighted);
      } else {
        combo.onEnter();
      }
      return;
    case 'Tab':
      if (highlighted) {
        event.preventDefault();
        combo.choose(highlighted);
      }
      return;
    case 'Escape':
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        combo.setOpen(false);
      } else {
        combo.onEscape();
      }
      return;
    default:
      return;
  }
}

export function AddPropertyRow({ busy, onAdd }: { busy: boolean; onAdd: (prop: string, value: string, important: boolean) => void }) {
  const row = useAddProperty(onAdd);
  const { expanded, prop, setProp, value, setValue, valueRef, cancel, submit } = row;
  const { vars } = useSharedVars({ active: expanded });
  const custom = useMemo(() => customPropertyNames(vars), [vars]);

  if (!expanded) {
    return <AddPropertyButton busy={busy} onOpen={() => row.setExpanded(true)} />;
  }

  return (
    <div className="embed-editor_decl is-add">
      <PropertyCombobox
        value={prop}
        custom={custom}
        busy={busy}
        onChange={setProp}
        onPick={(picked) => {
          setProp(picked);
          valueRef.current?.focus();
        }}
        onEnter={row.enterName}
        onEscape={cancel}
      />
      <NewValueInput valueRef={valueRef} value={value} setValue={setValue} submit={submit} cancel={cancel} />
      <CancelAddButton onCancel={cancel} />
    </div>
  );
}

export function useAddProperty(onAdd: (prop: string, value: string, important: boolean) => void) {
  const [expanded, setExpanded] = useState(false);
  const [prop, setProp] = useState('');
  const [value, setValue] = useState('');
  const valueRef = useRef<HTMLInputElement>(null);
  const ready = prop.trim() !== '' && value.trim() !== '';

  const cancel = () => {
    setProp('');
    setValue('');
    setExpanded(false);
  };
  const submit = () => {
    if (!ready) {
      return;
    }
    const parsed = parseImportant(value);
    onAdd(prop.trim(), parsed.value, parsed.important);
    setProp('');
    setValue('');
  };
  const enterName = () => {
    if (prop.trim() && !value.trim()) {
      valueRef.current?.focus();
      return;
    }
    submit();
  };

  return {
    expanded,
    setExpanded,
    prop,
    setProp,
    value,
    setValue,
    valueRef,
    ready,
    cancel,
    submit,
    enterName,
  };
}

export function CancelAddButton({ onCancel }: { onCancel: () => void }) {
  const translate = useTranslate();
  return (
    <button
      className="embed-editor_icon-btn"
      type="button"
      onClick={onCancel}
      title={translate('ui.cancel')}
      aria-label={translate('styleModel.embed.add.cancel')}
    >
      ✕
    </button>
  );
}

export function customPropertyNames(vars: ReadonlyArray<{ name: string }>): string[] {
  return [...new Set(vars.map((variable) => `--${variable.name}`))].sort();
}

export function NewValueInput({
  valueRef,
  value,
  setValue,
  submit,
  cancel,
}: {
  valueRef: React.RefObject<HTMLInputElement>;
  value: string;
  setValue: (value: string) => void;
  submit: () => void;
  cancel: () => void;
}) {
  const translate = useTranslate();
  return (
    <input
      ref={valueRef}
      className="u-input embed-editor_value-input"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          submit();
        }
        if (event.key === 'Escape') {
          cancel();
        }
      }}
      placeholder={translate('styleModel.embed.add.valuePlaceholder')}
      spellCheck={false}
      aria-label={translate('styleModel.embed.add.newValue')}
    />
  );
}

export function AddPropertyButton({ busy, onOpen }: { busy: boolean; onOpen: () => void }) {
  const translate = useTranslate();
  return (
    <button className="embed-editor_add-btn" type="button" onClick={onOpen} disabled={busy}>
      <span className="embed-editor_add-plus" aria-hidden="true">
        +
      </span>{' '}
      {translate('styleModel.embed.add.button')}
    </button>
  );
}


export type SectionToggleRequest = {
  readonly id: string;
  readonly ids: readonly string[];
  readonly next: 'open' | 'closed';
  readonly scope: 'one' | 'all';
};

export function useSectionVisibility(): readonly [ReadonlySet<string>, (request: SectionToggleRequest) => void] {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(['flex-child']));
  const toggle = useCallback((request: SectionToggleRequest) => {
    setClosed((previous) => {
      if (request.scope === 'all') {
        return request.next === 'open' ? new Set() : new Set(request.ids);
      }
      const next = new Set(previous);
      if (request.next === 'open') {
        next.delete(request.id);
      } else {
        next.add(request.id);
      }
      return next;
    });
  }, []);
  return [closed, toggle];
}
