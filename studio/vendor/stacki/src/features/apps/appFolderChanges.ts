import { useEffect } from 'react';
import { assert } from '../../../shared/core/assert';
import type { AppSummary } from '../../../shared/properties/apps';
import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { APP_FOLDER_LIMITS, joinBrokenRows, type AppFolderBroken } from '../../../shared/properties/appFolders';
import { listInstalledAppList } from '../../ipc/appsBridge';
import { listBrokenAppFolders, onAppFoldersChanged } from '../../ipc/appFoldersBridge';
import { bumpAppFileRevisions } from './appFileRevisions';
import { bumpAppsRefresh } from './appsRefresh';
import { runningApps, settleRunningApp, stopApp } from './appsRuntime';

export function useAppFolderChanges(projectPath: string): void {
  useEffect(() => {
    const settler = createAppFolderSettler({
      settleMs: APP_FOLDER_LIMITS.settleMs,
      schedule: (delayMs, run) => {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      },
      running: () => runningApps().map((running) => running.app.manifest.id),
      read: () => readAppFolders(projectPath),
      apply: applySettledAppFolders,
    });
    const stop = onAppFoldersChanged(projectPath, (change) => {
      bumpAppsRefresh();
      settler.heard(change.folders);
    });
    return () => {
      settler.close();
      stop();
    };
  }, [projectPath]);
}

export interface AppFolderReading {
  readonly apps: readonly AppSummary[];
  readonly broken: readonly AppFolderBroken[];
}

export type SettledAppFolder =
  | { readonly kind: 'valid'; readonly app: AppSummary }
  | { readonly kind: 'broken'; readonly appId: string; readonly message: string; readonly messageRef?: MessageRef | undefined }
  | { readonly kind: 'removed'; readonly appId: string };

export interface AppFolderSettlerDeps {
  readonly settleMs: number;
  readonly schedule: (delayMs: number, run: () => void) => () => void;
  readonly running: () => readonly string[];
  readonly read: () => Promise<AppFolderReading | undefined>;
  readonly apply: (settled: readonly SettledAppFolder[]) => void;
}

export function createAppFolderSettler(deps: AppFolderSettlerDeps): { readonly heard: (folders: readonly string[]) => void; readonly close: () => void } {
  assert(deps.settleMs > 0, 'Settling waits a while');
  let pending = new Set<string>();
  let cancel: (() => void) | undefined;
  let generation = 0;
  let closed = false;
  const settle = (): void => {
    cancel = undefined;
    const taken = pending;
    pending = new Set();
    if (!deps.running().some((id) => taken.has(id))) {
      return;
    }
    const started = generation;
    void deps.read().then(
      (reading) => {
        if (closed) {
          return;
        }
        if (generation !== started) {
          for (const folder of taken) {
            pending.add(folder);
          }
          return;
        }
        if (reading === undefined) {
          return;
        }
        const affected = deps.running().filter((id) => taken.has(id));
        if (affected.length > 0) {
          deps.apply(settledAppFolders(affected, reading));
        }
      },
      () => undefined,
    );
  };
  return {
    heard: (folders) => {
      if (closed) {
        return;
      }
      generation += 1;
      for (const folder of folders) {
        pending.add(folder);
      }
      assert(pending.size <= APP_FOLDER_LIMITS.entriesMax * 2, 'Pending folders are bounded');
      cancel?.();
      cancel = deps.schedule(deps.settleMs, settle);
    },
    close: () => {
      closed = true;
      cancel?.();
      cancel = undefined;
    },
  };
}

export function settledAppFolders(affected: readonly string[], reading: AppFolderReading): readonly SettledAppFolder[] {
  const apps = new Map(reading.apps.map((app) => [app.manifest.id, app]));
  const broken = new Map(reading.broken.map((row) => [row.folder, row]));
  const settled = affected.map((appId): SettledAppFolder => {
    const app = apps.get(appId);
    if (app !== undefined) {
      return { kind: 'valid', app };
    }
    const row = broken.get(appId);
    if (row !== undefined) {
      return { kind: 'broken', appId, message: row.message, ...(row.messageRef === undefined ? {} : { messageRef: row.messageRef }) };
    }
    return { kind: 'removed', appId };
  });
  assert(settled.length === affected.length, 'Every affected app settles one way');
  return settled;
}

export function appFolderErrorNotice(message: string, translate: Translator): string {
  const reason = message.trim().replace(/[.。]+$/, '');
  assert(reason.length > 0, 'A broken folder says why');
  return translate('apps.folder.errorNotice', { reason });
}

function applySettledAppFolders(settled: readonly SettledAppFolder[]): void {
  assert(settled.length > 0, 'A settle acts on at least one app');
  const reload: string[] = [];
  for (const folder of settled) {
    switch (folder.kind) {
      case 'valid':
        if (settleRunningApp(folder.app.manifest.id, { kind: 'valid', app: folder.app })) {
          reload.push(folder.app.manifest.id);
        }
        break;
      case 'broken':
        settleRunningApp(folder.appId, { kind: 'broken', message: folder.message, messageRef: folder.messageRef });
        break;
      case 'removed':
        stopApp(folder.appId);
        break;
      default: {
        const exhaustive: never = folder;
        return exhaustive;
      }
    }
  }
  if (reload.length > 0) {
    bumpAppFileRevisions(reload);
  }
}

async function readAppFolders(projectPath: string): Promise<AppFolderReading | undefined> {
  const [apps, broken] = await Promise.all([listInstalledAppList(projectPath), listBrokenAppFolders(projectPath)]);
  if (!apps.ok) {
    return undefined;
  }
  if (!broken.ok) {
    return undefined;
  }
  return { apps: apps.value.apps, broken: joinBrokenRows(broken.value, apps.value.broken) };
}
