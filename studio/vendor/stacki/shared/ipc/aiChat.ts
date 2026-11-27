import { assert } from '../core/assert';
import { parseMessageRef, type MessageRef } from '../core/i18n/messageReference';
import { boolean, count, list, object, optional, pathText, record, text } from '../core/boundary';
import type { Parsed } from '../core/boundary';
import { err, ok, type Result } from '../core/result';
import { toArray } from '../core/record';
import { parseAgentId, type AgentId } from '../properties/ai/agentIds';
import { AI_LIMITS } from '../properties/ai/aiLimits';
import {
  parseChatEvent,
  parseChatList,
  parseChatOption,
  parseChatSummary,
  parseSectionName,
  toChatId,
  toPermissionRequestId,
  toSectionId,
  toTurnId,
  type ChatEvent,
  type ChatList,
  type ChatOption,
  type ChatSummary,
  type SectionId,
  type TurnId,
} from '../properties/ai/chatModel';
import { parseAutoCompactPercent } from '../properties/ai/autoCompact';
import { parseRememberAction, parseRememberedSettings, type RememberedSettings } from '../properties/ai/rememberedSettings';
import { parsePinBrief } from '../properties/ai/commentPinBrief';
import { parsePinBoardStrict, parsePinImages, type PinBoardRead } from '../properties/ai/commentPins';
import { parseMentionCandidates, parseMentionKinds, parseMentionQuery, parsePromptParts, type MentionCandidate } from '../properties/ai/mentions';
import { parseMergeResolution, type MergeResolution } from './mergeResolution';
import type { WireConflictPart, WireMergeClash } from './ipcWire';


const projectPath = pathText;
const chat = (input: unknown) => toChatId(text(input));

function parsedRef(input: unknown): { readonly messageRef?: MessageRef } {
  if (input === undefined) {
    return {};
  }
  const parsed = parseMessageRef(input);
  return parsed.ok ? { messageRef: parsed.value } : {};
}

function bounded(max: number, name: string) {
  return (input: unknown): string => {
    const value = text(input);
    if (value.length > max) {
      throw new Error(`${name}: exceeds limit`);
    }
    return value;
  };
}

function title(input: unknown): string {
  const value = bounded(AI_LIMITS.titleCharsMax, 'title')(input).trim();
  if (value.length === 0) {
    throw new Error('title: expected non-empty text');
  }
  return value;
}

export type PromptAttachment =
  | {
      readonly kind: 'image';
      readonly name: string;
      readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
      readonly data: string;
      readonly note?: string | undefined;
    }
  | { readonly kind: 'file'; readonly path: string };

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export const SCREENSHOT_NOTE_CHARS_MAX = 500;

function screenshotNote(input: unknown): string {
  const value = bounded(SCREENSHOT_NOTE_CHARS_MAX, 'attachment.note')(input);
  if (value.trim() === '') {
    throw new Error('attachment.note: expected text');
  }
  if (/\p{Cc}/u.test(value)) {
    throw new Error('attachment.note: expected one line');
  }
  return value;
}

export function parsePromptAttachment(input: unknown): PromptAttachment {
  const value = record(input);
  if (value['kind'] === 'image') {
    const mimeType = IMAGE_TYPES.find((type) => type === value['mimeType']);
    if (mimeType === undefined) {
      throw new Error('attachment.mimeType: unsupported image type');
    }
    const data = bounded(AI_LIMITS.imageBase64CharsMax, 'attachment.data')(value['data']);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new Error('attachment.data: expected base64');
    }
    const name = bounded(AI_LIMITS.labelCharsMax, 'attachment.name')(value['name']);
    const note = value['note'] === undefined ? undefined : screenshotNote(value['note']);
    return note === undefined ? { kind: 'image', name, mimeType, data } : { kind: 'image', name, mimeType, data, note };
  }
  if (value['kind'] === 'file') {
    const path = pathText(value['path']);
    assert(!path.includes('\0'), 'attachment.path: pathText refuses NUL');
    return { kind: 'file', path };
  }
  throw new Error('attachment.kind: unknown kind');
}

