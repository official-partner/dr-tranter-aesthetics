import { useState, type ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { assert } from '../../../shared/core/assert';
import { AppsIcon, GitHubIcon, SparkleIcon } from '../../ui/Icons';
import { useShortcutTip } from '../../ui/shortcutTip';
import { type PaletteApp, type PaletteAppAuthor, type PaletteAppsAction } from './paletteApps';


export type AppsEmpty = { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'none' };

const APP_TILE_PX = 18;
const AUTHOR_AVATAR_PX = 14;

export function InsertAppRow({
  app,
  highlighted,
  onHover,
  onOpen,
}: {
  readonly app: PaletteApp;
  readonly highlighted: boolean;
  readonly onHover: () => void;
  readonly onOpen: () => void;
}) {
  const translate = useTranslate();
  const byline = app.author === undefined ? undefined : translate('palette.apps.by', { login: app.author.login });
  const { props: tipProps, tip } = useShortcutTip(app.name, app.shortcut);
  return (
    <div className={`insert-item insert-app ${highlighted ? 'highlight' : ''}`} onMouseMove={highlighted ? undefined : onHover} onClick={onOpen} {...tipProps}>
      <span className="insert-item-icon">
        <AppIconTile app={app} />
      </span>
      <span className="insert-item-label">{app.name}</span>
      {app.author !== undefined && byline !== undefined && <AuthorByline author={app.author} byline={byline} />}
      {tip}
    </div>
  );
}

function AuthorByline({ author, byline }: { readonly author: PaletteAppAuthor; readonly byline: string }) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const url = author.avatarURL;
  assert(url === undefined || url.length > 0, 'InsertAppRows: an avatar address is never empty');
  assert(byline.includes(author.login), 'InsertAppRows: the byline names the author');
  return (
    <span className="insert-item-sub insert-app-byline">
      {url !== undefined && failed !== url && (
        <img className="insert-app-avatar" src={url} alt="" width={AUTHOR_AVATAR_PX} height={AUTHOR_AVATAR_PX} onError={() => setFailed(url)} />
      )}
      <span className="insert-app-login">{byline}</span>
    </span>
  );
}

function AppIconTile({ app }: { readonly app: PaletteApp }) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const url = app.iconURL;
  assert(url === undefined || url.length > 0, 'InsertAppRows: an icon address is never empty');
  if (url !== undefined && failed !== url) {
    return <img className="insert-app-tile" src={url} alt="" width={APP_TILE_PX} height={APP_TILE_PX} onError={() => setFailed(url)} />;
  }
  return (
    <span className="insert-app-tile is-lettered" aria-hidden="true" style={{ background: app.color }}>
      {app.initial}
    </span>
  );
}

export function InsertMarketplaceRow({
  app,
  first,
  highlighted,
  onHover,
  onOpen,
}: {
  readonly app: PaletteApp;
  readonly first: boolean;
  readonly highlighted: boolean;
  readonly onHover: () => void;
  readonly onOpen: () => void;
}) {
  const translate = useTranslate();
  return (
    <div className="insert-marketplace-entry">
      {first && <div className="insert-section-heading">{translate('palette.apps.marketplace')}</div>}
      <InsertAppRow app={app} highlighted={highlighted} onHover={onHover} onOpen={onOpen} />
    </div>
  );
}

export function InsertAppsEmpty({
  empty,
  actions,
  highlight,
  onHover,
  onRun,
}: {
  readonly empty: AppsEmpty;
  readonly actions: readonly PaletteAppsAction[];
  readonly highlight: number;
  readonly onHover: (index: number) => void;
  readonly onRun: (action: PaletteAppsAction) => void;
}) {
  const translate = useTranslate();
  switch (empty.kind) {
    case 'loading':
      return <div className="props-empty">{translate('palette.apps.loading')}</div>;
    case 'failed':
      return <div className="props-empty">{empty.message}</div>;
    case 'none':
      assert(actions.length > 0, 'InsertAppRows: an empty Apps tab always offers a way on');
      return (
        <div className="insert-apps-empty" role="group" aria-label={translate('palette.apps.empty.title')}>
          <div className="insert-apps-empty-head">
            <span className="insert-apps-empty-tile" aria-hidden="true">
              <AppsIcon size={18} />
            </span>
            <span className="insert-apps-empty-text">
              <span className="insert-apps-empty-title">{translate('palette.apps.empty.title')}</span>
              <span className="insert-apps-empty-note">{translate('palette.apps.empty.note')}</span>
            </span>
          </div>
          {actions.map((action, index) => (
            <div
              key={action.key}
              className={`insert-item insert-apps-action ${index === highlight ? 'highlight' : ''}`}
              onMouseMove={index === highlight ? undefined : () => onHover(index)}
              onClick={() => onRun(action)}
            >
              <span className="insert-item-icon">{ACTION_ICONS[action.key]}</span>
              <span className="insert-item-label">{translate(action.labelKey)}</span>
            </div>
          ))}
        </div>
      );
    default: {
      const exhaustive: never = empty;
      return exhaustive;
    }
  }
}

const ACTION_ICONS: Readonly<Record<PaletteAppsAction['key'], ReactNode>> = {
  connect: <GitHubIcon size={14} />,
  buildApp: <SparkleIcon size={14} />,
  browse: <AppsIcon size={14} />,
};
