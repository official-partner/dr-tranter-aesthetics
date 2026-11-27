import { assert } from '../../../shared/core/assert';
import { appPermissionsFor, can, type RoleView } from '../../../shared/properties/projectRoles';
import type { AppManifest, AppSummary } from '../../../shared/properties/apps';
import type { AppSettingValues } from '../../../shared/properties/appSettings';
import {
  APP_CAPABILITIES,
  APP_EVENT_NAMES,
  APP_METHODS,
  APP_RPC_LIMITS,
  UnsupportedVersionError,
  appAccessFeature,
  errorMessage,
  eventMessage,
  isAppMethod,
  okMessage,
  parseAppRequest,
  requestIdOf,
  type AppDevice,
  type AppCapabilities,
  type AppEditOutcome,
  type AppEventData,
  type AppEventName,
  type AppFrameInfo,
  type AppHostKind,
  type AppHostMessage,
  type AppInsert,
  type AppInsertDragStep,
  type AppInsertOutcome,
  type AppInsertPlace,
  type AppInfo,
  type AppPerson,
  type AppMember,
  type AppOverlayPost,
  type AppOpenFrame,
  type AppOverrideAnswer,
  type AppOverridePoint,
  type AppShortcut,
  type AppLeftPanel,
  type AppMethod,
  type AppNodeRef,
  type AppNodeTarget,
  type AppNodeView,
  type AppOverlayItem,
  type AppPageSummary,
  type AppPageView,
  type AppRect,
  type AppRightPanel,
  type AppRoleView,
  type AppScrollTarget,
  type AppSelection,
  type AppSnapshotOutcome,
  type AppViewport,
} from '../../../shared/properties/appsRpc';
import type { AppCommand, AppReservedShortcut } from '../../../shared/properties/appShortcuts';
import type { AppStorageChange, AppStorageScope } from '../../../shared/properties/appStorage';
import { accessRoleRefusal, runAccessMethod, type AppHostAuth, type AppHostFiles, type AppHostNet } from './appAccessRpc';
import { canPanel } from '../../lib/roleAccess';
import { createAppPageIndex, type AppPageFiles, type AppPageIndex } from './appPageIndex';
import type { CanvasCapture } from './canvasCapture';
import { resolveCanvasCursor, type BundleBytesReader } from './appCursorImage';
import { findNodeByKey, nodeKey } from './nodeKeys';
import { resolveHighlight, resolveNodeRef, resolveNodeRefSteps, type NodeRefHost } from './nodeRefs';
import type { CanvasHighlight, CanvasHighlightStyle } from '../../../shared/properties/deepOutline';
import type { OutlineModeOwner } from './outlineModeOwner';
import type { InsertDrag } from './insertDrag';
import type { AppNodeMeasurer } from './overlayMeasure';
import { currentAppTheme } from './appTheme';

export interface AppHostCommands {
  readonly viewport: () => AppViewport;
  readonly setDevice: (device: AppDevice) => void;
  readonly setWidth: AppHostAbility<(widthPx: number) => void>;
  readonly scrollTo: AppHostAbility<(target: AppScrollTarget) => AppEditOutcome>;
  readonly openPanel: (panel: AppLeftPanel) => void;
  readonly closePanel: () => void;
  readonly openRightPanel: (panel: AppRightPanel) => void;
  readonly panels: () => AppEventData['panels.change'];
  readonly selection: () => AppSelection;
  readonly select: (nodeId: string | undefined) => AppEditOutcome;
  readonly page: () => AppPageView | undefined;
  readonly pages: () => readonly AppPageSummary[];
  readonly openPage: (path: string) => AppEditOutcome;
  readonly openComponent: AppHostAbility<(path: string) => AppEditOutcome>;
  readonly snapshot: AppHostAbility<(box: AppRect, widthMax: number) => Promise<AppSnapshotOutcome>>;
  readonly node: (nodeId: string) => AppNodeView | undefined;
  readonly attributes: AppHostAbility<{
    readonly set: (nodeId: string, name: string, value: string, label: string | undefined) => Promise<AppEditOutcome>;
    readonly remove: (nodeId: string, name: string, label: string | undefined) => Promise<AppEditOutcome>;
  }>;
  readonly classes: AppHostAbility<{
    readonly add: (nodeId: string, className: string, label: string | undefined) => Promise<AppEditOutcome>;
    readonly remove: (nodeId: string, className: string, label: string | undefined) => Promise<AppEditOutcome>;
  }>;
  readonly setStyle: AppHostAbility<(nodeId: string, css: string, label: string | undefined) => Promise<AppEditOutcome>>;
  readonly insertElement: AppHostAbility<(insert: AppHostInsert<'element'>) => Promise<AppInsertOutcome>>;
  readonly insertComponent: (insert: AppHostInsert<'component'>) => Promise<AppInsertOutcome>;
  readonly insertAttributes: AppHostAbility<true>;
  readonly insertReplace: AppHostAbility<true>;
  readonly remove: (nodeId: string, label: string | undefined) => Promise<AppEditOutcome>;
  readonly duplicate: (nodeId: string, label: string | undefined) => Promise<AppEditOutcome>;
  readonly history: AppHostAbility<{ readonly undo: () => Promise<AppEditOutcome>; readonly redo: () => Promise<AppEditOutcome> }>;
  readonly save: () => Promise<AppEditOutcome>;
  readonly openPalette: AppHostAbility<() => AppEditOutcome>;
  readonly escape: () => AppEditOutcome;
  readonly notify: (message: string, kind: 'info' | 'success' | 'error') => void;
  readonly settings: (appId: string) => Promise<AppSettingValues>;
  readonly kind: AppHostKind;
  readonly version: () => Promise<string>;
  readonly person: () => Promise<AppPerson>;
  readonly onPersonChange: (listener: () => void) => () => void;
  readonly storage: AppHostStorage;
  readonly files?: AppHostFiles | undefined;
  readonly auth?: AppHostAuth | undefined;
  readonly net?: AppHostNet | undefined;
  readonly pageFiles: AppPageFiles;
  readonly people?: (() => Promise<readonly AppMember[]>) | undefined;
}

