import { centralIcon } from '../../../ui/central/CentralIcon';
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../../shared/properties/i18n/messageRef';
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { add as centralAdd } from '../../../ui/central/centralGeometry';
import { ErrorToast } from '../../../ui/ErrorToast';
import Popup from '../../../ui/Popup';

import { loadSelectorFilters, saveSelectorFilters, type SelectorFilters } from '../model/toolPreferences';
import { parentClassPrefix } from '../model/classPrefix';
import { findNode, getHost } from '../model/host';
import { typedSelectorText } from '../model/typedSelector';
import { assert } from '../../../../shared/core/assert';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useHoverTip } from '../components/CssPropertyTip';
import { type SegmentedOption } from '../../../ui/SegmentedControl';
import { CodeInline } from '../../../ui/CodeBlock';
import { selectorKey, selectorsMatch } from '../model/resolved';
import { SpinnerIcon } from './EditorBasics';
import { InlineStyleChip } from './InlineStyleChip';
import type { InlineChip } from './useInlineTarget';
import { Skeleton } from '../../../ui/Skeleton';
import { loneTypedClass, usePseudoTarget } from './editorModel';
import { classRowMatch, classRows, classRowStep, fuzzySegments, isClassName, rankFuzzy, type ClassRow, type ClassRowList } from '../../../lib/fuzzyRank';
import { chipAtCaret, chipPart, createPressWatch, type PressWatch } from '../model/selectorCaret';
import { PLACEMENT_END } from '../../../editor/classAttr';
import {
  type SelectorSuggestion,
  useProjectClasses,
  PROJECT_CLASS_LIMIT,
  SUGGESTION_KIND_LABEL_KEY,
  type ClassifiedSelector,
  classifySelector,
  selectorAccessibleLabel,
  type SelectorPickerProps,
} from './LayoutRows';

export function SelectorPicker({
  selectors,
  suggestions,
  activeSelector,
  activePicked,
  busy,
  loading,
  settled,
  onSelect,
  onDeselect,
  onAdd,
  onVisibleSelectorsChange,
  inline,
}: SelectorPickerProps) {
  const translate = useTranslate();
  const pending = settled === false;
  const view = useSelectorView({ selectors, activeSelector, activePicked, onVisibleSelectorsChange });
  const removal = useChipRemoval({ shown: view.shownSelectors, activeSelector, onSelect, onDeselect });
  const field = useAddSelectorField({
    selectors,
    suggestions,
    activeSelector,
    busy,
    onSelect,
    onDeselect,
    onAdd,
    shown: removal.visible,
    removeChip: removal.remove,
  });
  const { add, showInput } = field;
  const removeChip = (entry: ClassifiedSelector) => {
    removal.remove(entry, 'chip');
  };

  return (
    <>
      <div className="embed-editor_selectors">
        {}
        <div className="embed-editor_selector-well" onMouseDown={field.onWellMouseDown}>
          {}
          {pending ? <SelectorChipsPlaceholder label={translate('styleModel.embed.picker.finding')} /> : undefined}
          {!pending && loading && !removal.visible.length ? (
            <div className="embed-editor_selector-loading" aria-live="polite">
              <SpinnerIcon />
              <span className="u-sr-only">{translate('styleModel.embed.picker.finding')}</span>
            </div>
          ) : undefined}
          {}
          {!pending && (removal.visible.length || showInput || inline !== undefined || !loading) ? (
            <SelectorChips
              chipsRef={removal.chipsRef}
              entries={removal.visible}
              inline={inline}
              activeSelector={activeSelector}
              busy={busy}
              onSelect={onSelect}
              onDeselect={onDeselect}
              onRemove={removeChip}
            >
              <SelectorAddField
                add={add}
                inputRef={field.inputRef}
                listRef={field.listRef}
                busy={busy}
                inTabOrder={showInput}
                onFocus={field.onFocus}
                onBlur={field.onBlur}
                apply={field.apply}
                onCaretKey={field.onCaretKey}
              />
            </SelectorChips>
          ) : undefined}
        </div>
      </div>
      <SelectorFilterToggles view={view} pending={pending} />
      <span className="u-sr-only" role="status" aria-live="polite">
        {removal.announcement}
      </span>
    </>
  );
}

