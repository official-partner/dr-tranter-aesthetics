import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import { APP_LIMITS, type AppSummary, type AppWindowMode } from '../../../shared/properties/apps';
import { appAccessFeature } from '../../../shared/properties/appsRpc';
import { can, type RoleView } from '../../../shared/properties/projectRoles';
import type { WindowMode } from '../../ui/DockableWindow';
import type { WindowSize } from '../../ui/windowGeometry';
import type { RunningApp } from './appsRuntime';

export const APP_WINDOW_MINIMUM_SIZE: WindowSize = { width: APP_LIMITS.windowWidthPxMin, height: APP_LIMITS.windowHeightPxMin };

const KEY_PREFIX = 'stacki.app.window';
const STORED_MODE_CHARS_MAX = 8;
const STORED_WIDTH_CHARS_MAX = 4;

export function appWindowStorageKey(projectPath: string, appId: string): string {
  assert(projectPath.length > 0, 'An app window key names its project');
  assert(appId.length > 0, 'An app window key names its app');
  assert(appId.length <= APP_LIMITS.idCharsMax, 'An app window key names a bounded app id');
  return `${KEY_PREFIX}.${encodeURIComponent(projectPath)}.${appId}`;
}

export function appOpeningMode(projectPath: string, app: AppSummary): AppWindowMode {
  return readStored(`${appWindowStorageKey(projectPath, app.manifest.id)}.mode`, parseStoredAppWindowMode) ?? app.manifest.window.mode;
}

export function storeAppWindowMode(projectPath: string, appId: string, mode: AppWindowMode): void {
  writeStored(`${appWindowStorageKey(projectPath, appId)}.mode`, mode);
}

export function appPanelWidth(projectPath: string, app: AppSummary): number | undefined {
  const stored = readStored(`${appWindowStorageKey(projectPath, app.manifest.id)}.panelWidth`, parseStoredAppPanelWidth);
  return stored ?? app.manifest.window.widthPx;
}

export function storeAppPanelWidth(projectPath: string, appId: string, widthPx: number): void {
  assert(parseStoredAppPanelWidth(String(widthPx)) === widthPx, 'A stored app panel width is a valid manifest width');
  writeStored(`${appWindowStorageKey(projectPath, appId)}.panelWidth`, String(widthPx));
}

export function parseStoredAppPanelWidth(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > STORED_WIDTH_CHARS_MAX) {
    return undefined;
  }
  const width = Number(raw);
  if (!Number.isSafeInteger(width)) {
    return undefined;
  }
  if (width < APP_LIMITS.windowWidthPxMin) {
    return undefined;
  }
  return width <= APP_LIMITS.windowWidthPxMax ? width : undefined;
}

export function parseStoredAppWindowMode(raw: unknown): AppWindowMode | undefined {
  if (typeof raw !== 'string' || raw.length > STORED_MODE_CHARS_MAX) {
    return undefined;
  }
  if (raw === 'panel' || raw === 'popup') {
    return raw;
  }
  return undefined;
}

export function dockModeOf(mode: AppWindowMode): WindowMode {
  switch (mode) {
    case 'panel':
      return 'docked';
    case 'popup':
      return 'floating';
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function appModeOf(mode: WindowMode): AppWindowMode {
  switch (mode) {
    case 'docked':
      return 'panel';
    case 'floating':
      return 'popup';
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function shownDockedApp(running: readonly RunningApp[], role: RoleView): RunningApp | undefined {
  const docked = running.filter((entry) => entry.mode === 'panel' && can(role, appAccessFeature(entry.app.manifest.id)));
  const shown = docked.at(-1);
  assert(shown === undefined || shown.mode === 'panel', 'The shown docked app is docked');
  return shown;
}

let dockSlot: HTMLElement | undefined;
const slotListeners = new Set<() => void>();

export function setAppDockSlot(element: HTMLElement | undefined): void {
  if (dockSlot === element) {
    return;
  }
  dockSlot = element;
  for (const listener of [...slotListeners]) {
    listener();
  }
}

export function useAppDockSlot(): HTMLElement | undefined {
  return useSyncExternalStore(
    (listener) => {
      slotListeners.add(listener);
      return () => {
        slotListeners.delete(listener);
      };
    },
    () => dockSlot,
  );
}

function readStored<T>(key: string, parse: (raw: unknown) => T | undefined): T | undefined {
  try {
    return parse(localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}