export type AppHostAbility<T> = { readonly kind: 'able'; readonly run: T } | { readonly kind: 'unable'; readonly reason: string };

export function able<T>(run: T): AppHostAbility<T> {
  return { kind: 'able', run };
}

export function unable<T>(reason: string): AppHostAbility<T> {
  assert(reason.length > 0, 'An unavailable command says why');
  return { kind: 'unable', reason };
}

type AppRefusal = Extract<AppEditOutcome, { readonly applied: false }>;

export interface AppHostInsert<K extends AppInsert['kind']> {
  readonly item: Extract<AppInsert, { readonly kind: K }>;
  readonly place: AppInsertPlace;
  readonly label: string | undefined;
}

function insertPartRefusal(host: AppHostCommands, item: AppInsert, place: AppInsertPlace): AppRefusal | undefined {
  const given = item.kind === 'element' ? item.attributes : item.props;
  if (Object.keys(given).length > 0) {
    if (host.insertAttributes.kind === 'unable') {
      return refusedBy(host.insertAttributes);
    }
  }
  if (place.kind === 'replace') {
    if (host.insertReplace.kind === 'unable') {
      return refusedBy(host.insertReplace);
    }
  }
  return undefined;
}

export interface AppHostStorage {
  readonly writer: string;
  readonly get: (appId: string, scope: AppStorageScope, key: string) => Promise<string | undefined>;
  readonly set: (appId: string, scope: AppStorageScope, key: string, value: string | undefined) => Promise<AppEditOutcome>;
  readonly keys: (appId: string, scope: AppStorageScope) => Promise<readonly string[]>;
  readonly watch: (listener: (change: AppStorageChange) => void) => () => void;
}

export function hostCapabilities(host: AppHostCommands): AppCapabilities {
  const can: AppCapabilities = {
    setAttribute: host.attributes.kind === 'able',
    addClass: host.classes.kind === 'able',
    setStyle: host.setStyle.kind === 'able',
    insertElement: host.insertElement.kind === 'able',
    insertAttributes: host.insertAttributes.kind === 'able',
    insertReplace: host.insertReplace.kind === 'able',
    openPalette: host.openPalette.kind === 'able',
    undo: host.history.kind === 'able',
    setWidth: host.setWidth.kind === 'able',
    scrollTo: host.scrollTo.kind === 'able',
    snapshot: host.snapshot.kind === 'able',
  };
  assert(Object.keys(can).length === APP_CAPABILITIES.length, 'Every capability is answered');
  return can;
}

export interface AppSession {
  readonly app: AppSummary;
  readonly subscriptions: Set<AppEventName>;
  readonly frame?: AppFrameInfo | undefined;
  readonly overlayItem?: string | undefined;
  readonly begin: () => boolean;
  readonly end: () => void;
}

export function inFlightCounter(): Pick<AppSession, 'begin' | 'end'> {
  let count = 0;
  return {
    begin: () => {
      if (count >= APP_RPC_LIMITS.requestsInFlightMax) {
        return false;
      }
      count += 1;
      return true;
    },
    end: () => {
      count -= 1;
      assert(count >= 0, 'In-flight requests never go negative');
    },
  };
}

