import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import { can, type RoleView } from '../../../shared/properties/projectRoles';
import { APP_LIMITS, appAuthorLogin, type AppsResult } from '../../../shared/properties/apps';
import { githubLoginAvatar } from '../../../shared/ipc/commitAvatars';
import { appAccessFeature } from '../../../shared/properties/appsRpc';
import { listApps } from '../../ipc/appsBridge';
import { appIconURL, appTileColor, appTileInitial } from './AppTile';
import { launchApp } from './appsRuntime';
import { appOpeningMode } from './appWindowPreferences';
import { setAppDetailsReveal } from './appDetailsRequests';

export interface AppDirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly iconURL: string | undefined;
  readonly initial: string;
  readonly color: string;
  readonly hasUpdate: boolean;
  readonly authorLogin: string | undefined;
  readonly authorAvatarURL: string | undefined;
  readonly open: () => void;
}

let revealPanel: (() => void) | undefined;

export type AppsPanelRequest = 'connect' | 'marketplace';

let pendingRequest: { readonly kind: AppsPanelRequest; readonly serial: number } | undefined;
let requestSerial = 0;
const requestListeners = new Set<() => void>();

function request(kind: AppsPanelRequest): void {
  requestSerial += 1;
  pendingRequest = { kind, serial: requestSerial };
  revealPanel?.();
  for (const listener of [...requestListeners]) {
    listener();
  }
}

export function requestAppConnect(): void {
  request('connect');
}

export function requestAppMarketplace(): void {
  request('marketplace');
}

export function useAppsPanelRequest(): { readonly request: AppsPanelRequest | undefined; readonly handled: () => void } {
  const current = useSyncExternalStore(
    (listener) => {
      requestListeners.add(listener);
      return () => {
        requestListeners.delete(listener);
      };
    },
    () => pendingRequest,
  );
  return {
    request: current?.kind,
    handled: () => {
      if (pendingRequest?.serial === current?.serial) {
        pendingRequest = undefined;
        for (const listener of [...requestListeners]) {
          listener();
        }
      }
    },
  };
}

export function revealAppsPanel(): void {
  revealPanel?.();
}

export function setAppsPanelReveal(reveal: (() => void) | undefined): void {
  revealPanel = reveal;
  setAppDetailsReveal(reveal);
}

export async function listAppDirectory(projectPath: string, role: RoleView): Promise<AppsResult<readonly AppDirectoryEntry[]>> {
  const answer = await listApps(projectPath);
  if (!answer.ok) {
    return answer;
  }
  const entries = answer.value
    .filter((app) => can(role, appAccessFeature(app.manifest.id)))
    .map((app): AppDirectoryEntry => ({
      id: app.manifest.id,
      name: app.manifest.name,
      description: app.manifest.description,
      version: app.manifest.version,
      iconURL: appIconURL(app.manifest),
      initial: appTileInitial(app.manifest.name),
      color: appTileColor(app.manifest.id),
      hasUpdate: app.lock.update !== undefined,
      authorLogin: appAuthorLogin(app),
      authorAvatarURL: authorAvatar(appAuthorLogin(app)),
      open: () => {
        if (launchApp(app, appOpeningMode(projectPath, app)) === 'panel') {
          revealPanel?.();
        }
      },
    }));
  assert(entries.length <= APP_LIMITS.appsMax, 'The directory is bounded by the installed apps');
  return { ok: true, value: entries };
}

function authorAvatar(login: string | undefined): string | undefined {
  return login === undefined ? undefined : githubLoginAvatar(login);
}
