import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';
import { parseAppId } from './apps';
import { parseAppFileContent, parseFilePathShape } from './appFiles';
import { parseAppPermissionId } from './appPermissions';
import { parseAuthProviderId, type AppAuthStatus } from './appAuth';
import { parseAppNetRequest } from './appNet';
import { parseAppStorageKey, parseAppStorageScope, parseAppStorageValue, type AppStorageScope } from './appStorage';
import { APP_SHORTCUTS, parseAppCommands, parseCommandShortcut, parseShortcutClaims, type AppReservedShortcut } from './appShortcuts';
import type { AppThemeView } from './appUiKit';
import { CANVAS_HIGHLIGHT_STYLES, CANVAS_OUTLINE_MODES, type CanvasHighlightStyle, type CanvasOutlineMode } from './deepOutline';

export { APP_SHORTCUTS, type AppShortcut } from './appShortcuts';
export type { AppStorageScope } from './appStorage';

export const APP_API_VERSION = 1;

export const APP_RPC_LIMITS = {
  requestsInFlightMax: 32,
  methodCharsMax: 64,
  subscriptionsMax: 16,
  overlayItemsMax: 64,
  overlayAnchorsMax: 64,
  clusterRadiusPx: 24,
  dragThresholdPx: 4,
  captureReasonCharsMax: 60,
  cursorImageBytesMax: 4096,
  cursorImagePxMax: 32,
  navigateTimeoutMs: 5000,
  snapshotBytesMax: 200 * 1024,
  snapshotWidthPxMax: 800,
  snapshotWidthPxDefault: 320,
  snapshotIntervalMs: 1000,
  measureRectsMax: 500,
  measureTimeoutMs: 1000,
  measureRequestsMax: 16,
  indexFilesMax: 2000,
  indexBytesReadMax: 32 * 1024 * 1024,
  attributeMatchesMax: 500,
  nodeKeyCharsMax: 32,
  nodeLayersMax: 32,
  nodeCopyMax: 100_000,
  pathCharsMax: 512,
  overlayFramesMax: 2,
  heatCellsMax: 1024,
  labelCharsMax: 120,
  pinLabelCharsMax: 3,
  pinAvatarURLCharsMax: 2048,
  notifyCharsMax: 280,
  nameCharsMax: 128,
  valueCharsMax: 4096,
  treeNodesMax: 5000,
  treeDepthMax: 64,
  nodeTextCharsMax: 500,
  insertAttributesMax: 32,
  coordinatePxMax: 1_000_000,
  overrideTimeoutMs: 5 * 60_000,
  overrideCallsMax: 4,
  overrideQueueMax: 64,
  overridePathsMax: 500,
  bindingPathCharsMax: 512,
  assetURLCharsMax: 2048,
  altCharsMax: 500,
  customFramesMax: 2,
  frameWidthPxMin: 240,
  frameWidthPxMax: 1600,
  frameHeightPxMin: 160,
  frameHeightPxMax: 1200,
  undoLabelCharsMax: 60,
  badgeCountMax: 9999,
  changePathsMax: 64,
  overlayMessageCharsMax: 64 * 1024,
  peopleMax: 200,
  clipboardCharsMax: 256 * 1024,
} as const satisfies Record<string, number>;


export const APP_LEFT_PANELS = [
  'pages',
  'navigator',
  'properties',
  'components',
  'assets',
  'cms',
  'variables',
  'selectors',
  'code',
  'history',
  'apps',
  'instructions',
  'audits',
  'ai',
] as const;
export type AppLeftPanel = (typeof APP_LEFT_PANELS)[number];
export const APP_RIGHT_PANELS = ['style', 'settings'] as const;
export type AppRightPanel = (typeof APP_RIGHT_PANELS)[number];
export const APP_DEVICES = ['desktop', 'laptop', 'tablet', 'phone'] as const;
export type AppDevice = (typeof APP_DEVICES)[number];
export const APP_CHANGE_SOURCES = ['page', 'styles', 'cms', 'assets', 'files'] as const;
export type AppChangeSource = (typeof APP_CHANGE_SOURCES)[number];

export const APP_OVERRIDE_POINTS = ['assets.pick', 'cms.bind'] as const;
export type AppOverridePoint = (typeof APP_OVERRIDE_POINTS)[number];
export const APP_MEDIA_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type AppMediaKind = (typeof APP_MEDIA_KINDS)[number];

export interface AppOverrideContexts {
  readonly 'assets.pick': {
    readonly nodeId: string | undefined;
    readonly field: string | undefined;
    readonly accepts: readonly AppMediaKind[];
    readonly current: string;
    readonly acceptsURL: boolean;
  };
  readonly 'cms.bind': {
    readonly purpose: 'field' | 'loop-source';
    readonly current: string | undefined;
    readonly paths: readonly string[];
    readonly selection: string | undefined;
  };
}

export type AppOverrideFallback = { readonly kind: 'default' } | { readonly kind: 'cancel' };

export interface AppOverrideResults {
  readonly 'assets.pick': { readonly kind: 'picked'; readonly url: string; readonly alt: string | undefined } | AppOverrideFallback;
  readonly 'cms.bind': { readonly kind: 'picked'; readonly path: string } | AppOverrideFallback;
}

export type AppOverrideRequest = { readonly [P in AppOverridePoint]: { readonly point: P; readonly context: AppOverrideContexts[P] } }[AppOverridePoint];
export type AppOverrideAnswer = { readonly [P in AppOverridePoint]: { readonly point: P; readonly result: AppOverrideResults[P] } }[AppOverridePoint];

export function defaultAnswer(point: AppOverridePoint): AppOverrideAnswer {
  return fallbackAnswer(point, { kind: 'default' });
}

export function fallbackAnswer(point: AppOverridePoint, fallback: AppOverrideFallback): AppOverrideAnswer {
  switch (point) {
    case 'assets.pick':
      return { point, result: fallback };
    case 'cms.bind':
      return { point, result: fallback };
    default: {
      const exhaustive: never = point;
      return exhaustive;
    }
  }
}

export interface AppOpenFrame {
  readonly page: string;
  readonly width: number;
  readonly height: number;
  readonly modal: boolean;
  readonly data: string | undefined;
}

export interface AppFrameInfo {
  readonly id: string;
  readonly data: string | undefined;
}

export interface AppRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AppViewport {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scale: number;
  readonly device: AppDevice | 'custom' | 'canvas';
}

export interface AppNodeView {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly classes: readonly string[];
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string | undefined;
  readonly children: readonly AppNodeView[];
}

export interface AppPageView {
  readonly path: string;
  readonly editable: boolean;
  readonly nodes: readonly AppNodeView[];
  readonly truncated: boolean;
}

export interface AppPageSummary {
  readonly path: string;
  readonly route: string;
  readonly title: string | undefined;
}

export interface AppSelection {
  readonly nodeId: string | undefined;
}

export interface AppRoleView {
  readonly id: string;
  readonly name: string;
  readonly isAdmin: boolean;
  readonly permissions: Readonly<Record<string, boolean>>;
}

export type AppEditOutcome = { readonly applied: true } | { readonly applied: false; readonly reason: string };

export type AppInsertOutcome = { readonly applied: true; readonly nodeId: string | undefined } | { readonly applied: false; readonly reason: string };

export type AppSnapshotOutcome =
  { readonly applied: true; readonly url: string; readonly width: number; readonly height: number } | { readonly applied: false; readonly reason: string };

export interface AppPerson {
  readonly id: string;
  readonly name: string | undefined;
  readonly email: string | undefined;
  readonly github: string | undefined;
}

export const APP_PERSON_LIMITS = {
  idChars: 32,
  detailCharsMax: 256,
} as const satisfies Record<string, number>;

