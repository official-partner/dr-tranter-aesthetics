import { useMemo, useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import type { RoleView } from '../../../shared/properties/projectRoles';
import type { AppSummary, AppWindowMode } from '../../../shared/properties/apps';
import {
  APP_RPC_LIMITS,
  eventMessage,
  type AppChangeSource,
  type AppEditOutcome,
  type AppEventData,
  type AppEventName,
  type AppFrameInfo,
  type AppHostMessage,
  type AppOpenFrame,
  type AppCanvasClick,
  type AppNodeRef,
  type AppNodeView,
  type AppOverlayItem,
} from '../../../shared/properties/appsRpc';
import type { AppOverrideSlot } from '../../ui/appOverrideSlot';
import { APP_SHORTCUT_LIMITS } from '../../../shared/properties/appShortcuts';
import { createAppOverrides, overrideSlotOf } from './appOverrides';
import { appBadges } from './appBadges';
import { createCanvasCapture, type CanvasCapture } from './canvasCapture';
import { createOverlayDrag, type OverlayDrag } from './overlayDrag';
import type { RefTargetLookup } from './overlayPlacement';
import { bundleBytesReader } from './appCursorImage';
import { appFrameURL } from '../../ipc/appsBridge';
import { tellCanvas } from '../../editor/canvasQuery';
import { queryCanvasChain } from '../../ui/canvasPointQuery';
import { overlayMeasure } from './overlayMeasure';
import { createNodeRefTargets, type NodeRefHost, type NodeRefTargets } from './nodeRefs';
import { createOutlineModeOwner, type OutlineModeOwner } from './outlineModeOwner';
import { createInsertDrag, type InsertDrag, type InsertDragHit } from './insertDrag';
import { setCanvasHighlight, setCanvasOutlineMode } from '../../ui/canvasOutlineMode';
import {
  answerAppMessage,
  appRoleView,
  eventForSession,
  inFlightCounter,
  pageIndexOf,
  type AppCommandRegistry,
  type AppHighlights,
  type AppCustomFrames,
  type AppEditOriginTracker,
  type AppHostCommands,
  type AppSession,
  type AppShortcutState,
  type AppOverlayMessenger,
} from './appRpcHost';
import { requestAppDetails } from './appDetailsRequests';

const FRAMES_MAX = 64;
export const RUNNING_APPS_MAX = 8;

export interface RunningApp {
  readonly app: AppSummary;
  readonly mode: AppWindowMode;
  readonly folderError?: string;
  readonly folderErrorRef?: MessageRef | undefined;
}

export type RunningAppFolder =
  { readonly kind: 'valid'; readonly app: AppSummary } | { readonly kind: 'broken'; readonly message: string; readonly messageRef?: MessageRef | undefined };

export interface CustomFrame extends AppOpenFrame {
  readonly id: string;
  readonly appId: string;
}

interface Snapshot {
  readonly running: readonly RunningApp[];
  readonly overlays: ReadonlyMap<string, readonly AppOverlayItem[]>;
  readonly frames: readonly CustomFrame[];
}

const FRAME_SERIAL_MAX = 999_999_999;

let snapshot: Snapshot = { running: [], overlays: new Map(), frames: [] };
const listeners = new Set<() => void>();
const sessions = new Map<MessageEventSource, AppSession>();
let configured: { readonly host: AppHostCommands; readonly role: () => RoleView } | undefined;
let listening = false;
let frameSerial = 0;
const shortcutStates = new WeakMap<AppSession, { readonly editableFocus: boolean; readonly claims: ReadonlySet<string> }>();
const shortcuts: AppShortcutState = {
  noteFocus: (session, editable) => {
    shortcutStates.set(session, { editableFocus: editable, claims: shortcutStates.get(session)?.claims ?? new Set() });
  },
  claim: (session, claims) => {
    assert(claims.length <= APP_SHORTCUT_LIMITS.claimsMax, 'A frame claims a bounded number of shortcuts');
    shortcutStates.set(session, { editableFocus: shortcutStates.get(session)?.editableFocus ?? false, claims: new Set(claims) });
  },
};
let commandRegistry: AppCommandRegistry | undefined;

export function setAppCommandRegistry(registry: AppCommandRegistry | undefined): void {
  commandRegistry = registry;
}
const frameOpeners = new Map<string, AppSession>();

const overrides = createAppOverrides({
  post: (session, message) => {
    const source = sourceOf(session);
    if (source !== undefined) {
      post(source, message);
    }
  },
  role: () => configured?.role(),
  running: (appId) => snapshot.running.some((running) => running.app.manifest.id === appId),
  selection: () => configured?.host.selection().nodeId,
  timeoutMs: APP_RPC_LIMITS.overrideTimeoutMs,
});

export const canvasCapture: CanvasCapture = createCanvasCapture({
  emit: (appId, event, data) => emitToApp(appId, event, data),
  running: (appId) => snapshot.running.some((running) => running.app.manifest.id === appId),
});

let highlightOwner: string | undefined;

export const appHighlights: AppHighlights = {
  show: (appId, highlight) => {
    highlightOwner = appId;
    setCanvasHighlight(highlight);
  },
  clear: (appId) => {
    if (highlightOwner === appId) {
      clearAppHighlight();
    }
  },
};

export function clearAppHighlight(): void {
  highlightOwner = undefined;
  setCanvasHighlight(undefined);
}

export function noteLeftPanel(panel: string | undefined): void {
  if (panel !== 'apps') {
    outlineModeOwner.reset('panel');
    clearAppHighlight();
  }
}

export const outlineModeOwner: OutlineModeOwner = createOutlineModeOwner({
  emit: (appId, event, data) => emitToApp(appId, event, data),
  running: (appId) => snapshot.running.some((running) => running.app.manifest.id === appId),
  apply: (mode) => {
    setCanvasOutlineMode(mode);
    if (mode === 'normal') {
      clearAppHighlight();
    }
  },
});

let insertDropLocator: ((x: number, y: number) => Promise<InsertDragHit | undefined>) | undefined;
let canvasClientMapper: ((x: number, y: number) => { readonly x: number; readonly y: number } | undefined) | undefined;

export function setInsertDropLocator(next: ((x: number, y: number) => Promise<InsertDragHit | undefined>) | undefined): void {
  insertDropLocator = next;
}

export function setCanvasClientMapper(next: ((x: number, y: number) => { readonly x: number; readonly y: number } | undefined) | undefined): void {
  canvasClientMapper = next;
}

export const insertDrag: InsertDrag = createInsertDrag({
  toCanvas: (x, y) => canvasClientMapper?.(x, y),
  locate: (x, y) => insertDropLocator?.(x, y) ?? Promise.resolve(undefined),
  running: (appId) => snapshot.running.some((running) => running.app.manifest.id === appId),
});

type CanvasPointLocator = (x: number, y: number) => Promise<AppCanvasClick>;
let canvasPointLocator: CanvasPointLocator | undefined;

export function setCanvasPointLocator(next: CanvasPointLocator | undefined): void {
  canvasPointLocator = next;
}

let canvasPageReader: (() => string | undefined) | undefined;

export function setCanvasPageReader(next: (() => string | undefined) | undefined): void {
  canvasPageReader = next;
  nodeRefTargets.refresh();
}

export function appNodeRefHost(): NodeRefHost | undefined {
  const host = configured?.host;
  const readCanvasPage = canvasPageReader;
  if (host === undefined || readCanvasPage === undefined) {
    return undefined;
  }
  return {
    open: () => host.page(),
    canvasPage: readCanvasPage,
    tree: async (file) => (await pageIndexOf(host).getTree(file, host.page()))?.nodes,
    locate: queryCanvasChain,
  };
}

export function appHostNode(nodeId: string): AppNodeView | undefined {
  return configured?.host.node(nodeId);
}

export const nodeRefTargets: NodeRefTargets = createNodeRefTargets({
  host: () => appNodeRefHost(),
  refsMax: RUNNING_APPS_MAX * APP_RPC_LIMITS.overlayAnchorsMax,
});

export function useRefTargetLookup(): RefTargetLookup {
  const version = useSyncExternalStore(nodeRefTargets.subscribe, nodeRefTargets.version);
  return useMemo(() => ({ version, target: (ref: AppNodeRef) => nodeRefTargets.target(ref) }), [version]);
}

export const overlayDrag: OverlayDrag = createOverlayDrag({
  emit: (appId, event, data) => emitToApp(appId, event, data),
  running: (appId) => snapshot.running.some((running) => running.app.manifest.id === appId),
  holds: (appId, itemId) =>
    (snapshot.overlays.get(appId) ?? []).some(
      (item) => item.id === itemId && (item.kind === 'box' || item.kind === 'label' || item.kind === 'pin') && item.draggable,
    ),
  locate: (x, y) => canvasPointLocator?.(x, y) ?? Promise.resolve({ nodeId: undefined, at: undefined, x, y, layers: [] }),
  frame: (step) => {
    const handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  },
});

const bundleReader = bundleBytesReader(appFrameURL);

export const appOverrideSlot: AppOverrideSlot = overrideSlotOf(overrides);

export function overridesChanged(): void {
  overrides.changed();
}

export function configureAppsRuntime(host: AppHostCommands, role: () => RoleView): void {
  configured = { host, role };
  listen();
}

function publish(next: Snapshot): void {
  snapshot = next;
  overrides.changed();
  canvasCapture.changed();
  outlineModeOwner.changed();
  insertDrag.changed();
  if (highlightOwner !== undefined && !next.running.some((running) => running.app.manifest.id === highlightOwner)) {
    clearAppHighlight();
  }
  overlayDrag.changed();
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppsRuntime(): Snapshot {
  return useSyncExternalStore(subscribeStore, () => snapshot);
}

export function runningApps(): readonly RunningApp[] {
  return snapshot.running;
}

export function launchApp(app: AppSummary, mode: AppWindowMode): AppWindowMode {
  outlineModeOwner.shown(app.manifest.id);
  const current = snapshot.running.find((running) => running.app.manifest.id === app.manifest.id);
  const others = snapshot.running.filter((running) => running.app.manifest.id !== app.manifest.id);
  const kept = others.length >= RUNNING_APPS_MAX ? others.slice(1) : others;
  const started: RunningApp = { app, mode: current?.mode ?? mode };
  const frames = snapshot.frames.filter((frame) => frame.appId === app.manifest.id || kept.some((running) => running.app.manifest.id === frame.appId));
  forgetOpeners(frames);
  publish({ ...snapshot, running: [...kept, started], frames });
  assert(snapshot.running.length <= RUNNING_APPS_MAX, 'Running apps are bounded');
  assert(snapshot.running.at(-1) === started, 'A launched app is the latest running app');
  outlineModeOwner.restore(app.manifest.id);
  return started.mode;
}

export function setAppMode(appId: string, mode: AppWindowMode): boolean {
  const current = snapshot.running.find((running) => running.app.manifest.id === appId);
  if (current === undefined) {
    return false;
  }
  const others = snapshot.running.filter((running) => running !== current);
  if (mode === 'panel') {
    outlineModeOwner.shown(appId);
  }
  const changed: RunningApp = { ...current, mode };
  const running = mode === 'panel' ? [...others, changed] : snapshot.running.map((entry) => (entry === current ? changed : entry));
  publish({ ...snapshot, running });
  assert(snapshot.running.length === others.length + 1, 'Changing a mode neither starts nor stops an app');
  outlineModeOwner.restore(appId);
  return true;
}

export function settleRunningApp(appId: string, folder: RunningAppFolder): boolean {
  const current = snapshot.running.find((running) => running.app.manifest.id === appId);
  if (current === undefined) {
    return false;
  }
  let settled: RunningApp;
  switch (folder.kind) {
    case 'valid':
      assert(folder.app.manifest.id === appId, 'A valid folder reads as the app that is running');
      settled = { app: folder.app, mode: current.mode };
      break;
    case 'broken':
      assert(folder.message.length > 0, 'A broken folder says why');
      settled = { ...current, folderError: folder.message, folderErrorRef: folder.messageRef };
      break;
    default: {
      const exhaustive: never = folder;
      return exhaustive;
    }
  }
  const running = snapshot.running.map((entry) => (entry === current ? settled : entry));
  publish({ ...snapshot, running });
  assert(snapshot.running.length === running.length, 'Settling a folder neither starts nor stops an app');
  return true;
}

export function stopApp(appId: string): void {
  const overlays = new Map(snapshot.overlays);
  overlays.delete(appId);
  const frames = snapshot.frames.filter((frame) => frame.appId !== appId);
  forgetOpeners(frames);
  publish({ running: snapshot.running.filter((running) => running.app.manifest.id !== appId), overlays, frames });
  nodeRefTargets.want(anchoredRefs(overlays));
}

const EDIT_ORIGIN_GRACE_MS = 1000;

let editAuthor: { readonly appId: string; readonly finishedAtMs: number | undefined } | undefined;

const editOrigin: AppEditOriginTracker = {
  begin: (appId) => {
    const mark = { appId, finishedAtMs: undefined };
    editAuthor = mark;
    return () => {
      if (editAuthor === mark) {
        editAuthor = { appId, finishedAtMs: Date.now() };
      }
    };
  },
};

function takePageChangeAuthor(): string | undefined {
  const author = editAuthor;
  if (author === undefined) {
    return undefined;
  }
  if (author.finishedAtMs === undefined) {
    return author.appId;
  }
  editAuthor = undefined;
  const ageMs = Date.now() - author.finishedAtMs;
  assert(ageMs >= 0, 'An edit finished in the past');
  return ageMs <= EDIT_ORIGIN_GRACE_MS ? author.appId : undefined;
}

export function emitProjectChange(source: AppChangeSource, paths: readonly string[]): void {
  const author = source === 'page' || source === 'files' ? takePageChangeAuthor() : undefined;
  const named = paths.length > 0 && paths.length <= APP_RPC_LIMITS.changePathsMax ? { paths: [...new Set(paths)] } : {};
  if (configured === undefined) {
    return;
  }
  const role = configured.role();
  for (const [frame, session] of sessions) {
    const origin = session.app.manifest.id === author ? 'self' : 'other';
    const message = eventForSession(session, role, 'project.change', { source, ...named, origin });
    if (message !== undefined) {
      post(frame, message);
    }
  }
}

export function stopAllApps(): void {
  frameOpeners.clear();
  publish({ running: [], overlays: new Map(), frames: [] });
  for (const session of sessions.values()) {
    overrides.drop(session);
  }
  sessions.clear();
}

export function attachAppFrame(source: MessageEventSource, app: AppSummary, frame?: AppFrameInfo, overlayItem?: string): () => void {
  if (sessions.size >= FRAMES_MAX) {
    throw new Error('Too many app frames are open');
  }
  const session: AppSession = { app, subscriptions: new Set(), frame, overlayItem, ...inFlightCounter() };
  sessions.set(source, session);
  assert(sessions.size <= FRAMES_MAX, 'App frames are bounded');
  return () => {
    if (sessions.get(source) === session) {
      sessions.delete(source);
    }
    overrides.drop(session);
  };
}

export function appFrameReloaded(source: MessageEventSource): void {
  const session = sessions.get(source);
  if (session === undefined) {
    return;
  }
  overrides.drop(session);
  shortcutStates.delete(session);
}

export type AppShortcutRoute = 'stacki' | 'native' | 'app';

export function appShortcutRoute(shortcut: string, active: Element | undefined): AppShortcutRoute {
  if (typeof HTMLIFrameElement === 'undefined' || !(active instanceof HTMLIFrameElement)) {
    return 'stacki';
  }
  const source = active.contentWindow ?? undefined;
  const session = source === undefined ? undefined : sessions.get(source);
  if (source === undefined || session === undefined) {
    return 'stacki';
  }
  const state = shortcutStates.get(session);
  if (session.app.manifest.shortcutClaims.includes(shortcut) || state?.claims.has(shortcut) === true) {
    const message = configured === undefined ? undefined : eventForSession(session, configured.role(), 'shortcut.press', { shortcut });
    if (message !== undefined) {
      post(source, message);
    }
    return 'app';
  }
  if (state?.editableFocus === true) {
    return 'native';
  }
  return 'stacki';
}

export function closeCustomFrame(frameId: string, result: string | undefined): void {
  const frame = snapshot.frames.find((entry) => entry.id === frameId);
  if (frame === undefined) {
    return;
  }
  const opener = frameOpeners.get(frameId);
  frameOpeners.delete(frameId);
  publish({ ...snapshot, frames: snapshot.frames.filter((entry) => entry.id !== frameId) });
  const source = opener === undefined ? undefined : sourceOf(opener);
  if (source !== undefined) {
    post(source, eventMessage('frame.close', { frameId, result }));
  }
}

const customFrames: AppCustomFrames = {
  open: (session, frame) => {
    const appId = session.app.manifest.id;
    if (!snapshot.running.some((running) => running.app.manifest.id === appId)) {
      throw new Error('Only a running app opens frames');
    }
    if (snapshot.frames.filter((entry) => entry.appId === appId).length >= APP_RPC_LIMITS.customFramesMax) {
      throw new Error(`An app has at most ${APP_RPC_LIMITS.customFramesMax} frames open; close one first`);
    }
    assert(frameSerial < FRAME_SERIAL_MAX, 'Custom frame ids stay within nine digits');
    frameSerial += 1;
    const id = `frame-${frameSerial}`;
    frameOpeners.set(id, session);
    publish({ ...snapshot, frames: [...snapshot.frames, { ...frame, id, appId }] });
    assert(frameOpeners.size <= FRAMES_MAX, 'Custom frames are bounded by the frames a window holds');
    return { frameId: id };
  },
  close: (session, frameId, result): AppEditOutcome => {
    const id = frameId ?? session.frame?.id;
    if (id === undefined) {
      return { applied: false, reason: 'Name the frame to close: this is not a custom frame' };
    }
    const frame = snapshot.frames.find((entry) => entry.id === id);
    if (frame === undefined || frame.appId !== session.app.manifest.id) {
      return { applied: false, reason: 'This app has no open frame with that id' };
    }
    closeCustomFrame(id, result);
    return { applied: true };
  },
};

export const overlayMessages: AppOverlayMessenger = {
  post: (sender, message) => {
    const appId = sender.app.manifest.id;
    const fromOverlay = sender.overlayItem !== undefined;
    const itemId = sender.overlayItem ?? message.itemId;
    assert(itemId !== undefined, 'An overlay message names its frame item');
    if (configured === undefined) {
      return 0;
    }
    const role = configured.role();
    let reached = 0;
    for (const [source, session] of sessions) {
      const sameApp = session.app.manifest.id === appId;
      const addressed = fromOverlay ? session.overlayItem === undefined : session.overlayItem === itemId;
      if (sameApp && addressed && session !== sender) {
        const data = { itemId, data: message.data, from: fromOverlay ? ('overlay' as const) : ('app' as const) };
        const event = eventForSession(session, role, 'overlay.message', data);
        if (event !== undefined) {
          post(source, event);
          reached += 1;
        }
      }
    }
    assert(reached <= FRAMES_MAX, 'A message reaches at most every frame');
    return reached;
  },
};

const hoverHeard = new Map<string, string | undefined>();
const hoverPending = new Map<string, string | undefined>();
let hoverFrame: number | undefined;

export function noteOverlayHover(appId: string, itemId: string | undefined): void {
  hoverPending.set(appId, itemId);
  assert(hoverPending.size <= RUNNING_APPS_MAX + FRAMES_MAX, 'Pending hovers are bounded by the apps that draw');
  if (hoverFrame !== undefined || typeof requestAnimationFrame === 'undefined') {
    return;
  }
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = undefined;
    flushOverlayHover();
  });
}