const PLACEHOLDER_CHIP_WIDTHS_REM = ['2.5rem', '4.5rem', '6rem'] as const;

function SelectorChipsPlaceholder({ label }: { readonly label: string }) {
  return (
    <div className="embed-editor_selector-chips is-placeholder" role="status" aria-busy="true">
      {PLACEHOLDER_CHIP_WIDTHS_REM.map((width) => (
        <Skeleton key={width} width={width} height="var(--embed-editor_chip-h)" />
      ))}
      <span className="u-sr-only">{label}</span>
    </div>
  );
}

export function useHighlightInView({ listRef, highlight, showList }: { listRef: React.RefObject<HTMLDivElement>; highlight: number; showList: boolean }) {
  useEffect(() => {
    if (!showList || highlight < 0) {
      return;
    }
    const element = listRef.current?.children[highlight];
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight, showList, listRef]);
}

const selectorFocusListeners = new Set<() => void>();
const SELECTOR_FOCUS_LISTENERS_MAX = 8;

export function requestSelectorFocus(): boolean {
  for (const listener of selectorFocusListeners) {
    listener();
  }
  return selectorFocusListeners.size > 0;
}

function onSelectorFocusRequest(listener: () => void): () => void {
  selectorFocusListeners.add(listener);
  assert(selectorFocusListeners.size <= SELECTOR_FOCUS_LISTENERS_MAX, 'onSelectorFocusRequest: listeners are released on unmount');
  return () => {
    selectorFocusListeners.delete(listener);
  };
}

export function removeChipFromElement(
  entry: ClassifiedSelector,
  panel: { readonly activeSelector: string; readonly onDeselect: () => void },
  outcome: ChipRemovalOutcome = {},
): boolean {
  const part = chipPart(entry.selector.text, loneTypedClass(entry.selector.text));
  const host = getHost();
  const request = part.kind === 'class' ? host.removeClass?.(part.name) : part.kind === 'attribute' ? host.removeAttribute?.(part.name) : undefined;
  if (request === undefined) {
    return false;
  }
  const wasActive = selectorsMatch(entry.selector.text, panel.activeSelector);
  outcome.onRequested?.();
  void request.then((answer) => {
    if (answer.tag === 'refused') {
      outcome.onRefused?.();
      return;
    }
    if (wasActive) {
      panel.onDeselect();
    }
    outcome.onApplied?.({ wasActive });
  });
  return true;
}

export interface ChipRemovalOutcome {
  readonly onRequested?: () => void;
  readonly onApplied?: (removed: { readonly wasActive: boolean }) => void;
  readonly onRefused?: () => void;
}

const HIDDEN_CHIPS_MAX = 64;