export function parseAppPerson(input: unknown): AppPerson {
  const value = record(input);
  const id = text(value['id']);
  if (id.length !== APP_PERSON_LIMITS.idChars || !/^[0-9a-f]+$/.test(id)) {
    throw new Error('A person id is 32 hex characters');
  }
  const detail = (field: string): string | undefined => {
    const raw = value[field];
    if (raw === undefined) {
      return undefined;
    }
    return boundedLabel(raw, APP_PERSON_LIMITS.detailCharsMax, field);
  };
  const github = detail('github');
  if (github !== undefined && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(github)) {
    throw new Error('github is a GitHub login');
  }
  return { id, name: detail('name'), email: detail('email'), github };
}

export interface AppCommitAuthor {
  readonly name: string | undefined;
  readonly email: string | undefined;
}

export function appMembers(input: {
  readonly roleMembers: readonly string[];
  readonly authors: readonly AppCommitAuthor[];
  readonly hidden: boolean;
  readonly avatar: (login: string) => string | undefined;
}): readonly AppMember[] {
  const members: AppMember[] = [];
  const logins = new Set<string>();
  const emails = new Set<string>();
  for (const login of input.roleMembers) {
    if (members.length >= APP_RPC_LIMITS.peopleMax) {
      break;
    }
    if (!GITHUB_LOGIN.test(login) || logins.has(login.toLowerCase())) {
      continue;
    }
    logins.add(login.toLowerCase());
    members.push({ login, name: undefined, email: undefined, avatarURL: input.avatar(login) });
  }
  for (const author of input.authors) {
    if (members.length >= APP_RPC_LIMITS.peopleMax) {
      break;
    }
    const email = author.email?.toLowerCase();
    const login = email === undefined ? undefined : noreplyLogin(email);
    const known = (login !== undefined && logins.has(login.toLowerCase())) || (email !== undefined && emails.has(email));
    if (known) {
      continue;
    }
    if (input.hidden) {
      if (login !== undefined) {
        logins.add(login.toLowerCase());
        members.push({ login, name: undefined, email: undefined, avatarURL: input.avatar(login) });
      }
      continue;
    }
    if (author.name === undefined && email === undefined) {
      continue;
    }
    if (email !== undefined) {
      emails.add(email);
    }
    if (login !== undefined) {
      logins.add(login.toLowerCase());
    }
    members.push({
      login,
      name: boundedDetail(author.name),
      email: boundedDetail(author.email),
      avatarURL: login === undefined ? undefined : input.avatar(login),
    });
  }
  assert(members.length <= APP_RPC_LIMITS.peopleMax, 'people.list is bounded');
  assert(!input.hidden || members.every((member) => member.name === undefined && member.email === undefined), 'Hidden details stay hidden');
  return members;
}

export function parseAppMembers(input: unknown): readonly AppMember[] {
  const list = toArray(input);
  if (list === undefined) {
    throw new Error('people is a list');
  }
  if (list.length > APP_RPC_LIMITS.peopleMax) {
    throw new Error(`people lists at most ${APP_RPC_LIMITS.peopleMax}`);
  }
  return list.map((entry): AppMember => {
    const value = record(entry);
    const optional = (field: string): string | undefined =>
      value[field] === undefined ? undefined : boundedLabel(value[field], APP_PERSON_LIMITS.detailCharsMax, field);
    const login = optional('login');
    if (login !== undefined && !GITHUB_LOGIN.test(login)) {
      throw new Error('login is a GitHub login');
    }
    const avatarURL = optional('avatarURL');
    if (avatarURL !== undefined && !/^https:\/\/(?:avatars\.githubusercontent\.com|github\.com)\//.test(avatarURL)) {
      throw new Error('avatarURL is a GitHub picture');
    }
    return { login, name: optional('name'), email: optional('email'), avatarURL };
  });
}

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

function noreplyLogin(email: string): string | undefined {
  const login = /^(?:\d{1,12}\+)?([^@\s]+)@users\.noreply\.github\.com$/.exec(email)?.[1];
  return login !== undefined && GITHUB_LOGIN.test(login) ? login : undefined;
}

function boundedDetail(detail: string | undefined): string | undefined {
  const trimmed = detail?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed.slice(0, APP_PERSON_LIMITS.detailCharsMax);
}

export const APP_HOST_KINDS = ['desktop', 'studio'] as const;
export type AppHostKind = (typeof APP_HOST_KINDS)[number];

export const APP_CAPABILITIES = [
  'setAttribute',
  'addClass',
  'setStyle',
  'insertElement',
  'insertAttributes',
  'insertReplace',
  'openPalette',
  'undo',
  'setWidth',
  'scrollTo',
  'snapshot',
] as const;
export type AppCapability = (typeof APP_CAPABILITIES)[number];
export type AppCapabilities = { readonly [C in AppCapability]: boolean };

export interface AppInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly frame: AppFrameInfo | undefined;
  readonly shortcutClaims: readonly string[];
  readonly host: { readonly kind: AppHostKind; readonly version: string };
  readonly can: AppCapabilities;
}

export type AppChangeOrigin = 'self' | 'other';

export interface AppPoint {
  readonly x: number;
  readonly y: number;
}

export type AppOverlayAnchor =
  | { readonly nodeId: string; readonly occurrence: number | undefined; readonly at: AppPoint | undefined }
  | { readonly ref: AppNodeRef; readonly at: AppPoint | undefined }
  | { readonly rect: AppRect };

export const APP_CANVAS_CURSORS = ['crosshair', 'default'] as const;
export type AppCanvasCursorName = (typeof APP_CANVAS_CURSORS)[number];

export interface AppCursorHotspot {
  readonly x: number;
  readonly y: number;
}

export type AppCanvasCursorRequest = AppCanvasCursorName | { readonly image: string; readonly hotspot: AppCursorHotspot };

export type AppCanvasCursor = AppCanvasCursorName | { readonly url: string; readonly hotspot: AppCursorHotspot };

export interface AppCanvasClick {
  readonly nodeId: string | undefined;
  readonly at: AppPoint | undefined;
  readonly x: number;
  readonly y: number;
  readonly layers: readonly AppNodeLayer[];
}

export interface AppNodeRefStep {
  readonly file: string;
  readonly nodeId: string | undefined;
  readonly key: string | undefined;
  readonly copy: number;
}

export interface AppNodeRef {
  readonly steps: readonly AppNodeRefStep[];
}

export interface AppNodeLayer {
  readonly file: string;
  readonly nodeId: string;
  readonly key: string | undefined;
  readonly component: string | undefined;
  readonly instancePath: readonly AppNodeRefStep[];
  readonly ref: AppNodeRef;
}

export type AppNodeTarget = { readonly nodeId: string; readonly occurrence: number | undefined } | { readonly ref: AppNodeRef };

function captureReason(input: unknown): string {
  const reason = boundedLabel(input, APP_RPC_LIMITS.captureReasonCharsMax, 'reason').trim();
  if (reason.length === 0 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new Error('reason is one line of words');
  }
  return reason;
}

export const APP_CAPTURE_MODES = ['capture', 'observe'] as const;
export type AppCaptureMode = (typeof APP_CAPTURE_MODES)[number];

export const APP_CAPTURE_REASONS = ['app', 'escape', 'replaced'] as const;
export type AppCaptureReason = (typeof APP_CAPTURE_REASONS)[number];

export const APP_OUTLINE_MODES = CANVAS_OUTLINE_MODES;
export type AppOutlineMode = CanvasOutlineMode;

export const APP_OUTLINE_REASONS = ['app', 'panel', 'replaced', 'project', 'restored'] as const;
export type AppOutlineReason = (typeof APP_OUTLINE_REASONS)[number];

export const APP_OVERLAY_MESSAGE_SENDERS = ['app', 'overlay'] as const;
export type AppOverlayMessageSender = (typeof APP_OVERLAY_MESSAGE_SENDERS)[number];

export interface AppOverlayPost {
  readonly itemId: string | undefined;
  readonly data: string;
}

export interface AppMember {
  readonly login: string | undefined;
  readonly name: string | undefined;
  readonly email: string | undefined;
  readonly avatarURL: string | undefined;
}

export const APP_DRAG_PHASES = ['start', 'move', 'end'] as const;
export type AppDragPhase = (typeof APP_DRAG_PHASES)[number];