function attachments(input: unknown): readonly PromptAttachment[] {
  const values = toArray(input);
  if (values === undefined) {
    throw new Error('attachments: expected array');
  }
  if (values.length > AI_LIMITS.attachmentsMax) {
    throw new Error('attachments: exceeds limit');
  }
  const parsed = values.map(parsePromptAttachment);
  const imageChars = parsed.reduce((sum, attachment) => sum + (attachment.kind === 'image' ? attachment.data.length : 0), 0);
  if (imageChars > AI_LIMITS.attachmentsImageCharsMax) {
    throw new Error('attachments: images exceed limit');
  }
  return parsed;
}

export type PermissionAnswer = { readonly kind: 'option'; readonly optionId: string } | { readonly kind: 'cancel' };

function permissionAnswer(input: unknown): PermissionAnswer {
  const value = record(input);
  if (value['kind'] === 'cancel') {
    return { kind: 'cancel' };
  }
  if (value['kind'] === 'option') {
    return { kind: 'option', optionId: bounded(AI_LIMITS.idCharsMax, 'optionId')(value['optionId']) };
  }
  throw new Error('permission answer: unknown kind');
}

export type ReviewAction = { readonly kind: 'keep' } | { readonly kind: 'undo' } | { readonly kind: 'resolve'; readonly resolution: MergeResolution };

function reviewAction(input: unknown): ReviewAction {
  const value = record(input);
  switch (value['kind']) {
    case 'keep':
      return { kind: 'keep' };
    case 'undo':
      return { kind: 'undo' };
    case 'resolve':
      return { kind: 'resolve', resolution: parseMergeResolution(value['resolution']) };
    default:
      throw new Error('review action: unknown kind');
  }
}

export interface ChatSetting {
  readonly option: string;
  readonly value: string;
}

export function parseChatSettings(input: unknown): readonly ChatSetting[] {
  const values = toArray(input);
  if (values === undefined) {
    throw new Error('settings: expected array');
  }
  if (values.length > AI_LIMITS.configOptionsMax) {
    throw new Error('settings: exceeds limit');
  }
  const settings = values.map((entry) => {
    const value = record(entry);
    return { option: bounded(AI_LIMITS.idCharsMax, 'setting.option')(value['option']), value: bounded(AI_LIMITS.idCharsMax, 'setting.value')(value['value']) };
  });
  assert(settings.length === values.length, 'settings: one per entry');
  return settings;
}

function prompt(input: unknown): string {
  return bounded(AI_LIMITS.promptCharsMax, 'prompt')(input);
}

const section = (input: unknown): SectionId => toSectionId(text(input));

export type PromptMode = 'send' | 'steer';

function promptMode(input: unknown): PromptMode {
  if (input === 'send' || input === 'steer') {
    return input;
  }
  throw new Error('prompt mode: expected send or steer');
}

export type SectionAction =
  | { readonly kind: 'create'; readonly name: string }
  | { readonly kind: 'rename'; readonly section: SectionId; readonly name: string }
  | { readonly kind: 'delete'; readonly section: SectionId }
  | { readonly kind: 'collapse'; readonly section: SectionId; readonly collapsed: boolean }
  | { readonly kind: 'move'; readonly section: SectionId; readonly before: SectionId | undefined };

export function parseSectionAction(input: unknown): SectionAction {
  const value = record(input);
  switch (value['kind']) {
    case 'create':
      return { kind: 'create', name: parseSectionName(value['name']) };
    case 'rename':
      return { kind: 'rename', section: section(value['section']), name: parseSectionName(value['name']) };
    case 'delete':
      return { kind: 'delete', section: section(value['section']) };
    case 'collapse':
      return { kind: 'collapse', section: section(value['section']), collapsed: boolean(value['collapsed']) };
    case 'move':
      return { kind: 'move', section: section(value['section']), before: optional(section)(value['before']) };
    default:
      throw new Error('section action: unknown kind');
  }
}

export const SCREENSHOT_RECT_PX_MAX = 16_384;

export interface ScreenshotRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function screenshotRect(input: unknown): ScreenshotRect {
  const rect = object({ x: count, y: count, width: count, height: count })(input);
  if (rect.width < 1) {
    throw new Error('screenshot.rect: at least a pixel wide');
  }
  if (rect.height < 1) {
    throw new Error('screenshot.rect: at least a pixel high');
  }
  if (rect.x + rect.width > SCREENSHOT_RECT_PX_MAX) {
    throw new Error('screenshot.rect: past the window bound');
  }
  if (rect.y + rect.height > SCREENSHOT_RECT_PX_MAX) {
    throw new Error('screenshot.rect: past the window bound');
  }
  return rect;
}

