import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { segmentIndicatorStyle, useSegmentIndicator } from '../../ui/segmentIndicator';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { PlacementMessage } from '../../../shared/page/placement';
import type { ScanComponent } from '../../../shared/properties/projectScan';
import { HTML_TAGS } from '../../editor/elementSchemas';
import type { TrailingSlash } from '../../editor/pageState';
import { rankInsertItems, tagSearchText } from '../../lib/insertRank';
import { ASTRO_ASSETS } from './astroAssets';
import { useOfferedComponents } from './componentVisibility';
import { insertFolderOf, type InsertFolderKey } from './insertFolders';
import { insertResultsMax, insertView, moveHighlight, type GridMove, type InsertTab } from './insertGrid';
import type { InsertItem } from './insertItem';
import { previewStoreFor, tileId, tileRequests } from './previewTiles';
import { InsertPlacementTip, PLACEMENT_REASON_ID } from './InsertPlacementTip';
import { InsertCard, InsertHints, InsertPills, InsertRow, type InsertPreviewHost } from './InsertCards';
import { INSERT_TAB_DEFAULT, loadInsertFolder, loadInsertTab, saveInsertFolder, saveInsertTab } from './insertPreferences';
import type { AppsEmpty } from './InsertAppRows';
import { usePaletteResize } from './paletteResize';
import {
  canSeePaletteApps,
  paletteAppItems,
  paletteAppsActions,
  paletteMarketplaceItems,
  visiblePaletteApps,
  type PaletteAppItem,
  type PaletteAppsAction,
  type PaletteMarketplaceItem,
  type PaletteAppsSource,
} from './paletteApps';
import { InsertAppRow, InsertAppsEmpty, InsertMarketplaceRow } from './InsertAppRows';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';
import { useCurrentRole } from '../../lib/useCurrentRole';
import {
  elementIcon,
  ElementComponentIcon,
  LayoutIcon,
  RepeatIcon,
  BranchIcon,
  TextIcon,
  CommentIcon,
  BracesIcon,
  CodeIcon,
  SearchIcon,
  astroAssetIcon,
} from '../../ui/Icons';

export type { InsertChoice, InsertItem } from './insertItem';

type TabEntry = { readonly key: InsertTab; readonly labelKey: MessageKey };

const TABS: ReadonlyArray<TabEntry> = [
  { key: 'all', labelKey: 'palette.tab.all' },
  { key: 'components', labelKey: 'palette.tab.components' },
  { key: 'elements', labelKey: 'palette.tab.elements' },
  { key: 'other', labelKey: 'palette.tab.other' },
];

const TABS_WITH_APPS: ReadonlyArray<TabEntry> = [...TABS, { key: 'apps', labelKey: 'palette.tab.apps' }];

type PaletteEntry = InsertItem | PaletteAppItem | PaletteMarketplaceItem;

const listResultsMax = 60;

const GRID_KEYS: Readonly<Record<string, GridMove>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

