import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import { appAuthorLogin, type AppSummary } from '../../../shared/properties/apps';
import { appPlacePills } from '../../../shared/properties/appPlace';
import { repositoryURL } from '../../../shared/properties/appPublish';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { useTranslate, useTranslateRef } from '../../lib/i18n/useTranslate';
import { confirmDialog } from '../../ui/ConfirmDialog';
import { GitHubIcon, HelpCircleIcon, RefreshIcon, TrashIcon } from '../../ui/Icons';
import MoreMenu, { type MenuItem } from '../../ui/MoreMenu';
import Popup from '../../ui/Popup';
import { useScrollEdges } from '../../ui/useScrollEdges';
import { AppCommandSettings } from './AppCommandSettings';
import { AppConnectionsSection } from './AppConnections';
import { AppDetailsItem, AppDetailsList, AppDetailsSection } from './AppDetailsLayout';
import { AppFolderScanSection, AppServicesSection } from './AppFolderRows';
import { AppSettingsSection } from './AppSettings';
import { AppTile } from './AppTile';
import { AppPlacePills, type AppPlaceFacts } from './appPlaces';
import { AutoUpdateSetting, appUpdatable, appUpdateStatus, updateAdditionsNote, updateStatusLabel } from './appUpdates';
import { MarketplaceIcon } from './marketplace/MarketplaceIcons';
import { appNeedsShare } from './publishFlow';
import './appDetails.css';

export interface AppItemActions {
  readonly admin: boolean;
  readonly busy: boolean;
  readonly projectPath: string;
  readonly open: (app: AppSummary) => void;
  readonly update: (app: AppSummary) => void;
  readonly uninstall: (app: AppSummary) => void;
  readonly setAutoUpdate: (app: AppSummary, policy: { readonly autoUpdate: boolean }) => void;
  readonly share: ((app: AppSummary) => void) | undefined;
  readonly submit: ((app: AppSummary) => (() => void) | undefined) | undefined;
}

export interface AppDetailsContext {
  readonly app: AppSummary;
  readonly avatar: ReactNode;
  readonly actions: AppItemActions;
  readonly place: AppPlaceFacts;
}

export const APP_DETAILS_SECTION_IDS = ['about', 'services', 'review', 'settings', 'connections', 'commands', 'updates', 'danger'] as const;
export type AppDetailsSectionId = (typeof APP_DETAILS_SECTION_IDS)[number];

export const APP_DETAILS_SECTIONS: { readonly [Id in AppDetailsSectionId]: (context: AppDetailsContext) => ReactNode } = {
  about: (context) => <AboutSection {...context} />,
  services: ({ app }) => <AppServicesSection app={app} />,
  review: ({ app, actions }) => <AppFolderScanSection projectPath={actions.projectPath} app={app} />,
  settings: ({ app, actions }) => <AppSettingsSection projectPath={actions.projectPath} app={app} />,
  connections: ({ app, actions }) => <AppConnectionsSection projectPath={actions.projectPath} app={app} />,
  commands: ({ app, actions }) => <AppCommandSettings app={app} admin={actions.admin} />,
  updates: (context) => <UpdatesSection {...context} />,
  danger: (context) => <DangerSection {...context} />,
};

