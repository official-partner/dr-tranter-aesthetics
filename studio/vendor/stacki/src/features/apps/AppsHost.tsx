import { useEffect, useRef, type MutableRefObject } from 'react';
import type { RoleView } from '../../../shared/properties/projectRoles';
import { APP_RPC_LIMITS, type AppChangeSource, type AppEventData } from '../../../shared/properties/appsRpc';
import { checkAppUpdates, listApps } from '../../ipc/appsBridge';
import { shortcutOfPress } from '../../../shared/properties/appShortcuts';
import { configureAppCommands, runShortcutCommand } from './appCommands';
import { isShortcutRecorderTarget } from '../../ui/ShortcutRecorder';
import { cmsTransport, onPropertyFilesChanged, onVariablesChanged } from '../../ipc/editorEnvironment';
import { onAssetEntriesChanged } from '../../ipc/assetBridge';
import { AppWindows } from './AppWindows';
import { bumpAppsRefresh, useAppsRefresh } from './appsRefresh';
import {
  appOverrideSlot,
  configureAppsRuntime,
  emitAppEvent,
  emitProjectChange,
  emitRoleChange,
  emitToApp,
  noteLeftPanel,
  nodeRefTargets,
  outlineModeOwner,
  overridesChanged,
  stopAllApps,
  stopApp,
} from './appsRuntime';
import { clearAppBadges, keepAppBadges } from './appBadges';
import { setAppOverrideSlot } from '../../ui/appOverrideSlot';
import { noteUpdateOutcomes } from './appUpdates';
import { useAppFolderChanges } from './appFolderChanges';
import type { AppHostCommands } from './appRpcHost';
import { watchAppTheme } from './appTheme';
import './apps.css';

const REF_REFRESH_DELAY_MS = 600;

export const APP_UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

export interface AppEventState {
  readonly selection: string | undefined;
  readonly hover: string | undefined;
  readonly viewport: AppEventData['canvas.change'];
  readonly panels: AppEventData['panels.change'];
  readonly pagePath: string | undefined;
  readonly pageVersion: string | undefined;
}

export function AppsHost({
  projectPath,
  host,
  role,
  state,
  notify,
}: {
  readonly projectPath: string;
  readonly host: AppHostCommands;
  readonly role: RoleView;
  readonly state: AppEventState;
  readonly notify: (message: string, kind: 'info' | 'success' | 'error') => void;
}) {
  const roleRef = useRef(role);
  roleRef.current = role;
  configureAppsRuntime(host, () => roleRef.current);
  useEffect(
    () => () => {
      stopAllApps();
      clearAppBadges();
    },
    [projectPath],
  );
  useEffect(() => {
    setAppOverrideSlot(appOverrideSlot);
    return () => setAppOverrideSlot(undefined);
  }, []);
  useEffect(() => overridesChanged(), [role]);
  useStateEvents(state, role, projectPath);
  useProjectChangeEvents(projectPath);
  useStorageEvents(host);
  usePersonEvents(host);
  useAuthEvents(host);
  useThemeEvents();
  useUpdateChecks(projectPath, role, notify);
  useAppFolderChanges(projectPath);
  useAppCommandKeys(projectPath, roleRef);
  return <AppWindows projectPath={projectPath} role={role} />;
}

function useStateEvents(state: AppEventState, role: RoleView, projectPath: string): void {
  useEffect(() => emitAppEvent('selection.change', { nodeId: state.selection }), [state.selection]);
  useEffect(() => emitAppEvent('hover.change', { nodeId: state.hover }), [state.hover]);
  const { widthPx, heightPx, scale, device } = state.viewport;
  useEffect(() => emitAppEvent('canvas.change', { widthPx, heightPx, scale, device }), [widthPx, heightPx, scale, device]);
  const { left, right } = state.panels;
  useEffect(() => emitAppEvent('panels.change', { left, right }), [left, right]);
  useEffect(() => emitAppEvent('page.change', { path: state.pagePath }), [state.pagePath]);
  const changedPage = state.pagePath === undefined ? undefined : projectRelativePath(projectPath, state.pagePath);
  const changedPageRef = useRef(changedPage);
  changedPageRef.current = changedPage;
  useEffect(() => {
    if (state.pageVersion !== undefined) {
      const page = changedPageRef.current;
      emitProjectChange('page', page === undefined ? [] : [page]);
    }
  }, [state.pageVersion]);
  useEffect(() => {
    noteLeftPanel(state.panels.left);
  }, [state.panels.left]);
  useEffect(() => () => void outlineModeOwner.reset('project'), [projectPath]);
  useEffect(() => {
    nodeRefTargets.refresh();
    const later = setTimeout(() => nodeRefTargets.refresh(), REF_REFRESH_DELAY_MS);
    return () => clearTimeout(later);
  }, [state.pageVersion, state.pagePath]);
  useEffect(() => emitRoleChange(), [role]);
}