export interface InsertComponent extends Pick<ScanComponent, 'name' | 'origin' | 'instances' | 'isLayout'> {
  readonly file?: string;
  readonly path?: string;
  readonly folder?: string;
}
interface InsertSearchProps {
  readonly projectKey?: string | undefined;
  readonly components?: readonly InsertComponent[];
  readonly allowSlot?: boolean;
  readonly devUrl?: string | undefined;
  readonly trailingSlash?: TrailingSlash;
  readonly resolvePreviewURL?: (url: string) => Promise<string>;
  readonly apps?: PaletteAppsSource | undefined;
  readonly onInsert: (item: InsertItem) => void;
  readonly placementOf?: ((item: InsertItem) => PlacementMessage | undefined) | undefined;
  readonly onWarm?: ((item: InsertItem) => void) | undefined;
  readonly onClose: () => void;
}
export default function InsertSearch(props: InsertSearchProps) {
  const { onClose } = props;
  const state = useInsertSearch(props);
  const translate = useTranslate();
  const { query, setQuery, tab, setTab, pickFolder, highlight, setHighlight, listRef, view } = state;
  const highlighted = view.shown[highlight];
  const refusal = highlighted === undefined || highlighted.type === 'app' || highlighted.type === 'marketplace' ? undefined : props.placementOf?.(highlighted);
  const placementReason = refusal === undefined ? undefined : translate(refusal.messageKey, refusal.params);
  const onWarm = props.onWarm;
  useEffect(() => {
    if (highlighted !== undefined && highlighted.type !== 'app' && highlighted.type !== 'marketplace') {
      onWarm?.(highlighted);
    }
  }, [highlighted, onWarm]);
  const choose = (entry: PaletteEntry): void => {
    if (entry.type === 'app') {
      onClose();
      entry.app.open();
    } else if (entry.type === 'marketplace') {
      onClose();
      entry.app.open();
    } else if (props.placementOf?.(entry) === undefined) {
      props.onInsert(entry);
    }
  };
  const store =
    props.devUrl === undefined || props.projectKey === undefined
      ? undefined
      : previewStoreFor(props.projectKey, { devURL: props.devUrl, resolvePreviewURL: props.resolvePreviewURL });
  const host: InsertPreviewHost = { devURL: props.devUrl, store };
  const grid = tab === 'components';
  const paletteRef = useRef<HTMLDivElement>(null);
  usePaletteResize(paletteRef, grid ? 'grid' : 'list');
  return (
    <div className="insert-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={paletteRef} className={`insert-palette ${grid ? 'insert-palette-grid' : ''}`} onKeyDown={(event) => insertKey(event, state, choose, onClose)}>
        <div className="insert-search-row">
          <SearchIcon size={14} />
          <input
            autoFocus
            value={query}
            placeholder={translate(state.tabs === TABS ? 'palette.search.placeholder' : 'palette.search.placeholderApps')}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <InsertTabs tabs={state.tabs} tab={tab} onPick={setTab} />
        {view.folders !== undefined && <InsertPills pills={view.folders.pills} selected={view.folders.selected} onPick={pickFolder} />}
        <div className={`insert-results ${grid ? 'insert-results-grid' : ''}`} ref={listRef}>
          {view.shown.map((item, i) => {
            const key = insertItemKey(item);
            const select = () => choose(item);
            const hover = () => {
              state.noteMove('pointer');
              setHighlight(i);
            };
            if (item.type === 'app') {
              return <InsertAppRow key={key} app={item.app} highlighted={i === highlight} onHover={hover} onOpen={select} />;
            }
            if (item.type === 'marketplace') {
              const first = view.shown[i - 1]?.type !== 'marketplace';
              return <InsertMarketplaceRow key={key} app={item.app} first={first} highlighted={i === highlight} onHover={hover} onOpen={select} />;
            }
            const refusal = props.placementOf?.(item);
            const describedBy = refusal !== undefined && i === highlight ? PLACEMENT_REASON_ID : undefined;
            const shownItem =
              !grid || item.card === undefined ? (
                <InsertRow key={key} item={item} highlighted={i === highlight} describedBy={describedBy} onHover={hover} onInsert={select} />
              ) : (
                <InsertCard
                  key={key}
                  item={item}
                  itemKey={key}
                  highlighted={i === highlight}
                  host={host}
                  scrollRoot={listRef}
                  onVisible={state.reportVisible}
                  showFolder={view.folders?.selected === undefined}
                  describedBy={describedBy}
                  onHover={hover}
                  onInsert={select}
                />
              );
            return refusal === undefined ? (
              shownItem
            ) : (
              <div key={key} className="insert-placement" data-refused="" aria-disabled="true">
                {shownItem}
              </div>
            );
          })}
          {view.shown.length === 0 && <InsertEmpty state={state} onClose={onClose} />}
        </div>
        <InsertPlacementTip reason={placementReason} listRef={listRef} highlight={highlight} />
        {grid && <InsertHints />}
      </div>
    </div>
  );
}

function InsertEmpty({ state, onClose }: { readonly state: InsertState; readonly onClose: () => void }) {
  const translate = useTranslate();
  const empty = state.appsEmpty;
  if (empty === undefined) {
    return <div className="props-empty">{translate('palette.search.noMatches')}</div>;
  }
  return (
    <InsertAppsEmpty
      empty={empty}
      actions={state.emptyActions}
      highlight={state.highlight}
      onHover={(index) => {
        state.noteMove('pointer');
        state.setHighlight(index);
      }}
      onRun={(action) => runEmptyAction(action, onClose)}
    />
  );
}

function runEmptyAction(action: PaletteAppsAction, onClose: () => void): void {
  onClose();
  action.run();
}

