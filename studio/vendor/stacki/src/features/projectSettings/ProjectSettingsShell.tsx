import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import { isSearching } from '../../lib/searchText';
import {
  SETTINGS_VIEW_TITLE_KEYS,
  loadFoldedSections,
  publishSettingsView,
  saveFoldedSections,
  sectionsOfView,
  settingsRequestSerial,
  subscribeSettingsRequests,
  takeSettingsRequest,
  viewOfTarget,
  type SettingsBulkRequest,
  type SettingsSectionId,
  type SettingsSectionsContext,
  type SettingsViewId,
} from '../../lib/settingsSections';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { ChevronRightIcon, CollapseVerticalIcon, ExpandVerticalIcon, AgentIcon, InstructionsIcon, LockIcon, PlugIcon } from '../../ui/Icons';
import MoreMenu from '../../ui/MoreMenu';
import { centralIcon } from '../../ui/central/CentralIcon';
import { roles as centralRoles } from '../../ui/central/centralGeometry';
import { PanelSearch } from '../../ui/PanelSearch';
import './projectSettings.css';
import { PanelHeader } from '../../ui/PanelHeader';
import { useShortcutTip } from '../../ui/shortcutTip';

export interface ProjectSettingsShellProps {
  readonly projectKey: string;
  readonly views: readonly SettingsViewId[];
  readonly renderView: (view: SettingsViewId, context: SettingsSectionsContext) => ReactNode;
  readonly onLeaveView?: ((view: SettingsViewId) => void) | undefined;
  readonly shortcuts?: Readonly<Partial<Record<SettingsViewId, string>>> | undefined;
  readonly refreshable: boolean;
  readonly renderRoot?: ((show: (view: SettingsViewId) => void) => ReactNode) | undefined;
}

const RolesIcon = centralIcon(centralRoles);
const LINK_ICONS = { secrets: LockIcon, mcp: PlugIcon, instructions: InstructionsIcon, agents: AgentIcon, roles: RolesIcon } as const satisfies Record<
  SettingsViewId,
  typeof LockIcon
>;

const NO_REPORTS: Readonly<Partial<Record<SettingsSectionId, number | undefined>>> = {};