export interface AppRpcContext {
  readonly host: AppHostCommands;
  readonly role: () => RoleView;
  readonly setOverlay: (appId: string, items: readonly AppOverlayItem[] | undefined) => void;
  readonly overrides?: AppOverrideRegistry | undefined;
  readonly frames?: AppCustomFrames | undefined;
  readonly shortcuts?: AppShortcutState | undefined;
  readonly commands?: AppCommandRegistry | undefined;
  readonly badges?: AppBadgeRegistry | undefined;
  readonly editOrigin?: AppEditOriginTracker | undefined;
  readonly capture?: CanvasCapture | undefined;
  readonly measure?: AppNodeMeasurer | undefined;
  readonly readBundle?: BundleBytesReader | undefined;
  readonly tellCanvas?: ((message: unknown) => boolean) | undefined;
  readonly nowMs?: (() => number) | undefined;
  readonly overlayMessages?: AppOverlayMessenger | undefined;
  readonly openDetails?: ((appId: string) => void) | undefined;
  readonly writeClipboard?: ((text: string) => Promise<void>) | undefined;
  readonly nodeRefs?: NodeRefHost | undefined;
  readonly outlineMode?: OutlineModeOwner | undefined;
  readonly highlight?: AppHighlights | undefined;
  readonly insertDrag?: InsertDrag | undefined;
  readonly frameOrigin?: (() => { readonly left: number; readonly top: number } | undefined) | undefined;
}

export interface AppHighlights {
  readonly show: (appId: string, highlight: CanvasHighlight) => void;
  readonly clear: (appId: string) => void;
}

export interface AppOverlayMessenger {
  readonly post: (session: AppSession, message: AppOverlayPost) => number;
}

export interface AppBadgeRegistry {
  readonly set: (appId: string, count: number) => void;
}

export interface AppEditOriginTracker {
  readonly begin: (appId: string) => () => void;
}

export interface AppShortcutState {
  readonly noteFocus: (session: AppSession, editable: boolean) => void;
  readonly claim: (session: AppSession, shortcuts: readonly string[]) => void;
}

export interface AppCommandRegistry {
  readonly register: (session: AppSession, commands: readonly AppCommand[]) => void;
  readonly trigger: (shortcut: AppReservedShortcut) => boolean;
}

export interface AppOverrideRegistry {
  readonly register: (session: AppSession, point: AppOverridePoint) => { readonly owner: boolean };
  readonly unregister: (session: AppSession, point: AppOverridePoint) => void;
  readonly resolve: (session: AppSession, call: number, answer: AppOverrideAnswer) => AppEditOutcome;
}

export interface AppCustomFrames {
  readonly open: (session: AppSession, frame: AppOpenFrame) => { readonly frameId: string };
  readonly close: (session: AppSession, frameId: string | undefined, result: string | undefined) => AppEditOutcome;
}

export async function answerAppMessage(session: AppSession, input: unknown, context: AppRpcContext): Promise<AppHostMessage | undefined> {
  let request: ReturnType<typeof parseAppRequest>;
  try {
    request = parseAppRequest(input);
  } catch (error: unknown) {
    if (error instanceof UnsupportedVersionError) {
      return errorMessage(error.requestId, 'unsupported-version', error.message);
    }
    const id = requestIdOf(input);
    return id === undefined ? undefined : errorMessage(id, 'bad-request', describe(error));
  }
  if (request === undefined) {
    return undefined;
  }
  const { id, method } = request;
  if (!isAppMethod(method)) {
    return errorMessage(id, 'unknown-method', `Stacki has no method "${method.slice(0, 64)}"`);
  }
  const role = context.role();
  if (!can(role, appAccessFeature(session.app.manifest.id))) {
    return errorMessage(id, 'role-denied', `The ${role.name} role cannot use this app`);
  }
  try {
    APP_METHODS[method].params(request.params);
  } catch (error: unknown) {
    return errorMessage(id, 'bad-params', describe(error));
  }
  if (!session.begin()) {
    return errorMessage(id, 'busy', 'Too many requests are waiting');
  }
  try {
    const refusal = roleRefusal(method, request.params, role);
    if (refusal !== undefined) {
      return errorMessage(id, 'role-denied', refusal);
    }
    return okMessage(id, await runMethod(method, request.params, session, context));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Assertion failed')) {
      throw error;
    }
    return errorMessage(id, 'failed', describe(error));
  } finally {
    session.end();
  }
}

function roleRefusal(method: AppMethod, rawParams: unknown, role: RoleView): string | undefined {
  const access = accessRoleRefusal(method, role);
  if (access !== undefined) {
    return access;
  }
  if (method === 'panels.open' || method === 'panels.openRight') {
    const panel = APP_METHODS[method].params(rawParams).panel;
    if (!canPanel(role, panel)) {
      return `The ${role.name} role cannot open ${panel}`;
    }
  }
  if (method === 'page.getTree' || method === 'page.findByAttribute') {
    if (!canPanel(role, 'pages')) {
      return `The ${role.name} role cannot read other pages`;
    }
  }
  if (method === 'page.open') {
    if (!canPanel(role, 'pages')) {
      return `The ${role.name} role cannot open other pages`;
    }
  }
  if (method === 'component.open') {
    if (!can(role, 'component:edit')) {
      return `The ${role.name} role cannot edit components`;
    }
  }
  if (method === 'app.openSettings') {
    if (!canPanel(role, 'apps')) {
      return `The ${role.name} role cannot open the Apps panel`;
    }
  }
  return undefined;
}