export function useChipRemoval({
  shown,
  activeSelector,
  onSelect,
  onDeselect,
}: {
  readonly shown: readonly ClassifiedSelector[];
  readonly activeSelector: string;
  readonly onSelect: (selector: string) => void;
  readonly onDeselect: () => void;
}) {
  const translate = useTranslate();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const chipsRef = useRef<HTMLDivElement>(null);
  const shownKeys = shown.map((entry) => entry.selector.key).join('\n');
  useEffect(() => {
    const present = new Set(shownKeys.split('\n'));
    setHidden((current) => {
      const kept = [...current].filter((key) => present.has(key));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [shownKeys]);
  const visible = shown.filter((entry) => !hidden.has(entry.selector.key));
  const remove = (entry: ClassifiedSelector, focus: 'chip' | 'stay') => {
    const at = visible.findIndex((candidate) => candidate.selector.key === entry.selector.key);
    const neighbour = at < 0 ? undefined : (visible[at + 1] ?? visible[at - 1]);
    const key = entry.selector.key;
    return removeChipFromElement(
      entry,
      { activeSelector, onDeselect },
      {
        onRequested: () => {
          setHidden((current) => {
            assert(current.size < HIDDEN_CHIPS_MAX, 'useChipRemoval: hidden chips are released as the list catches up');
            return new Set([...current, key]);
          });
        },
        onRefused: () => {
          setHidden((current) => new Set([...current].filter((hiddenKey) => hiddenKey !== key)));
        },
        onApplied: ({ wasActive }) => {
          setAnnouncement(translate('styleModel.embed.picker.chipRemoved', { name: entry.selector.display ?? entry.selector.text }));
          if (neighbour === undefined) {
            return;
          }
          if (wasActive) {
            onSelect(neighbour.selector.text);
          }
          if (focus === 'chip') {
            focusChip(chipsRef.current ?? undefined, neighbour.selector.key);
          }
        },
      },
    );
  };
  return { visible, remove, announcement, chipsRef };
}

function focusChip(container: HTMLElement | undefined, key: string): void {
  if (container === undefined) {
    return;
  }
  for (const chip of container.querySelectorAll<HTMLElement>('[data-selector-key]')) {
    if (chip.dataset['selectorKey'] === key) {
      chip.focus();
      return;
    }
  }
}

export function useAddSelectorField({
  selectors,
  suggestions,
  activeSelector,
  busy,
  onSelect,
  onDeselect,
  onAdd,
  shown,
  removeChip,
}: Pick<SelectorPickerProps, 'selectors' | 'suggestions' | 'activeSelector' | 'busy' | 'onSelect' | 'onDeselect' | 'onAdd'> & {
  readonly shown: readonly ClassifiedSelector[];
  readonly removeChip: (entry: ClassifiedSelector, focus: 'chip' | 'stay') => boolean;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [moved, setHighlight] = useState(-1);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [inputOpen, setInputOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wantFocus = useRef(false);
  const restoreRef = useRef<string | undefined>(undefined);
  const pressWatch = useRef<PressWatch | undefined>(undefined);

  useEffect(() => {
    const watch = createPressWatch(window);
    pressWatch.current = watch;
    return watch.dispose;
  }, []);

  const showInput = inputOpen;
  const filtered = useSelectorSuggestions({ selectors, suggestions, draft });
  const typed = typedDraft(draft, selectedElementTag());
  const list = selectorRows({ typed, filtered, selectors });
  const highlight = classRowStep(moved, list);
  const refusal = refused === draft.trim();
  const showList = open && list.rows.length > 0;

  useHighlightInView({ listRef, highlight, showList });

  useEffect(() => {
    if (showInput && wantFocus.current) {
      wantFocus.current = false;
      inputRef.current?.focus();
    }
  }, [showInput]);

  useEffect(
    () =>
      onSelectorFocusRequest(() => {
        if (busy) {
          return;
        }
        if (inputRef.current) {
          inputRef.current.focus();
          return;
        }
        wantFocus.current = true;
        setInputOpen(true);
      }),
    [busy],
  );

  const onWellMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!wellMouseDown(event, { busy, inputRef }, restoreRef)) {
      return;
    }
    const input = inputRef.current;
    if (input) {
      input.focus();
    } else {
      wantFocus.current = true;
      setInputOpen(true);
    }
  };
  const apply = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    restoreRef.current = undefined;
    onAdd(trimmed, PLACEMENT_END);
    setDraft('');
    setOpen(false);
    setHighlight(-1);
  };
  const onFocus = () => {
    pressWatch.current?.cancel();
    setInputOpen(true);
    restoreRef.current = activeSelector || undefined;
    onDeselect();
    setOpen(true);
  };
  const onBlur = () => {
    setOpen(false);
    setDraft('');
    setHighlight(-1);
    pressWatch.current?.whenPressEnds(() => setInputOpen(false));
    if (restoreRef.current) {
      onSelect(restoreRef.current);
      restoreRef.current = undefined;
    }
  };
  const onCaretKey = (key: string): boolean => {
    if (draft !== '') {
      return false;
    }
    if (key !== 'Backspace') {
      return false;
    }
    const index = chipAtCaret(shown.length, shown.length, key);
    const entry = index === undefined ? undefined : shown[index];
    if (entry === undefined) {
      return false;
    }
    assert(index === shown.length - 1, 'onCaretKey: Backspace takes the last chip');
    return removeChip(entry, 'stay');
  };
  const add = { draft, setDraft, open, setOpen, highlight, setHighlight, typed, list, refusal, setRefused, showList };
  return { add, showInput, listRef, inputRef, onWellMouseDown, apply, onFocus, onBlur, onCaretKey };
}

export function wellMouseDown(
  event: ReactMouseEvent<HTMLDivElement>,
  well: { busy: boolean; inputRef: React.RefObject<HTMLInputElement> },
  restoreRef: React.MutableRefObject<string | undefined>,
): boolean {
  if (well.busy) {
    return false;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('.embed-editor_selector-chip')) {
    restoreRef.current = undefined;
    return false;
  }
  if (target.closest('.embed-editor_selector-suggest')) {
    return false;
  }
  const input = well.inputRef.current;
  if (input && target === input) {
    return false;
  }
  event.preventDefault();
  return true;
}

export type SelectorView = ReturnType<typeof useSelectorView>;

export function useSelectorView({
  selectors,
  activeSelector,
  activePicked,
  onVisibleSelectorsChange,
}: Pick<SelectorPickerProps, 'selectors' | 'activeSelector' | 'activePicked'> & {
  onVisibleSelectorsChange: SelectorPickerProps['onVisibleSelectorsChange'] | undefined;
}) {
  const [filters, setFilters] = useState(loadSelectorFilters);
  const updateFilters = (next: SelectorFilters): void => {
    setFilters(next);
    saveSelectorFilters(next);
  };
  const showGlobals = !filters.hideGlobals;
  const showInherited = !filters.hideInherited;
  const classified = useMemo(() => selectors.map(classifySelector), [selectors]);
  const globals = useMemo(() => classified.filter((entry) => entry.global), [classified]);
  const inherited = useMemo(() => classified.filter((entry) => entry.inherited), [classified]);
  const shownSelectors = useMemo(
    () =>
      classified.filter((entry) => {
        const picked = activePicked && selectorsMatch(entry.selector.text, activeSelector);
        const globalVisible = !entry.global || showGlobals;
        const inheritedVisible = !entry.inherited || showInherited;
        return picked || (globalVisible && inheritedVisible);
      }),
    [classified, showGlobals, showInherited, activeSelector, activePicked],
  );
  const visibleSelectorTexts = useMemo(() => shownSelectors.map((entry) => entry.selector.text), [shownSelectors]);
  useEffect(() => {
    onVisibleSelectorsChange?.(visibleSelectorTexts);
  }, [onVisibleSelectorsChange, visibleSelectorTexts]);
  return {
    globals,
    inherited,
    shownSelectors,
    filters,
    setHideGlobals: (hideGlobals: boolean) => updateFilters({ ...filters, hideGlobals }),
    setHideInherited: (hideInherited: boolean) => updateFilters({ ...filters, hideInherited }),
  };
}

export function useSelectorSuggestions({
  selectors,
  suggestions,
  draft,
}: Pick<SelectorPickerProps, 'selectors' | 'suggestions'> & { draft: string }): RankedSuggestion[] {
  const projectClasses = useProjectClasses();
  const query = draft.trim();
  const chipKeys = useMemo(() => new Set(selectors.map((entry) => selectorKey(entry.text))), [selectors]);
  return useMemo(() => rankedSuggestions({ query, own: suggestions, projectClasses, chipKeys }), [suggestions, projectClasses, query, chipKeys]);
}

export type TypedDraft =
  | { readonly kind: 'class'; readonly name: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'selector' };

const BARE_WORD = /^[^\s.:#[\]>+~,*&(){}|\\@]+$/;

export function typedDraft(draft: string, elementTag: string | undefined): TypedDraft {
  const typed = typedSelectorText(draft, elementTag);
  if (typed.includes('{')) {
    return { kind: 'selector' };
  }
  const lone = loneTypedClass(typed);
  if (lone !== undefined && typed === `.${lone}`) {
    return isClassName(lone) ? { kind: 'class', name: lone } : { kind: 'invalid' };
  }
  if (BARE_WORD.test(typed)) {
    return isClassName(typed) ? { kind: 'selector' } : { kind: 'invalid' };
  }
  return { kind: 'selector' };
}

function selectorRows(inputs: {
  readonly typed: TypedDraft;
  readonly filtered: readonly RankedSuggestion[];
  readonly selectors: SelectorPickerProps['selectors'];
}): ClassRowList<RankedSuggestion> {
  const { typed, filtered, selectors } = inputs;
  const name = typed.kind === 'class' ? typed.name : undefined;
  return classRows({
    name,
    matches: filtered,
    nameOf: (suggestion) => (suggestion.selector.startsWith('.') ? suggestion.selector.slice(1) : undefined),
    carried: name === undefined ? false : hasClassChip(selectors, name),
    restPlain: -1,
  });
}

function hasClassChip(selectors: SelectorPickerProps['selectors'], name: string): boolean {
  const key = selectorKey(`.${name}`);
  return selectors.some((entry) => selectorKey(entry.text) === key);
}

export type RankedSuggestion = SelectorSuggestion & { readonly hits: readonly number[] };

export function rankedSuggestions(inputs: {
  readonly query: string;
  readonly own: readonly SelectorSuggestion[];
  readonly projectClasses: readonly string[];
  readonly chipKeys: ReadonlySet<string>;
}): RankedSuggestion[] {
  const { query, chipKeys } = inputs;
  const needle = query.startsWith('.') ? query.slice(1) : query;
  const ownFree = inputs.own.filter((suggestion) => !chipKeys.has(selectorKey(suggestion.selector)));
  if (!query) {
    return ownFree.map((suggestion) => ({ ...suggestion, hits: [] }));
  }
  const own = needle
    ? rankFuzzy(needle, ownFree, { limit: ownFree.length }, dotless).map(({ item, hit }) => withHits(item, hit.indexes))
    : ownFree.map((item) => withHits(item, []));
  const taken = new Set(own.map((suggestion) => suggestion.selector));
  const candidates = inputs.projectClasses.filter((name) => {
    const selector = `.${name}`;
    return !taken.has(selector) && !chipKeys.has(selectorKey(selector));
  });
  const extra = needle
    ? rankFuzzy(needle, candidates, { limit: PROJECT_CLASS_LIMIT }, (name) => name).map(({ item, hit }) =>
        withHits({ selector: `.${item}`, kind: 'class' }, hit.indexes),
      )
    : candidates.slice(0, PROJECT_CLASS_LIMIT).map((name) => withHits({ selector: `.${name}`, kind: 'class' }, []));
  assert(extra.length <= PROJECT_CLASS_LIMIT, 'rankedSuggestions: project classes are capped');
  return [...own, ...extra];
}

function dotless(suggestion: SelectorSuggestion): string {
  return suggestion.selector.startsWith('.') ? suggestion.selector.slice(1) : suggestion.selector;
}

function withHits(suggestion: SelectorSuggestion, indexes: readonly number[]): RankedSuggestion {
  const offset = suggestion.selector.startsWith('.') ? 1 : 0;
  return { ...suggestion, hits: indexes.map((index) => index + offset) };
}

export function SelectorChips({
  chipsRef,
  entries,
  activeSelector,
  busy,
  onSelect,
  onDeselect,
  onRemove,
  inline,
  children,
}: {
  chipsRef?: React.RefObject<HTMLDivElement> | undefined;
  entries: readonly ClassifiedSelector[];
  inline?: InlineChip | undefined;
  activeSelector: string;
  busy: boolean;
  onSelect: (selector: string) => void;
  onDeselect: () => void;
  onRemove?: (entry: ClassifiedSelector) => void;
  children?: React.ReactNode;
}) {
  const deselectable = usePseudoTarget() === undefined;
  return (
    <div ref={chipsRef} className="embed-editor_selector-chips">
      {entries.map((entry) => (
        <SelectorChip
          key={entry.selector.key}
          entry={entry}
          activeSelector={activeSelector}
          busy={busy}
          deselectable={deselectable}
          onSelect={onSelect}
          onDeselect={onDeselect}
          onRemove={onRemove}
        />
      ))}
      {inline === undefined ? undefined : <InlineStyleChip chip={inline} busy={busy} />}
      {children === undefined ? undefined : <div className="embed-editor_selector-caret-slot">{children}</div>}
    </div>
  );
}

function SelectorChip({
  entry,
  activeSelector,
  busy,
  deselectable,
  onSelect,
  onDeselect,
  onRemove,
}: {
  readonly entry: ClassifiedSelector;
  readonly activeSelector: string;
  readonly busy: boolean;
  readonly deselectable: boolean;
  readonly onSelect: (selector: string) => void;
  readonly onDeselect: () => void;
  readonly onRemove: ((entry: ClassifiedSelector) => void) | undefined;
}) {
  const translate = useTranslate();
  const selectorText = entry.selector;
  const active = selectorsMatch(selectorText.text, activeSelector);
  const state: ChipState = { active, dimmed: selectorText.inContext === false, deselectable };
  const label = selectorText.display ?? selectorText.text;
  const [truncated, setTruncated] = useState(false);
  const { ref, hoverProps, hide, tip } = useHoverTip<HTMLButtonElement>(<SelectorChipTip label={label} hint={chipHint(entry, state, translate)} />);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={chipClassName(entry, state)}
        data-selector-key={entry.selector.key}
        disabled={busy}
        aria-pressed={active}
        aria-label={selectorAccessibleLabel(entry, label)}
        onMouseEnter={(event) => {
          const text = event.currentTarget.firstElementChild;
          const cut = text !== null && chipTruncated(text);
          setTruncated(cut);
          if (cut) {
            hoverProps.onMouseEnter?.();
          }
        }}
        onMouseLeave={hoverProps.onMouseLeave}
        onClick={() => {
          hide();
          if (!active) {
            onSelect(selectorText.text);
          } else if (deselectable) {
            onDeselect();
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) {
            return;
          }
          onRemove?.(entry);
        }}
        title={truncated ? undefined : chipTitle(label, entry, state, translate)}
      >
        {}
        <span className="embed-editor_selector-chip-text">
          <bdi dir="ltr">{label}</bdi>
        </span>
      </button>
      {tip}
    </>
  );
}

export function chipTruncated(text: Pick<Element, 'scrollWidth' | 'clientWidth'>): boolean {
  return text.scrollWidth > text.clientWidth;
}

function SelectorChipTip({ label, hint }: { readonly label: string; readonly hint: string | undefined }): ReactNode {
  return (
    <>
      <CodeInline text={label} language="css" className="embed-editor_selector-tip-code" />
      {hint === undefined ? undefined : <div className="u-prop-tip-note">{hint}</div>}
    </>
  );
}

export interface ChipState {
  readonly active: boolean;
  readonly dimmed: boolean;
  readonly deselectable?: boolean;
}

export function chipClassName(entry: ClassifiedSelector, state: ChipState): string {
  return [
    'embed-editor_selector-chip',
    `is-${entry.kind}`,
    state.active && 'is-active',
    entry.selector.pending && 'is-pending',
    entry.selector.inComponentMarkup === true && 'is-component',
    entry.selector.fromInstance === true && 'is-instance',
    entry.global && 'is-global',
    entry.inherited && 'is-inherited',
    state.dimmed && 'is-dimmed',
  ]
    .filter(Boolean)
    .join(' ');
}

export function chipTitle(label: string, entry: ClassifiedSelector, state: ChipState, translate: Translator = ENGLISH_TRANSLATE): string {
  const hint = chipHint(entry, state, translate);
  return hint === undefined ? label : `${label} — ${hint}`;
}

export function chipHint(entry: ClassifiedSelector, state: ChipState, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  if (state.active) {
    return state.deselectable === false ? undefined : translate('styleModel.embed.picker.chipDeselect');
  }
  if (state.dimmed) {
    return translate('styleModel.embed.picker.chipOtherQuery');
  }
  if (entry.selector.fromInstance === true) {
    return entry.selector.pending ? translate('styleModel.embed.picker.chipInstancePending') : translate('styleModel.embed.picker.chipInstance');
  }
  return entry.selector.pending ? translate('styleModel.embed.picker.chipPending') : undefined;
}

export interface AddSelectorState {
  draft: string;
  setDraft: (draft: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  highlight: number;
  setHighlight: (index: number) => void;
  typed: TypedDraft;
  list: ClassRowList<RankedSuggestion>;
  refusal: boolean;
  setRefused: (text: string) => void;
  showList: boolean;
}

export function SelectorAddField({
  add,
  inputRef,
  listRef,
  busy,
  inTabOrder,
  onFocus,
  onBlur,
  apply,
  onCaretKey,
}: {
  add: AddSelectorState;
  inputRef: React.RefObject<HTMLInputElement>;
  listRef: React.RefObject<HTMLDivElement>;
  busy: boolean;
  inTabOrder: boolean;
  onFocus: () => void;
  onBlur: () => void;
  apply: (text: string) => void;
  onCaretKey?: (key: string) => boolean;
}) {
  const translate = useTranslate();
  const { draft, setHighlight, showList } = add;
  return (
    <div className="embed-editor_selector-field">
      <input
        ref={inputRef}
        className="u-input embed-editor_selector-add"
        value={draft}
        placeholder={translate('styleModel.embed.picker.addPlaceholder', { example: '.card:hover' })}
        spellCheck={false}
        disabled={busy}
        tabIndex={inTabOrder ? 0 : -1}
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-invalid={add.refusal || undefined}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => {
          add.setDraft(event.target.value);
          add.setOpen(true);
          setHighlight(-1);
        }}
        onKeyDown={(event) => {
          if (onCaretKey?.(event.key) === true) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          selectorKeyDown(event, add, apply);
        }}
        aria-label={translate('styleModel.embed.picker.addLabel')}
      />
      {}
      <ErrorToast message={add.refusal ? translate('styleModel.embed.picker.classRefusal') : undefined} />
      {showList ? <SelectorSuggestions add={add} listRef={listRef} apply={apply} /> : undefined}
    </div>
  );
}

export function selectorKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, add: AddSelectorState, apply: (text: string) => void) {
  const { highlight, list, showList } = add;
  if (event.key === 'ArrowRight' && add.draft === '') {
    const host = getHost();
    const prefix = parentClassPrefix(host.nodes, host.selectedId);
    if (prefix !== undefined) {
      event.preventDefault();
      add.setDraft(prefix);
      add.setOpen(true);
      add.setHighlight(-1);
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    add.setOpen(true);
    add.setHighlight(classRowStep(highlight + 1, list));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    add.setHighlight(classRowStep(highlight - 1, list));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const row = showList ? list.rows[highlight] : undefined;
    if (row !== undefined) {
      apply(selectorRowText(row));
    } else if (add.typed.kind === 'invalid') {
      add.setRefused(add.draft.trim());
      add.setOpen(true);
    } else {
      apply(typedSelectorText(add.draft, selectedElementTag()));
    }
  } else if (event.key === 'Tab') {
    const pick = classRowMatch(list, highlight);
    if (showList && pick) {
      event.preventDefault();
      add.setDraft(pick.selector);
      add.setHighlight(-1);
    }
  } else if (event.key === 'Escape' && add.open) {
    event.preventDefault();
    add.setOpen(false);
    add.setHighlight(-1);
  }
}

export function SelectorFilterToggles({ view, pending = false }: { view: SelectorView; pending?: boolean }) {
  const translate = useTranslate();
  const { globals, inherited } = view;
  return (
    <>
      <label className="embed-editor_check embed-editor_selector-filter" title={translate('styleModel.embed.picker.hideGlobalsTip')}>
        <input type="checkbox" checked={view.filters.hideGlobals} onChange={(event) => view.setHideGlobals(event.target.checked)} />
        {pending ? (
          <PendingCount label={translate('styleModel.embed.picker.hideGlobalsPending')} />
        ) : (
          <span>{translate('styleModel.embed.picker.hideGlobals', { count: globals.length })}</span>
        )}
      </label>
      <label className="embed-editor_check embed-editor_selector-filter" title={translate('styleModel.embed.picker.hideInheritedTip')}>
        <input type="checkbox" checked={view.filters.hideInherited} onChange={(event) => view.setHideInherited(event.target.checked)} />
        {pending ? (
          <PendingCount label={translate('styleModel.embed.picker.hideInheritedPending')} />
        ) : (
          <span>{translate('styleModel.embed.picker.hideInherited', { count: inherited.length })}</span>
        )}
      </label>
    </>
  );
}

function PendingCount({ label }: { readonly label: string }) {
  return (
    <span className="embed-editor_selector-filter-pending">
      {label} <Skeleton width="1.25rem" />
    </span>
  );
}

export function asQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) {
    return trimmed;
  }
  return trimmed.startsWith('(') ? `@media ${trimmed}` : `@media (${trimmed})`;
}