export interface AppOverlayDrag extends AppCanvasClick {
  readonly itemId: string;
  readonly phase: AppDragPhase;
  readonly cancelled: boolean;
}

export { NODE_KEY_ATTRIBUTE } from '../core/internalAttributes';

export type AppNodeKeyOutcome = { readonly applied: true; readonly key: string } | { readonly applied: false; readonly reason: string };

export interface AppAttributeMatch {
  readonly path: string;
  readonly nodeId: string;
  readonly value: string;
}

export const APP_PIN_TONES = ['accent', 'success', 'muted', 'danger'] as const;
export type AppPinTone = (typeof APP_PIN_TONES)[number];

export type AppOverlayItem =
  | {
      readonly kind: 'box';
      readonly id: string;
      readonly anchor: AppOverlayAnchor;
      readonly color: string | undefined;
      readonly fill: string | undefined;
      readonly label: string | undefined;
      readonly dashed: boolean;
      readonly interactive: boolean;
      readonly draggable: boolean;
    }
  | {
      readonly kind: 'label';
      readonly id: string;
      readonly anchor: AppOverlayAnchor;
      readonly text: string;
      readonly placement: 'top' | 'bottom' | 'center';
      readonly color: string | undefined;
      readonly background: string | undefined;
      readonly interactive: boolean;
      readonly draggable: boolean;
      readonly cluster: boolean;
    }
  | {
      readonly kind: 'pin';
      readonly id: string;
      readonly anchor: AppOverlayAnchor;
      readonly label: string | undefined;
      readonly tone: AppPinTone;
      readonly avatarURL: string | undefined;
      readonly active: boolean;
      readonly interactive: boolean;
      readonly draggable: boolean;
      readonly cluster: boolean;
    }
  | {
      readonly kind: 'heat';
      readonly id: string;
      readonly anchor: AppOverlayAnchor;
      readonly columns: number;
      readonly rows: number;
      readonly values: readonly number[];
      readonly color: string | undefined;
    }
  | {
      readonly kind: 'frame';
      readonly id: string;
      readonly anchor: AppOverlayAnchor;
      readonly path: string;
      readonly interactive: boolean;
    };


type ParamsParser<T> = (input: unknown) => T;

const nothing: ParamsParser<undefined> = () => undefined;

export const APP_METHODS = {
  'app.info': { params: nothing },
  'role.get': { params: nothing },
  'role.can': { params: (input: unknown) => ({ permission: parseAppPermissionId(record(input)['permission']) }) },
  'settings.get': { params: nothing },
  'events.subscribe': { params: parseEventList },
  'events.unsubscribe': { params: parseEventList },
  'canvas.getViewport': { params: nothing },
  'canvas.setDevice': { params: (input: unknown) => ({ device: oneOf(record(input)['device'], APP_DEVICES, 'device') }) },
  'canvas.setWidth': { params: (input: unknown) => ({ widthPx: integerIn(record(input)['widthPx'], 240, 6000, 'widthPx') }) },
  'canvas.scrollTo': { params: parseScrollTarget },
  'canvas.snapshot': {
    params: (input: unknown) => {
      const value = record(input);
      const widthMax = value['widthMax'];
      return {
        target: parseNodeTarget(value),
        widthMax: widthMax === undefined ? APP_RPC_LIMITS.snapshotWidthPxDefault : integerIn(widthMax, 16, APP_RPC_LIMITS.snapshotWidthPxMax, 'widthMax'),
      };
    },
  },
  'canvas.capture': {
    params: (input: unknown) => {
      const value = record(input);
      return {
        on: requiredFlag(value['on'], 'on'),
        cursor: parseCursorRequest(value['cursor']),
        mode: value['mode'] === undefined ? 'capture' : oneOf(value['mode'], APP_CAPTURE_MODES, 'mode'),
        reason: value['reason'] === undefined ? undefined : captureReason(value['reason']),
      };
    },
  },
  'canvas.startInsertDrag': { params: parseInsertDragStart },
  'canvas.insertDrag': { params: parseInsertDragStep },
  'canvas.highlight': { params: parseHighlight },
  'canvas.setOutlineMode': { params: (input: unknown) => ({ mode: oneOf(record(input)['mode'], APP_OUTLINE_MODES, 'mode') }) },
  'panels.open': { params: (input: unknown) => ({ panel: oneOf(record(input)['panel'], APP_LEFT_PANELS, 'panel') }) },
  'panels.close': { params: nothing },
  'panels.openRight': { params: (input: unknown) => ({ panel: oneOf(record(input)['panel'], APP_RIGHT_PANELS, 'panel') }) },
  'panels.get': { params: nothing },
  'selection.get': { params: nothing },
  'selection.set': { params: (input: unknown) => ({ nodeId: optionalNodeId(record(input)['nodeId']) }) },
  'page.get': { params: nothing },
  'page.open': { params: (input: unknown) => ({ path: parseProjectFilePath(record(input)['path']) }) },
  'component.open': { params: (input: unknown) => ({ path: parseComponentPath(record(input)['path']) }) },
  'page.list': { params: nothing },
  'page.getTree': { params: (input: unknown) => ({ path: parseProjectFilePath(record(input)['path']) }) },
  'page.findByAttribute': { params: parseFindByAttribute },
  'node.get': { params: (input: unknown) => ({ nodeId: parseNodeId(record(input)['nodeId']) }) },
  'node.measure': { params: (input: unknown) => parseNodeTarget(record(input)) },
  'node.key': { params: (input: unknown) => ({ nodeId: parseNodeId(record(input)['nodeId']) }) },
  'node.find': { params: parseNodeFind },
  'node.setAttribute': {
    params: (input: unknown) => {
      const value = record(input);
      return {
        nodeId: parseNodeId(value['nodeId']),
        name: parseAttributeName(value['name']),
        value: boundedValue(value['value'], 'value'),
        label: optionalUndoLabel(value['label']),
      };
    },
  },
  'node.removeAttribute': {
    params: (input: unknown) => {
      const value = record(input);
      return { nodeId: parseNodeId(value['nodeId']), name: parseAttributeName(value['name']), label: optionalUndoLabel(value['label']) };
    },
  },
  'node.addClass': { params: parseClassEdit },
  'node.removeClass': { params: parseClassEdit },
  'node.setStyle': {
    params: (input: unknown) => {
      const value = record(input);
      return { nodeId: parseNodeId(value['nodeId']), css: boundedValue(value['css'], 'css'), label: optionalUndoLabel(value['label']) };
    },
  },
  'node.insert': {
    params: (input: unknown) => ({ item: parseInsert(input), place: parseInsertPlace(input), label: optionalUndoLabel(record(input)['label']) }),
  },
  'node.remove': { params: parseNodeStep },
  'node.duplicate': { params: parseNodeStep },
  'history.undo': { params: nothing },
  'history.redo': { params: nothing },
  'shortcuts.run': { params: (input: unknown) => ({ shortcut: oneOf(record(input)['shortcut'], APP_SHORTCUTS, 'shortcut') }) },
  'shortcuts.focus': { params: (input: unknown) => ({ editable: requiredFlag(record(input)['editable'], 'editable') }) },
  'shortcuts.claim': { params: (input: unknown) => ({ shortcuts: parseShortcutClaims(record(input)['shortcuts']) }) },
  'commands.register': { params: (input: unknown) => ({ commands: parseAppCommands(record(input)['commands']) }) },
  'commands.trigger': { params: (input: unknown) => ({ shortcut: parseCommandShortcut(record(input)['shortcut']) }) },
  'overrides.register': { params: (input: unknown) => ({ point: oneOf(record(input)['point'], APP_OVERRIDE_POINTS, 'point') }) },
  'overrides.unregister': { params: (input: unknown) => ({ point: oneOf(record(input)['point'], APP_OVERRIDE_POINTS, 'point') }) },
  'overrides.resolve': { params: parseOverrideResolve },
  'overlay.set': { params: (input: unknown) => ({ items: parseOverlayItems(record(input)['items']) }) },
  'overlay.clear': { params: nothing },
  'overlay.post': { params: parseOverlayPost },
  'app.openSettings': { params: nothing },
  'people.list': { params: nothing },
  'clipboard.write': {
    params: (input: unknown) => ({ text: boundedValueMax(record(input)['text'], APP_RPC_LIMITS.clipboardCharsMax, 'text') }),
  },
  'ui.notify': {
    params: (input: unknown) => {
      const value = record(input);
      return {
        message: boundedLabel(value['message'], APP_RPC_LIMITS.notifyCharsMax, 'message'),
        kind: value['kind'] === undefined ? 'info' : oneOf(value['kind'], ['info', 'success', 'error'] as const, 'kind'),
      };
    },
  },
  'ui.openFrame': { params: parseOpenFrame },
  'ui.theme': { params: nothing },
  'ui.closeFrame': {
    params: (input: unknown) => {
      const value = input === undefined ? {} : record(input);
      return {
        frameId: value['frameId'] === undefined ? undefined : parseFrameId(value['frameId']),
        result: value['result'] === undefined ? undefined : boundedValue(value['result'], 'result'),
      };
    },
  },
  'person.get': { params: nothing },
  'app.badge': { params: (input: unknown) => ({ count: integerIn(record(input)['count'], 0, APP_RPC_LIMITS.badgeCountMax, 'count') }) },
  'storage.get': { params: (input: unknown) => parseStorageKeyParams(input) },
  'storage.set': {
    params: (input: unknown) => {
      const value = record(input);
      return { ...parseStorageKeyParams(value), value: parseAppStorageValue(value['value']) };
    },
  },
  'storage.remove': { params: (input: unknown) => parseStorageKeyParams(input) },
  'storage.keys': { params: (input: unknown) => ({ scope: parseAppStorageScope(input === undefined ? undefined : record(input)['scope']) }) },
  'files.list': { params: (input: unknown) => ({ dir: parseFilePathShape(input === undefined ? '' : (record(input)['dir'] ?? ''), { allowRoot: true }) }) },
  'files.read': { params: (input: unknown) => ({ path: parseFilePathShape(record(input)['path'], { allowRoot: false }) }) },
  'files.write': {
    params: (input: unknown) => {
      const value = record(input);
      return {
        path: parseFilePathShape(value['path'], { allowRoot: false }),
        ...parseAppFileContent(value['content'], value['encoding']),
        label: optionalUndoLabel(value['label']),
      };
    },
  },
  'files.delete': { params: parseFileStep },
  'files.move': {
    params: (input: unknown) => {
      const value = record(input);
      return {
        from: parseFilePathShape(value['from'], { allowRoot: false }),
        to: parseFilePathShape(value['to'], { allowRoot: false }),
        label: optionalUndoLabel(value['label']),
      };
    },
  },
  'files.mkdir': { params: parseFileStep },
  'auth.connect': { params: parseProviderParams },
  'auth.token': { params: parseProviderParams },
  'auth.disconnect': { params: parseProviderParams },
  'auth.status': { params: nothing },
  'net.fetch': { params: parseAppNetRequest },
} as const satisfies Readonly<Record<string, { readonly params: ParamsParser<unknown> }>>;