export const RECORDING_FRAMES_MAX = 240;
export const RECORDING_DURATION_MS_MAX = 15_000;
const RECORDING_THUMB_CHARS_MAX = 400_000;
const RECORDING_ID = /^r[0-9a-f]{16}$/;

export type RecordAction =
  | { readonly kind: 'start'; readonly rect: ScreenshotRect }
  | { readonly kind: 'status'; readonly id: string }
  | { readonly kind: 'stop'; readonly id: string }
  | { readonly kind: 'frame'; readonly id: string; readonly index: number }
  | { readonly kind: 'discard'; readonly id: string };

function recordingId(input: unknown): string {
  const value = text(input);
  if (!RECORDING_ID.test(value)) {
    throw new Error('record.id: expected a recording id');
  }
  return value;
}

function recordAction(input: unknown): RecordAction {
  const value = record(input);
  switch (value['kind']) {
    case 'start':
      return { kind: 'start', rect: screenshotRect(value['rect']) };
    case 'status':
    case 'stop':
    case 'discard':
      return { kind: value['kind'], id: recordingId(value['id']) };
    case 'frame': {
      const index = count(value['index']);
      if (index >= RECORDING_FRAMES_MAX) {
        throw new Error('record.index: past the frame bound');
      }
      return { kind: 'frame', id: recordingId(value['id']), index };
    }
    default:
      throw new Error('record.kind: unknown action');
  }
}

export const AI_PAYLOADS = {
  'ai:screenshot': object({ projectPath, rect: screenshotRect }),
  'ai:record': object({ projectPath, action: recordAction }),
  'ai:agents': object({ projectPath }),
  'ai:installAgent': object({ projectPath, agent: parseAgentId }),
  'ai:trust': object({ projectPath }),
  'ai:prewarm': object({ projectPath, agent: parseAgentId, action: parsePrewarmAction }),
  'ai:chats': object({ projectPath }),
  'ai:chatCreate': object({ projectPath, agent: parseAgentId, title: optional(title), settings: optional(parseChatSettings) }),
  'ai:chatUpdate': object({
    projectPath,
    chat,
    title: optional(title),
    pinned: optional(boolean),
    settings: optional(parseChatSettings),
    archived: optional(boolean),
    unread: optional(boolean),
  }),
  'ai:chatDelete': object({ projectPath, chat }),
  'ai:chatRead': object({ projectPath, chat }),
  'ai:prompt': object({
    projectPath,
    chat,
    text: prompt,
    attachments,
    parts: optional(parsePromptParts),
    mode: optional(promptMode),
    pins: optional(parsePinBrief),
  }),
  'ai:steer': object({ projectPath, chat, text: prompt, attachments, parts: optional(parsePromptParts) }),
  'ai:compact': object({ projectPath, chat }),
  'ai:pinsRead': object({ projectPath }),
  'ai:pinsWrite': object({ projectPath, board: parsePinBoardStrict, images: parsePinImages }),
  'ai:autoCompactGet': object({}),
  'ai:autoCompactSet': object({ percent: optional(parseAutoCompactPercent) }),
  'ai:chatFork': object({ projectPath, chat }),
  'ai:chatMove': object({ projectPath, chat, section: optional(section), before: optional(chat) }),
  'ai:sections': object({ projectPath, action: parseSectionAction }),
  'ai:diff': object({ projectPath, chat, turn: (input: unknown) => toTurnId(text(input)), path: pathText }),
  'ai:mentions': object({ projectPath, query: parseMentionQuery, kinds: parseMentionKinds }),
  'ai:cancel': object({ projectPath, chat }),
  'ai:permission': object({ projectPath, chat, request: (input: unknown) => toPermissionRequestId(text(input)), answer: permissionAnswer }),
  'ai:setOption': object({ projectPath, chat, option: bounded(AI_LIMITS.idCharsMax, 'option'), value: bounded(AI_LIMITS.idCharsMax, 'value') }),
  'ai:remember': object({ projectPath, agent: parseAgentId, action: parseRememberAction }),
  'ai:review': object({ projectPath, chat, turn: (input: unknown) => toTurnId(text(input)), path: pathText, action: reviewAction }),
  'ai:setup': object({ projectPath, agent: parseAgentId, action: (input: unknown) => parseSetupAction(input) }),
} as const;

