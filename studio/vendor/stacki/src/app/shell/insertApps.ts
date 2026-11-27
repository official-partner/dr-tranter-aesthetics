import { useEffect, useMemo, useState } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { PaletteApp, PaletteAppList, PaletteAppsSource } from '../../features/palette/paletteApps';
import { canSeePaletteApps } from '../../features/palette/paletteApps';
import { listAppDirectory, requestAppConnect, type AppDirectoryEntry } from '../../features/apps/appsDirectory';
import { useAppsRefresh } from '../../features/apps/appsRefresh';
import { platformShortcutLabel, runAppCommand, useAppCommands, type BoundCommand } from '../../features/apps/appCommands';
import { requestBuildApp } from '../../features/apps/appPrompt';
import { assert } from '../../../shared/core/assert';
import { appsFailureMessage } from '../../../shared/properties/apps';
import type { MarketplaceApp } from '../../../shared/properties/appMarketplace';
import { can, type RoleView } from '../../../shared/properties/projectRoles';
import { githubLoginAvatar } from '../../../shared/ipc/commitAvatars';
import { loadMarketplace } from '../../ipc/appMarketplaceBridge';
import { appTileColor, appTileInitial } from '../../features/apps/AppTile';
import { requestMarketplaceApp } from '../../features/apps/marketplace/marketplaceRequests';

export type InsertAppsNotify = (message: string, kind: 'success' | 'error') => void;

export interface InsertAppsHost {
  readonly projectPath: string;
  readonly role: RoleView;
  readonly browse: () => void;
  readonly notify: InsertAppsNotify;
}

let lastRead: { readonly projectPath: string; readonly entries: readonly AppDirectoryEntry[] } | undefined;

export function useInsertAppsSource({ projectPath, role, browse, notify }: InsertAppsHost): PaletteAppsSource {
  const entries = useAppDirectory(projectPath, role);
  const market = useMarketplaceApps(projectPath, role);
  const commands = useAppCommands();
  const translate = useTranslate();
  return useMemo((): PaletteAppsSource => {
    const installed = entries.kind === 'ready' ? new Set(entries.entries.map((entry) => entry.id)) : new Set<string>();
    return {
      list: withCommands(paletteList(entries, browse), commands),
      browse,
      connect: requestAppConnect,
      buildApp: () => void requestBuildApp(translate, notify),
      marketplace: market.filter((app) => !installed.has(app.id)).map(paletteMarketplaceApp),
    };
  }, [entries, market, browse, notify, commands, translate]);
}

function useMarketplaceApps(projectPath: string, role: RoleView): readonly MarketplaceApp[] {
  const [apps, setApps] = useState<readonly MarketplaceApp[]>([]);
  const allowed = can(role, 'marketplace:view');
  useEffect(() => {
    if (!allowed) {
      setApps([]);
      return undefined;
    }
    let current = true;
    void loadMarketplace(projectPath, { refresh: false }).then(
      (answer) => {
        if (current) {
          setApps(answer.ok ? answer.value.apps : []);
        }
      },
      () => {
        if (current) {
          setApps([]);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [allowed, projectPath]);
  return apps;
}

function paletteMarketplaceApp(app: MarketplaceApp): PaletteApp {
  assert(app.id.length > 0, 'insertApps: a marketplace app has an id');
  assert(app.iconURL.length > 0, 'insertApps: a marketplace app has an icon');
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    author: { login: app.author, avatarURL: githubLoginAvatar(app.author) },
    iconURL: app.iconURL,
    initial: appTileInitial(app.name),
    color: appTileColor(app.id),
    open: () => requestMarketplaceApp(app.id),
  };
}

type DirectoryLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly entries: readonly AppDirectoryEntry[] };

function useAppDirectory(projectPath: string, role: RoleView): DirectoryLoad {
  assert(projectPath.length > 0, 'insertApps: a project has a path');
  const [load, setLoad] = useState<DirectoryLoad>(() =>
    lastRead?.projectPath === projectPath ? { kind: 'ready', entries: lastRead.entries } : { kind: 'loading' },
  );
  const refreshTick = useAppsRefresh();
  const allowed = canSeePaletteApps(role);
  useEffect(() => {
    if (!allowed) {
      return undefined;
    }
    let current = true;
    void listAppDirectory(projectPath, role).then(
      (answer) => {
        if (!current) {
          return;
        }
        if (answer.ok) {
          lastRead = { projectPath, entries: answer.value };
          setLoad({ kind: 'ready', entries: answer.value });
        } else {
          setLoad({ kind: 'failed', message: answer.message });
        }
      },
      (error: unknown) => {
        if (current) {
          setLoad({ kind: 'failed', message: appsFailureMessage(error) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [allowed, projectPath, role, refreshTick]);
  return load;
}

function paletteList(load: DirectoryLoad, browse: () => void): PaletteAppList {
  switch (load.kind) {
    case 'loading':
      return load;
    case 'failed':
      return load;
    case 'ready': {
      const apps = load.entries.map((entry): PaletteApp => paletteApp(entry, browse));
      assert(apps.length === load.entries.length, 'insertApps: one palette app per entry');
      return { kind: 'ready', apps };
    }
    default: {
      const exhaustive: never = load;
      return exhaustive;
    }
  }
}

function withCommands(list: PaletteAppList, commands: readonly BoundCommand[]): PaletteAppList {
  if (list.kind !== 'ready') {
    return list;
  }
  const apps = list.apps.map((app) => ({
    ...app,
    commands: commands
      .filter((entry) => entry.app.manifest.id === app.id)
      .map((entry) => ({
        id: entry.command.id,
        title: entry.command.title,
        shortcut: entry.shortcut === undefined ? undefined : platformShortcutLabel(entry.shortcut),
        run: () => {
          runAppCommand(app.id, entry.command.id);
        },
      })),
  }));
  return { kind: 'ready', apps };
}

function paletteApp(entry: AppDirectoryEntry, browse: () => void): PaletteApp {
  assert(entry.id.length > 0, 'insertApps: an app has an id');
  assert(entry.authorAvatarURL === undefined || entry.authorLogin !== undefined, 'insertApps: a picture belongs to a named author');
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    author: entry.authorLogin === undefined ? undefined : { login: entry.authorLogin, avatarURL: entry.authorAvatarURL },
    iconURL: entry.iconURL,
    initial: entry.initial,
    color: entry.color,
    open: () => {
      browse();
      entry.open();
    },
  };
}
