import { useTranslate } from '../lib/i18n/useTranslate';
import { useEffect, useState } from 'react';
import { assert } from '../../shared/core/assert';
import { APP_LIMITS, type AppSummary } from '../../shared/properties/apps';
import { appAccessFeature } from '../../shared/properties/appsRpc';
import { ROLE_LIMITS, can, type RoleView } from '../../shared/properties/projectRoles';
import { listApps } from '../ipc/appsBridge';
import { badgeText, useAppBadgeCount } from '../features/apps/appBadges';
import { AppTile } from '../features/apps/AppTile';
import { useAppsRefresh } from '../features/apps/appsRefresh';
import { launchApp, useAppsRuntime } from '../features/apps/appsRuntime';
import { revealAppsPanel } from '../features/apps/appsDirectory';
import { appOpeningMode, shownDockedApp } from '../features/apps/appWindowPreferences';

export function railAppId(appId: string): string {
  assert(appId.length > 0, 'A pinned app has an id');
  return `app:${appId}`;
}

export function pinnedRailApps(role: RoleView, installed: readonly AppSummary[]): readonly AppSummary[] {
  assert(role.pinnedApps.length <= ROLE_LIMITS.pinnedAppsMax, 'Pins are bounded by the roles parser');
  assert(installed.length <= APP_LIMITS.appsMax, 'Installed apps are bounded');
  const apps: AppSummary[] = [];
  for (const appId of role.pinnedApps) {
    const app = installed.find((candidate) => candidate.manifest.id === appId);
    if (app !== undefined && can(role, appAccessFeature(appId))) {
      apps.push(app);
    }
  }
  assert(apps.length <= role.pinnedApps.length, 'The rail never shows more apps than were pinned');
  return apps;
}

export function usePinnedRailApps(projectPath: string | undefined, role: RoleView, reread: string | undefined): readonly AppSummary[] {
  const [installed, setInstalled] = useState<{ readonly projectPath: string; readonly apps: readonly AppSummary[] } | undefined>(undefined);
  const refreshTick = useAppsRefresh();
  const pins = role.pinnedApps.join(' ');
  useEffect(() => {
    if (projectPath === undefined || pins.length === 0) {
      return undefined;
    }
    let lifetime: 'active' | 'disposed' = 'active';
    const settle = (apps: readonly AppSummary[]) => {
      if (lifetime === 'active') {
        setInstalled({ projectPath, apps });
      }
    };
    void listApps(projectPath).then(
      (answer) => settle(answer.ok ? answer.value : []),
      () => settle([]),
    );
    return () => {
      lifetime = 'disposed';
    };
  }, [projectPath, pins, refreshTick, reread]);
  if (installed === undefined || installed.projectPath !== projectPath) {
    return [];
  }
  return pinnedRailApps(role, installed.apps);
}

export function useShownPinnedApp(role: RoleView, appsOpen: 'open' | 'closed'): string | undefined {
  const runtime = useAppsRuntime();
  if (appsOpen === 'closed') {
    return undefined;
  }
  return shownDockedApp(runtime.running, role)?.app.manifest.id;
}

export function openPinnedApp(projectPath: string, app: AppSummary): void {
  assert(projectPath.length > 0, 'A pinned app opens in a project');
  const mode = launchApp(app, appOpeningMode(projectPath, app));
  if (mode === 'panel') {
    revealAppsPanel();
  }
}

export function RailAppFace({ app }: { readonly app: AppSummary }) {
  return (
    <>
      <AppTile manifest={app.manifest} size={20} />
      <RailAppCount appId={app.manifest.id} name={app.manifest.name} />
    </>
  );
}

function RailAppCount({ appId, name }: { readonly appId: string; readonly name: string }) {
  const count = useAppBadgeCount(appId);
  const translate = useTranslate();
  if (count === 0) {
    return undefined;
  }
  return (
    <span className="apps-rail-count" role="status" aria-label={translate('rail.appWaiting', { name, count })}>
      {badgeText(count)}
    </span>
  );
}
