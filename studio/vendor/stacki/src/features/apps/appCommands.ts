import { useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { record } from '../../../shared/core/boundary';
import { can, type RoleView } from '../../../shared/properties/projectRoles';
import { APP_LIMITS, type AppSummary } from '../../../shared/properties/apps';
import { appAccessFeature, type AppEventData } from '../../../shared/properties/appsRpc';
import {
  APP_RESERVED_SHORTCUTS,
  APP_SHORTCUT_LIMITS,
  isReservedShortcut,
  shortcutLabel,
  type AppCommand,
  type AppReservedShortcut,
} from '../../../shared/properties/appShortcuts';
import { revealAppsPanel } from './appsDirectory';
import { emitToApp, launchApp, onAppSubscribed, onAppsRuntimeChange, runningApps, setAppCommandRegistry } from './appsRuntime';
import { appOpeningMode } from './appWindowPreferences';

const QUEUED_RUNS_MAX = 4;
const STORAGE_PREFIX = 'stacki.apps.commands:';

export type CommandRebind = AppReservedShortcut | 'none';
export type CommandRebinds = Readonly<Record<string, Readonly<Record<string, CommandRebind>>>>;

export interface BoundCommand {
  readonly app: AppSummary;
  readonly command: AppCommand;
  readonly shortcut: AppReservedShortcut | undefined;
  readonly inUse: { readonly shortcut: AppReservedShortcut; readonly holder: string } | undefined;
  readonly rebind: CommandRebind | undefined;
}

interface Store {
  readonly projectPath: string | undefined;
  readonly apps: readonly AppSummary[];
  readonly registered: ReadonlyMap<string, readonly AppCommand[]>;
  readonly rebinds: CommandRebinds;
  readonly bound: readonly BoundCommand[];
}

let store: Store = { projectPath: undefined, apps: [], registered: new Map(), rebinds: {}, bound: [] };
let role: (() => RoleView) | undefined;
const listeners = new Set<() => void>();
const queued = new Map<string, AppEventData['command.run'][]>();

onAppSubscribed((appId) => deliverQueued(appId));
setAppCommandRegistry({
  register: (session, commands) => registerAppCommands(session.app.manifest.id, commands),
  trigger: (shortcut) => runShortcutCommand(shortcut),
});
onAppsRuntimeChange(() => {
  const running = new Set(runningApps().map((entry) => entry.app.manifest.id));
  for (const appId of [...queued.keys()]) {
    if (!running.has(appId)) {
      queued.delete(appId);
    }
  }
  const stopped = [...store.registered.keys()].filter((appId) => !running.has(appId));
  for (const appId of stopped) {
    forgetAppCommands(appId);
  }
});

export function bindCommands(
  apps: readonly AppSummary[],
  registered: ReadonlyMap<string, readonly AppCommand[]>,
  rebinds: CommandRebinds,
): readonly BoundCommand[] {
  assert(apps.length <= APP_LIMITS.appsMax, 'Installed apps are bounded');
  const ordered = [...apps].sort((left, right) => {
    if (left.lock.installedAt === right.lock.installedAt) {
      return left.manifest.id < right.manifest.id ? -1 : 1;
    }
    return left.lock.installedAt < right.lock.installedAt ? -1 : 1;
  });
  const holders = new Map<AppReservedShortcut, string>();
  const bound: BoundCommand[] = [];
  for (const app of ordered) {
    for (const command of commandsOf(app, registered)) {
      const rebind = rebinds[app.manifest.id]?.[command.id];
      const wanted = rebind === undefined ? command.shortcut : rebind === 'none' ? undefined : rebind;
      if (wanted === undefined) {
        bound.push({ app, command, shortcut: undefined, inUse: undefined, rebind });
      } else {
        const holder = holders.get(wanted);
        if (holder === undefined) {
          holders.set(wanted, app.manifest.name);
          bound.push({ app, command, shortcut: wanted, inUse: undefined, rebind });
        } else {
          bound.push({ app, command, shortcut: undefined, inUse: { shortcut: wanted, holder }, rebind });
        }
      }
    }
  }
  assert(holders.size <= APP_RESERVED_SHORTCUTS.length, 'Each reserved key runs one command');
  return bound;
}

export function configureAppCommands(projectPath: string, apps: readonly AppSummary[], currentRole: () => RoleView): void {
  role = currentRole;
  const rebinds = projectPath === store.projectPath ? store.rebinds : readRebinds(projectPath);
  update({ ...store, projectPath, apps, rebinds });
}

export function registerAppCommands(appId: string, commands: readonly AppCommand[]): void {
  const registered = new Map(store.registered);
  registered.set(appId, commands);
  update({ ...store, registered });
}

export function forgetAppCommands(appId: string): void {
  queued.delete(appId);
  if (store.registered.has(appId)) {
    const registered = new Map(store.registered);
    registered.delete(appId);
    update({ ...store, registered });
  }
}

export function commandForShortcut(shortcut: AppReservedShortcut): BoundCommand | undefined {
  return store.bound.find((entry) => entry.shortcut === shortcut);
}

export function runShortcutCommand(shortcut: string): boolean {
  if (!isReservedShortcut(shortcut)) {
    return false;
  }
  const entry = commandForShortcut(shortcut);
  if (entry === undefined) {
    return false;
  }
  return runCommand(entry, shortcut);
}

export function runAppCommand(appId: string, commandId: string): boolean {
  const entry = store.bound.find((candidate) => candidate.app.manifest.id === appId && candidate.command.id === commandId);
  return entry === undefined ? false : runCommand(entry, undefined);
}

export function rebindCommand(appId: string, commandId: string, rebind: CommandRebind | undefined): void {
  const projectPath = store.projectPath;
  assert(projectPath !== undefined, 'Rebinding needs an open project');
  const forApp: Record<string, CommandRebind> = { ...store.rebinds[appId] };
  if (rebind === undefined) {
    delete forApp[commandId];
  } else {
    forApp[commandId] = rebind;
  }
  const rebinds: Record<string, Readonly<Record<string, CommandRebind>>> = { ...store.rebinds, [appId]: forApp };
  writeRebinds(projectPath, rebinds);
  update({ ...store, rebinds });
}

export function useAppCommands(): readonly BoundCommand[] {
  return useSyncExternalStore(subscribe, () => store.bound);
}

export function shortcutPlatform(): 'mac' | 'other' {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? 'mac' : 'other';
}

export function platformShortcutLabel(shortcut: string): string {
  return shortcutLabel(shortcut, shortcutPlatform());
}

export function commandShortcutHint(platform: 'mac' | 'other', translate: Translator): string {
  const keys = APP_RESERVED_SHORTCUTS.map((shortcut) => shortcut.split('+').at(-1) ?? '');
  const modifiers = APP_RESERVED_SHORTCUTS[0].split('+').slice(0, -1).join('+');
  assert(
    APP_RESERVED_SHORTCUTS.every((shortcut) => shortcut.startsWith(`${modifiers}+`)),
    'The reserved range shares one set of modifiers',
  );
  assert(
    keys.every((key) => /^[0-9]$/.test(key)),
    'The reserved range is digits; the hint says numbers',
  );
  return translate('apps.commands.reservedHint', { modifiers: shortcutLabel(modifiers, platform), first: keys[0] ?? '', last: keys.at(-1) ?? '' });
}

export function shortcutHolder(bound: readonly BoundCommand[], appId: string, commandId: string, shortcut: string, translate: Translator): string | undefined {
  assert(appId.length > 0, 'A command belongs to an app');
  const holder = bound.find((entry) => entry.shortcut === shortcut);
  if (holder === undefined) {
    return undefined;
  }
  if (holder.app.manifest.id === appId) {
    if (holder.command.id === commandId) {
      return undefined;
    }
    return translate('apps.commands.usedBy', { name: holder.command.title });
  }
  assert(holder.app.manifest.name.length > 0, 'An installed app has a name');
  return translate('apps.commands.usedBy', { name: holder.app.manifest.name });
}

export function rebindFor(command: AppCommand, shortcut: AppReservedShortcut | undefined): CommandRebind | undefined {
  if (shortcut === command.shortcut) {
    return undefined;
  }
  const rebind = shortcut ?? 'none';
  assert(rebind !== command.shortcut, 'A rebind differs from the app’s own key');
  return rebind;
}

export function parseRebinds(input: unknown): CommandRebinds {
  const out: Record<string, Record<string, CommandRebind>> = {};
  const apps = Object.entries(record(input)).slice(0, APP_LIMITS.appsMax);
  for (const [appId, commands] of apps) {
    const forApp: Record<string, CommandRebind> = {};
    for (const [commandId, value] of Object.entries(record(commands)).slice(0, APP_SHORTCUT_LIMITS.commandsMax * 2)) {
      if (value === 'none') {
        forApp[commandId] = 'none';
      } else if (typeof value === 'string' && isReservedShortcut(value)) {
        forApp[commandId] = value;
      }
    }
    out[appId] = forApp;
  }
  return out;
}

function runCommand(entry: BoundCommand, shortcut: AppReservedShortcut | undefined): boolean {
  const currentRole = role?.();
  if (currentRole === undefined) {
    return false;
  }
  if (!can(currentRole, appAccessFeature(entry.app.manifest.id))) {
    return false;
  }
  const appId = entry.app.manifest.id;
  const running = runningApps().some((candidate) => candidate.app.manifest.id === appId);
  if (!running) {
    const projectPath = store.projectPath;
    assert(projectPath !== undefined, 'A command runs in an open project');
    if (launchApp(entry.app, appOpeningMode(projectPath, entry.app)) === 'panel') {
      revealAppsPanel();
    }
  }
  const run: AppEventData['command.run'] = { id: entry.command.id, panel: entry.command.panel, shortcut };
  const waiting = [...(queued.get(appId) ?? []), run].slice(-QUEUED_RUNS_MAX);
  queued.set(appId, waiting);
  deliverQueued(appId);
  return true;
}

function deliverQueued(appId: string): void {
  const waiting = queued.get(appId);
  if (waiting === undefined || waiting.length === 0) {
    return;
  }
  let delivered = false;
  for (const run of waiting) {
    delivered = emitToApp(appId, 'command.run', run) > 0;
    if (!delivered) {
      return;
    }
  }
  queued.delete(appId);
}

function commandsOf(app: AppSummary, registered: ReadonlyMap<string, readonly AppCommand[]>): readonly AppCommand[] {
  const declared = app.manifest.commands;
  const extra = (registered.get(app.manifest.id) ?? []).filter((command) => !declared.some((known) => known.id === command.id));
  return [...declared, ...extra].slice(0, APP_SHORTCUT_LIMITS.commandsMax * 2);
}

function update(next: Omit<Store, 'bound'>): void {
  store = { ...next, bound: bindCommands(next.apps, next.registered, next.rebinds) };
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readRebinds(projectPath: string): CommandRebinds {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectPath);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    return parseRebinds(parsed);
  } catch {
    return {};
  }
}

function writeRebinds(projectPath: string, rebinds: CommandRebinds): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + projectPath, JSON.stringify(rebinds));
  } catch {
  }
}

export function resetAppCommands(): void {
  queued.clear();
  role = undefined;
  store = { projectPath: undefined, apps: [], registered: new Map(), rebinds: {}, bound: [] };
}