function InsertTabs({ tabs, tab, onPick }: { readonly tabs: ReadonlyArray<TabEntry>; readonly tab: InsertTab; readonly onPick: (tab: InsertTab) => void }) {
  const translate = useTranslate();
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | undefined>>([]);
  const selectedIndex = tabs.findIndex((entry) => entry.key === tab);
  assert(selectedIndex >= 0, 'InsertSearch: the tab is one of the tabs');
  const { indicator, animated } = useSegmentIndicator({ trackRef, buttonsRef, selectedIndex, layoutKey: String(tabs.length) });
  return (
    <div ref={trackRef} className="insert-tabs" role="tablist" aria-label={translate('palette.tab.aria')}>
      <span className={`insert-tab-indicator${animated ? ' is-animated' : ''}`} aria-hidden="true" style={segmentIndicatorStyle(indicator)} />
      {tabs.map((entry, index) => (
        <button
          key={entry.key}
          ref={(element) => {
            buttonsRef.current[index] = element ?? undefined;
          }}
          type="button"
          role="tab"
          aria-selected={tab === entry.key}
          className={`insert-tab ${tab === entry.key ? 'on' : ''}`}
          onClick={() => onPick(entry.key)}
        >
          {translate(entry.labelKey)}
        </button>
      ))}
    </div>
  );
}

function isInsertItem(entry: PaletteEntry): entry is InsertItem {
  if (entry.type === 'app') {
    return false;
  }
  return entry.type !== 'marketplace';
}

function insertItemKey(item: PaletteEntry): string {
  if (item.type === 'app') {
    return JSON.stringify([item.type, item.app.id]);
  }
  if (item.type === 'marketplace') {
    return JSON.stringify([item.type, item.app.id]);
  }
  if (item.type === 'component') {
    return JSON.stringify([item.type, item.path ?? item.sub, item.name]);
  }
  return JSON.stringify([item.type, item.label]);
}