function useAppCommandKeys(projectPath: string, roleRef: MutableRefObject<RoleView>): void {
  const refreshTick = useAppsRefresh();
  useEffect(() => {
    let current = true;
    void listApps(projectPath).then(
      (answer) => {
        if (current) {
          configureAppCommands(projectPath, answer.ok ? answer.value : [], () => roleRef.current);
          if (answer.ok) {
            keepAppBadges(answer.value.map((app) => app.manifest.id));
          }
        }
      },
      () => {
        if (current) {
          configureAppCommands(projectPath, [], () => roleRef.current);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [projectPath, refreshTick, roleRef]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isShortcutRecorderTarget(event.target)) {
        return;
      }
      const shortcut = shortcutOfPress(event);
      if (shortcut !== undefined && runShortcutCommand(shortcut)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
}

function useProjectChangeEvents(projectPath: string): void {
  useEffect(() => {
    const emit = (source: AppChangeSource) => () => emitProjectChange(source, []);
    const stops = [
      cmsTransport.onCmsChanged(emit('cms')),
      onVariablesChanged(emit('styles')),
      onAssetEntriesChanged(emit('assets')),
      onPropertyFilesChanged((event) => {
        const paths: string[] = [];
        for (const file of event.files.slice(0, APP_RPC_LIMITS.changePathsMax + 1)) {
          const relative = projectRelativePath(projectPath, file);
          if (relative !== undefined) {
            paths.push(relative);
          }
        }
        emitProjectChange('files', paths);
      }),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [projectPath]);
}

export function projectRelativePath(projectPath: string, file: string): string | undefined {
  const normalized = file.replace(/\\/g, '/');
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
  if (!absolute) {
    return normalized.replace(/^\.\//, '');
  }
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : undefined;
}

function useStorageEvents(host: AppHostCommands): void {
  useEffect(
    () =>
      host.storage.watch((change) => {
        const origin = change.writer === host.storage.writer ? 'self' : 'other';
        if (change.keys === undefined) {
          emitToApp(change.appId, 'storage.change', { key: undefined, scope: change.scope, origin });
          return;
        }
        for (const key of change.keys) {
          emitToApp(change.appId, 'storage.change', { key, scope: change.scope, origin });
        }
      }),
    [host],
  );
}

function useThemeEvents(): void {
  useEffect(() => watchAppTheme((view) => emitAppEvent('theme.change', view)), []);
}

function useAuthEvents(host: AppHostCommands): void {
  useEffect(() => {
    const auth = host.auth;
    if (auth === undefined) {
      return undefined;
    }
    return auth.watch((appId) => {
      void auth.status(appId).then(
        (answer) => {
          if (answer.ok) {
            for (const status of answer.value) {
              emitToApp(appId, 'auth.change', status);
            }
          }
        },
        () => undefined,
      );
    });
  }, [host]);
}

function usePersonEvents(host: AppHostCommands): void {
  useEffect(
    () =>
      host.onPersonChange(() => {
        void host.person().then(
          (person) => emitAppEvent('person.change', person),
          () => undefined,
        );
      }),
    [host],
  );
}

function useUpdateChecks(projectPath: string, role: RoleView, notify: (message: string, kind: 'info' | 'success' | 'error') => void): void {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const adminRef = useRef(role.isAdmin);
  adminRef.current = role.isAdmin;
  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      try {
        const answer = await checkAppUpdates(projectPath, { force: false });
        if (!active || !answer.ok) {
          return;
        }
        noteUpdateOutcomes(answer.value);
        const available = answer.value.filter((outcome) => outcome.kind === 'available');
        const held = answer.value.filter((outcome) => outcome.kind === 'needs-approval');
        const updated = answer.value.filter((outcome) => outcome.kind === 'updated');
        for (const outcome of updated) {
          stopApp(outcome.id);
        }
        if (available.length + held.length + updated.length > 0) {
          bumpAppsRefresh();
        }
        if (updated.length > 0) {
          notifyRef.current(
            updated.length === 1 ? 'An app updated itself (auto-update is on).' : `${updated.length} apps updated themselves (auto-update is on).`,
            'info',
          );
        }
        if (adminRef.current && held.length > 0) {
          notifyRef.current(
            held.length === 1 ? 'An app update needs your OK in the Apps panel.' : `${held.length} app updates need your OK in the Apps panel.`,
            'info',
          );
        }
        if (adminRef.current && available.length > 0) {
          notifyRef.current(
            available.length === 1 ? 'An app update is available in the Apps panel.' : `${available.length} app updates are available in the Apps panel.`,
            'info',
          );
        }
      } catch {
      }
    };
    void check();
    const timer = setInterval(() => void check(), APP_UPDATE_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectPath]);
}
