import { useTranslate } from '../../lib/i18n/useTranslate';
import Popup from '../../ui/Popup';
import {
  CLASS_NAME_REFUSAL,
  classRowMatch,
  classRows,
  classRowStep,
  fuzzyMatch,
  fuzzySegments,
  isClassName,
  rankFuzzy,
  type ClassRow,
} from '../../lib/fuzzyRank';
import React, { useEffect, useRef, useState } from 'react';
import { useClassPopup } from './useClassPopup';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { CheckIcon } from '../../ui/Icons';
import { caretAtPoint, caretStep, type ChipBox } from '../../lib/chipCaret';

const collator = new Intl.Collator(undefined, { numeric: true });

function familyPrefix(cls: string) {
  const cut = Math.max(cls.lastIndexOf('-'), cls.lastIndexOf('_'));
  return cut > 0 ? cls.slice(0, cut + 1) : undefined;
}

interface ClassInputProps {
  readonly value?: string | undefined;
  readonly suggestions?: readonly string[];
  readonly onChange: (value: string, immediate: boolean) => void;
}
interface Family {
  readonly index: number;
  readonly options: readonly string[];
  readonly left: number;
  readonly top: number;
}
export default function ClassInput(props: ClassInputProps) {
  const state = useClassInput(props);
  const { wrapRef, focused, setCaret, inputRef } = state;
  return (
    <>
      <div
        ref={wrapRef}
        className={`class-input ${focused ? 'focused' : ''}`}
        onMouseDown={(event) => {
          const wrap = wrapRef.current;
          if (wrap === null) {
            return;
          }
          if (event.target === wrap) {
            event.preventDefault();
            setCaret(caretAtPoint(classTagBoxes(wrap), { x: event.clientX, y: event.clientY }));
            inputRef.current?.focus();
          }
        }}
      >
        <ClassTokens state={state} />
      </div>
      <ClassSuggestions state={state} />
      <ClassFamilyMenu state={state} />
    </>
  );
}