export const ADD_QUERY = '\0add-query';

export const PlusIcon = centralIcon(centralAdd, 12);

export const queryModes = (translate: Translator): SegmentedOption<'wrap' | 'nest'>[] => [
  {
    value: 'wrap',
    label: translate('styleModel.embed.query.wrap'),
    tooltip: translate('styleModel.embed.query.wrapTip', { code: '@query { selector { … } }' }),
  },
  {
    value: 'nest',
    label: translate('styleModel.embed.query.nest'),
    tooltip: translate('styleModel.embed.query.nestTip', { code: 'selector { @query { … } }' }),
  },
];

export type QuerySuggestion = { query: string; kind: string };

export const COMMON_QUERIES: QuerySuggestion[] = [
  { query: '@media (hover: hover)', kind: 'hover' },
  { query: '@media (pointer: coarse)', kind: 'touch' },
  { query: '@media (pointer: fine)', kind: 'pointer' },
  { query: '@media (prefers-color-scheme: dark)', kind: 'dark mode' },
  { query: '@media (prefers-color-scheme: light)', kind: 'light mode' },
  { query: '@media (prefers-reduced-motion: reduce)', kind: 'reduced motion' },
  { query: '@media (prefers-contrast: more)', kind: 'contrast' },
  { query: '@media (orientation: landscape)', kind: 'orientation' },
  { query: '@media (orientation: portrait)', kind: 'orientation' },
  { query: '@media (min-aspect-ratio: 16 / 9)', kind: 'aspect ratio' },
  { query: '@container (width < 50em)', kind: 'container' },
  { query: '@container (width > 30em)', kind: 'container' },
  { query: '@media (min-width: 48em)', kind: 'width' },
  { query: '@media (max-width: 47.99em)', kind: 'width' },
  { query: '@supports (display: grid)', kind: 'supports' },
];

