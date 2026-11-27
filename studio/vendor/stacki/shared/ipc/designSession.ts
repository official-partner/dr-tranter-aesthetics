import { boolean, count, pathText, record, text } from '../core/boundary';
import { parseDesignSnapshot, type DesignSnapshot } from './designSnapshot';

export const DESIGN_MODE_ENABLED = true;

export function designModeAvailable(platform: string): boolean {
  return DESIGN_MODE_ENABLED && platform === 'darwin';
}

export const DESIGN_SESSION_LIMITS = {
  framesMax: 8,
  frameNameCharsMax: 60,
  refusalCharsMax: 400,
  pageCharsMax: 1_000,
  projectNameCharsMax: 400,
  imageCharsMax: 4_000_000,
  placePxMax: 1_000_000,
  placeStepPx: 1_520,
  pageSourceCharsMax: 2_000_000,
  handoffTextCharsMax: 200_000,
  handoffImagesMax: 9,
} as const satisfies Record<string, number>;

export type DesignFrameId = `f${number}`;

export interface DesignPlace {
  readonly x: number;
  readonly y: number;
}

export interface DesignFrameView {
  readonly id: DesignFrameId;
  readonly name: string;
  readonly at: DesignPlace;
  readonly changedFiles: number;
}

export type DesignSessionState =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'on';
      readonly projectName: string;
      readonly liveRoot: string;
      readonly page: string | undefined;
      readonly frames: readonly DesignFrameView[];
      readonly active: DesignFrameId;
      readonly stale: boolean;
    };

export const DESIGN_ENTER_REFUSALS = ['not-open', 'too-large', 'outside-link', 'copy-failed', 'busy', 'cancelled'] as const;
export type DesignEnterRefusal = (typeof DESIGN_ENTER_REFUSALS)[number];

export interface DesignHandoff {
  readonly text: string;
  readonly images: readonly string[];
  readonly names: readonly string[];
}

export type DesignSessionRequest =
  | { readonly op: 'state' }
  | {
      readonly op: 'enter';
      readonly projectPath: string;
      readonly page: string | undefined;
      readonly refusal: string;
      readonly frameName: string;
      readonly snapshot: DesignSnapshot | undefined;
    }
  | { readonly op: 'exit'; readonly handoff: DesignHandoff | undefined }
  | { readonly op: 'cancel' }
  | { readonly op: 'take-handoff' }
  | { readonly op: 'preview'; readonly projectPath: string }
  | { readonly op: 'frame-duplicate'; readonly source: DesignFrameId; readonly name: string; readonly at: DesignPlace }
  | { readonly op: 'frame-switch'; readonly frame: DesignFrameId; readonly page: string | undefined }
  | { readonly op: 'frame-rename'; readonly frame: DesignFrameId; readonly name: string }
  | { readonly op: 'frame-delete'; readonly frame: DesignFrameId; readonly page: string | undefined }
  | { readonly op: 'frame-move'; readonly frame: DesignFrameId; readonly at: DesignPlace }
  | { readonly op: 'frame-snapshot'; readonly frame: DesignFrameId; readonly snapshot: DesignSnapshot }
  | { readonly op: 'frame-snapshots' }
  | { readonly op: 'start-over'; readonly frameName: string; readonly page: string | undefined };

export type DesignSessionReply =
  | { readonly kind: 'state'; readonly state: DesignSessionState }
  | { readonly kind: 'entered'; readonly liveRoot: string }
  | { readonly kind: 'refused'; readonly reason: DesignEnterRefusal; readonly folder: string | undefined }
  | { readonly kind: 'left'; readonly realRoot: string }
  | { readonly kind: 'handoff'; readonly handoff: DesignHandoff | undefined }
  | { readonly kind: 'shown'; readonly state: DesignSessionState; readonly pageSource: string | undefined }
  | { readonly kind: 'kept' }
  | {
      readonly kind: 'preview';
      readonly frames: readonly DesignFrameView[];
      readonly snapshots: readonly { readonly frame: DesignFrameId; readonly snapshot: DesignSnapshot }[];
    }
  | { readonly kind: 'snapshots'; readonly snapshots: readonly { readonly frame: DesignFrameId; readonly snapshot: DesignSnapshot }[] };

const FRAME_ID = /^f[1-9]\d{0,5}$/;