function classTagBoxes(wrap: HTMLDivElement): readonly ChipBox[] {
  const tags = wrap.querySelectorAll('.class-tag');
  assert(tags.length <= LIMITS.attrCharsMax, 'classTagBoxes: a bounded tag count');
  return Array.from(tags, (tag) => {
    const rect = tag.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
}

function useClassInput({ value, suggestions = [], onChange }: ClassInputProps) {
  assert((value?.length ?? 0) <= LIMITS.attrCharsMax, 'ClassInput: value limit exceeded');
  assert(suggestions.length <= 100_000, 'ClassInput: suggestion limit exceeded');
  const tokens = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const [caret, setCaret] = useState(tokens.length);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [moved, setHighlight] = useState(-1);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const at = Math.min(caret, tokens.length);

  const tokenActions = classTokenActions({ tokens, at, setCaret, setDraft, onChange });
  const familyState = useClassFamily(tokens, onChange);
  const query = draft.trim();
  const list = classRows({
    name: query === '' ? undefined : query,
    matches: classMatches(draft, suggestions, tokens),
    nameOf: (name) => name,
    carried: tokens.includes(query),
    restPlain: 0,
  });

  return {
    ...tokenActions,
    ...familyState,
    tokens,
    at,
    setCaret,
    draft,
    setDraft,
    focused,
    setFocused,
    highlight: classRowStep(moved, list),
    setHighlight,
    refusal: refused === query,
    setRefused,
    wrapRef,
    inputRef,
    list,
    suggestions,
  };
}

type ClassState = ReturnType<typeof useClassInput>;
function classTokenActions(options: {
  readonly tokens: readonly string[];
  readonly at: number;
  readonly setCaret: Dispatch<SetStateAction<number>>;
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly onChange: ClassInputProps['onChange'];
}) {
  const { tokens, at, setCaret, setDraft, onChange } = options;
  const commit = (next: readonly string[]) => {
    const text = next.join(' ');
    onChange(text, true);
  };

  const addToken = (text: string | undefined) => {
    const token = (text ?? '').trim();
    setDraft('');
    if (!token) {
      return;
    }
    if (tokens.includes(token)) {
      setCaret(tokens.indexOf(token) + 1);
      return;
    }
    const next = [...tokens];
    next.splice(at, 0, token);
    setCaret(at + 1);
    commit(next);
  };

  const removeAt = (i: number) => {
    if (i < 0 || i >= tokens.length) {
      return;
    }
    const next = tokens.filter((_, j) => j !== i);
    setCaret(Math.max(0, i));
    commit(next);
  };

  return { addToken, removeAt };
}
function useClassFamily(tokens: readonly string[], onChange: ClassInputProps['onChange']) {
  const [family, setFamily] = useState<Family | undefined>(undefined);
  const [famHighlight, setFamHighlight] = useState(-1);
  const famOriginal = useRef('');
  const famPreview = useRef<string | undefined>(undefined);
  const famRef = useRef<HTMLDivElement>(null);

  const actions = classFamilyActions({
    tokens,
    onChange,
    family,
    famOriginal,
    famPreview,
    setFamily,
    setFamHighlight,
  });
  useEffect(() => {
    if (!family || famHighlight < 0) {
      return;
    }
    famRef.current?.children[famHighlight]?.scrollIntoView({ block: 'nearest' });
  }, [family, famHighlight]);

  return {
    ...actions,
    family,
    setFamily,
    famHighlight,
    setFamHighlight,
    famOriginal,
    famPreview,
    famRef,
  };
}
function classFamilyActions(options: {
  readonly tokens: readonly string[];
  readonly onChange: ClassInputProps['onChange'];
  readonly family: Family | undefined;
  readonly famOriginal: MutableRefObject<string>;
  readonly famPreview: MutableRefObject<string | undefined>;
  readonly setFamily: Dispatch<SetStateAction<Family | undefined>>;
  readonly setFamHighlight: Dispatch<SetStateAction<number>>;
}) {
  const { tokens, onChange, family, famOriginal, famPreview, setFamily, setFamHighlight } = options;
  const closeFamily = ({ revert }: { readonly revert: boolean }) => {
    if (revert && family && famPreview.current !== undefined && famPreview.current !== famOriginal.current) {
      writeClassAt(tokens, family.index, famOriginal.current, { immediate: true, dedupe: false }, onChange);
    }
    famPreview.current = undefined;
    setFamily(undefined);
    setFamHighlight(-1);
  };

  const previewFamily = (index: number) => {
    if (!family) {
      return;
    }
    setFamHighlight(index);
    const cls = family.options[index];
    if (!cls) {
      return;
    }
    const applied = famPreview.current ?? famOriginal.current;
    if (cls === applied) {
      return;
    }
    famPreview.current = cls;
    writeClassAt(tokens, family.index, cls, { immediate: true, dedupe: false }, onChange);
  };

  const applyFamily = (index: number) => {
    if (!family) {
      return;
    }
    const cls = family.options[index];
    const i = family.index;
    famPreview.current = undefined;
    setFamily(undefined);
    setFamHighlight(-1);
    if (cls) {
      writeClassAt(tokens, i, cls, { immediate: true, dedupe: true }, onChange);
    }
  };

  return { closeFamily, previewFamily, applyFamily };
}
function writeClassAt(
  tokens: readonly string[],
  i: number,
  cls: string,
  { immediate, dedupe }: { readonly immediate: boolean; readonly dedupe: boolean },
  onChange: ClassInputProps['onChange'],
): void {
  let next = tokens.map((token, j) => (j === i ? cls : token));
  if (dedupe) {
    next = next.filter((token, j, all) => all.indexOf(token) === j);
  }
  onChange(next.join(' '), immediate);
}
function classFamilyOf(cls: string, suggestions: readonly string[], tokens: readonly string[]) {
  const prefix = familyPrefix(cls);
  if (!prefix) {
    return [];
  }
  const pool = new Set([...suggestions, ...tokens]);
  return [...pool].filter((name) => name.startsWith(prefix)).sort(collator.compare);
}
export function classMatches(draft: string, suggestions: readonly string[], tokens: readonly string[]): readonly string[] {
  const query = draft.trim();
  if (!query) {
    return [];
  }
  const free = suggestions.filter((name) => !tokens.includes(name));
  return rankFuzzy(query, free, { limit: free.length }, (name) => name).map(({ item }) => item);
}

function ClassMatchLabel({ name, draft }: { readonly name: string; readonly draft: string }) {
  const hit = fuzzyMatch(draft.trim(), name);
  return (
    <span className="dd-option-label">
      {fuzzySegments(name, hit?.indexes ?? []).map((segment, index) =>
        segment.hit ? (
          <mark key={index} className="class-suggest-hit">
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
    </span>
  );
}
function classInputKey(event: React.KeyboardEvent<HTMLInputElement>, state: ClassState): void {
  const { draft, removeAt, at, setCaret, tokens, list, setHighlight, highlight, addToken, setDraft, inputRef } = state;
  if (classFamilyKey(event, state)) {
    return;
  }
  if (event.key === 'Backspace' && !draft) {
    event.preventDefault();
    removeAt(at - 1);
  } else if (event.key === 'Delete' && !draft) {
    event.preventDefault();
    removeAt(at);
  } else if (event.key === 'ArrowLeft' && !draft) {
    event.preventDefault();
    setCaret(caretStep(at, tokens.length, -1));
  } else if (event.key === 'ArrowRight' && !draft) {
    event.preventDefault();
    setCaret(caretStep(at, tokens.length, 1));
  } else if (event.key === 'ArrowDown' && list.rows.length) {
    event.preventDefault();
    setHighlight(classRowStep(highlight + 1, list));
  } else if (event.key === 'ArrowUp' && list.rows.length) {
    event.preventDefault();
    setHighlight(classRowStep(highlight - 1, list));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    classInputEnter(state);
  } else if (event.key === ' ') {
    event.preventDefault();
    addToken(draft);
  } else if (event.key === 'Tab' && draft) {
    event.preventDefault();
    addToken(classRowMatch(list, highlight) ?? draft);
  } else if (event.key === 'Escape') {
    setDraft('');
    inputRef.current?.blur();
  }
}
function classInputEnter(state: ClassState): void {
  const { draft, tokens, list, highlight, addToken, setRefused } = state;
  const row = list.rows[highlight];
  if (row !== undefined) {
    addToken(classRowText(row));
    return;
  }
  const query = draft.trim();
  assert(highlight < list.rows.length, 'classInputEnter: the selection is on the list');
  if (query === '') {
    addToken(draft);
  } else if (tokens.includes(query)) {
    addToken(draft);
  } else {
    assert(!isClassName(query), 'classInputEnter: a valid new name has a create row');
    setRefused(query);
  }
}
function classRowText(row: ClassRow<string>): string {
  return row.kind === 'create' ? row.name : row.item;
}
function classFamilyKey(event: React.KeyboardEvent<HTMLInputElement>, state: ClassState): boolean {
  const { family, previewFamily, famHighlight, applyFamily, closeFamily } = state;
  if (family) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      previewFamily(Math.min(famHighlight + 1, family.options.length - 1));
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      previewFamily(Math.max(famHighlight - 1, 0));
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applyFamily(famHighlight);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFamily({ revert: true });
      return true;
    }
  }
  return false;
}
function ClassCaret({ state }: { readonly state: ClassState }) {
  const { draft, tokens, at, inputRef, setDraft, setHighlight, setFocused, addToken } = state;
  const emptyAmongTags = !draft && tokens.length > 0;
  assert(at >= 0, 'ClassCaret: the caret is not before the first gap');
  assert(at <= tokens.length, 'ClassCaret: the caret is not past the last gap');
  const order = 2 * at - 1;
  return (
    <input
      key="caret"
      ref={inputRef}
      className={`class-input-field ${emptyAmongTags ? 'empty' : ''}`}
      value={draft}
      style={draft ? { order, width: `${draft.length + 1}ch` } : { order }}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
        setHighlight(-1);
      }}
      onKeyDown={(event) => classInputKey(event, state)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft.trim()) {
          addToken(draft);
        }
      }}
    />
  );
}
function ClassTokens({ state }: { readonly state: ClassState }) {
  const translate = useTranslate();
  const { tokens, at, family, suggestions, setCaret, inputRef, closeFamily, famOriginal, famPreview, setFamHighlight, setFamily } = state;
  assert(at <= tokens.length, 'ClassTokens: the caret is within the tags');
  const items: React.ReactNode[] = [];
  tokens.forEach((token, i) => {
    items.push(
      <span
        key={`${token}-${i}`}
        className={`class-tag${family?.index === i ? ' open' : ''}`}
        style={{ order: 2 * i }}
        title={classFamilyOf(token, suggestions, tokens).length > 1 ? translate('props.classInput.switchTitle') : translate('props.classInput.caretTitle')}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setCaret(i + 1);
          inputRef.current?.focus();
          if (family?.index === i) {
            closeFamily({ revert: true });
            return;
          }
          closeFamily({ revert: true });
          const options = classFamilyOf(token, suggestions, tokens);
          if (options.length < 2) {
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          famOriginal.current = token;
          famPreview.current = undefined;
          setFamHighlight(options.indexOf(token));
          setFamily({ index: i, options, left: rect.left, top: rect.bottom + 5 });
        }}
      >
        {token}
      </span>,
    );
  });
  items.push(<ClassCaret key="caret" state={state} />);

  return items;
}
function ClassSuggestions({ state }: { readonly state: ClassState }) {
  const translate = useTranslate();
  const { list, highlight, setHighlight, addToken, focused, wrapRef, draft, refusal } = state;
  const popupPosition = useClassPopup(wrapRef, list.rows.length + (refusal ? 1 : 0), { open: focused });
  const popupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    popupRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, list.rows.length, draft]);
  if (!popupPosition) {
    return undefined;
  }
  return (
    <Popup mode="popover" portal={true} onClose={() => state.setFocused(false)} ref={popupRef} className="dd-popup class-suggest" style={popupPosition}>
      {list.rows.map((row, i) => (
        <div
          key={`${row.kind}:${classRowText(row)}`}
          className={`dd-option ${i === highlight ? 'highlight' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setHighlight(i)}
          onClick={() => addToken(classRowText(row))}
        >
          {row.kind === 'create' ? (
            <span className="dd-option-label">{translate('props.classInput.create', { name: row.name })}</span>
          ) : (
            <ClassMatchLabel name={row.item} draft={draft} />
          )}
        </div>
      ))}
      {}
      {refusal ? (
        <div className="dd-empty" role="status">
          {CLASS_NAME_REFUSAL}
        </div>
      ) : undefined}
    </Popup>
  );
}
function ClassFamilyMenu({ state }: { readonly state: ClassState }) {
  const { family, famRef, famHighlight, famOriginal, previewFamily, applyFamily } = state;
  const position = useClassPopup(state.wrapRef, family?.options.length ?? 0, {
    open: !!family,
    matchWidth: false,
  });
  if (!family || !position) {
    return undefined;
  }
  return (
    <Popup mode="popover" portal={true} onClose={() => state.closeFamily({ revert: true })} ref={famRef} className="dd-popup class-family" style={position}>
      {family.options.map((option, i) => (
        <div
          key={option}
          className={`dd-option ${i === famHighlight ? 'highlight' : ''} ${option === famOriginal.current ? 'selected' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => previewFamily(i)}
          onClick={() => applyFamily(i)}
        >
          <span className="dd-option-label">{option}</span>
          <span className="dd-check">{option === famOriginal.current && <CheckIcon size={12} />}</span>
        </div>
      ))}
    </Popup>
  );
}
