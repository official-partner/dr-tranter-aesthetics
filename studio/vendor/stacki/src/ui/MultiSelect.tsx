
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import Popup from './Popup';
import { popupBox, POPUP_GAP, type DropdownOption } from './Dropdown';
import { CheckIcon, ChevronDownIcon, CloseIcon } from './Icons';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import './multiSelect.css';
import { useTranslate } from '../lib/i18n/useTranslate';

const OPTION_HEIGHT_PX = 26;
const MENU_HEIGHT_PX_MAX = 320;
const MENU_PADDING_PX = 8;
const POPUP_EDGE_PX = 8;

export interface MultiSelectProps<T> {
  readonly ariaLabel: string;
  readonly values: readonly T[];
  readonly options: readonly DropdownOption<T>[];
  readonly onChange: (values: readonly T[]) => void;
  readonly placeholder?: string | undefined;
  readonly valueOfText?: ((text: string) => T | undefined) | undefined;
  readonly labelOf?: ((value: T) => string) | undefined;
  readonly valuesMax?: number | undefined;
}

export default function MultiSelect<T>(props: MultiSelectProps<T>) {
  const translate = useTranslate();
  const { values, options, onChange } = props;
  assert(options.length <= LIMITS.scanEntriesMax, 'MultiSelect: option count exceeds limit');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const visible = needle === '' ? options : options.filter((option) => option.label.toLowerCase().includes(needle));
  const chosen = (value: T): boolean => values.some((current) => Object.is(current, value));
  const full = values.length >= (props.valuesMax ?? LIMITS.scanEntriesMax);
  const labelOf = (value: T): string => props.labelOf?.(value) ?? options.find((option) => Object.is(option.value, value))?.label ?? String(value);
  const toggle = (value: T): void => {
    if (chosen(value)) {
      onChange(values.filter((current) => !Object.is(current, value)));
    } else if (!full) {
      onChange([...values, value]);
    }
    setQuery('');
  };
  const addTyped = (): void => {
    const option = visible[highlight];
    if (open && option !== undefined && option.disabled !== true) {
      toggle(option.value);
      return;
    }
    const typed = query.trim() === '' ? undefined : props.valueOfText?.(query);
    if (typed !== undefined && !chosen(typed) && !full) {
      onChange([...values, typed]);
      setQuery('');
    }
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'Backspace':
        if (query === '' && values.length > 0) {
          event.preventDefault();
          onChange(values.slice(0, -1));
        }
        return;
      case 'ArrowDown':
        event.preventDefault();
        setOpen(true);
        setHighlight((current) => Math.min(current + 1, Math.max(visible.length - 1, 0)));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setHighlight((current) => Math.max(current - 1, 0));
        return;
      case 'Enter':
        event.preventDefault();
        addTyped();
        return;
      default:
        return;
    }
  };
  return (
    <div
      ref={fieldRef}
      className={`multi-select${open ? ' is-open' : ''}${values.length > 0 ? ' has-values' : ''}${options.length > 0 ? ' has-chevron' : ''}`}
      role="combobox"
      aria-label={props.ariaLabel}
      aria-expanded={open}
      aria-controls={menuId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {values.map((value, index) => (
        <span key={index} className="multi-select-chip">
          {labelOf(value)}
          <button
            type="button"
            aria-label={translate('ui.multiSelect.remove', { label: labelOf(value) })}
            tabIndex={-1}
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          >
            <CloseIcon size={9} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="multi-select-input"
        aria-label={translate('ui.multiSelect.typeToFilter', { label: props.ariaLabel })}
        value={query}
        placeholder={values.length === 0 ? (props.placeholder ?? translate('ui.choose')) : ''}
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          setOpen(options.length > 0);
        }}
        onFocus={() => setOpen(options.length > 0)}
        onBlur={() => {
          if (props.valueOfText !== undefined && query.trim() !== '') {
            const typed = props.valueOfText(query);
            if (typed !== undefined && !chosen(typed) && !full) {
              onChange([...values, typed]);
            }
            setQuery('');
          }
        }}
        onKeyDown={onKey}
      />
      {options.length > 0 && (
        <button
          type="button"
          className="multi-select-chevron"
          aria-label={translate(open ? 'ui.multiSelect.closeOptions' : 'ui.multiSelect.openOptions')}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen(!open);
            inputRef.current?.focus();
          }}
        >
          <ChevronDownIcon size={11} />
        </button>
      )}
      {open && visible.length > 0 && (
        <MultiSelectMenu
          id={menuId}
          anchor={fieldRef.current ?? undefined}
          options={visible}
          highlight={highlight}
          chosen={chosen}
          onHighlight={setHighlight}
          onToggle={toggle}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function MultiSelectMenu<T>(props: {
  readonly id: string;
  readonly anchor: HTMLElement | undefined;
  readonly options: readonly DropdownOption<T>[];
  readonly highlight: number;
  readonly chosen: (value: T) => boolean;
  readonly onHighlight: (index: number) => void;
  readonly onToggle: (value: T) => void;
  readonly onClose: () => void;
}) {
  const translate = useTranslate();
  const [position, setPosition] = useState<{ readonly left: number; readonly minWidth: number } & ReturnType<typeof popupBox>>();
  const { anchor, options } = props;
  useLayoutEffect(() => {
    if (anchor === undefined) {
      return;
    }
    const rectangle = anchor.getBoundingClientRect();
    const wanted = Math.min(options.length * OPTION_HEIGHT_PX + MENU_PADDING_PX, MENU_HEIGHT_PX_MAX);
    setPosition({ left: Math.max(POPUP_EDGE_PX, rectangle.left), minWidth: rectangle.width, ...popupBox(rectangle, wanted + POPUP_GAP, window.innerHeight) });
  }, [anchor, options.length]);
  if (position === undefined) {
    return undefined;
  }
  return (
    <Popup
      mode="popover"
      anchor={anchor}
      within={anchor}
      onClose={props.onClose}
      id={props.id}
      className="dd-popup multi-select-menu"
      style={{ ...position, width: 'max-content', maxWidth: window.innerWidth - position.left - POPUP_EDGE_PX }}
      role="listbox"
      label={translate('ui.multiSelect.options')}
    >
      {options.map((option, index) => (
        <div
          key={String(option.value)}
          role="option"
          aria-selected={props.chosen(option.value)}
          className={`dd-option${index === props.highlight ? ' highlight' : ''}${props.chosen(option.value) ? ' selected' : ''}`}
          onMouseEnter={() => props.onHighlight(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onToggle(option.value)}
        >
          {option.icon !== undefined && <span className="dd-icon">{option.icon}</span>}
          <span className="dd-option-label">{option.label}</span>
          {}
          {props.chosen(option.value) && <CheckIcon size={12} className="dd-check" />}
        </div>
      ))}
    </Popup>
  );
}