export function flushOverlayHover(): void {
  const pending = [...hoverPending];
  hoverPending.clear();
  for (const [appId, itemId] of pending) {
    if (hoverHeard.has(appId) && hoverHeard.get(appId) === itemId) {
      continue;
    }
    hoverHeard.set(appId, itemId);
    emitToApp(appId, 'overlay.hover', { itemId });
  }
  for (const appId of [...hoverHeard.keys()]) {
    if (!snapshot.running.some((running) => running.app.manifest.id === appId)) {
      hoverHeard.delete(appId);
    }
  }
}

export function emitAppEvent<E extends AppEventName>(event: E, data: AppEventData[E]): void {
  if (configured === undefined) {
    return;
  }
  const role = configured.role();
  for (const [source, session] of sessions) {
    const message = eventForSession(session, role, event, data);
    if (message !== undefined) {
      post(source, message);
    }
  }
}

export function emitRoleChange(): void {
  if (configured === undefined) {
    return;
  }
  const role = configured.role();
  for (const [source, session] of sessions) {
    if (!session.subscriptions.has('role.change')) {
      continue;
    }
    const message = eventForSession(session, role, 'role.change', appRoleView(role, session.app.manifest));
    if (message !== undefined) {
      post(source, message);
    }
  }
}

export function emitToApp<E extends AppEventName>(appId: string, event: E, data: AppEventData[E]): number {
  if (configured === undefined) {
    return 0;
  }
  const role = configured.role();
  let reached = 0;
  for (const [source, session] of sessions) {
    if (session.app.manifest.id === appId) {
      const message = eventForSession(session, role, event, data);
      if (message !== undefined) {
        post(source, message);
        reached += 1;
      }
    }
  }
  return reached;
}