const pageIndexes = new WeakMap<AppHostCommands, AppPageIndex>();

export function pageIndexOf(host: AppHostCommands): AppPageIndex {
  const known = pageIndexes.get(host);
  if (known !== undefined) {
    return known;
  }
  const created = createAppPageIndex(host.pageFiles);
  pageIndexes.set(host, created);
  return created;
}

async function runMethod(method: AppMethod, rawParams: unknown, session: AppSession, context: AppRpcContext): Promise<unknown> {
  const { host } = context;
  switch (method) {
    case 'app.info': {
      const { id, name, version, shortcutClaims } = session.app.manifest;
      const info: AppInfo = {
        id,
        name,
        version,
        frame: session.frame,
        shortcutClaims,
        host: { kind: host.kind, version: await host.version() },
        can: hostCapabilities(host),
      };
      return info;
    }
    case 'settings.get':
      return host.settings(session.app.manifest.id);
    case 'role.get':
      return appRoleView(context.role(), session.app.manifest);
    case 'role.can': {
      const { permission } = APP_METHODS['role.can'].params(rawParams);
      const permissions = appRoleView(context.role(), session.app.manifest).permissions;
      if (!Object.hasOwn(permissions, permission)) {
        throw new Error(`This app declares no permission "${permission}" in its manifest`);
      }
      return permissions[permission] === true;
    }
    case 'events.subscribe':
      return subscribe(session, APP_METHODS['events.subscribe'].params(rawParams).events);
    case 'events.unsubscribe':
      for (const event of APP_METHODS['events.unsubscribe'].params(rawParams).events) {
        session.subscriptions.delete(event);
      }
      return { events: [...session.subscriptions] };
    case 'canvas.getViewport':
      return host.viewport();
    case 'canvas.setDevice':
      host.setDevice(APP_METHODS['canvas.setDevice'].params(rawParams).device);
      return host.viewport();
    case 'canvas.setWidth':
      ableOrThrow(host.setWidth)(APP_METHODS['canvas.setWidth'].params(rawParams).widthPx);
      return host.viewport();
    case 'canvas.scrollTo':
      return scrollCanvas(host, context, APP_METHODS['canvas.scrollTo'].params(rawParams));
    case 'canvas.startInsertDrag': {
      const start = APP_METHODS['canvas.startInsertDrag'].params(rawParams);
      const refusal = insertDragRefusal(host, start.item);
      if (refusal !== undefined) {
        return refusal;
      }
      required(context.insertDrag, 'Drags to insert').start(session.app.manifest.id, start);
      return { applied: true };
    }
    case 'canvas.insertDrag':
      return insertDragStep(context, session, APP_METHODS['canvas.insertDrag'].params(rawParams));
    case 'canvas.highlight':
      return highlightCanvas(context, session, APP_METHODS['canvas.highlight'].params(rawParams));
    case 'canvas.setOutlineMode':
      return required(context.outlineMode, 'Outline modes').set(session.app.manifest.id, APP_METHODS['canvas.setOutlineMode'].params(rawParams).mode);
    case 'canvas.snapshot': {
      const { target, widthMax } = APP_METHODS['canvas.snapshot'].params(rawParams);
      if (host.snapshot.kind === 'unable') {
        return refusedBy(host.snapshot);
      }
      if (!snapshotAllowed(session.app.manifest.id, (context.nowMs ?? Date.now)())) {
        return { applied: false, reason: `One snapshot per ${APP_RPC_LIMITS.snapshotIntervalMs / 1000} s: try again in a moment` };
      }
      const box =
        'ref' in target
          ? await refBox(context, target.ref)
          : await renderedBox(required(context.measure, 'Element measurements'), target.nodeId, target.occurrence);
      if (box === undefined) {
        return { applied: false, reason: 'That element is not drawn on the canvas' };
      }
      return host.snapshot.run(box, widthMax);
    }
    case 'panels.open':
      host.openPanel(APP_METHODS['panels.open'].params(rawParams).panel);
      return host.panels();
    case 'panels.close':
      host.closePanel();
      return host.panels();
    case 'panels.openRight':
      host.openRightPanel(APP_METHODS['panels.openRight'].params(rawParams).panel);
      return host.panels();
    case 'panels.get':
      return host.panels();
    case 'selection.get':
      return host.selection();
    case 'selection.set':
      return host.select(APP_METHODS['selection.set'].params(rawParams).nodeId);
    case 'page.get':
      return host.page();
    case 'page.open': {
      const { path } = APP_METHODS['page.open'].params(rawParams);
      if (!host.pages().some((page) => page.path === path)) {
        return { applied: false, reason: 'This project has no page at that path; page.list names them' };
      }
      return openedWithin(host, path, host.openPage(path));
    }
    case 'component.open': {
      const { path } = APP_METHODS['component.open'].params(rawParams);
      if (host.openComponent.kind === 'unable') {
        return refusedBy(host.openComponent);
      }
      return openedWithin(host, path, host.openComponent.run(path));
    }
    case 'page.list':
      return host.pages();
    case 'node.get':
      return host.node(APP_METHODS['node.get'].params(rawParams).nodeId);
    case 'node.setAttribute': {
      const edit = APP_METHODS['node.setAttribute'].params(rawParams);
      return pageEdit(context, session, host.attributes, (run) => run.set(edit.nodeId, edit.name, edit.value, edit.label));
    }
    case 'node.removeAttribute': {
      const edit = APP_METHODS['node.removeAttribute'].params(rawParams);
      return pageEdit(context, session, host.attributes, (run) => run.remove(edit.nodeId, edit.name, edit.label));
    }
    case 'node.addClass': {
      const edit = APP_METHODS['node.addClass'].params(rawParams);
      return pageEdit(context, session, host.classes, (run) => run.add(edit.nodeId, edit.className, edit.label));
    }
    case 'node.removeClass': {
      const edit = APP_METHODS['node.removeClass'].params(rawParams);
      return pageEdit(context, session, host.classes, (run) => run.remove(edit.nodeId, edit.className, edit.label));
    }
    case 'node.setStyle': {
      const edit = APP_METHODS['node.setStyle'].params(rawParams);
      return pageEdit(context, session, host.setStyle, (run) => run(edit.nodeId, edit.css, edit.label));
    }
    case 'node.insert': {
      const { item, place, label } = APP_METHODS['node.insert'].params(rawParams);
      const refusal = insertPartRefusal(host, item, place);
      if (refusal !== undefined) {
        return refusal;
      }
      if (item.kind === 'element') {
        return pageEdit(context, session, host.insertElement, (run) => run({ item, place, label }));
      }
      return pageEdit(context, session, able(host.insertComponent), (run) => run({ item, place, label }));
    }
    case 'node.remove': {
      const edit = APP_METHODS['node.remove'].params(rawParams);
      return pageEdit(context, session, able(host.remove), (run) => run(edit.nodeId, edit.label));
    }
    case 'node.duplicate': {
      const edit = APP_METHODS['node.duplicate'].params(rawParams);
      return pageEdit(context, session, able(host.duplicate), (run) => run(edit.nodeId, edit.label));
    }
    case 'history.undo':
      return pageEdit(context, session, host.history, (run) => run.undo());
    case 'history.redo':
      return pageEdit(context, session, host.history, (run) => run.redo());
    case 'shortcuts.run':
      return runShortcut(host, APP_METHODS['shortcuts.run'].params(rawParams).shortcut);
    case 'shortcuts.focus':
      required(context.shortcuts, 'Menu shortcuts').noteFocus(session, APP_METHODS['shortcuts.focus'].params(rawParams).editable);
      return { applied: true };
    case 'shortcuts.claim': {
      const { shortcuts } = APP_METHODS['shortcuts.claim'].params(rawParams);
      required(context.shortcuts, 'Menu shortcuts').claim(session, shortcuts);
      return { shortcuts: [...new Set([...session.app.manifest.shortcutClaims, ...shortcuts])] };
    }
    case 'commands.register': {
      const { commands } = APP_METHODS['commands.register'].params(rawParams);
      required(context.commands, 'App commands').register(session, commands);
      return { commands: commands.map((command) => command.id) };
    }
    case 'commands.trigger':
      return { ran: required(context.commands, 'App commands').trigger(APP_METHODS['commands.trigger'].params(rawParams).shortcut) };
    case 'overrides.register':
      return required(context.overrides, 'Overrides').register(session, APP_METHODS['overrides.register'].params(rawParams).point);
    case 'overrides.unregister':
      required(context.overrides, 'Overrides').unregister(session, APP_METHODS['overrides.unregister'].params(rawParams).point);
      return { applied: true };
    case 'overrides.resolve': {
      const { call, answer } = APP_METHODS['overrides.resolve'].params(rawParams);
      return required(context.overrides, 'Overrides').resolve(session, call, answer);
    }
    case 'ui.theme':
      return currentAppTheme();
    case 'ui.openFrame':
      return required(context.frames, 'Custom frames').open(session, APP_METHODS['ui.openFrame'].params(rawParams));
    case 'ui.closeFrame': {
      const { frameId, result } = APP_METHODS['ui.closeFrame'].params(rawParams);
      return required(context.frames, 'Custom frames').close(session, frameId, result);
    }
    case 'overlay.set':
      context.setOverlay(session.app.manifest.id, APP_METHODS['overlay.set'].params(rawParams).items);
      return { applied: true };
    case 'overlay.clear':
      context.setOverlay(session.app.manifest.id, undefined);
      return { applied: true };
    case 'ui.notify': {
      const note = APP_METHODS['ui.notify'].params(rawParams);
      host.notify(`${session.app.manifest.name}: ${note.message}`, note.kind);
      return { applied: true };
    }
    case 'person.get':
      return host.person();
    case 'app.badge':
      required(context.badges, 'Rail badges').set(session.app.manifest.id, APP_METHODS['app.badge'].params(rawParams).count);
      return { applied: true };
    case 'storage.get': {
      const { key, scope } = APP_METHODS['storage.get'].params(rawParams);
      return { value: await host.storage.get(session.app.manifest.id, scope, key) };
    }
    case 'storage.set': {
      const { key, scope, value } = APP_METHODS['storage.set'].params(rawParams);
      return host.storage.set(session.app.manifest.id, scope, key, value);
    }
    case 'storage.remove': {
      const { key, scope } = APP_METHODS['storage.remove'].params(rawParams);
      return host.storage.set(session.app.manifest.id, scope, key, undefined);
    }
    case 'files.list':
    case 'files.read':
    case 'files.write':
    case 'files.delete':
    case 'files.move':
    case 'files.mkdir':
    case 'auth.connect':
    case 'auth.token':
    case 'auth.disconnect':
    case 'auth.status':
    case 'net.fetch':
      return runAccessMethod(method, rawParams, session, context);
    case 'storage.keys':
      return { keys: await host.storage.keys(session.app.manifest.id, APP_METHODS['storage.keys'].params(rawParams).scope) };
    case 'canvas.capture': {
      const { on, cursor, mode, reason } = APP_METHODS['canvas.capture'].params(rawParams);
      const { id, name } = session.app.manifest;
      const capture = required(context.capture, 'Canvas clicks');
      if (!on) {
        return capture.set({ id, name }, on, { cursor: 'crosshair', mode, reason });
      }
      const read = typeof cursor === 'string' ? undefined : required(context.readBundle, 'Image cursors');
      const resolved = await resolveCanvasCursor(id, cursor, read ?? (() => Promise.resolve(undefined)));
      return resolved.ok ? capture.set({ id, name }, on, { cursor: resolved.cursor, mode, reason }) : { applied: false, reason: resolved.reason };
    }
    case 'node.measure': {
      const target = APP_METHODS['node.measure'].params(rawParams);
      if ('ref' in target) {
        const box = await refBox(context, target.ref);
        return { rects: box === undefined ? [] : [box] };
      }
      return { rects: await required(context.measure, 'Element measurements').measure(target.nodeId, target.occurrence) };
    }
    case 'node.key': {
      const { nodeId } = APP_METHODS['node.key'].params(rawParams);
      return nodeKey(
        {
          node: (id) => host.node(id),
          tree: () => host.page()?.nodes ?? [],
          setAttribute: (id, name, value) => pageEdit(context, session, host.attributes, (run) => run.set(id, name, value, 'Key element')),
        },
        nodeId,
      );
    }
    case 'overlay.post': {
      const message = APP_METHODS['overlay.post'].params(rawParams);
      if (session.overlayItem === undefined && message.itemId === undefined) {
        throw new Error('Name the overlay frame item (itemId) to post to');
      }
      if (session.overlayItem !== undefined && message.itemId !== undefined && message.itemId !== session.overlayItem) {
        throw new Error('An overlay frame posts only to its own app; leave itemId out');
      }
      return { delivered: required(context.overlayMessages, 'Overlay messages').post(session, message) };
    }
    case 'app.openSettings':
      required(context.openDetails, 'App details')(session.app.manifest.id);
      return { applied: true };
    case 'people.list':
      return required(host.people, 'Project members')();
    case 'clipboard.write': {
      const { text } = APP_METHODS['clipboard.write'].params(rawParams);
      await required(context.writeClipboard, 'Clipboard writes')(text);
      return { applied: true };
    }
    case 'node.find': {
      const find = APP_METHODS['node.find'].params(rawParams);
      if ('key' in find) {
        return { nodeId: findNodeByKey(host.page()?.nodes ?? [], find.key) };
      }
      const steps = await resolveNodeRefSteps(required(context.nodeRefs, 'Node refs'), find.ref);
      return steps.found ? { nodeId: steps.openNodeId, ref: steps.ref } : { nodeId: undefined, ref: undefined };
    }
    case 'page.getTree':
      return pageIndexOf(host).getTree(APP_METHODS['page.getTree'].params(rawParams).path, host.page());
    case 'page.findByAttribute': {
      const { name, limit } = APP_METHODS['page.findByAttribute'].params(rawParams);
      return pageIndexOf(host).findByAttribute(name, limit, host.page());
    }
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}

async function runShortcut(host: AppHostCommands, shortcut: AppShortcut): Promise<AppEditOutcome> {
  switch (shortcut) {
    case 'undo':
      return host.history.kind === 'able' ? host.history.run.undo() : refusedBy(host.history);
    case 'redo':
      return host.history.kind === 'able' ? host.history.run.redo() : refusedBy(host.history);
    case 'save':
      return host.save();
    case 'palette':
      return host.openPalette.kind === 'able' ? host.openPalette.run() : refusedBy(host.openPalette);
    case 'escape':
      return host.escape();
    default: {
      const exhaustive: never = shortcut;
      return exhaustive;
    }
  }
}

async function pageEdit<T, O extends AppEditOutcome | AppInsertOutcome>(
  context: AppRpcContext,
  session: AppSession,
  ability: AppHostAbility<T>,
  edit: (run: T) => Promise<O>,
): Promise<O | AppRefusal> {
  if (ability.kind === 'unable') {
    return refusedBy(ability);
  }
  const finish = context.editOrigin?.begin(session.app.manifest.id);
  try {
    return await edit(ability.run);
  } finally {
    finish?.();
  }
}

const NAVIGATE_POLL_MS = 50;

async function openedWithin(host: AppHostCommands, path: string, started: AppEditOutcome): Promise<AppEditOutcome> {
  if (!started.applied) {
    return started;
  }
  for (let waitedMs = 0; waitedMs < APP_RPC_LIMITS.navigateTimeoutMs; waitedMs += NAVIGATE_POLL_MS) {
    if (host.page()?.path === path) {
      return { applied: true };
    }
    await new Promise((resolve) => setTimeout(resolve, NAVIGATE_POLL_MS));
  }
  return host.page()?.path === path
    ? { applied: true }
    : { applied: false, reason: `The editor did not open ${path} within ${APP_RPC_LIMITS.navigateTimeoutMs / 1000} s` };
}

async function renderedBox(measure: AppNodeMeasurer, nodeId: string, occurrence: number | undefined): Promise<AppRect | undefined> {
  const tries = Math.ceil(APP_RPC_LIMITS.navigateTimeoutMs / APP_RPC_LIMITS.measureTimeoutMs);
  assert(tries >= 1, 'A rendered box is asked for at least once');
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const [box] = await measure.measure(nodeId, occurrence);
    if (box !== undefined) {
      return box;
    }
  }
  return undefined;
}