export type AppMethod = keyof typeof APP_METHODS;
export type AppMethodParams = { readonly [M in AppMethod]: ReturnType<(typeof APP_METHODS)[M]['params']> };
export const APP_METHOD_NAMES: readonly AppMethod[] = methodNames();

export const APP_EVENT_LIST = [
  'selection.change',
  'hover.change',
  'canvas.change',
  'panels.change',
  'page.change',
  'project.change',
  'overlay.click',
  'role.change',
  'shortcut.press',
  'command.run',
  'override.request',
  'override.cancel',
  'frame.close',
  'storage.change',
  'person.change',
  'canvas.click',
  'canvas.capture',
  'auth.change',
  'theme.change',
  'overlay.drag',
  'overlay.message',
  'overlay.hover',
  'settings.change',
  'canvas.outline',
] as const;
export type AppEventName = (typeof APP_EVENT_LIST)[number];
export const APP_EVENT_NAMES: readonly AppEventName[] = APP_EVENT_LIST;

export interface AppEventData {
  readonly 'selection.change': AppSelection;
  readonly 'hover.change': AppSelection;
  readonly 'canvas.change': AppViewport;
  readonly 'panels.change': { readonly left: AppLeftPanel | undefined; readonly right: AppRightPanel };
  readonly 'page.change': { readonly path: string | undefined };
  readonly 'project.change': { readonly source: AppChangeSource; readonly paths?: readonly string[]; readonly origin: AppChangeOrigin };
  readonly 'overlay.click': { readonly itemId: string; readonly nodeId: string | undefined };
  readonly 'role.change': AppRoleView;
  readonly 'shortcut.press': { readonly shortcut: string };
  readonly 'command.run': { readonly id: string; readonly panel: string | undefined; readonly shortcut: AppReservedShortcut | undefined };
  readonly 'override.request': { readonly call: number } & AppOverrideRequest;
  readonly 'override.cancel': { readonly call: number };
  readonly 'frame.close': { readonly frameId: string; readonly result: string | undefined };
  readonly 'storage.change': { readonly key: string | undefined; readonly scope: AppStorageScope; readonly origin: AppChangeOrigin };
  readonly 'person.change': AppPerson;
  readonly 'canvas.click': AppCanvasClick;
  readonly 'canvas.outline': { readonly mode: AppOutlineMode; readonly reason: AppOutlineReason };
  readonly 'canvas.capture': { readonly on: boolean; readonly reason: AppCaptureReason };
  readonly 'overlay.message': { readonly itemId: string; readonly data: string; readonly from: AppOverlayMessageSender };
  readonly 'overlay.hover': { readonly itemId: string | undefined };
  readonly 'settings.change': { readonly ids: readonly string[] };
  readonly 'overlay.drag': AppOverlayDrag;
  readonly 'auth.change': AppAuthStatus;
  readonly 'theme.change': AppThemeView;
}

function methodNames(): readonly AppMethod[] {
  const names: AppMethod[] = [];
  for (const name of Object.keys(APP_METHODS)) {
    const known = isAppMethod(name);
    assert(known, 'Every key of APP_METHODS is a method');
    names.push(name);
  }
  return names;
}

export function isAppMethod(name: string): name is AppMethod {
  return Object.hasOwn(APP_METHODS, name);
}

export function isAppEvent(name: string): name is AppEventName {
  return APP_EVENT_LIST.some((event) => event === name);
}


export interface AppRequest {
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
}

export type AppErrorCode = 'bad-request' | 'unsupported-version' | 'unknown-method' | 'role-denied' | 'bad-params' | 'busy' | 'failed';

export type AppHostMessage =
  | { readonly stacki: 'host'; readonly v: 1; readonly id: number; readonly ok: true; readonly value: unknown }
  | {
      readonly stacki: 'host';
      readonly v: 1;
      readonly id: number;
      readonly ok: false;
      readonly error: { readonly code: AppErrorCode; readonly message: string };
    }
  | { readonly stacki: 'host'; readonly v: 1; readonly event: AppEventName; readonly data: unknown };

export function parseAppRequest(input: unknown): AppRequest | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const value = record(input);
  if (value['stacki'] !== 'app') {
    return undefined;
  }
  const id = value['id'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('A request id is a positive safe integer');
  }
  if (value['v'] !== APP_API_VERSION) {
    throw new UnsupportedVersionError(id);
  }
  const method = text(value['method']);
  if (method.length === 0 || method.length > APP_RPC_LIMITS.methodCharsMax) {
    throw new Error('A method name is 1 to 64 characters');
  }
  return { id, method, params: value['params'] };
}

export class UnsupportedVersionError extends Error {
  public readonly requestId: number;

  public constructor(requestId: number) {
    super(`This Stacki speaks app API version ${APP_API_VERSION}`);
    this.requestId = requestId;
  }
}

