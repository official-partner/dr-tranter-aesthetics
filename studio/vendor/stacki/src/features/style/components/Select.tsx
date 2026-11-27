import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { menuPlacement, menuWidthMaxPx, panelBounds } from '../model/panelBox';
import { assert } from '../../../../shared/core/assert';
import { isHTMLElementInDocument } from '../model/dom';
import { endDragNotes, hoverNote } from '../../../ui/sound';
import { type SelectOption, type Props } from './selectTypes';
import { SelectTrigger, SelectList } from './SelectViews';

export { type SelectOption } from './selectTypes';

export default function Select<T extends string>(props: Props<T>) {
  const select = useSelectState(props);
  const { open, refs } = select;
  const keys = selectKeyHandlers(select);
  const toggle = () => (open ? select.cancelMenu() : select.openMenu());
  return (
    <div ref={refs.root} className={selectClass(props, { open })}>
      <SelectTrigger
        props={props}
        selectedOption={select.selectedOption}
        open={open}
        buttonRef={refs.button}
        onToggle={toggle}
        onKeyDown={keys.onButtonKeyDown}
      />
      {open ? (
        <SelectList
          props={props}
          listRef={refs.list}
          searchRef={refs.search}
          trigger={refs.button.current ?? undefined}
          dropUp={select.dropUp}
          baseId={select.baseId}
          displayed={select.displayed}
          activeIndex={select.activeIndex}
          query={select.query}
          onQuery={select.setQuery}
          onListKeyDown={keys.onListKeyDown}
          onSearchKeyDown={keys.onSearchKeyDown}
          onActivate={select.setActiveIndex}
          onLeave={select.pausePreview}
          onChoose={select.choose}
          onCancel={select.cancelMenu}
        />
      ) : undefined}
    </div>
  );
}

function useSelectState<T extends string>(props: Props<T>) {
  const { value, options, searchable = false, variant = 'default' } = props;
  const baseId = useId();
  const refs = useSelectRefs();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const optionsState = useSelectOptions({ options, value, query, searchable });
  const { selectedOption, displayed, firstSelectable, lastSelectable, selectedIndex } = optionsState;
  const highlight = usePreviewHighlight(selectedIndex);
  const { activeIndex, activity: previewActivity, activateIndex, sourceRef } = highlight;

  const preview = useHoverPreview({
    open,
    activity: previewActivity,
    activeIndex,
    displayed,
    value,
    props,
  });
  const { cancelPreview } = preview;
  const { cancelMenu, pausePreview } = usePreviewDismiss({
    setOpen,
    pausePreviewActivity: highlight.pause,
    cancelPreview,
  });
  useHighlightSound({ open, activeIndex, displayed });
  const menu = useMenuActions({
    props,
    refs,
    displayed,
    selectedIndex,
    setActiveIndex: activateIndex,
    setOpen,
  });
  const choose = (index: number) => menu.choose(index, preview.commit);
  const runTypeahead = useTypeahead(activeIndex, displayed, activateIndex);
  useMenuResets({
    open,
    query,
    searchable,
    selectedIndex,
    firstSelectable,
    setActiveIndex: activateIndex,
    setQuery,
  });
  const dropUp = useListPlacement({ open, activeIndex, query, variant, refs, sourceRef });
  return {
    open,
    setOpen,
    refs,
    baseId,
    searchable,
    selectedOption,
    displayed,
    firstSelectable,
    lastSelectable,
    activeIndex,
    setActiveIndex: activateIndex,
    query,
    setQuery,
    dropUp,
    choose,
    cancelMenu,
    pausePreview,
    openMenu: menu.openMenu,
    move: menu.move,
    runTypeahead,
  };
}

const LIST_EDGE_PX = 8;
const LIST_TRIGGER_GAP_PX = 8;

type PreviewActivity = 'active' | 'paused';
type HighlightSource = 'keyboard' | 'pointer';

function usePreviewDismiss({
  setOpen,
  pausePreviewActivity,
  cancelPreview,
}: {
  readonly setOpen: (open: boolean) => void;
  readonly pausePreviewActivity: () => void;
  readonly cancelPreview: () => void;
}) {
  const cancelMenu = useCallback(() => {
    setOpen(false);
    cancelPreview();
  }, [cancelPreview, setOpen]);
  const pausePreview = useCallback(() => {
    pausePreviewActivity();
    cancelPreview();
  }, [cancelPreview, pausePreviewActivity]);
  return { cancelMenu, pausePreview };
}