async function scrollCanvas(host: AppHostCommands, context: AppRpcContext, target: AppScrollTarget): Promise<AppEditOutcome> {
  if (host.scrollTo.kind === 'unable') {
    return refusedBy(host.scrollTo);
  }
  const tell = context.tellCanvas ?? (() => false);
  if ('ref' in target) {
    const box = await refBox(context, target.ref);
    if (box === undefined) {
      return { applied: false, reason: 'That element is not drawn on the canvas' };
    }
    const told = tell({ type: 'avb:app-scroll', space: 'viewport', x: box.x, y: box.y, w: box.width, h: box.height, block: target.block });
    return told ? { applied: true } : { applied: false, reason: 'The canvas is not showing a page' };
  }
  if (!('nodeId' in target)) {
    const told = tell({ type: 'avb:app-scroll', space: 'page', x: target.x, y: target.y, w: 0, h: 0, block: target.block });
    return told ? { applied: true } : { applied: false, reason: 'The canvas is not showing a page' };
  }
  const box = context.measure === undefined ? undefined : await renderedBox(context.measure, target.nodeId, target.occurrence);
  if (context.measure !== undefined && box === undefined) {
    return { applied: false, reason: `That element is not drawn on the canvas within ${APP_RPC_LIMITS.navigateTimeoutMs / 1000} s` };
  }
  if (target.block === 'start' && box !== undefined) {
    const told = tell({ type: 'avb:app-scroll', space: 'viewport', x: box.x, y: box.y, w: box.width, h: box.height, block: 'start' });
    return told ? { applied: true } : { applied: false, reason: 'The canvas is not showing a page' };
  }
  return host.scrollTo.run(target);
}