export function parseDesignFrameId(input: unknown): DesignFrameId {
  const value = text(input);
  if (!FRAME_ID.test(value)) {
    throw new Error('Design frame id: expected f followed by a number');
  }
  return value as DesignFrameId;
}

export function nextDesignFrameId(frames: readonly { readonly id: DesignFrameId }[]): DesignFrameId {
  const highest = frames.reduce((max, frame) => Math.max(max, Number(frame.id.slice(1))), 0);
  const next = parseDesignFrameId(`f${highest + 1}`);
  if (frames.some((frame) => frame.id === next)) {
    throw new Error('Assertion failed: nextDesignFrameId: a new id is unused');
  }
  return next;
}

export function defaultFramePlace(index: number): DesignPlace {
  return { x: index * DESIGN_SESSION_LIMITS.placeStepPx, y: 0 };
}

function coordinate(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    throw new Error('Design place: expected whole numbers');
  }
  if (Math.abs(input) > DESIGN_SESSION_LIMITS.placePxMax) {
    throw new Error('Design place: too far from the canvas');
  }
  return input;
}

export function parseDesignPlace(input: unknown): DesignPlace {
  const value = record(input);
  return { x: coordinate(value['x']), y: coordinate(value['y']) };
}

function bounded(input: unknown, charsMax: number, what: string): string {
  const value = text(input);
  if (value.length > charsMax) {
    throw new Error(`${what}: exceeds ${charsMax} characters`);
  }
  return value;
}

function frameName(input: unknown): string {
  const value = bounded(input, DESIGN_SESSION_LIMITS.frameNameCharsMax, 'Design frame name').trim();
  if (value.length === 0) {
    throw new Error('Design frame name: expected text');
  }
  return value;
}

function image(input: unknown): string {
  const value = bounded(input, DESIGN_SESSION_LIMITS.imageCharsMax, 'Design frame image');
  if (!value.startsWith('data:image/png;base64,') && !value.startsWith('data:image/jpeg;base64,')) {
    throw new Error('Design frame image: expected a PNG data URL');
  }
  return value;
}

function optionalPage(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  return bounded(pathText(input), DESIGN_SESSION_LIMITS.pageCharsMax, 'Design page');
}

function handoff(input: unknown): DesignHandoff {
  const value = record(input);
  const images = value['images'];
  if (!Array.isArray(images)) {
    throw new Error('Design handoff images: expected a list');
  }
  if (images.length > DESIGN_SESSION_LIMITS.handoffImagesMax) {
    throw new Error('Design handoff images: too many');
  }
  const names = value['names'];
  if (!Array.isArray(names) || names.length !== images.length) {
    throw new Error('Design handoff names: one per picture');
  }
  return {
    text: bounded(value['text'], DESIGN_SESSION_LIMITS.handoffTextCharsMax, 'Design handoff text'),
    images: images.map(image),
    names: names.map(frameName),
  };
}

export function parseDesignSessionRequest(input: unknown): DesignSessionRequest {
  const value = record(input);
  const op = value['op'];
  switch (op) {
    case 'state':
    case 'take-handoff':
    case 'frame-snapshots':
    case 'cancel':
      return { op };
    case 'preview':
      return { op, projectPath: pathText(value['projectPath']) };
    case 'enter':
      return {
        op,
        projectPath: pathText(value['projectPath']),
        page: optionalPage(value['page']),
        refusal: bounded(value['refusal'], DESIGN_SESSION_LIMITS.refusalCharsMax, 'Design refusal'),
        frameName: frameName(value['frameName']),
        snapshot: value['snapshot'] === undefined ? undefined : parseDesignSnapshot(value['snapshot']),
      };
    case 'exit':
      return { op, handoff: value['handoff'] === undefined ? undefined : handoff(value['handoff']) };
    case 'frame-duplicate':
      return { op, source: parseDesignFrameId(value['source']), name: frameName(value['name']), at: parseDesignPlace(value['at']) };
    case 'frame-switch':
    case 'frame-delete':
      return { op, frame: parseDesignFrameId(value['frame']), page: optionalPage(value['page']) };
    case 'frame-rename':
      return { op, frame: parseDesignFrameId(value['frame']), name: frameName(value['name']) };
    case 'frame-move':
      return { op, frame: parseDesignFrameId(value['frame']), at: parseDesignPlace(value['at']) };
    case 'frame-snapshot':
      return { op, frame: parseDesignFrameId(value['frame']), snapshot: parseDesignSnapshot(value['snapshot']) };
    case 'start-over':
      return { op, frameName: frameName(value['frameName']), page: optionalPage(value['page']) };
    default:
      throw new Error(`Design session: unknown op ${JSON.stringify(op)}`);
  }
}