function usePreviewHighlight(selectedIndex: number) {
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [activity, setActivity] = useState<PreviewActivity>('active');
  const sourceRef = useRef<HighlightSource>('keyboard');
  const activateIndex = useCallback((index: number, source: HighlightSource = 'keyboard') => {
    sourceRef.current = source;
    setActivity('active');
    setActiveIndex(index);
  }, []);
  const pause = useCallback(() => setActivity('paused'), []);
  return { activeIndex, activity, activateIndex, pause, sourceRef };
}

function useSelectOptions<T extends string>({
  options,
  value,
  query,
  searchable,
}: {
  readonly options: SelectOption<T>[];
  readonly value: T;
  readonly query: string;
  readonly searchable: boolean;
}) {
  const selectedOption = useMemo(
    () =>
      options.find((option) => !option.heading && option.value === value) ??
      options.find((option) => !option.heading && option.header !== true && option.footer !== true),
    [options, value],
  );
  const displayed = useMemo(() => filterOptions(options, query, { searchable }), [options, query, searchable]);
  const { firstSelectable, lastSelectable } = selectableBounds(displayed);
  const found = displayed.findIndex((option) => !option.heading && option.value === value);
  const selectedIndex = found >= 0 ? found : firstSelectable;
  return { selectedOption, displayed, firstSelectable, lastSelectable, selectedIndex };
}

function useSelectRefs(): SelectRefs {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  return useMemo(() => ({ root, button, list, search }), []);
}

type SelectRefs = {
  readonly root: RefObject<HTMLDivElement>;
  readonly button: RefObject<HTMLButtonElement>;
  readonly list: RefObject<HTMLDivElement>;
  readonly search: RefObject<HTMLInputElement>;
};

function selectClass<T extends string>(props: Props<T>, state: { readonly open: boolean }) {
  return ['u-select', props.variant === 'link' ? 'is-link' : '', state.open ? 'is-open' : '', props.disabled ? 'is-disabled' : '', props.className]
    .filter(Boolean)
    .join(' ');
}

function filterOptions<T extends string>(options: SelectOption<T>[], query: string, mode: { readonly searchable: boolean }): SelectOption<T>[] {
  if (!mode.searchable || !query.trim()) {
    return options;
  }
  const normalized = query.trim().toLowerCase();
  const out: SelectOption<T>[] = [];
  let heading: SelectOption<T> | undefined;
  let headingMatches = false;
  let headingPushed = false;
  for (const option of options) {
    if (option.heading) {
      heading = option;
      headingMatches = option.label.toLowerCase().includes(normalized);
      headingPushed = false;
      if (headingMatches) {
        out.push(option);
        headingPushed = true;
      }
      continue;
    }
    if (headingMatches || option.label.toLowerCase().includes(normalized)) {
      if (heading && !headingPushed) {
        out.push(heading);
        headingPushed = true;
      }
      out.push(option);
    }
  }
  return out;
}

function selectableBounds<T extends string>(displayed: SelectOption<T>[]) {
  const firstSelectable = Math.max(
    0,
    displayed.findIndex((option) => !option.heading),
  );
  let lastSelectable = 0;
  for (let i = displayed.length - 1; i >= 0; i -= 1) {
    if (!displayed[i]?.heading) {
      lastSelectable = i;
      break;
    }
  }
  return { firstSelectable, lastSelectable };
}