export function AppDetails(
  props: AppDetailsContext & {
    readonly onClose: () => void;
    readonly section?: AppDetailsSectionId | undefined;
  },
) {
  const { app, actions, section } = props;
  const translate = useTranslate();
  const { manifest } = app;
  assert(manifest.name.length > 0, 'An installed app has a name');
  const body = useRef<HTMLDivElement>(null);
  const { edges } = useScrollEdges(body);
  useEffect(() => {
    if (section === undefined) {
      return;
    }
    const scroll = (): void => {
      const slot = body.current?.querySelector(`[data-app-details-section="${section}"]`);
      const shown = slot?.firstElementChild ?? undefined;
      shown?.scrollIntoView({ block: 'start' });
    };
    scroll();
    const frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [section]);
  return (
    <Popup
      className="modal apps-details-popup"
      label={translate('apps.details.popupLabel', { name: manifest.name })}
      onClose={props.onClose}
      dismissible={true}
    >
      {({ finish }) => {
        const leave = (action: () => void) =>
          finish(() => {
            props.onClose();
            action();
          });
        return (
          <>
            <div className="modal-header apps-details-header">
              <AppTile manifest={manifest} size={40} />
              <span className="apps-details-heading">
                <span className="apps-details-name">{manifest.name}</span>
                <AppMeta app={app} avatar={props.avatar} place={props.place} />
              </span>
              <span className="apps-details-header-actions">
                <button type="button" className="apps-open primary" onClick={() => leave(() => actions.open(app))}>
                  {translate('ui.open')}
                </button>
                <MoreMenu
                  title={translate('apps.details.options', { name: manifest.name })}
                  width={200}
                  items={appMenuItems(app, actions, { details: undefined, finish: leave, place: props.place }, translate)}
                />
              </span>
            </div>
            <div ref={body} className="modal-body apps-details-body" data-edge-top={edges.top} data-edge-bottom={edges.bottom}>
              {APP_DETAILS_SECTION_IDS.map((id) => (
                <div key={id} className="apps-details-slot" data-app-details-section={id}>
                  {APP_DETAILS_SECTIONS[id]({ app, avatar: props.avatar, actions: wrapActions(actions, leave), place: props.place })}
                </div>
              ))}
            </div>
          </>
        );
      }}
    </Popup>
  );
}

export function appMenuItems(
  app: AppSummary,
  actions: AppItemActions,
  options: {
    readonly details: (() => void) | undefined;
    readonly finish: (action: () => void) => void;
    readonly place: AppPlaceFacts;
  },
  translate: Translator,
): readonly (MenuItem | false)[] {
  const { lock } = app;
  const updating = appUpdateStatus(lock);
  const submit = actions.submit?.(app);
  const share = actions.share;
  const { published } = options.place;
  const needsShare = appNeedsShare(lock.source, published);
  const submitLabel = translate('apps.menu.submit');
  return [
    options.details !== undefined && { label: translate('apps.menu.details'), icon: <HelpCircleIcon size={14} />, onSelect: options.details },
    options.details === undefined &&
      updating.kind !== 'none' &&
      actions.admin && {
        label: translate('apps.menu.updateTo', { version: updating.update.version }),
        icon: <RefreshIcon size={14} />,
        disabled: actions.busy,
        onSelect: () => actions.update(app),
      },
    needsShare &&
      share !== undefined && { label: translate('apps.menu.share'), icon: <GitHubIcon size={14} />, onSelect: () => options.finish(() => share(app)) },
    actions.submit !== undefined && needsShare && { label: submitLabel, icon: <MarketplaceIcon size={14} />, disabled: true },
    submit !== undefined && !needsShare && { label: submitLabel, icon: <MarketplaceIcon size={14} />, onSelect: () => options.finish(submit) },
    actions.admin && {
      label: translate('apps.menu.remove'),
      icon: <TrashIcon size={14} />,
      danger: true,
      disabled: actions.busy,
      onSelect: () =>
        void confirmUninstall(app, translate).then((confirmed) => {
          if (confirmed) {
            options.finish(() => actions.uninstall(app));
          }
        }),
    },
  ];
}

export async function confirmUninstall(app: AppSummary, translate: Translator): Promise<boolean> {
  const { name } = app.manifest;
  assert(name.length > 0, 'An installed app has a name');
  const answer = await confirmDialog({
    title: translate('apps.uninstall.title', { name }),
    body: translate('apps.uninstall.body'),
    confirmLabel: translate('apps.uninstall.confirm'),
    danger: true,
  });
  return answer === true;
}

function wrapActions(actions: AppItemActions, finish: (action: () => void) => void): AppItemActions {
  return { ...actions, uninstall: (app) => finish(() => actions.uninstall(app)) };
}

function appRepository(app: AppSummary, place: AppPlaceFacts): { readonly owner: string; readonly repository: string } | undefined {
  const { manifest, lock } = app;
  return place.place ?? (lock.source.kind === 'github' ? lock.source : undefined) ?? place.published ?? manifest.source;
}

function AppMeta({ app, avatar, place }: Pick<AppDetailsContext, 'app' | 'avatar' | 'place'>) {
  const translate = useTranslate();
  const { manifest } = app;
  assert(manifest.version.length > 0, 'An installed app has a version');
  const author = appAuthorLogin(app);
  const repository = appRepository(app, place);
  return (
    <span className="apps-details-meta">
      <span className="apps-details-version" title={translate('apps.details.versionNamed', { version: manifest.version })}>
        v{manifest.version}
      </span>
      {}
      {author !== undefined && (
        <span className="apps-details-author">
          {avatar}
          <span>{author}</span>
        </span>
      )}
      {repository !== undefined && (
        <a
          className="apps-details-link apps-details-repository"
          href={repositoryURL(repository.owner, repository.repository)}
          target="_blank"
          rel="noopener noreferrer"
          title={translate('apps.details.openOnGitHub', { repository: `${repository.owner}/${repository.repository}` })}
        >
          <GitHubIcon size={12} />
          <span>
            {repository.owner}/{repository.repository}
          </span>
        </a>
      )}
    </span>
  );
}

function AboutSection({ app, place }: AppDetailsContext) {
  const translate = useTranslate();
  const translateRef = useTranslateRef();
  const { manifest, lock } = app;
  const pills = appPlacePills(lock.source, place);
  assert(pills.length > 0, 'Every app says where it lives');
  const explained = pills.map((pill) => `${translateRef(pill.tooltipRef)}.`).join(' ');
  const reaches = manifest.network.length + manifest.auth.length;
  return (
    <AppDetailsSection label={translate('apps.about.title')}>
      {manifest.description !== '' && <AboutText text={manifest.description} />}
      <AppDetailsList label={translate('apps.details.aboutNamed', { name: manifest.name })}>
        <AppDetailsItem label={translate('apps.about.installedFrom')}>
          <span title={installSourceLabel(lock.source, translate)}>{installSourceShortLabel(lock.source, translate)}</span>
        </AppDetailsItem>
        {place.listedVersion !== undefined && (
          <AppDetailsItem label={translate('apps.about.listed')} hint={translate('apps.about.listedHint')}>
            <ListedLatest version={place.listedVersion} repository={appRepository(app, place)} />
          </AppDetailsItem>
        )}
        {manifest.stackiVersionMin !== undefined && (
          <AppDetailsItem label={translate('apps.about.needs')} hint={translate('apps.about.needsHint')}>
            {translate('apps.about.needsVersion', { version: manifest.stackiVersionMin })}
          </AppDetailsItem>
        )}
        <AppDetailsItem label={translate('apps.about.storedIn')} hint={explained}>
          <span className="apps-details-place">
            <span>{translate('apps.about.thisProject')}</span>
            <AppPlacePills app={app} facts={place} />
          </span>
        </AppDetailsItem>
        {reaches === 0 ? (
          <AppDetailsItem label={translate('apps.about.network')}>
            <span className="apps-details-muted">{translate('apps.about.worksOffline')}</span>
          </AppDetailsItem>
        ) : (
          <AppDetailsItem label={translate('apps.about.network')} tone="warning" hint={translate('apps.about.networkHint')}>
            {translate('apps.about.reaches', { count: reaches })}
          </AppDetailsItem>
        )}
      </AppDetailsList>
    </AppDetailsSection>
  );
}

function ListedLatest({
  version,
  repository,
}: {
  readonly version: string;
  readonly repository: { readonly owner: string; readonly repository: string } | undefined;
}) {
  assert(version.length > 0, 'A listing names its version');
  const translate = useTranslate();
  return (
    <span className="apps-details-listed">
      <span>v{version}</span>
      {repository !== undefined && (
        <a
          className="apps-details-link"
          href={repositoryURL(repository.owner, repository.repository)}
          target="_blank"
          rel="noopener noreferrer"
          title={translate('apps.details.openOnGitHub', { repository: `${repository.owner}/${repository.repository}` })}
        >
          {repository.owner}/{repository.repository}
        </a>
      )}
    </span>
  );
}

export function AboutText({ text }: { readonly text: string }) {
  assert(text.length > 0, 'An empty description draws nothing');
  const translate = useTranslate();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const shown = paragraph.current;
    if (shown === null) {
      return;
    }
    if (expanded) {
      return;
    }
    const measure = (): void => setOverflows(shown.scrollHeight > shown.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(shown);
    return () => observer.disconnect();
  }, [text, expanded]);
  return (
    <div className="apps-details-about">
      <p ref={paragraph} className="apps-details-about-text" data-expanded={expanded}>
        {text}
      </p>
      {(overflows || expanded) && (
        <button type="button" className="apps-details-more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? translate('apps.about.less') : translate('apps.about.more')}
        </button>
      )}
    </div>
  );
}