export function requestIdOf(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const id = record(input)['id'];
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function okMessage(id: number, value: unknown): AppHostMessage {
  assert(id > 0, 'A response answers a request id');
  return { stacki: 'host', v: 1, id, ok: true, value };
}

export function errorMessage(id: number, code: AppErrorCode, message: string): AppHostMessage {
  assert(id > 0, 'A response answers a request id');
  assert(message.length > 0, 'An error says why');
  return { stacki: 'host', v: 1, id, ok: false, error: { code, message: message.slice(0, 500) } };
}

export function eventMessage<E extends AppEventName>(event: E, data: AppEventData[E]): AppHostMessage {
  assert(isAppEvent(event), 'An event message names a known event');
  return { stacki: 'host', v: 1, event, data };
}


function oneOf<const T extends string>(input: unknown, options: readonly T[], what: string): T {
  const found = options.find((option) => option === input);
  if (found === undefined) {
    throw new Error(`${what} must be one of ${options.join(', ')}`);
  }
  return found;
}

function integerIn(input: unknown, minimum: number, maximum: number, what: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new Error(`${what} must be a number`);
  }
  const rounded = Math.round(input);
  if (rounded < minimum || rounded > maximum) {
    throw new Error(`${what} must be ${minimum} to ${maximum}`);
  }
  return rounded;
}

function coordinate(input: unknown, what: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new Error(`${what} must be a finite number`);
  }
  if (Math.abs(input) > APP_RPC_LIMITS.coordinatePxMax) {
    throw new Error(`${what} is out of range`);
  }
  return input;
}

export function parseNodeId(input: unknown): string {
  const id = text(input);
  if (id.length === 0 || id.length > 200 || /\s/.test(id)) {
    throw new Error('nodeId must be a node id the host gave out');
  }
  return id;
}

function optionalNodeId(input: unknown): string | undefined {
  return input === undefined || input === null ? undefined : parseNodeId(input);
}

function boundedLabel(input: unknown, charsMax: number, what: string): string {
  const value = text(input);
  if (value.length === 0 || value.length > charsMax) {
    throw new Error(`${what} is 1 to ${charsMax} characters`);
  }
  return value;
}

function boundedValue(input: unknown, what: string): string {
  const value = text(input);
  if (value.length > APP_RPC_LIMITS.valueCharsMax) {
    throw new Error(`${what} exceeds ${APP_RPC_LIMITS.valueCharsMax} characters`);
  }
  return value;
}

function parseAttributeNameShape(input: unknown): string {
  const name = boundedLabel(input, APP_RPC_LIMITS.nameCharsMax, 'name');
  if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]*$/.test(name)) {
    throw new Error(`"${name.slice(0, 40)}" is not an attribute name`);
  }
  if (/^on/i.test(name)) {
    throw new Error('Event handler attributes cannot be written by apps');
  }
  if (name.includes(':')) {
    throw new Error('Directives cannot be written by apps');
  }
  return name;
}

function parseAttributeName(input: unknown): string {
  const name = parseAttributeNameShape(input);
  if (name === 'class' || name === 'style') {
    throw new Error(`Use node.${name === 'class' ? 'addClass' : 'setStyle'} for ${name}`);
  }
  return name;
}

function parseClassEdit(input: unknown): { readonly nodeId: string; readonly className: string; readonly label: string | undefined } {
  const value = record(input);
  const className = boundedLabel(value['className'], APP_RPC_LIMITS.nameCharsMax, 'className');
  if (!/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(className)) {
    throw new Error(`"${className.slice(0, 40)}" is not a class name`);
  }
  return { nodeId: parseNodeId(value['nodeId']), className, label: optionalUndoLabel(value['label']) };
}

function parseNodeStep(input: unknown): { readonly nodeId: string; readonly label: string | undefined } {
  const value = record(input);
  return { nodeId: parseNodeId(value['nodeId']), label: optionalUndoLabel(value['label']) };
}

export function optionalUndoLabel(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const label = boundedLabel(input, APP_RPC_LIMITS.undoLabelCharsMax, 'label').trim();
  if (label.length === 0) {
    throw new Error('label has words in it');
  }
  if (/[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error('label is one line of text');
  }
  return label;
}

function parseFileStep(input: unknown): { readonly path: string; readonly label: string | undefined } {
  const value = record(input);
  return { path: parseFilePathShape(value['path'], { allowRoot: false }), label: optionalUndoLabel(value['label']) };
}

function parseProviderParams(input: unknown): { readonly provider: string } {
  return { provider: parseAuthProviderId(record(input)['provider']) };
}

function parseStorageKeyParams(input: unknown): { readonly key: string; readonly scope: AppStorageScope } {
  const value = record(input);
  return { key: parseAppStorageKey(value['key']), scope: parseAppStorageScope(value['scope']) };
}

export type AppInsertAttributes = Readonly<Record<string, string>>;

export type AppInsert =
  | { readonly kind: 'element'; readonly tag: string; readonly attributes: AppInsertAttributes }
  | { readonly kind: 'component'; readonly name: string; readonly props: AppInsertAttributes };

export const APP_INSERT_POSITIONS = ['before', 'after', 'inside'] as const;
export type AppInsertPosition = (typeof APP_INSERT_POSITIONS)[number];

export type AppInsertPlace =
  | { readonly kind: 'selection' }
  | { readonly kind: 'before' | 'after'; readonly anchor: string }
  | { readonly kind: 'inside'; readonly anchor: string; readonly index: number | undefined }
  | { readonly kind: 'replace'; readonly nodeId: string };

const INSERT_CODE_TAGS: readonly string[] = ['script', 'style'];

function parseInsert(input: unknown): AppInsert {
  const value = record(input);
  if (value['kind'] === 'element') {
    const tag = boundedLabel(value['tag'], 40, 'tag');
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      throw new Error(`"${tag}" is not an element an app may insert`);
    }
    if (INSERT_CODE_TAGS.includes(tag)) {
      throw new Error(`Apps cannot insert <${tag}> elements: they are code. Write code with files.write, which needs the code:edit role feature`);
    }
    if (value['props'] !== undefined) {
      throw new Error('An element takes attributes, not props');
    }
    const attributes = parseInsertAttributes(value['attributes'], 'attributes', { kind: 'element' });
    assert(Object.keys(attributes).length <= APP_RPC_LIMITS.insertAttributesMax, 'An element starts with a bounded set of attributes');
    return { kind: 'element', tag, attributes };
  }
  if (value['kind'] === 'component') {
    const name = boundedLabel(value['name'], 120, 'name');
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new Error(`"${name.slice(0, 40)}" is not a component name`);
    }
    if (value['attributes'] !== undefined) {
      throw new Error('A component takes props, not attributes');
    }
    const props = parseInsertAttributes(value['props'], 'props', { kind: 'component' });
    assert(Object.keys(props).length <= APP_RPC_LIMITS.insertAttributesMax, 'A component starts with a bounded set of props');
    return { kind: 'component', name, props };
  }
  throw new Error('kind must be "element" or "component"');
}

function parseInsertAttributes(input: unknown, what: string, owner: { readonly kind: 'element' | 'component' }): AppInsertAttributes {
  if (input === undefined) {
    return {};
  }
  const value = record(input);
  const names = Object.keys(value);
  if (names.length > APP_RPC_LIMITS.insertAttributesMax) {
    throw new Error(`${what} has at most ${APP_RPC_LIMITS.insertAttributesMax} entries`);
  }
  const parsed: Record<string, string> = {};
  const seen = new Set<string>();
  for (const name of names) {
    const checked = parseAttributeNameShape(name);
    const key = owner.kind === 'element' ? checked.toLowerCase() : checked;
    if (seen.has(key)) {
      throw new Error(`${what} names "${checked.slice(0, 40)}" twice`);
    }
    seen.add(key);
    const attributeValue = boundedValue(value[name], `${what}.${checked.slice(0, 40)}`);
    if (checked === 'class' && !classNamesOnly(attributeValue)) {
      throw new Error('class is class names separated by spaces');
    }
    parsed[checked] = attributeValue;
  }
  assert(Object.keys(parsed).length === names.length, 'Every attribute is kept once');
  return parsed;
}