export const parseAiAck = object({ chars: count });
export type AiAck = Parsed<typeof parseAiAck>;


export type AgentAvailability =
  | { readonly agent: AgentId; readonly state: 'missing-cli' }
  | { readonly agent: AgentId; readonly state: 'needs-install'; readonly adapterVersion: string; readonly downloadMegabytes: number }
  | { readonly agent: AgentId; readonly state: 'installing' }
  | { readonly agent: AgentId; readonly state: 'ready'; readonly adapterVersion: string; readonly running: boolean }
  | { readonly agent: AgentId; readonly state: 'sign-in' }
  | { readonly agent: AgentId; readonly state: 'failed'; readonly message: string; readonly messageRef?: MessageRef | undefined };

export interface AiAgentsReply {
  readonly trusted: boolean;
  readonly agents: readonly AgentAvailability[];
  readonly options: readonly { readonly agent: AgentId; readonly options: readonly ChatOption[] }[];
  readonly remembered: RememberedSettings;
}

export interface AiFailure {
  readonly code:
    | 'not-trusted'
    | 'missing-cli'
    | 'not-installed'
    | 'sign-in'
    | 'busy'
    | 'agent-failed'
    | 'chat-missing'
    | 'read-only'
    | 'unsupported'
    | 'delivered'
    | 'section-missing'
    | 'invalid';
  readonly message: string;
  readonly messageRef?: MessageRef | undefined;
}

export interface SteerReply {
  readonly turn: TurnId;
  readonly outcome: 'steered' | 'startedNewTurn';
}

export interface DiffReply {
  readonly oldText: string | undefined;
  readonly newText: string | undefined;
}

export interface ChatTranscript {
  readonly summary: ChatSummary;
  readonly events: readonly ChatEvent[];
  readonly full: boolean;
}

export type ReviewOutcome =
  | { readonly tag: 'done'; readonly review: 'kept' | 'undone' }
  | { readonly tag: 'drifted'; readonly clash: WireMergeClash }
  | { readonly tag: 'failed'; readonly message: string; readonly messageRef?: MessageRef | undefined };

export interface AiEventsPush {
  readonly projectPath: string;
  readonly chat: ChatSummary['id'];
  readonly events: readonly ChatEvent[];
  readonly chars: number;
}

export interface AiStatusPush {
  readonly projectPath: string;
  readonly availability: AgentAvailability;
  readonly options: readonly ChatOption[] | undefined;
}