const subscribedListeners = new Set<(appId: string) => void>();

export function onAppSubscribed(listener: (appId: string) => void): () => void {
  subscribedListeners.add(listener);
  return () => {
    subscribedListeners.delete(listener);
  };
}

export function onAppsRuntimeChange(listener: () => void): () => void {
  return subscribeStore(listener);
}

function setOverlay(appId: string, items: readonly AppOverlayItem[] | undefined): void {
  const overlays = new Map(snapshot.overlays);
  if (items === undefined || items.length === 0) {
    overlays.delete(appId);
  } else {
    overlays.set(appId, items);
  }
  publish({ ...snapshot, overlays });
  nodeRefTargets.want(anchoredRefs(overlays));
}

function anchoredRefs(overlays: ReadonlyMap<string, readonly AppOverlayItem[]>): readonly AppNodeRef[] {
  const refs: AppNodeRef[] = [];
  for (const items of overlays.values()) {
    for (const item of items) {
      if ('ref' in item.anchor) {
        refs.push(item.anchor.ref);
      }
    }
  }
  return refs;
}

function listen(): void {
  if (listening || typeof window === 'undefined') {
    return;
  }
  listening = true;
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const source = event.source;
    if (source === null) {
      return;
    }
    const session = sessions.get(source);
    if (session === undefined || configured === undefined) {
      return;
    }
    const context = {
      host: configured.host,
      role: configured.role,
      setOverlay,
      overrides,
      frames: customFrames,
      shortcuts,
      commands: commandRegistry,
      badges: appBadges,
      editOrigin,
      capture: canvasCapture,
      measure: overlayMeasure,
      readBundle: bundleReader,
      tellCanvas,
      overlayMessages,
      openDetails: (appId: string) => requestAppDetails(appId, 'settings'),
      writeClipboard: (text: string) => navigator.clipboard.writeText(text),
      nodeRefs: appNodeRefHost(),
      outlineMode: outlineModeOwner,
      insertDrag,
      highlight: appHighlights,
      frameOrigin: () => frameOriginOf(source),
    };
    void answerAppMessage(session, event.data, context).then((answer) => {
      if (answer !== undefined) {
        post(source, answer);
      }
      if (session.subscriptions.has('command.run')) {
        for (const listener of [...subscribedListeners]) {
          listener(session.app.manifest.id);
        }
      }
    });
  });
}