function insertDragRefusal(host: AppHostCommands, item: AppInsert): AppRefusal | undefined {
  if (item.kind === 'element' && host.insertElement.kind === 'unable') {
    return refusedBy(host.insertElement);
  }
  return insertPartRefusal(host, item, { kind: 'selection' });
}

async function insertDragStep(context: AppRpcContext, session: AppSession, step: AppInsertDragStep): Promise<unknown> {
  const drag = required(context.insertDrag, 'Drags to insert');
  const appId = session.app.manifest.id;
  const origin = context.frameOrigin?.() ?? { left: 0, top: 0 };
  const x = origin.left + step.x;
  const y = origin.top + step.y;
  switch (step.phase) {
    case 'move':
      return { over: await drag.move(appId, x, y) };
    case 'cancel':
      if (drag.view()?.appId === appId) {
        drag.cancel();
      }
      return { applied: false, reason: 'The drag was cancelled' };
    case 'drop': {
      const dropped = await drag.drop(appId, x, y);
      if (dropped.kind === 'refused') {
        return { applied: false, reason: dropped.reason };
      }
      const { item, place, label } = dropped;
      const refusal = insertPartRefusal(context.host, item, place);
      if (refusal !== undefined) {
        return refusal;
      }
      if (item.kind === 'element') {
        return pageEdit(context, session, context.host.insertElement, (run) => run({ item, place, label }));
      }
      return pageEdit(context, session, able(context.host.insertComponent), (run) => run({ item, place, label }));
    }
    default: {
      const exhaustive: never = step.phase;
      return exhaustive;
    }
  }
}