function classNamesOnly(value: string): boolean {
  const words = value.split(/\s+/).filter((word) => word.length > 0);
  assert(words.length <= APP_RPC_LIMITS.valueCharsMax, 'A bounded value has bounded words');
  return words.every((word) => /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(word));
}

function parseInsertPlace(input: unknown): AppInsertPlace {
  const value = record(input);
  const position = value['position'];
  const anchor = value['anchor'];
  const index = value['index'];
  if (value['replace'] !== undefined) {
    if (position !== undefined || anchor !== undefined || index !== undefined) {
      throw new Error('replace puts the new node in that node’s place: leave out position, anchor and index');
    }
    return { kind: 'replace', nodeId: parseNodeId(value['replace']) };
  }
  if (position === undefined) {
    if (anchor !== undefined || index !== undefined) {
      throw new Error('anchor and index need a position: "before", "after" or "inside"');
    }
    return { kind: 'selection' };
  }
  const kind = oneOf(position, APP_INSERT_POSITIONS, 'position');
  if (anchor === undefined) {
    throw new Error('position needs an anchor: the node id to place the new node by');
  }
  const anchorId = parseNodeId(anchor);
  if (kind === 'inside') {
    return { kind, anchor: anchorId, index: parseInsertIndex(index) };
  }
  if (index !== undefined) {
    throw new Error('index goes with position "inside" only');
  }
  return { kind, anchor: anchorId };
}

function parseInsertIndex(input: unknown): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    throw new Error('index must be a whole number');
  }
  if (input < 0) {
    throw new Error('index must be at least 0');
  }
  if (input < APP_RPC_LIMITS.treeNodesMax) {
    return input;
  }
  throw new Error(`index must be below ${APP_RPC_LIMITS.treeNodesMax}`);
}

export const APP_SCROLL_BLOCKS = ['center', 'start'] as const;
export type AppScrollBlock = (typeof APP_SCROLL_BLOCKS)[number];

export type AppScrollTarget =
  | { readonly nodeId: string; readonly occurrence: number | undefined; readonly block: AppScrollBlock }
  | { readonly ref: AppNodeRef; readonly block: AppScrollBlock }
  | { readonly x: number; readonly y: number; readonly block: AppScrollBlock };

function parseScrollTarget(input: unknown): AppScrollTarget {
  const value = record(input);
  const block = value['block'] === undefined ? 'center' : oneOf(value['block'], APP_SCROLL_BLOCKS, 'block');
  if (value['ref'] !== undefined) {
    if (value['nodeId'] !== undefined) {
      throw new Error('Name the element by nodeId or by ref, not both');
    }
    return { ref: parseNodeRef(value['ref']), block };
  }
  if (value['nodeId'] !== undefined) {
    return { nodeId: parseNodeId(value['nodeId']), occurrence: parseOccurrence(value['occurrence']), block };
  }
  const x = coordinate(value['x'], 'x');
  const y = coordinate(value['y'], 'y');
  if (x < 0 || y < 0) {
    throw new Error('A page point is at or below and right of its top left: x and y are at least 0');
  }
  return { x, y, block };
}

function parseComponentPath(input: unknown): string {
  const path = parseProjectFilePath(input);
  if (!path.endsWith('.astro')) {
    throw new Error('path names a component: an .astro file');
  }
  return path;
}

export interface AppInsertDragStart {
  readonly item: AppInsert;
  readonly label: string | undefined;
  readonly preview: string | undefined;
}

export const APP_INSERT_DRAG_PHASES = ['move', 'drop', 'cancel'] as const;
export type AppInsertDragPhase = (typeof APP_INSERT_DRAG_PHASES)[number];
export interface AppInsertDragStep {
  readonly phase: AppInsertDragPhase;
  readonly x: number;
  readonly y: number;
}

function parseInsertDragStart(input: unknown): AppInsertDragStart {
  const value = record(input);
  if (value['position'] !== undefined || value['anchor'] !== undefined || value['replace'] !== undefined) {
    throw new Error('A drag to insert is placed by the drop: leave out position, anchor and replace');
  }
  const preview = value['preview'] === undefined ? undefined : boundedLabel(value['preview'], APP_RPC_LIMITS.labelCharsMax, 'preview');
  return { item: parseInsert(value), label: optionalUndoLabel(value['label']), preview };
}

function parseInsertDragStep(input: unknown): AppInsertDragStep {
  const value = record(input);
  const phase = oneOf(value['phase'], APP_INSERT_DRAG_PHASES, 'phase');
  if (phase === 'cancel') {
    return { phase, x: 0, y: 0 };
  }
  return { phase, x: coordinate(value['x'], 'x'), y: coordinate(value['y'], 'y') };
}

export type AppNodeFind = { readonly key: string } | { readonly ref: AppNodeRef };

function parseNodeFind(input: unknown): AppNodeFind {
  const value = record(input);
  if (value['ref'] !== undefined) {
    if (value['key'] !== undefined) {
      throw new Error('Find by key or by ref, not both');
    }
    return { ref: parseNodeRef(value['ref']) };
  }
  return { key: parseNodeKey(value['key']) };
}

function parseHighlight(input: unknown): { readonly target: AppNodeTarget | undefined; readonly style: CanvasHighlightStyle } {
  if (input === undefined || input === null) {
    return { target: undefined, style: 'selected' };
  }
  const { style, ...value } = record(input);
  const shown = style === undefined ? 'selected' : oneOf(style, CANVAS_HIGHLIGHT_STYLES, 'style');
  return { target: Object.keys(value).length === 0 ? undefined : parseNodeTarget(value), style: shown };
}

function parseNodeTarget(value: Readonly<Record<string, unknown>>): AppNodeTarget {
  if (value['ref'] !== undefined) {
    if (value['nodeId'] !== undefined || value['occurrence'] !== undefined) {
      throw new Error('A ref names one copy already: leave out nodeId and occurrence');
    }
    return { ref: parseNodeRef(value['ref']) };
  }
  return { nodeId: parseNodeId(value['nodeId']), occurrence: parseOccurrence(value['occurrence']) };
}

export function parseNodeRef(input: unknown): AppNodeRef {
  const value = record(input);
  const steps = toArray(value['steps']);
  if (steps === undefined) {
    throw new Error('ref.steps must be a list');
  }
  if (steps.length === 0) {
    throw new Error('A ref has at least one step');
  }
  if (steps.length > APP_RPC_LIMITS.nodeLayersMax) {
    throw new Error(`A ref has at most ${APP_RPC_LIMITS.nodeLayersMax} steps`);
  }
  const parsed = steps.map((step, index) => parseNodeRefStep(step, `ref.steps[${index}]`));
  assert(parsed.length > 0, 'A parsed ref has a step');
  assert(parsed.length <= APP_RPC_LIMITS.nodeLayersMax, 'A parsed ref is within the layer bound');
  return { steps: parsed };
}

function parseNodeRefStep(input: unknown, what: string): AppNodeRefStep {
  const value = record(input);
  const file = parseProjectFilePath(value['file']);
  if (file.includes('|')) {
    throw new Error(`${what}.file names a project file: no |`);
  }
  const key = absent(value['key']) ? undefined : parseNodeKey(value['key']);
  const nodeId = absent(value['nodeId']) ? undefined : parseNodeId(value['nodeId']);
  if (key === undefined && nodeId === undefined) {
    throw new Error(`${what} names its element: nodeId, key or both`);
  }
  const copy = absent(value['copy']) ? 0 : integerIn(value['copy'], 0, APP_RPC_LIMITS.nodeCopyMax, `${what}.copy`);
  return { file, nodeId, key, copy };
}

function absent(input: unknown): boolean {
  return input === undefined || input === null;
}

export function nodeRefKey(ref: AppNodeRef): string {
  assert(ref.steps.length > 0, 'A ref has a step to key');
  assert(ref.steps.length <= APP_RPC_LIMITS.nodeLayersMax, 'A keyed ref is within the layer bound');
  return JSON.stringify(ref.steps.map((step) => [step.file, step.key ?? '', step.nodeId ?? '', step.copy]));
}