function useInsertSearch({ components, allowSlot, projectKey, apps, devUrl, trailingSlash, resolvePreviewURL }: InsertSearchProps) {
  const [query, setQuery] = useState('');
  const role = useCurrentRole();
  const appsShown = apps !== undefined && canSeePaletteApps(role);
  const tabs = appsShown ? TABS_WITH_APPS : TABS;
  const [storedTab, setTabState] = useState<InsertTab>(loadInsertTab);
  const tab = tabs.some((entry) => entry.key === storedTab) ? storedTab : INSERT_TAB_DEFAULT;
  const setTab = useCallback((next: InsertTab) => {
    setTabState(next);
    saveInsertTab(next);
  }, []);
  const [folder, setFolder] = useState<InsertFolderKey | undefined>(() => loadInsertFolder(projectKey));
  const pickFolder = useCallback(
    (picked: InsertFolderKey) => {
      setFolder((current) => {
        const next = current === picked ? undefined : picked;
        saveInsertFolder(projectKey, next);
        return next;
      });
    },
    [projectKey],
  );
  const [highlight, setHighlight] = useState(0);
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
  const movedBy = useRef<'keyboard' | 'pointer'>('keyboard');

  const addable = useOfferedComponents('search', components);
  const allItems = useMemo(() => insertItems(addable, { allowSlot }), [addable, allowSlot]);
  const appList = apps?.list;
  const appItems = useMemo(
    () => (appsShown && appList?.kind === 'ready' ? paletteAppItems(visiblePaletteApps(appList.apps, role)) : []),
    [appsShown, appList, role],
  );
  const marketplaceApps = apps?.marketplace;
  const marketplaceItems = useMemo(
    () => (appsShown && marketplaceApps !== undefined ? paletteMarketplaceItems(marketplaceApps, role) : []),
    [appsShown, marketplaceApps, role],
  );
  const folders = useMemo(() => allItems.flatMap((item) => (item.card?.folder === undefined ? [] : [item.card.folder])), [allItems]);
  const view = useMemo(() => {
    const entries: readonly PaletteEntry[] = [...allItems, ...appItems];
    const items = entries.filter((i) => tab === 'all' || i.cat === tab);
    const ranked = rankInsertItems(items, query);
    if (tab === 'components') {
      return insertView(ranked, tab, { chosen: folder, present: folders });
    }
    const market = tab === 'apps' && /\S/.test(query) ? rankInsertItems(marketplaceItems, query) : [];
    const shown: readonly PaletteEntry[] = [...ranked, ...market].slice(0, listResultsMax);
    return { shown, folders: undefined };
  }, [allItems, appItems, marketplaceItems, folders, query, tab, folder]);
  const appsEmpty = tab === 'apps' ? appsEmptyState(appList, appItems.length) : undefined;
  const emptyActions = useMemo(() => (appsEmpty?.kind === 'none' && apps !== undefined ? paletteAppsActions(apps, role) : []), [appsEmpty?.kind, apps, role]);

  useEffect(() => {
    movedBy.current = 'keyboard';
    setHighlight(0);
  }, [query, tab, view.folders?.selected]);

  useEffect(() => {
    const element = listRef.current?.children[highlight];
    if (element && movedBy.current === 'keyboard') {
      element.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight]);

  const reportVisible = useCallback((key: string, visible: boolean) => {
    setVisibleKeys((current) => {
      if (current.has(key) === visible) {
        return current;
      }
      const next = new Set(current);
      if (visible) {
        next.add(key);
      } else {
        next.delete(key);
      }
      assert(next.size <= insertResultsMax, 'Only shown cards can be visible');
      return next;
    });
  }, []);

  useEffect(() => {
    if (projectKey === undefined || devUrl === undefined) {
      return;
    }
    const store = previewStoreFor(projectKey, { devURL: devUrl, resolvePreviewURL });
    const shown = view.shown.filter(isInsertItem).flatMap((item) => (item.card !== undefined && item.preview !== undefined ? [item.preview] : []));
    const visibleIds = new Set(
      view.shown
        .filter(isInsertItem)
        .filter((item) => visibleKeys.has(insertItemKey(item)))
        .flatMap((item) => (item.preview === undefined ? [] : [tileId(item.preview)])),
    );
    store.request(tileRequests(shown, devUrl, trailingSlash ?? 'ignore', visibleIds));
    store.prioritize(new Map([...visibleIds].map((id) => [id, 'visible' as const])));
  }, [view.shown, visibleKeys, projectKey, devUrl, trailingSlash, resolvePreviewURL]);

  return {
    query,
    setQuery,
    tabs,
    tab,
    setTab,
    appsEmpty,
    emptyActions,
    pickFolder,
    highlight,
    setHighlight,
    listRef,
    view,
    reportVisible,
    noteMove: (by: 'keyboard' | 'pointer') => {
      movedBy.current = by;
    },
  };
}

type InsertState = ReturnType<typeof useInsertSearch>;

function appsEmptyState(list: PaletteAppsSource['list'] | undefined, visibleCount: number): AppsEmpty | undefined {
  assert(visibleCount >= 0, 'InsertSearch: a count is never negative');
  if (list === undefined) {
    return undefined;
  }
  switch (list.kind) {
    case 'loading':
      return { kind: 'loading' };
    case 'failed':
      return { kind: 'failed', message: list.message };
    case 'ready':
      return visibleCount === 0 ? { kind: 'none' } : undefined;
    default: {
      const exhaustive: never = list;
      return exhaustive;
    }
  }
}

function insertKey(event: React.KeyboardEvent, state: InsertState, onInsert: (item: PaletteEntry) => void, onClose: () => void): void {
  if (event.target instanceof HTMLElement && event.target.closest('.insert-pill, .insert-tab') !== null) {
    if (event.key === 'Enter' || event.key === ' ') {
      return;
    }
  }
  const { view, highlight, tab, setTab } = state;
  const item = view.shown[highlight];
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
  } else if (tab !== 'components' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    listKey(event, state);
  } else if (tab === 'components' && Object.hasOwn(GRID_KEYS, event.key)) {
    gridKey(event, state);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (item) {
      onInsert(item);
    } else {
      const action = state.emptyActions[highlight];
      if (action !== undefined) {
        runEmptyAction(action, onClose);
      }
    }
  } else if (event.key === 'Tab') {
    event.preventDefault();
    const tabs = state.tabs;
    const index = tabs.findIndex((tabEntry) => tabEntry.key === tab);
    const next = tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length];
    assert(next !== undefined, 'InsertSearch: next tab exists');
    setTab(next.key);
  }
}

function listKey(event: React.KeyboardEvent, state: InsertState): void {
  assert(event.key === 'ArrowDown' || event.key === 'ArrowUp', 'InsertSearch: a list key is up or down');
  event.preventDefault();
  state.noteMove('keyboard');
  const rows = state.view.shown.length > 0 ? state.view.shown.length : state.emptyActions.length;
  const last = rows - 1;
  if (last >= 0) {
    const current = Math.min(state.highlight, last);
    state.setHighlight(event.key === 'ArrowDown' ? Math.min(current + 1, last) : Math.max(current - 1, 0));
  }
}

function gridKey(event: React.KeyboardEvent, state: InsertState): void {
  const move = GRID_KEYS[event.key];
  assert(move !== undefined, 'InsertSearch: a grid key maps to a move');
  const horizontal = move === 'left' || move === 'right';
  if (horizontal && state.query !== '') {
    return;
  }
  event.preventDefault();
  state.noteMove('keyboard');
  const count = state.view.shown.length;
  if (count > 0) {
    const current = Math.min(state.highlight, count - 1);
    state.setHighlight(moveHighlight(current, count, move));
  }
}