export interface QueryComboProps {
  draft: string;
  setDraft: (next: string) => void;
  onSubmit: (query: string) => void;
  onCancel: () => void;
  suggestions: QuerySuggestion[];
  ariaLabel: string;
  initial?: string;
  selectOnFocus?: boolean;
}

function SelectorSuggestions({
  add,
  listRef,
  apply,
}: {
  readonly add: AddSelectorState;
  readonly listRef: React.RefObject<HTMLDivElement>;
  readonly apply: (text: string) => void;
}) {
  const translate = useTranslate();
  const { list, highlight, setHighlight } = add;
  return (
    <Popup
      mode="popover"
      portal={false}
      onClose={() => add.setOpen(false)}
      className="embed-editor_selector-suggest"
      ref={listRef}
      role="listbox"
      label={translate('styleModel.embed.picker.suggestions')}
    >
      {list.rows.map((row, i) => (
        <button
          key={row.kind === 'create' ? `create:${row.name}` : `${row.item.kind}:${row.item.selector}`}
          type="button"
          role="option"
          aria-selected={i === highlight}
          className={`embed-editor_suggest-item ${i === highlight ? 'is-active' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => setHighlight(i)}
          onClick={() => apply(selectorRowText(row))}
        >
          <SelectorRowLabel row={row} />
        </button>
      ))}
    </Popup>
  );
}

function selectorRowText(row: ClassRow<RankedSuggestion>): string {
  return row.kind === 'create' ? `.${row.name}` : row.item.selector;
}

function SelectorRowLabel({ row }: { readonly row: ClassRow<RankedSuggestion> }) {
  const translate = useTranslate();
  if (row.kind === 'create') {
    return (
      <>
        <span className="embed-editor_suggest-sel">{translate('styleModel.embed.picker.create', { name: row.name })}</span>
        <span className="embed-editor_suggest-kind">{translate(SUGGESTION_KIND_LABEL_KEY.class)}</span>
      </>
    );
  }
  const suggestion = row.item;
  return (
    <>
      <span className="embed-editor_suggest-sel">
        {fuzzySegments(suggestion.selector, suggestion.hits).map((segment, index) =>
          segment.hit ? (
            <mark key={index} className="embed-editor_suggest-hit">
              {segment.text}
            </mark>
          ) : (
            segment.text
          ),
        )}
      </span>
      <span className="embed-editor_suggest-kind">{translate(SUGGESTION_KIND_LABEL_KEY[suggestion.kind])}</span>
    </>
  );
}

function selectedElementTag(): string | undefined {
  const host = getHost();
  if (host.selectedId === undefined) {
    return undefined;
  }
  const node = findNode(host.nodes, host.selectedId);
  return node?.kind === 'element' ? node.name : undefined;
}