export function parseNodeKey(input: unknown): string {
  const key = text(input);
  if (!/^k[0-9a-z]{6,31}$/.test(key)) {
    throw new Error('key must be a key node.key gave out');
  }
  assert(key.length <= APP_RPC_LIMITS.nodeKeyCharsMax, 'A node key is within its bound');
  return key;
}

export function parseProjectFilePath(input: unknown): string {
  const path = boundedLabel(input, APP_RPC_LIMITS.pathCharsMax, 'path');
  if (!/\.(?:astro|md|mdx)$/.test(path)) {
    throw new Error('path names a page or component: an .astro, .md or .mdx file');
  }
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error('path is relative to the project and uses /');
  }
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('path names a file without ., .. or empty segments');
  }
  return path;
}

function parseFindByAttribute(input: unknown): { readonly name: string; readonly limit: number } {
  const value = record(input);
  const name = boundedLabel(value['name'], APP_RPC_LIMITS.nameCharsMax, 'name');
  if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]*$/.test(name)) {
    throw new Error(`"${name.slice(0, 40)}" is not an attribute name`);
  }
  const { attributeMatchesMax } = APP_RPC_LIMITS;
  return { name, limit: value['limit'] === undefined ? attributeMatchesMax : integerIn(value['limit'], 1, attributeMatchesMax, 'limit') };
}

function parseEventList(input: unknown): { readonly events: readonly AppEventName[] } {
  const items = toArray(record(input)['events']);
  if (items === undefined) {
    throw new Error('events must be a list');
  }
  if (items.length === 0 || items.length > APP_RPC_LIMITS.subscriptionsMax) {
    throw new Error(`events names 1 to ${APP_RPC_LIMITS.subscriptionsMax} events`);
  }
  const events = items.map((item) => {
    const name = text(item);
    if (!isAppEvent(name)) {
      throw new Error(`Unknown event "${name.slice(0, 40)}"`);
    }
    return name;
  });
  return { events: [...new Set(events)] };
}


function parseCall(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) {
    throw new Error('call is the positive id Stacki sent with the request');
  }
  return input;
}

function parseAssetURL(input: unknown): string {
  const value = boundedLabel(input, APP_RPC_LIMITS.assetURLCharsMax, 'url');
  if (value.startsWith('https://')) {
    if (!URL.canParse(value)) {
      throw new Error('url is not a URL');
    }
    return value;
  }
  if (!/^(?:public|src)\/[^\\\0?#]+$/.test(value)) {
    throw new Error('url is an https:// URL or a project path in public/ or src/');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('A project path names a file without ., .. or empty segments');
  }
  return value;
}

const BINDING_PATH = /^(?:(?:astro|sanity):)?[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$]*|\[\d{1,6}\]|\["[^"\\\]\n]{1,200}"\])*$/;

function parseBindingPath(input: unknown): string {
  const path = boundedLabel(input, APP_RPC_LIMITS.bindingPathCharsMax, 'path');
  if (!BINDING_PATH.test(path)) {
    throw new Error(`"${path.slice(0, 40)}" is not a data path`);
  }
  return path;
}

function parseFallback(kind: unknown): AppOverrideFallback | undefined {
  if (kind === 'default') {
    return { kind: 'default' };
  }
  if (kind === 'cancel') {
    return { kind: 'cancel' };
  }
  return undefined;
}

export function parseOverrideAnswer(point: AppOverridePoint, input: unknown): AppOverrideAnswer {
  const value = record(input);
  const fallback = parseFallback(value['kind']);
  if (fallback !== undefined) {
    return fallbackAnswer(point, fallback);
  }
  if (value['kind'] !== 'picked') {
    throw new Error('result.kind must be picked, default or cancel');
  }
  switch (point) {
    case 'assets.pick':
      return {
        point,
        result: {
          kind: 'picked',
          url: parseAssetURL(value['url']),
          alt: value['alt'] === undefined ? undefined : boundedValueMax(value['alt'], APP_RPC_LIMITS.altCharsMax, 'alt'),
        },
      };
    case 'cms.bind':
      return { point, result: { kind: 'picked', path: parseBindingPath(value['path']) } };
    default: {
      const exhaustive: never = point;
      return exhaustive;
    }
  }
}

function parseOverrideResolve(input: unknown): { readonly call: number; readonly answer: AppOverrideAnswer } {
  const value = record(input);
  const point = oneOf(value['point'], APP_OVERRIDE_POINTS, 'point');
  return { call: parseCall(value['call']), answer: parseOverrideAnswer(point, value['result']) };
}

export function parseFrameId(input: unknown): string {
  const id = text(input);
  if (!/^frame-[1-9]\d{0,8}$/.test(id)) {
    throw new Error('frameId is an id ui.openFrame gave out');
  }
  return id;
}

function parseOpenFrame(input: unknown): AppOpenFrame {
  const value = record(input);
  const { frameWidthPxMin, frameWidthPxMax, frameHeightPxMin, frameHeightPxMax } = APP_RPC_LIMITS;
  return {
    page: parseBundlePage(value['page'], 'A custom frame'),
    width: integerIn(value['width'], frameWidthPxMin, frameWidthPxMax, 'width'),
    height: integerIn(value['height'], frameHeightPxMin, frameHeightPxMax, 'height'),
    modal: flag(value['modal'], 'modal'),
    data: value['data'] === undefined ? undefined : boundedValue(value['data'], 'data'),
  };
}

function boundedValueMax(input: unknown, charsMax: number, what: string): string {
  const value = text(input);
  if (value.length > charsMax) {
    throw new Error(`${what} exceeds ${charsMax} characters`);
  }
  return value;
}


export function parseOverlayPost(input: unknown): AppOverlayPost {
  const value = record(input);
  const target = value['itemId'];
  const post: AppOverlayPost = {
    itemId: target === undefined ? undefined : itemId(target),
    data: boundedValueMax(value['data'], APP_RPC_LIMITS.overlayMessageCharsMax, 'data'),
  };
  assert(post.data.length <= APP_RPC_LIMITS.overlayMessageCharsMax, 'An overlay message is bounded');
  return post;
}

export function parseOverlayColor(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const color = text(input);
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
    throw new Error('Overlay colours are hex: #rgb, #rgba, #rrggbb or #rrggbbaa');
  }
  return color;
}

function parseAnchor(input: unknown): AppOverlayAnchor {
  const value = record(input);
  if (value['ref'] !== undefined) {
    if (value['nodeId'] !== undefined || value['occurrence'] !== undefined) {
      throw new Error('An anchor names its element by nodeId or by ref, not both');
    }
    const at = value['at'] === undefined ? undefined : parsePoint(value['at'], 'anchor.at');
    return { ref: parseNodeRef(value['ref']), at };
  }
  if (value['nodeId'] !== undefined) {
    const at = value['at'] === undefined ? undefined : parsePoint(value['at'], 'anchor.at');
    return { nodeId: parseNodeId(value['nodeId']), occurrence: parseOccurrence(value['occurrence']), at };
  }
  const rect = record(value['rect']);
  const width = coordinate(rect['width'], 'rect.width');
  const height = coordinate(rect['height'], 'rect.height');
  if (width < 0 || height < 0) {
    throw new Error('An overlay rectangle has a nonnegative size');
  }
  return { rect: { x: coordinate(rect['x'], 'rect.x'), y: coordinate(rect['y'], 'rect.y'), width, height } };
}

function parseOccurrence(input: unknown): number | undefined {
  return input === undefined ? undefined : integerIn(input, 0, APP_RPC_LIMITS.measureRectsMax - 1, 'occurrence');
}

export function parsePoint(input: unknown, what: string): AppPoint {
  const value = record(input);
  return { x: unitInterval(value['x'], `${what}.x`), y: unitInterval(value['y'], `${what}.y`) };
}

function unitInterval(input: unknown, what: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new Error(`${what} must be a number`);
  }
  if (input < 0 || input > 1) {
    throw new Error(`${what} runs 0 to 1 within the element's box`);
  }
  return input;
}