export interface ScreenshotReply {
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

export type RecordStopReason = 'person' | 'duration' | 'frames' | 'bytes' | 'failed' | 'discarded';
const STOP_REASONS: readonly RecordStopReason[] = ['person', 'duration', 'frames', 'bytes', 'failed', 'discarded'];

export interface RecordedFrame {
  readonly index: number;
  readonly atMs: number;
  readonly width: number;
  readonly height: number;
  readonly thumb: string;
}

export type RecordReply =
  | { readonly kind: 'started'; readonly id: string }
  | {
      readonly kind: 'status';
      readonly state: 'recording' | 'paused' | 'stopped';
      readonly elapsedMs: number;
      readonly frames: number;
      readonly bytes: number;
      readonly stopReason: RecordStopReason | undefined;
    }
  | { readonly kind: 'stopped'; readonly frames: readonly RecordedFrame[]; readonly fps: number; readonly stopReason: RecordStopReason }
  | { readonly kind: 'frame'; readonly image: ScreenshotReply }
  | { readonly kind: 'discarded' };

export interface AiResults {
  readonly 'ai:screenshot': Result<ScreenshotReply, AiFailure>;
  readonly 'ai:record': Result<RecordReply, AiFailure>;
  readonly 'ai:agents': AiAgentsReply;
  readonly 'ai:installAgent': Result<AgentAvailability, AiFailure>;
  readonly 'ai:trust': { readonly ok: true };
  readonly 'ai:prewarm': { readonly ok: true };
  readonly 'ai:chats': ChatList;
  readonly 'ai:chatCreate': Result<ChatSummary, AiFailure>;
  readonly 'ai:chatUpdate': Result<ChatSummary, AiFailure>;
  readonly 'ai:chatDelete': { readonly ok: true };
  readonly 'ai:chatRead': Result<ChatTranscript, AiFailure>;
  readonly 'ai:prompt': Result<{ readonly turn: TurnId }, AiFailure>;
  readonly 'ai:steer': Result<SteerReply, AiFailure>;
  readonly 'ai:compact': Result<{ readonly started: true }, AiFailure>;
  readonly 'ai:pinsRead': Result<PinBoardRead, AiFailure>;
  readonly 'ai:pinsWrite': Result<{ readonly saved: true }, AiFailure>;
  readonly 'ai:autoCompactGet': AutoCompactReply;
  readonly 'ai:autoCompactSet': AutoCompactReply;
  readonly 'ai:chatFork': Result<ChatSummary, AiFailure>;
  readonly 'ai:chatMove': Result<ChatList, AiFailure>;
  readonly 'ai:sections': Result<ChatList, AiFailure>;
  readonly 'ai:diff': Result<DiffReply, AiFailure>;
  readonly 'ai:mentions': Result<readonly MentionCandidate[], AiFailure>;
  readonly 'ai:cancel': { readonly ok: true };
  readonly 'ai:permission': Result<{ readonly answered: true }, AiFailure>;
  readonly 'ai:setOption': Result<{ readonly set: true }, AiFailure>;
  readonly 'ai:remember': Result<RememberedSettings, AiFailure>;
  readonly 'ai:review': ReviewOutcome;
  readonly 'ai:setup': SetupState;
}


const AVAILABILITY_STATES = ['missing-cli', 'needs-install', 'installing', 'ready', 'sign-in', 'failed'] as const;
const FAILURE_CODES: readonly AiFailure['code'][] = [
  'not-trusted',
  'missing-cli',
  'not-installed',
  'sign-in',
  'busy',
  'agent-failed',
  'chat-missing',
  'read-only',
  'unsupported',
  'delivered',
  'section-missing',
  'invalid',
];

export function parseAgentAvailability(input: unknown): AgentAvailability {
  const value = record(input);
  const agent = parseAgentId(value['agent']);
  const state = AVAILABILITY_STATES.find((candidate) => candidate === value['state']);
  switch (state) {
    case 'missing-cli':
    case 'installing':
    case 'sign-in':
      return { agent, state };
    case 'needs-install':
      return {
        agent,
        state,
        adapterVersion: bounded(AI_LIMITS.idCharsMax, 'adapterVersion')(value['adapterVersion']),
        downloadMegabytes: count(value['downloadMegabytes']),
      };
    case 'ready':
      return { agent, state, adapterVersion: bounded(AI_LIMITS.idCharsMax, 'adapterVersion')(value['adapterVersion']), running: boolean(value['running']) };
    case 'failed':
      return { agent, state, message: bounded(AI_LIMITS.labelCharsMax, 'message')(value['message']), ...parsedRef(value['messageRef']) };
    case undefined:
      throw new Error('AgentAvailability.state: unknown state');
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function parseAiAgentsReply(input: unknown): AiAgentsReply {
  const value = record(input);
  const agents = list(parseAgentAvailability)(value['agents']);
  assert(agents.length <= 16, 'ai:agents: a handful of agents');
  const options = list((entry: unknown) => {
    const item = record(entry);
    const choices = toArray(item['options']);
    if (choices === undefined || choices.length > AI_LIMITS.configOptionsMax) {
      throw new Error('ai:agents.options: expected a bounded array');
    }
    return { agent: parseAgentId(item['agent']), options: choices.map(parseChatOption) };
  })(value['options']);
  return { trusted: boolean(value['trusted']), agents, options, remembered: parseRememberedSettings(value['remembered']) };
}

export { parseRememberedSettings };

export function parseAiFailure(input: unknown): AiFailure {
  const value = record(input);
  const code = FAILURE_CODES.find((candidate) => candidate === value['code']);
  if (code === undefined) {
    throw new Error('AiFailure.code: unknown code');
  }
  return { code, message: bounded(AI_LIMITS.labelCharsMax, 'message')(value['message']), ...parsedRef(value['messageRef']) };
}

export function parseAiResult<T>(input: unknown, parse: (value: unknown) => T): Result<T, AiFailure> {
  const value = record(input);
  if (value['ok'] === true) {
    return ok(parse(value['value']));
  }
  if (value['ok'] === false) {
    return err(parseAiFailure(value['error']));
  }
  throw new Error('ai result: expected ok flag');
}

export { parseChatList };

export function parseChatTranscript(input: unknown): ChatTranscript {
  const value = record(input);
  const events = toArray(value['events']);
  if (events === undefined) {
    throw new Error('transcript.events: expected array');
  }
  if (events.length > AI_LIMITS.chatEventsMax) {
    throw new Error('transcript.events: exceeds limit');
  }
  return { summary: parseChatSummary(value['summary']), events: events.map(parseChatEvent), full: boolean(value['full']) };
}

export function parseReviewOutcome(input: unknown): ReviewOutcome {
  const value = record(input);
  switch (value['tag']) {
    case 'done': {
      const review = value['review'] === 'kept' || value['review'] === 'undone' ? value['review'] : undefined;
      if (review === undefined) {
        throw new Error('review.review: unknown value');
      }
      return { tag: 'done', review };
    }
    case 'drifted':
      return { tag: 'drifted', clash: parseClash(value['clash']) };
    case 'failed':
      return { tag: 'failed', message: bounded(AI_LIMITS.labelCharsMax, 'message')(value['message']), ...parsedRef(value['messageRef']) };
    default:
      throw new Error('review outcome: unknown tag');
  }
}

function parseClash(input: unknown): WireMergeClash {
  const value = record(input);
  const parts = list(parseConflictPart)(value['parts']);
  assert(parts.length <= AI_LIMITS.chatEventsMax, 'clash: parts are bounded by the list parser');
  return { path: pathText(value['path']), ours: optional(text)(value['ours']), theirs: optional(text)(value['theirs']), parts };
}

const CLASH_SIDES = ['ours', 'theirs', 'both'] as const;

function parseConflictPart(input: unknown): WireConflictPart {
  const entry = record(input);
  if (entry['kind'] === 'same') {
    return { kind: 'same', text: text(entry['text']) };
  }
  if (entry['kind'] !== 'clash') {
    throw new Error('clash part: unknown kind');
  }
  const changedBy = CLASH_SIDES.find((side) => side === entry['changedBy']);
  if (changedBy === undefined) {
    throw new Error('clash part: unknown side');
  }
  const part: WireConflictPart = {
    kind: 'clash',
    ours: text(entry['ours']),
    theirs: text(entry['theirs']),
    changedBy,
    merged: optional(text)(entry['merged']),
  };
  assert(part.kind === 'clash', 'clash part: built as a clash');
  return part;
}

export function parseAiEventsPush(input: unknown): AiEventsPush {
  const value = record(input);
  const events = toArray(value['events']);
  if (events === undefined) {
    throw new Error('ai:events.events: expected array');
  }
  if (events.length > AI_LIMITS.eventsQueuedMax) {
    throw new Error('ai:events.events: exceeds limit');
  }
  return { projectPath: pathText(value['projectPath']), chat: toChatId(text(value['chat'])), events: events.map(parseChatEvent), chars: count(value['chars']) };
}

export function parseAiStatusPush(input: unknown): AiStatusPush {
  const value = record(input);
  const options = value['options'] === undefined ? undefined : toArray(value['options']);
  if (options !== undefined && options.length > AI_LIMITS.configOptionsMax) {
    throw new Error('ai:agentStatus.options: exceeds limit');
  }
  return { projectPath: pathText(value['projectPath']), availability: parseAgentAvailability(value['availability']), options: options?.map(parseChatOption) };
}

export function parseSteerReply(input: unknown): SteerReply {
  const value = record(input);
  const outcome = value['outcome'] === 'steered' || value['outcome'] === 'startedNewTurn' ? value['outcome'] : undefined;
  if (outcome === undefined) {
    throw new Error('ai:steer.outcome: unknown outcome');
  }
  return { turn: toTurnId(text(value['turn'])), outcome };
}

export function parsePinsSaved(input: unknown): { readonly saved: true } {
  if (record(input)['saved'] !== true) {
    throw new Error('ai:pinsWrite: expected saved');
  }
  return { saved: true };
}

export interface AutoCompactReply {
  readonly percent: number | undefined;
}

export function parseAutoCompactReply(input: unknown): AutoCompactReply {
  const percent = optional(parseAutoCompactPercent)(record(input)['percent']);
  return { percent };
}

export function parseCompactStarted(input: unknown): { readonly started: true } {
  if (record(input)['started'] !== true) {
    throw new Error('ai:compact.started: expected true');
  }
  return { started: true };
}

export function parseDiffReply(input: unknown): DiffReply {
  const value = record(input);
  const side = optional(bounded(AI_LIMITS.fileCharsMax, 'diff'));
  return { oldText: side(value['oldText']), newText: side(value['newText']) };
}

export const SCREENSHOT_EDGE_PX_MAX = 1600;
const SCREENSHOT_TYPES = ['image/png', 'image/jpeg'] as const;

export function parseScreenshotReply(input: unknown): ScreenshotReply {
  const value = record(input);
  const mimeType = SCREENSHOT_TYPES.find((type) => type === value['mimeType']);
  if (mimeType === undefined) {
    throw new Error('screenshot.mimeType: expected PNG or JPEG');
  }
  const data = bounded(AI_LIMITS.imageBase64CharsMax, 'screenshot.data')(value['data']);
  if (data.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error('screenshot.data: expected base64');
  }
  const width = count(value['width']);
  const height = count(value['height']);
  for (const side of [width, height]) {
    if (side < 1 || side > SCREENSHOT_EDGE_PX_MAX) {
      throw new Error('screenshot: size outside the edge bound');
    }
  }
  return { mimeType, data, width, height };
}

function stopReason(input: unknown): RecordStopReason {
  const reason = STOP_REASONS.find((candidate) => candidate === input);
  if (reason === undefined) {
    throw new Error('record.stopReason: unknown reason');
  }
  return reason;
}

function recordedFrame(input: unknown): RecordedFrame {
  const value = record(input);
  const thumb = bounded(RECORDING_THUMB_CHARS_MAX, 'record.thumb')(value['thumb']);
  if (thumb.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(thumb)) {
    throw new Error('record.thumb: expected base64');
  }
  const width = count(value['width']);
  const height = count(value['height']);
  for (const side of [width, height]) {
    if (side < 1 || side > SCREENSHOT_EDGE_PX_MAX) {
      throw new Error('record.frame: size outside the edge bound');
    }
  }
  return { index: count(value['index']), atMs: count(value['atMs']), width, height, thumb };
}

export function parseRecordReply(input: unknown): RecordReply {
  const value = record(input);
  switch (value['kind']) {
    case 'started':
      return { kind: 'started', id: recordingId(value['id']) };
    case 'status': {
      const state = (['recording', 'paused', 'stopped'] as const).find((candidate) => candidate === value['state']);
      if (state === undefined) {
        throw new Error('record.state: unknown state');
      }
      const reason = value['stopReason'] === undefined ? undefined : stopReason(value['stopReason']);
      return { kind: 'status', state, elapsedMs: count(value['elapsedMs']), frames: count(value['frames']), bytes: count(value['bytes']), stopReason: reason };
    }
    case 'stopped': {
      const frames = toArray(value['frames']);
      if (frames === undefined || frames.length > RECORDING_FRAMES_MAX) {
        throw new Error('record.frames: expected a bounded array');
      }
      const parsed = frames.map(recordedFrame);
      parsed.forEach((frame, index) => {
        if (frame.index !== index) {
          throw new Error('record.frames: indices in order');
        }
      });
      const fps = value['fps'];
      if (typeof fps !== 'number' || !Number.isFinite(fps) || fps < 0 || fps > 60) {
        throw new Error('record.fps: expected a small rate');
      }
      return { kind: 'stopped', frames: parsed, fps, stopReason: stopReason(value['stopReason']) };
    }
    case 'frame':
      return { kind: 'frame', image: parseScreenshotReply(value['image']) };
    case 'discarded':
      return { kind: 'discarded' };
    default:
      throw new Error('record.kind: unknown reply');
  }
}

export function parseMentionReply(input: unknown): readonly MentionCandidate[] {
  return parseMentionCandidates(input);
}

export function parsePromptTurn(input: unknown): { readonly turn: TurnId } {
  const turn = toTurnId(text(record(input)['turn']));
  assert(turn.startsWith('t'), 'ai:prompt: a turn id');
  return { turn };
}


export type SetupAction =
  | { readonly kind: 'detect' }
  | { readonly kind: 'install' }
  | { readonly kind: 'signIn' }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'signOut' };

export const SETUP_CODE_CHARS_MAX = 4_096;

export const PREWARM_ACTIONS = ['warm', 'release'] as const;
export type PrewarmAction = (typeof PREWARM_ACTIONS)[number];

export function parsePrewarmAction(input: unknown): PrewarmAction {
  const action = PREWARM_ACTIONS.find((candidate) => candidate === input);
  if (action === undefined) {
    throw new Error('prewarm action: expected warm or release');
  }
  return action;
}

export function parseSetupAction(input: unknown): SetupAction {
  const value = record(input);
  switch (value['kind']) {
    case 'detect':
    case 'install':
    case 'signIn':
    case 'cancel':
    case 'signOut':
      return { kind: value['kind'] };
    case 'code': {
      const code = bounded(SETUP_CODE_CHARS_MAX, 'code')(value['code']).trim();
      if (code === '' || /[\r\n]/.test(code)) {
        throw new Error('code: expected one line');
      }
      return { kind: 'code', code };
    }
    default:
      throw new Error('setup action: unknown kind');
  }
}

export type SetupState =
  | { readonly agent: AgentId; readonly step: 'missing' }
  | { readonly agent: AgentId; readonly step: 'installing' }
  | { readonly agent: AgentId; readonly step: 'signed-out' }
  | {
      readonly agent: AgentId;
      readonly step: 'signing-in';
      readonly url: string | undefined;
      readonly needsCode: boolean;
      readonly output: string;
    }
  | { readonly agent: AgentId; readonly step: 'ready'; readonly account: SetupAccount }
  | {
      readonly agent: AgentId;
      readonly step: 'failed';
      readonly during: 'install' | 'sign-in' | 'sign-out';
      readonly message: string;
      readonly messageRef?: MessageRef | undefined;
      readonly details: string;
    };

export interface SetupAccount {
  readonly name: string | undefined;
  readonly plan: string | undefined;
  readonly email: string | undefined;
}

export const SETUP_DETAILS_CHARS_MAX = 16_000;

const SETUP_STEPS = ['missing', 'installing', 'signed-out', 'signing-in', 'ready', 'failed'] as const;

export function parseSetupState(input: unknown): SetupState {
  const value = record(input);
  const agent = parseAgentId(value['agent']);
  const step = SETUP_STEPS.find((candidate) => candidate === value['step']);
  switch (step) {
    case 'missing':
    case 'installing':
    case 'signed-out':
      return { agent, step };
    case 'signing-in':
      return {
        agent,
        step,
        url: optional(bounded(AI_LIMITS.labelCharsMax, 'url'))(value['url']),
        needsCode: boolean(value['needsCode']),
        output: optional(bounded(SETUP_DETAILS_CHARS_MAX, 'output'))(value['output']) ?? '',
      };
    case 'ready': {
      const account = record(value['account']);
      const field = optional(bounded(AI_LIMITS.labelCharsMax, 'account'));
      const name = field(account['name']);
      if (name !== undefined && name.includes('@')) {
        throw new Error('account.name: a display name, never an email');
      }
      return { agent, step, account: { name, plan: field(account['plan']), email: field(account['email']) } };
    }
    case 'failed': {
      const during = value['during'] === 'install' || value['during'] === 'sign-in' || value['during'] === 'sign-out' ? value['during'] : undefined;
      if (during === undefined) {
        throw new Error('setup.during: unknown step');
      }
      return {
        agent,
        step,
        during,
        message: bounded(AI_LIMITS.labelCharsMax, 'message')(value['message']),
        ...parsedRef(value['messageRef']),
        details: bounded(SETUP_DETAILS_CHARS_MAX, 'details')(value['details']),
      };
    }
    case undefined:
      throw new Error('setup.step: unknown step');
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}