function frameView(input: unknown): DesignFrameView {
  const value = record(input);
  const changedFiles = count(value['changedFiles']);
  return { id: parseDesignFrameId(value['id']), name: frameName(value['name']), at: parseDesignPlace(value['at']), changedFiles };
}

function parseState(input: unknown): DesignSessionState {
  const value = record(input);
  if (value['kind'] === 'off') {
    return { kind: 'off' };
  }
  if (value['kind'] !== 'on') {
    throw new Error('Design session state: unknown kind');
  }
  const frames = value['frames'];
  if (!Array.isArray(frames)) {
    throw new Error('Design session frames: expected a list');
  }
  if (frames.length === 0) {
    throw new Error('Design session frames: at least one');
  }
  if (frames.length > DESIGN_SESSION_LIMITS.framesMax) {
    throw new Error('Design session frames: too many');
  }
  const parsed = frames.map(frameView);
  const active = parseDesignFrameId(value['active']);
  if (!parsed.some((frame) => frame.id === active)) {
    throw new Error('Design session: the active frame is one of the frames');
  }
  return {
    kind: 'on',
    projectName: bounded(value['projectName'], DESIGN_SESSION_LIMITS.projectNameCharsMax, 'Design project name'),
    liveRoot: pathText(value['liveRoot']),
    page: optionalPage(value['page']),
    frames: parsed,
    active,
    stale: boolean(value['stale']),
  };
}

function boundedList(input: unknown, itemsMax: number, what: string): readonly unknown[] {
  if (!Array.isArray(input)) {
    throw new Error(`${what}: expected a list`);
  }
  if (input.length > itemsMax) {
    throw new Error(`${what}: too many`);
  }
  return input;
}

function frameSnapshots(input: unknown): readonly { readonly frame: DesignFrameId; readonly snapshot: DesignSnapshot }[] {
  return boundedList(input, DESIGN_SESSION_LIMITS.framesMax, 'Design snapshots').map((entry) => {
    const item = record(entry);
    return { frame: parseDesignFrameId(item['frame']), snapshot: parseDesignSnapshot(item['snapshot']) };
  });
}

export function parseDesignSessionReply(input: unknown): DesignSessionReply {
  const value = record(input);
  const kind = value['kind'];
  switch (kind) {
    case 'state':
      return { kind, state: parseState(value['state']) };
    case 'entered':
      return { kind, liveRoot: pathText(value['liveRoot']) };
    case 'refused': {
      const reason = DESIGN_ENTER_REFUSALS.find((entry) => entry === value['reason']);
      if (reason === undefined) {
        throw new Error('Design session: unknown refusal');
      }
      const folder = value['folder'] === undefined ? undefined : bounded(value['folder'], DESIGN_SESSION_LIMITS.pageCharsMax, 'Design refusal folder');
      return { kind, reason, folder };
    }
    case 'left':
      return { kind, realRoot: pathText(value['realRoot']) };
    case 'handoff':
      return { kind, handoff: value['handoff'] === undefined ? undefined : handoff(value['handoff']) };
    case 'shown': {
      const source = value['pageSource'];
      const pageSource = source === undefined ? undefined : bounded(source, DESIGN_SESSION_LIMITS.pageSourceCharsMax, 'Design page text');
      return { kind, state: parseState(value['state']), pageSource };
    }
    case 'kept':
      return { kind };
    case 'snapshots':
      return { kind, snapshots: frameSnapshots(value['snapshots']) };
    case 'preview': {
      const frames = boundedList(value['frames'], DESIGN_SESSION_LIMITS.framesMax, 'Design preview').map(frameView);
      return { kind, frames, snapshots: frameSnapshots(value['snapshots']) };
    }
    default:
      throw new Error(`Design session: unknown reply ${JSON.stringify(kind)}`);
  }
}

export const DESIGN_SESSION_PAYLOADS = { 'design:session': parseDesignSessionRequest } as const;

export interface DesignSessionResults {
  readonly 'design:session': DesignSessionReply;
}