function useHoverPreview<T extends string>({
  open,
  activity,
  activeIndex,
  displayed,
  value,
  props,
}: {
  open: boolean;
  activity: PreviewActivity;
  activeIndex: number;
  displayed: SelectOption<T>[];
  value: T;
  props: Props<T>;
}) {
  const onPreviewRef = useRef(props.onPreview);
  onPreviewRef.current = props.onPreview;
  const shownRef = useRef<T | undefined>(undefined);
  const emittedRef = useRef(false);
  const wantedRef = useRef<T | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const dropFrame = useCallback(() => {
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    wantedRef.current = undefined;
  }, []);
  const flush = useCallback(() => {
    frameRef.current = undefined;
    const wanted = wantedRef.current;
    wantedRef.current = undefined;
    if (wanted === undefined || wanted === shownRef.current) {
      return;
    }
    shownRef.current = wanted;
    emittedRef.current = true;
    onPreviewRef.current?.(wanted);
  }, []);
  const cancelPreview = useCallback(() => {
    dropFrame();
    shownRef.current = undefined;
    if (!emittedRef.current) {
      return;
    }
    emittedRef.current = false;
    onPreviewRef.current?.(undefined);
  }, [dropFrame]);
  const commit = useCallback(() => {
    dropFrame();
    shownRef.current = undefined;
    emittedRef.current = false;
  }, [dropFrame]);

  useEffect(() => {
    if (!open || activity === 'paused' || !onPreviewRef.current) {
      return;
    }
    const option = displayed[activeIndex];
    if (!option || option.heading) {
      return;
    }
    if (shownRef.current === undefined) {
      shownRef.current = value;
    }
    wantedRef.current = option.value;
    if (option.value !== shownRef.current && frameRef.current === undefined) {
      frameRef.current = window.requestAnimationFrame(flush);
    }
  }, [open, activity, activeIndex, displayed, value, flush]);

  useEffect(
    () => () => {
      dropFrame();
      if (emittedRef.current) {
        onPreviewRef.current?.(undefined);
      }
    },
    [dropFrame],
  );
  return { cancelPreview, commit };
}

function useHighlightSound<T extends string>({
  open,
  activeIndex,
  displayed,
}: {
  readonly open: boolean;
  readonly activeIndex: number;
  readonly displayed: SelectOption<T>[];
}): void {
  const placedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      if (placedRef.current) {
        placedRef.current = false;
        endDragNotes();
      }
      return;
    }
    if (!placedRef.current) {
      placedRef.current = true;
      return;
    }
    if (displayed[activeIndex]) {
      hoverNote(activeIndex, displayed.length);
    }
  }, [open, activeIndex, displayed]);
}

type MenuActionsInput<T extends string> = {
  readonly props: Props<T>;
  readonly refs: SelectRefs;
  readonly displayed: SelectOption<T>[];
  readonly selectedIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly setOpen: (open: boolean) => void;
};

function useMenuActions<T extends string>(input: MenuActionsInput<T>) {
  const { props, refs, displayed, selectedIndex, setActiveIndex, setOpen } = input;
  const { disabled, searchable = false, onChange } = props;
  const openMenu = useCallback(
    (index = selectedIndex) => {
      if (disabled) {
        return;
      }
      setActiveIndex(firstRealRow(displayed, clampIndex(index, displayed.length)));
      setOpen(true);
      window.requestAnimationFrame(() => (searchable ? refs.search.current : refs.list.current)?.focus({ preventScroll: true }));
    },
    [disabled, displayed, selectedIndex, searchable, refs, setActiveIndex, setOpen],
  );

  const choose = useCallback(
    (index: number, commitPreview: () => void) => {
      const option = displayed[index];
      if (!option || option.heading) {
        return;
      }
      commitPreview();
      onChange(option.value);
      if (option.switch === true) {
        return;
      }
      setOpen(false);
      window.requestAnimationFrame(() => refs.button.current?.focus({ preventScroll: true }));
    },
    [displayed, onChange, refs, setOpen],
  );

  const move = useCallback(
    (from: number, direction: number) => {
      const count = displayed.length;
      if (count === 0) {
        return;
      }
      for (let step = 1; step <= count; step += 1) {
        const i = (((from + direction * step) % count) + count) % count;
        if (!displayed[i]?.heading) {
          setActiveIndex(i);
          return;
        }
      }
    },
    [displayed, setActiveIndex],
  );
  return { openMenu, choose, move };
}

function firstRealRow<T extends string>(displayed: SelectOption<T>[], start: number): number {
  if (!displayed[start]?.heading) {
    return start;
  }
  for (let step = 1; step <= displayed.length; step += 1) {
    const i = (start + step) % displayed.length;
    if (!displayed[i]?.heading) {
      return i;
    }
  }
  return start;
}