function UpdatesSection({ app, actions }: AppDetailsContext) {
  const translate = useTranslate();
  const { lock } = app;
  if (!appUpdatable(lock.source)) {
    return undefined;
  }
  const status = appUpdateStatus(lock);
  const hint =
    status.kind === 'none'
      ? undefined
      : (updateAdditionsNote(status.update, translate) ?? (actions.admin ? undefined : translate('apps.updates.adminCanInstall')));
  return (
    <AppDetailsSection title={translate('apps.updates.title')}>
      <AppDetailsList label={translate('apps.updates.listLabel', { name: app.manifest.name })}>
        {status.kind !== 'none' && (
          <AppDetailsItem
            label={updateStatusLabel(status, translate)}
            {...(hint === undefined ? {} : { hint })}
            {...(status.kind === 'needs-approval' ? { tone: 'warning' as const } : {})}
          >
            {actions.admin ? (
              <button type="button" className="apps-button primary apps-update-button" disabled={actions.busy} onClick={() => actions.update(app)}>
                <RefreshIcon size={12} />
                {translate('apps.updates.update')}
              </button>
            ) : (
              <span className="apps-details-muted">{translate('apps.updates.adminOnly')}</span>
            )}
          </AppDetailsItem>
        )}
        <AutoUpdateSetting app={app} admin={actions.admin} busy={actions.busy} onChange={(policy) => actions.setAutoUpdate(app, policy)} />
      </AppDetailsList>
    </AppDetailsSection>
  );
}