async function highlightCanvas(
  context: AppRpcContext,
  session: AppSession,
  { target, style }: { readonly target: AppNodeTarget | undefined; readonly style: CanvasHighlightStyle },
): Promise<AppEditOutcome> {
  const highlights = required(context.highlight, 'Highlights');
  const appId = session.app.manifest.id;
  if (target === undefined) {
    highlights.clear(appId);
    return { applied: true };
  }
  const page = context.host.page()?.path;
  if (!('ref' in target) && page === undefined) {
    return { applied: false, reason: 'No page is open' };
  }
  const ref: AppNodeRef = 'ref' in target ? target.ref : { steps: [{ file: page ?? '', nodeId: target.nodeId, key: undefined, copy: target.occurrence ?? 0 }] };
  const resolved = await resolveHighlight(required(context.nodeRefs, 'Node refs'), ref, style);
  if ('reason' in resolved) {
    return { applied: false, reason: resolved.reason };
  }
  highlights.show(appId, resolved);
  return { applied: true };
}

async function refBox(context: AppRpcContext, ref: AppNodeRef): Promise<AppRect | undefined> {
  const resolved = await resolveNodeRef(required(context.nodeRefs, 'Node refs'), ref);
  return 'reason' in resolved ? undefined : resolved.box;
}

const SNAPSHOT_APPS_MAX = 64;
const snapshotTimes = new Map<string, number>();