function useTypeahead<T extends string>(activeIndex: number, displayed: SelectOption<T>[], setActiveIndex: (index: number) => void) {
  const typeahead = useRef('');
  const typeaheadTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (typeaheadTimer.current !== undefined) {
        window.clearTimeout(typeaheadTimer.current);
      }
    },
    [],
  );
  return useCallback(
    (key: string): boolean => {
      if (key.length !== 1 || !/\S/.test(key)) {
        return false;
      }
      if (typeaheadTimer.current !== undefined) {
        window.clearTimeout(typeaheadTimer.current);
      }
      const typed = `${typeahead.current}${key}`.toLowerCase();
      typeahead.current = typed;
      typeaheadTimer.current = window.setTimeout(() => {
        typeahead.current = '';
        typeaheadTimer.current = undefined;
      }, 500);
      const start = (activeIndex + (typed.length === 1 ? 1 : 0)) % displayed.length;
      for (let i = 0; i < displayed.length; i += 1) {
        const index = (start + i) % displayed.length;
        const option = displayed[index];
        if (option && !option.heading && option.label.toLowerCase().startsWith(typed)) {
          setActiveIndex(index);
          return true;
        }
      }
      return false;
    },
    [activeIndex, displayed, setActiveIndex],
  );
}

function useMenuResets({
  open,
  query,
  searchable,
  selectedIndex,
  firstSelectable,
  setActiveIndex,
  setQuery,
}: {
  readonly open: boolean;
  readonly query: string;
  readonly searchable: boolean;
  readonly selectedIndex: number;
  readonly firstSelectable: number;
  readonly setActiveIndex: (index: number) => void;
  readonly setQuery: (query: string) => void;
}): void {
  useEffect(() => {
    if (!open) {
      setActiveIndex(selectedIndex);
    }
  }, [selectedIndex, open, setActiveIndex]);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open, setQuery]);

  useEffect(() => {
    if (open && searchable) {
      setActiveIndex(firstSelectable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a stale firstSelectable is intended.
  }, [query]);
}

function useListPlacement({
  open,
  activeIndex,
  query,
  variant,
  refs,
  sourceRef,
}: {
  readonly open: boolean;
  readonly activeIndex: number;
  readonly query: string;
  readonly variant: 'default' | 'link';
  readonly refs: SelectRefs;
  readonly sourceRef: RefObject<HighlightSource>;
}): boolean {
  const [dropUp, setDropUp] = useState(false);
  const wasOpenRef = useRef(false);
  const { root: rootRef, list: listRef } = refs;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const trigger = rootRef.current;
    const opening = !wasOpenRef.current;
    wasOpenRef.current = true;
    if (trigger && list) {
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const region = scrollRegionOf(list);
      const natural = region === list ? list.offsetHeight : list.offsetHeight - region.clientHeight + region.scrollHeight;
      const up = spaceBelow < natural + LIST_EDGE_PX && spaceAbove > spaceBelow;
      setDropUp(up);
      if (region !== list) {
        list.style.setProperty('--select-room', `${Math.max(0, Math.floor((up ? spaceAbove : spaceBelow) - LIST_EDGE_PX - LIST_TRIGGER_GAP_PX))}px`);
      }
      if (variant === 'link') {
        clampLinkMenu(trigger, list);
      }
    }
    if (list && (opening || sourceRef.current !== 'pointer')) {
      scrollActiveIntoList(list, { opening });
    }
  }, [open, activeIndex, query, variant, rootRef, listRef, sourceRef]);
  useKeepScroll({ open }, listRef);
  return dropUp;
}

function clampLinkMenu(trigger: HTMLDivElement, listElement: HTMLDivElement): void {
  const bounds = panelBounds(trigger);
  listElement.style.maxWidth = `${menuWidthMaxPx(bounds)}px`;
  const rect = trigger.getBoundingClientRect();
  const { shiftPx } = menuPlacement({
    anchorLeftPx: rect.left,
    menuWidthPx: listElement.offsetWidth,
    boundsLeftPx: bounds.left,
    boundsRightPx: bounds.right,
  });
  listElement.style.translate = shiftPx === 0 ? '' : `${shiftPx}px 0`;
  assert(listElement.style.transform === '', 'clampLinkMenu: the open motion owns transform');
}

function scrollRegionOf(listElement: HTMLDivElement): HTMLElement {
  return listElement.querySelector<HTMLElement>(':scope > .u-select-scroll') ?? listElement;
}