function itemId(input: unknown): string {
  const id = boundedLabel(input, 64, 'id');
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) {
    throw new Error('Overlay item ids are letters, digits and _.:-');
  }
  return id;
}

function flag(input: unknown, what: string): boolean {
  if (input === undefined) {
    return false;
  }
  if (typeof input !== 'boolean') {
    throw new Error(`${what} must be true or false`);
  }
  return input;
}

function requiredFlag(input: unknown, what: string): boolean {
  if (typeof input !== 'boolean') {
    throw new Error(`${what} must be true or false`);
  }
  return input;
}

function parseCursorRequest(input: unknown): AppCanvasCursorRequest {
  if (input === undefined) {
    return 'crosshair';
  }
  if (typeof input === 'string') {
    return oneOf(input, APP_CANVAS_CURSORS, 'cursor');
  }
  const value = record(input);
  const image = text(value['image']);
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*\.(?:png|svg)$/.test(image) || image.includes('..') || image.length > 200) {
    throw new Error('cursor.image names a PNG or SVG file in the app’s own bundle');
  }
  const pixelMax = APP_RPC_LIMITS.cursorImagePxMax - 1;
  const hotspotInput = value['hotspot'];
  if (hotspotInput === undefined) {
    return { image, hotspot: { x: 0, y: 0 } };
  }
  const hotspot = record(hotspotInput);
  return { image, hotspot: { x: integerIn(hotspot['x'], 0, pixelMax, 'cursor.hotspot.x'), y: integerIn(hotspot['y'], 0, pixelMax, 'cursor.hotspot.y') } };
}

function parseBundlePage(input: unknown, what: string): string {
  const path = text(input);
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*\.html$/.test(path) || path.includes('..') || path.length > 200) {
    throw new Error(`${what} opens one of the app’s own HTML files`);
  }
  return path;
}

export function parseOverlayItem(input: unknown): AppOverlayItem {
  const value = record(input);
  const id = itemId(value['id']);
  const anchor = parseAnchor(value['anchor']);
  if ('at' in anchor && anchor.at !== undefined && value['kind'] !== 'label' && value['kind'] !== 'pin') {
    throw new Error('Only a label or a pin anchors to a point (anchor.at)');
  }
  if (value['draggable'] !== undefined && value['kind'] !== 'box' && value['kind'] !== 'label' && value['kind'] !== 'pin') {
    throw new Error('Only a box, a label or a pin is draggable');
  }
  switch (value['kind']) {
    case 'box':
      return {
        kind: 'box',
        id,
        anchor,
        color: parseOverlayColor(value['color']),
        fill: parseOverlayColor(value['fill']),
        label: value['label'] === undefined ? undefined : boundedLabel(value['label'], APP_RPC_LIMITS.labelCharsMax, 'label'),
        dashed: flag(value['dashed'], 'dashed'),
        interactive: flag(value['interactive'], 'interactive'),
        draggable: flag(value['draggable'], 'draggable'),
      };
    case 'label':
      return {
        kind: 'label',
        id,
        anchor,
        text: boundedLabel(value['text'], APP_RPC_LIMITS.labelCharsMax, 'text'),
        placement: value['placement'] === undefined ? 'top' : oneOf(value['placement'], ['top', 'bottom', 'center'] as const, 'placement'),
        color: parseOverlayColor(value['color']),
        background: parseOverlayColor(value['background']),
        interactive: flag(value['interactive'], 'interactive'),
        draggable: flag(value['draggable'], 'draggable'),
        cluster: value['cluster'] === undefined ? true : requiredFlag(value['cluster'], 'cluster'),
      };
    case 'pin':
      return parsePin(value, id, anchor);
    case 'heat':
      return parseHeat(value, id, anchor);
    case 'frame':
      return { kind: 'frame', id, anchor, path: parseBundlePage(value['path'], 'An overlay frame'), interactive: flag(value['interactive'], 'interactive') };
    default:
      throw new Error('Overlay kind must be box, label, pin, heat or frame');
  }
}

function parsePin(value: Readonly<Record<string, unknown>>, id: string, anchor: AppOverlayAnchor): AppOverlayItem {
  return {
    kind: 'pin',
    id,
    anchor,
    label: value['label'] === undefined ? undefined : parsePinLabel(value['label']),
    tone: value['tone'] === undefined ? 'accent' : oneOf(value['tone'], APP_PIN_TONES, 'tone'),
    avatarURL: value['avatarURL'] === undefined ? undefined : parsePinAvatarURL(value['avatarURL']),
    active: flag(value['active'], 'active'),
    interactive: flag(value['interactive'], 'interactive'),
    draggable: flag(value['draggable'], 'draggable'),
    cluster: value['cluster'] === undefined ? true : requiredFlag(value['cluster'], 'cluster'),
  };
}

function parsePinLabel(input: unknown): string {
  const label = text(input);
  const characters = [...label].length;
  if (characters === 0 || characters > APP_RPC_LIMITS.pinLabelCharsMax) {
    throw new Error(`A pin label is 1 to ${APP_RPC_LIMITS.pinLabelCharsMax} characters`);
  }
  if (label.trim() !== label) {
    throw new Error('A pin label has no leading or trailing space');
  }
  return label;
}

function parsePinAvatarURL(input: unknown): string {
  const address = text(input);
  if (address.length === 0 || address.length > APP_RPC_LIMITS.pinAvatarURLCharsMax) {
    throw new Error(`avatarURL is 1 to ${APP_RPC_LIMITS.pinAvatarURLCharsMax} characters`);
  }
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error('avatarURL is an https address');
  }
  if (url.protocol !== 'https:') {
    throw new Error('avatarURL is an https address');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('avatarURL carries no credentials');
  }
  return url.href;
}

function parseHeat(value: Readonly<Record<string, unknown>>, id: string, anchor: AppOverlayAnchor): AppOverlayItem {
  const columns = integerIn(value['columns'], 1, 64, 'columns');
  const rows = integerIn(value['rows'], 1, 64, 'rows');
  if (columns * rows > APP_RPC_LIMITS.heatCellsMax) {
    throw new Error(`A heat map has at most ${APP_RPC_LIMITS.heatCellsMax} cells`);
  }
  const items = toArray(value['values']);
  if (items === undefined || items.length !== columns * rows) {
    throw new Error('values holds columns × rows numbers');
  }
  const values = items.map((item) => {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) {
      throw new Error('Heat values are numbers from 0 to 1');
    }
    return item;
  });
  return { kind: 'heat', id, anchor, columns, rows, values, color: parseOverlayColor(value['color']) };
}

export function parseOverlayItems(input: unknown): readonly AppOverlayItem[] {
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('items must be a list');
  }
  if (items.length > APP_RPC_LIMITS.overlayItemsMax) {
    throw new Error(`An overlay has at most ${APP_RPC_LIMITS.overlayItemsMax} items`);
  }
  const parsed = items.map(parseOverlayItem);
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
    throw new Error('Overlay item ids are unique');
  }
  const anchors = new Set(parsed.flatMap((item) => anchoredElement(item.anchor)));
  if (anchors.size > APP_RPC_LIMITS.overlayAnchorsMax) {
    throw new Error(`An overlay anchors to at most ${APP_RPC_LIMITS.overlayAnchorsMax} elements`);
  }
  if (parsed.filter((item) => item.kind === 'frame').length > APP_RPC_LIMITS.overlayFramesMax) {
    throw new Error(`An overlay has at most ${APP_RPC_LIMITS.overlayFramesMax} frames`);
  }
  return parsed;
}

function anchoredElement(anchor: AppOverlayAnchor): readonly string[] {
  if ('nodeId' in anchor) {
    return [`id:${anchor.nodeId}`];
  }
  if ('ref' in anchor) {
    return [`ref:${nodeRefKey(anchor.ref)}`];
  }
  return [];
}

export function appAccessFeature(appId: string): `app:${string}` {
  return `app:${parseAppId(appId)}`;
}
