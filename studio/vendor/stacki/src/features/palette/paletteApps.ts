import { assert } from '../../../shared/core/assert';
import { APP_LIMITS } from '../../../shared/properties/apps';
import { MARKETPLACE_LIMITS } from '../../../shared/properties/appMarketplace';
import { appAccessFeature } from '../../../shared/properties/appsRpc';
import type { MessageKey } from '../../../shared/properties/i18n/messageRef';
import { can, type RoleView } from '../../../shared/properties/projectRoles';

export interface PaletteApp {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly author: PaletteAppAuthor | undefined;
  readonly iconURL: string | undefined;
  readonly initial: string;
  readonly color: string;
  readonly open: () => void;
  readonly commands?: readonly PaletteAppCommand[] | undefined;
  readonly shortcut?: string | undefined;
}

export interface PaletteAppCommand {
  readonly id: string;
  readonly title: string;
  readonly shortcut: string | undefined;
  readonly run: () => void;
}

export interface PaletteAppAuthor {
  readonly login: string;
  readonly avatarURL: string | undefined;
}

export type PaletteAppList =
  { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'ready'; readonly apps: readonly PaletteApp[] };

export interface PaletteAppsSource {
  readonly list: PaletteAppList;
  readonly browse: () => void;
  readonly connect?: (() => void) | undefined;
  readonly buildApp?: (() => void) | undefined;
  readonly marketplace?: readonly PaletteApp[] | undefined;
}

export interface PaletteAppsAction {
  readonly key: 'connect' | 'buildApp' | 'browse';
  readonly label: string;
  readonly labelKey: MessageKey;
  readonly run: () => void;
}

export function paletteAppsActions(source: PaletteAppsSource, role: RoleView): readonly PaletteAppsAction[] {
  assert(canSeePaletteApps(role), 'paletteApps: only a role with the Apps panel has an Apps tab');
  const browse: PaletteAppsAction = { key: 'browse', label: 'Open Apps panel', labelKey: 'palette.apps.action.browse', run: source.browse };
  const buildApp: PaletteAppsAction = {
    key: 'buildApp',
    label: 'Build an app',
    labelKey: 'palette.apps.action.buildApp',
    run: source.buildApp ?? source.browse,
  };
  if (!role.isAdmin) {
    return [buildApp, browse];
  }
  const connect: PaletteAppsAction = {
    key: 'connect',
    label: 'Load App From GitHub',
    labelKey: 'palette.apps.action.connect',
    run: source.connect ?? source.browse,
  };
  const actions: readonly PaletteAppsAction[] = [connect, buildApp, browse];
  assert(actions.at(-1) === browse, 'paletteApps: the panel is the last way on');
  return actions;
}

export interface PaletteAppItem {
  readonly type: 'app';
  readonly app: PaletteApp;
  readonly name: string;
  readonly label: string;
  readonly sub: string;
  readonly cat: 'apps';
}

export interface PaletteMarketplaceItem {
  readonly type: 'marketplace';
  readonly app: PaletteApp;
  readonly name: string;
  readonly label: string;
  readonly sub: string;
  readonly cat: 'apps';
}

export function paletteMarketplaceItems(apps: readonly PaletteApp[], role: RoleView): readonly PaletteMarketplaceItem[] {
  assert(apps.length <= MARKETPLACE_LIMITS.appsMax, 'paletteApps: marketplace apps are bounded by the index');
  if (!canSeePaletteApps(role)) {
    return [];
  }
  if (!can(role, 'marketplace:view')) {
    return [];
  }
  const items = apps.map((app): PaletteMarketplaceItem => ({
    type: 'marketplace',
    app,
    name: app.name,
    label: app.name,
    sub: `${app.id} ${app.description}`,
    cat: 'apps',
  }));
  assert(items.length === apps.length, 'paletteApps: one row per marketplace app');
  return items;
}

export function canSeePaletteApps(role: RoleView): boolean {
  assert(role.id.length > 0, 'paletteApps: a role has an id');
  const allowed = can(role, 'panel:apps');
  assert(!role.isAdmin || allowed, 'paletteApps: an admin always sees Apps');
  return allowed;
}

export function visiblePaletteApps(apps: readonly PaletteApp[], role: RoleView): readonly PaletteApp[] {
  assert(apps.length <= APP_LIMITS.appsMax, 'paletteApps: installed apps are bounded');
  if (!canSeePaletteApps(role)) {
    return [];
  }
  const visible = apps.filter((app) => can(role, appAccessFeature(app.id)));
  assert(visible.length <= apps.length, 'paletteApps: filtering never adds apps');
  return visible;
}

export function paletteAppItems(apps: readonly PaletteApp[]): readonly PaletteAppItem[] {
  assert(apps.length <= APP_LIMITS.appsMax, 'paletteApps: installed apps are bounded');
  const items = apps.map(appItem);
  assert(items.length === apps.length, 'paletteApps: one row per app');
  return items;
}

function appItem(app: PaletteApp): PaletteAppItem {
  return { type: 'app', app, name: app.name, label: app.name, sub: app.description === '' ? app.id : `${app.id} ${app.description}`, cat: 'apps' };
}

export function paletteAppByline(app: PaletteApp): string | undefined {
  assert(app.name.length > 0, 'paletteApps: an app has a name');
  if (app.author === undefined) {
    return undefined;
  }
  assert(app.author.login.length > 0, 'paletteApps: an author has a login');
  return `by ${app.author.login}`;
}