function scrollActiveIntoList(listElement: HTMLDivElement, moment: { readonly opening: boolean }): void {
  const region = scrollRegionOf(listElement);
  const active = region.querySelector<HTMLElement>('[data-active="true"]');
  if (!active) {
    return;
  }
  const searchHeight = region.querySelector<HTMLElement>('.u-select-search')?.offsetHeight ?? 0;
  if (moment.opening) {
    const card = active.closest<HTMLElement>('.u-select-group');
    let anchor: HTMLElement = active;
    if (card !== null && region.contains(card)) {
      anchor = card;
    } else {
      let node = active.previousElementSibling;
      while (isHTMLElementInDocument(node, active.ownerDocument) && !node.classList.contains('u-select-heading')) {
        node = node.previousElementSibling;
      }
      anchor = isHTMLElementInDocument(node, active.ownerDocument) ? node : active;
    }
    const paddingTop = Number.parseFloat(window.getComputedStyle(region).paddingTop) || 0;
    const top = anchor.offsetTop - region.offsetTop;
    const bottom = active.offsetTop - region.offsetTop + active.offsetHeight;
    region.scrollTop = bottom <= region.clientHeight ? 0 : Math.max(0, top - paddingTop - searchHeight);
    return;
  }
  const regionRect = region.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  if (activeRect.top < regionRect.top + searchHeight) {
    region.scrollTop -= regionRect.top + searchHeight - activeRect.top;
  } else if (activeRect.bottom > regionRect.bottom) {
    region.scrollTop += activeRect.bottom - regionRect.bottom;
  }
}

function useKeepScroll({ open }: { readonly open: boolean }, listRef: RefObject<HTMLDivElement>): void {
  const remembered = useRef<{ readonly element: HTMLElement; scrollTop: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) {
      remembered.current = undefined;
      return undefined;
    }
    const region = scrollRegionOf(list);
    const previous = remembered.current;
    if (previous !== undefined && previous.element !== region) {
      region.scrollTop = previous.scrollTop;
    }
    const record = { element: region, scrollTop: region.scrollTop };
    remembered.current = record;
    const onScroll = () => {
      record.scrollTop = region.scrollTop;
    };
    region.addEventListener('scroll', onScroll, { passive: true });
    return () => region.removeEventListener('scroll', onScroll);
  });
}

type KeyInput = {
  readonly searchable: boolean;
  readonly activeIndex: number;
  readonly firstSelectable: number;
  readonly lastSelectable: number;
  readonly openMenu: (index?: number) => void;
  readonly move: (from: number, direction: number) => void;
  readonly choose: (index: number) => void;
  readonly cancelMenu: () => void;
  readonly runTypeahead: (key: string) => boolean;
  readonly setActiveIndex: (index: number) => void;
  readonly setOpen: (open: boolean) => void;
  readonly refs: SelectRefs;
};

function selectKeyHandlers(input: KeyInput) {
  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault();
        input.openMenu();
        return;
      case 'ArrowUp':
      case 'End':
        event.preventDefault();
        input.openMenu(input.lastSelectable);
        return;
      case 'Home':
        event.preventDefault();
        input.openMenu(input.firstSelectable);
        return;
      default:
        if (!input.searchable && input.runTypeahead(event.key)) {
          event.preventDefault();
          input.setOpen(true);
          window.requestAnimationFrame(() => input.refs.list.current?.focus({ preventScroll: true }));
        }
    }
  };
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      event.preventDefault();
      input.choose(input.activeIndex);
      return;
    }
    if (navigateByKey(event, input)) {
      return;
    }
    if (input.runTypeahead(event.key)) {
      event.preventDefault();
    }
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === ' ') {
      return;
    }
    navigateByKey(event, input);
  };
  return { onButtonKeyDown, onListKeyDown, onSearchKeyDown };
}

function navigateByKey(event: KeyboardEvent<HTMLElement>, input: KeyInput): boolean {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      input.move(input.activeIndex, 1);
      return true;
    case 'ArrowUp':
      event.preventDefault();
      input.move(input.activeIndex, -1);
      return true;
    case 'Home':
      event.preventDefault();
      input.setActiveIndex(input.firstSelectable);
      return true;
    case 'End':
      event.preventDefault();
      input.setActiveIndex(input.lastSelectable);
      return true;
    case 'Enter':
    case ' ':
      event.preventDefault();
      input.choose(input.activeIndex);
      return true;
    case 'Escape':
      event.preventDefault();
      input.cancelMenu();
      input.refs.button.current?.focus({ preventScroll: true });
      return true;
    case 'Tab':
      input.cancelMenu();
      return true;
    default:
      return false;
  }
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(length - 1, Math.max(0, index));
}