function insertItems(
  components: readonly InsertComponent[],
  options: {
    readonly allowSlot: boolean | undefined;
  },
): InsertItem[] {
  assert(components.length <= LIMITS.scanEntriesMax, 'InsertSearch: component limit exceeded');
  const items = [...insertComponents(components), ...insertAssets(), ...insertTags(options), ...OTHER_ITEMS];
  assert(items.length <= LIMITS.scanEntriesMax + HTML_TAGS.length + 11, 'InsertSearch: combined item limit exceeded');
  return items;
}
function previewSource(component: InsertComponent): ScanComponent | undefined {
  if (component.path === undefined) {
    return undefined;
  }
  return { ...component, path: component.path, folder: component.folder ?? '' };
}
function insertComponents(components: readonly InsertComponent[]): InsertItem[] {
  return components.map((component): InsertItem => {
    const preview = previewSource(component);
    return {
      type: 'component',
      ...(component.path === undefined ? {} : { path: component.path }),
      name: component.name,
      label: component.name,
      sub: component.folder || 'component',
      cat: 'components',
      icon: component.isLayout ? <LayoutIcon size={15} style={{ color: '#79e09c' }} /> : <ElementComponentIcon size={15} style={{ color: '#79e09c' }} />,
      card: { folder: insertFolderOf(component.folder ?? '') },
      ...(component.instances === undefined ? {} : { instances: component.instances }),
      ...(preview === undefined ? {} : { preview }),
    };
  });
}
function insertAssets(): InsertItem[] {
  return ASTRO_ASSETS.map((asset): InsertItem => ({
    type: 'astroAsset',
    name: asset.name,
    label: `<${asset.name}>`,
    sub: 'astro:assets',
    search: `${asset.name} astro assets image picture optimised responsive`,
    cat: 'components',
    icon: astroAssetIcon(asset.name, 15),
    card: { folder: undefined },
  }));
}
const ASTRO_TAGS = ['Fragment', 'Content'] as const;
function insertTags({ allowSlot }: { readonly allowSlot: boolean | undefined }): InsertItem[] {
  const tags = [...HTML_TAGS, ...ASTRO_TAGS, ...(allowSlot ? ['slot'] : [])].sort();
  return tags.map((tag): InsertItem => ({
    type: 'element',
    tag,
    label: `<${tag}>`,
    search: tagSearchText(tag),
    ...(tag === 'slot' ? { sub: 'what the caller passes in', subKey: 'palette.element.slot' } : {}),
    ...(tag === 'Fragment' ? { sub: 'group without a wrapper element', subKey: 'palette.element.fragment' } : {}),
    ...(tag === 'Content' ? { sub: 'rendered Markdown entry', subKey: 'palette.element.content' } : {}),
    cat: 'elements',
    icon: elementIcon(tag, 14),
  }));
}
export const OTHER_ITEMS: readonly InsertItem[] = [
  {
    type: 'map',
    label: 'Loop',
    labelKey: 'palette.other.loop',
    sub: 'items.map',
    search: 'loop map repeat repeater each for list collection list cms collection items iterate',
    cat: 'other',
    icon: <RepeatIcon size={14} style={{ color: '#c4afff' }} />,
  },
  {
    type: 'cond',
    label: 'Condition',
    labelKey: 'palette.other.condition',
    sub: 'if / else',
    search: 'condition if else ternary show hide',
    cat: 'other',
    icon: <BranchIcon size={14} style={{ color: '#c4afff' }} />,
  },
  {
    type: 'text',
    label: 'Text',
    labelKey: 'palette.other.text',
    cat: 'other',
    icon: <TextIcon size={14} />,
  },
  {
    type: 'comment',
    label: 'Comment',
    labelKey: 'palette.other.comment',
    cat: 'other',
    icon: <CommentIcon size={14} />,
  },
  {
    type: 'expr',
    label: 'Code Expression',
    labelKey: 'palette.other.expression',
    sub: '{ }',
    cat: 'other',
    icon: <BracesIcon size={14} />,
  },
  {
    type: 'doctype',
    label: 'Doctype',
    labelKey: 'palette.other.doctype',
    sub: '<!doctype html>',
    search: 'doctype html',
    cat: 'other',
    icon: elementIcon('html', 14),
  },
  {
    type: 'style',
    label: 'Style Block',
    labelKey: 'palette.other.style',
    sub: '<style>',
    cat: 'other',
    icon: elementIcon('style', 14),
  },
  {
    type: 'script',
    label: 'Script Block',
    labelKey: 'palette.other.script',
    sub: '<script>',
    cat: 'other',
    icon: <CodeIcon size={14} />,
  },
];
