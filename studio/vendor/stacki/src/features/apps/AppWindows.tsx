import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { assert } from '../../../shared/core/assert';
import { appPopupSize, type AppSummary } from '../../../shared/properties/apps';
import type { RoleView } from '../../../shared/properties/projectRoles';
import DockableWindow, { type WindowMode } from '../../ui/DockableWindow';
import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import { CloseIcon } from '../../ui/Icons';
import { requestPanelWidth } from '../../ui/panelWidthRequests';
import { AppCustomFrames } from './AppCustomFrames';
import { AppFrame } from './AppFrame';
import { appFolderErrorNotice } from './appFolderChanges';
import { AppSetupGate } from './AppSettings';
import { AppTile } from './AppTile';
import { revealAppsPanel } from './appsDirectory';
import { appIdOfFrame, outlineModeOwner, setAppMode, stopApp, useAppsRuntime, type RunningApp } from './appsRuntime';
import {
  APP_WINDOW_MINIMUM_SIZE,
  appModeOf,
  appPanelWidth,
  appWindowStorageKey,
  dockModeOf,
  setAppDockSlot,
  shownDockedApp,
  storeAppPanelWidth,
  storeAppWindowMode,
  useAppDockSlot,
} from './appWindowPreferences';

export function AppDockSlot() {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = slot.current ?? undefined;
    assert(element !== undefined, 'The dock slot is mounted before its layout effect');
    setAppDockSlot(element);
    return () => setAppDockSlot(undefined);
  }, []);
  return <div ref={slot} className="apps-panel apps-dock-slot" />;
}

export function AppWindows({ projectPath, role }: { readonly projectPath: string; readonly role: RoleView }) {
  const runtime = useAppsRuntime();
  const slot = useAppDockSlot();
  const layer = useRef<HTMLDivElement>(null);
  const shown = slot === undefined ? undefined : shownDockedApp(runtime.running, role);
  useDockBox(slot, layer);
  useDockedPanelWidth(projectPath, shown?.app);
  useOutlineRestore(shown?.app.manifest.id);
  return (
    <div ref={layer} className="apps-windows">
      {runtime.running.map((running) => (
        <AppWindow key={running.app.manifest.id} projectPath={projectPath} running={running} hidden={running !== shown} />
      ))}
      <AppCustomFrames />
    </div>
  );
}

function useOutlineRestore(shownAppId: string | undefined): void {
  useEffect(() => {
    if (shownAppId !== undefined) {
      outlineModeOwner.restore(shownAppId);
    }
  }, [shownAppId]);
  useEffect(() => {
    const onBlur = (): void => {
      const active = document.activeElement;
      const source = active instanceof HTMLIFrameElement ? (active.contentWindow ?? undefined) : undefined;
      const appId = source === undefined ? undefined : appIdOfFrame(source);
      if (appId !== undefined) {
        outlineModeOwner.restore(appId);
      }
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);
}

function AppWindow({ projectPath, running, hidden }: { readonly projectPath: string; readonly running: RunningApp; readonly hidden: boolean }) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const { app } = running;
  const size = appPopupSize(app.manifest.window);
  const changeMode = (next: WindowMode): void => {
    const mode = appModeOf(next);
    if (!setAppMode(app.manifest.id, mode)) {
      return;
    }
    storeAppWindowMode(projectPath, app.manifest.id, mode);
    if (mode === 'panel') {
      revealAppsPanel();
    }
  };
  return (
    <DockableWindow
      mode={dockModeOf(running.mode)}
      onModeChange={changeMode}
      label={app.manifest.name}
      className="apps-window"
      hidden={hidden}
      minimumSize={APP_WINDOW_MINIMUM_SIZE}
      initialSize={{ width: size.widthPx, height: size.heightPx }}
      storageKey={appWindowStorageKey(projectPath, app.manifest.id)}
      header={<AppWindowHeader app={app} />}
      trailing={<AppWindowClose app={app} />}
    >
      {running.folderError !== undefined && (
        <p className="apps-folder-error" role="status">
          {appFolderErrorNotice(translateDescribed({ message: running.folderError, messageRef: running.folderErrorRef }), translate)}
        </p>
      )}
      <AppSetupGate projectPath={projectPath} app={app}>
        <AppFrame app={app} title={app.manifest.name} className="apps-frame" />
      </AppSetupGate>
    </DockableWindow>
  );
}

function AppWindowHeader({ app }: { readonly app: AppSummary }) {
  return (
    <span className="apps-running-title">
      <AppTile manifest={app.manifest} size={18} />
      <h2>{app.manifest.name}</h2>
    </span>
  );
}

function AppWindowClose({ app }: { readonly app: AppSummary }) {
  const translate = useTranslate();
  return (
    <button
      type="button"
      className="ghost apps-icon-button"
      onClick={() => stopApp(app.manifest.id)}
      title={translate('apps.frame.closeApp')}
      aria-label={translate('apps.frame.closeNamed', { name: app.manifest.name })}
    >
      <CloseIcon size={13} />
    </button>
  );
}

interface DockBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function useDockBox(slot: HTMLElement | undefined, layer: React.RefObject<HTMLDivElement>): void {
  const [box, setBox] = useState<DockBox | undefined>(undefined);
  useLayoutEffect(() => {
    if (slot === undefined) {
      setBox(undefined);
      return undefined;
    }
    const measure = (): void => {
      const rectangle = slot.getBoundingClientRect();
      setBox({ left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height });
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(slot);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [slot]);
  useLayoutEffect(() => {
    const element = layer.current;
    if (element === null) {
      return;
    }
    if (box === undefined) {
      return;
    }
    element.style.setProperty('--apps-dock-left', `${box.left}px`);
    element.style.setProperty('--apps-dock-top', `${box.top}px`);
    element.style.setProperty('--apps-dock-width', `${box.width}px`);
    element.style.setProperty('--apps-dock-height', `${box.height}px`);
  }, [box, layer]);
}

export function useDockedPanelWidth(projectPath: string, app: AppSummary | undefined): void {
  useEffect(() => {
    if (app === undefined) {
      return undefined;
    }
    const widthPx = appPanelWidth(projectPath, app);
    if (widthPx === undefined) {
      return undefined;
    }
    const appId = app.manifest.id;
    return requestPanelWidth('left', { widthPx, onResize: (resized) => storeAppPanelWidth(projectPath, appId, resized) });
  }, [projectPath, app]);
}