function DangerSection({ app, actions }: AppDetailsContext) {
  const translate = useTranslate();
  if (!actions.admin) {
    return undefined;
  }
  const ask = async (): Promise<void> => {
    if (await confirmUninstall(app, translate)) {
      actions.uninstall(app);
    }
  };
  return (
    <section className="apps-details-danger" aria-label={translate('apps.danger.zone')}>
      <button type="button" className="apps-details-uninstall" disabled={actions.busy} onClick={() => void ask()}>
        <TrashIcon size={13} />
        <span>{translate('apps.danger.uninstall')}</span>
      </button>
    </section>
  );
}

export function installSourceLabel(source: AppSummary['lock']['source'], translate: Translator): string {
  switch (source.kind) {
    case 'github':
      return `${source.owner}/${source.repository} · ${source.tag}`;
    case 'marketplace':
      return translate('apps.source.marketplaceVersion', { version: source.version });
    case 'file':
      return translate('apps.source.fileNamed', { fileName: source.fileName });
    case 'local':
      return translate('apps.source.localLong');
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export function installSourceShortLabel(source: AppSummary['lock']['source'], translate: Translator): string {
  switch (source.kind) {
    case 'github':
      return translate('apps.source.githubTag', { tag: source.tag });
    case 'marketplace':
      return translate('apps.source.marketplace');
    case 'file':
      return translate('apps.source.file');
    case 'local':
      return translate('apps.source.local');
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}