function snapshotAllowed(appId: string, nowMs: number): boolean {
  const lastMs = snapshotTimes.get(appId);
  if (lastMs !== undefined && nowMs - lastMs < APP_RPC_LIMITS.snapshotIntervalMs) {
    return false;
  }
  snapshotTimes.delete(appId);
  snapshotTimes.set(appId, nowMs);
  if (snapshotTimes.size > SNAPSHOT_APPS_MAX) {
    const [oldest] = snapshotTimes.keys();
    if (oldest !== undefined) {
      snapshotTimes.delete(oldest);
    }
  }
  assert(snapshotTimes.size <= SNAPSHOT_APPS_MAX, 'Snapshot times are bounded');
  return true;
}

function refusedBy(ability: { readonly kind: 'unable'; readonly reason: string }): AppRefusal {
  assert(ability.reason.length > 0, 'A refusal says why');
  return { applied: false, reason: ability.reason };
}

function ableOrThrow<T>(ability: AppHostAbility<T>): T {
  if (ability.kind === 'unable') {
    throw new Error(ability.reason);
  }
  return ability.run;
}

function required<T>(part: T | undefined, what: string): T {
  if (part === undefined) {
    throw new Error(`${what} are not available in this editor`);
  }
  return part;
}

function subscribe(session: AppSession, events: readonly AppEventName[]): { readonly events: readonly AppEventName[] } {
  for (const event of events) {
    session.subscriptions.add(event);
  }
  assert(session.subscriptions.size <= APP_EVENT_NAMES.length, 'Subscriptions are bounded by the event list');
  return { events: [...session.subscriptions] };
}

export function appRoleView(role: RoleView, manifest: Pick<AppManifest, 'id' | 'permissions'>): AppRoleView {
  const permissions = appPermissionsFor(role, manifest.id, manifest.permissions);
  assert(Object.keys(permissions).length === manifest.permissions.length, 'An app hears exactly the permissions it declares');
  return { id: role.id, name: role.name, isAdmin: role.isAdmin, permissions };
}

export function eventForSession<E extends AppEventName>(session: AppSession, role: RoleView, event: E, data: AppEventData[E]): AppHostMessage | undefined {
  if (!session.subscriptions.has(event)) {
    return undefined;
  }
  if (!can(role, appAccessFeature(session.app.manifest.id))) {
    return undefined;
  }
  return eventMessage(event, data);
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500) || 'The request failed';
}