export default function ProjectSettingsShell({ projectKey, views, renderView, refreshable, onLeaveView, shortcuts, renderRoot }: ProjectSettingsShellProps) {
  assert(renderRoot !== undefined || views.length > 0, 'The Settings panel lists at least one view');
  const translate = useTranslate();
  const [view, setView] = useState<SettingsViewId | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<SettingsSectionId>>(() => loadFoldedSections(projectKey));
  const [bulk, setBulk] = useState<SettingsBulkRequest>({ serial: 0, mode: undefined });
  const [refreshSerial, setRefreshSerial] = useState(0);
  const [reports, setReports] = useState(NO_REPORTS);
  const [scrollTarget, setScrollTarget] = useState<SettingsSectionId | undefined>(undefined);
  const searching = isSearching(query);

  const show = useCallback((next: SettingsViewId | undefined): void => {
    setQuery('');
    setReports(NO_REPORTS);
    setView(next);
  }, []);
  const leave = (): void => {
    if (view !== undefined) {
      onLeaveView?.(view);
    }
    show(undefined);
  };
  useEffect(() => {
    publishSettingsView(view);
    return () => publishSettingsView(undefined);
  }, [view]);
  const persist = useCallback(
    (next: ReadonlySet<SettingsSectionId>): void => {
      setFolded(next);
      saveFoldedSections(projectKey, next);
    },
    [projectKey],
  );
  const toggle = useCallback(
    (id: SettingsSectionId): void => {
      const next = new Set(folded);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persist(next);
    },
    [folded, persist],
  );
  const open = useCallback(
    (id: SettingsSectionId): void => {
      if (folded.has(id)) {
        persist(new Set([...folded].filter((each) => each !== id)));
      }
    },
    [folded, persist],
  );
  const report = useCallback((id: SettingsSectionId, matches: number | undefined): void => {
    setReports((current) => (current[id] === matches ? current : { ...current, [id]: matches }));
  }, []);
  const clearSearch = useCallback((): void => setQuery(''), []);

  const requestSerial = useSyncExternalStore(subscribeSettingsRequests, settingsRequestSerial, settingsRequestSerial);
  const standing = useRef({ folded, views });
  standing.current = { folded, views };
  useEffect(() => {
    const target = takeSettingsRequest();
    if (target === undefined) {
      return;
    }
    const wanted = viewOfTarget(target);
    if (!standing.current.views.includes(wanted.view)) {
      return;
    }
    show(wanted.view);
    persist(new Set([...standing.current.folded].filter((id) => !wanted.open.includes(id))));
    setScrollTarget(wanted.scrollTo);
  }, [requestSerial, persist, show]);
  useEffect(() => {
    if (scrollTarget === undefined) {
      return;
    }
    document.querySelector(`[data-panel-section="${scrollTarget}"]`)?.scrollIntoView?.({ block: 'nearest' });
    setScrollTarget(undefined);
  }, [scrollTarget]);

  const sections = view === undefined ? [] : sectionsOfView(view);
  const anyOpen = sections.some((id) => !folded.has(id));
  const expandAll = (): void => {
    persist(new Set());
    setBulk((current) => ({ serial: current.serial + 1, mode: 'expand' }));
  };
  const collapseAll = (): void => {
    persist(new Set(sections));
    setBulk((current) => ({ serial: current.serial + 1, mode: 'collapse' }));
  };

  const context = useMemo<SettingsSectionsContext>(
    () => ({ query, searching, refreshSerial, bulk, isOpen: (id) => searching || !folded.has(id), toggle, open, report, clearSearch }),
    [query, searching, refreshSerial, bulk, folded, toggle, open, report, clearSearch],
  );

  if (view === undefined) {
    return (
      <div className="panel-section grow settings-panel">
        <PanelHeader title={translate('settings.title')} />
        {renderRoot === undefined ? (
          <div className="panel-body settings-body" role="list" aria-label={translate('settings.sections')}>
            {views.map((id) => (
              <SettingsLink key={id} id={id} shortcut={shortcuts?.[id]} onShow={show} />
            ))}
          </div>
        ) : (
          renderRoot(show)
        )}
      </div>
    );
  }
  const noMatch = searching && sections.length > 0 && sections.every((id) => reports[id] === 0);
  return (
    <div
      className="panel-section grow settings-panel"
      onKeyDown={(event) => {
        const target = event.target;
        const typing = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
        if (event.key === 'Escape' && !event.defaultPrevented && !typing) {
          leave();
        }
      }}
    >
      <PanelHeader
        back={{ label: translate('settings.back'), onBack: leave }}
        title={translate(SETTINGS_VIEW_TITLE_KEYS[view])}
        actions={
          sections.length > 0 && (
            <>
              <button
                type="button"
                className="ghost"
                title={anyOpen ? translate('settings.collapseAll') : translate('settings.expandAll')}
                aria-label={anyOpen ? translate('settings.collapseAll') : translate('settings.expandAll')}
                onClick={anyOpen ? collapseAll : expandAll}
              >
                {anyOpen ? <CollapseVerticalIcon size={13} /> : <ExpandVerticalIcon size={13} />}
              </button>
              <MoreMenu
                className="ghost"
                title={translate('settings.options')}
                width={170}
                items={[
                  { label: translate('settings.expandAll'), onSelect: expandAll },
                  { label: translate('settings.collapseAll'), onSelect: collapseAll },
                  refreshable && { label: translate('settings.refresh'), onSelect: () => setRefreshSerial((count) => count + 1) },
                ]}
              />
            </>
          )
        }
      />
      {sections.length > 0 && <PanelSearch value={query} placeholder={translate('settings.instructions.search.placeholder')} onChange={setQuery} />}
      <div className={sections.length > 0 ? 'panel-body settings-body' : 'panel-body settings-detail'}>
        {renderView(view, context)}
        {noMatch && <div className="props-empty">{translate('settings.instructions.search.noMatch')}</div>}
      </div>
    </div>
  );
}

function SettingsLink({
  id,
  shortcut,
  onShow,
}: {
  readonly id: SettingsViewId;
  readonly shortcut: string | undefined;
  readonly onShow: (id: SettingsViewId) => void;
}) {
  const translate = useTranslate();
  const Icon = LINK_ICONS[id];
  const label = translate(SETTINGS_VIEW_TITLE_KEYS[id]);
  const { props, tip } = useShortcutTip(label, shortcut);
  return (
    <>
      <button type="button" role="listitem" className="list-item settings-link" onClick={() => onShow(id)} {...props}>
        <span className="icon">
          <Icon size={14} />
        </span>
        <span className="label">{label}</span>
        <ChevronRightIcon size={12} />
      </button>
      {tip}
    </>
  );
}