function frameOriginOf(source: MessageEventSource): { readonly left: number; readonly top: number } | undefined {
  for (const element of Array.from(document.querySelectorAll('iframe')).slice(0, FRAMES_MAX * 2)) {
    if (element.contentWindow === source) {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    }
  }
  return undefined;
}

function sourceOf(session: AppSession): MessageEventSource | undefined {
  for (const [source, candidate] of sessions) {
    if (candidate === session) {
      return source;
    }
  }
  return undefined;
}

function forgetOpeners(kept: readonly CustomFrame[]): void {
  for (const id of [...frameOpeners.keys()]) {
    if (!kept.some((frame) => frame.id === id)) {
      frameOpeners.delete(id);
    }
  }
}

function post(source: MessageEventSource, message: AppHostMessage): void {
  if ('postMessage' in source && typeof source.postMessage === 'function') {
    try {
      source.postMessage(message, { targetOrigin: '*' });
    } catch {
    }
  }
}

export function appIdOfFrame(source: MessageEventSource): string | undefined {
  return sessions.get(source)?.app.manifest.id;
}

export function subscribeAppFrameForTests(source: MessageEventSource, event: AppEventName): void {
  const session = sessions.get(source);
  assert(session !== undefined, 'Only an attached frame subscribes');
  session.subscriptions.add(event);
}

export function resetAppsRuntime(): void {
  editAuthor = undefined;
  hoverHeard.clear();
  hoverPending.clear();
  for (const session of sessions.values()) {
    overrides.drop(session);
  }
  sessions.clear();
  frameOpeners.clear();
  configured = undefined;
  publish({ running: [], overlays: new Map(), frames: [] });
}
