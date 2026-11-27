import { parseDeepHoverNode, type DeepHoverNode } from '../../../shared/properties/deepOutline';
import type { Ownership } from '../../../shared/properties/outlineOwnership';
import { isReservedShortcut, type AppReservedShortcut } from '../../../shared/properties/appShortcuts';
import { parseContextPoint, type ContextPoint } from './contextPosition';
import { canvasClickBox, coordinateOf, type CanvasClickBox } from '../../ui/canvasClickSlot';
import type { Box } from './outlineBoxes';
import type { MarginCollapse, Spacing } from './spacingBands';
import { boolean, count, dictionary, digest, list, optional, pathText, record, text } from '../../../shared/core/boundary';
import type { Digest } from '../../../shared/core/brand';
import { LIMITS } from '../../../shared/core/limits';
import { ITERATION_LIMITS, type PreviewIteration } from '../../../shared/page/previewIteration';
import { parseFrameRenderProblem, parsePreviewRender, type FrameRenderProblem, type PreviewRender } from '../../../shared/page/previewToken';
import type { PseudoLayer } from '../../../shared/page/pseudoPath';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../lib/i18n/localeContext';
import { GUIDE_LIMITS, parseGuideVariableName, type GuideMetrics } from './guideModel';
import { parseCanvasDragMessage, type CanvasDragMessage } from './canvasDragMessages';

export type PreviewMessage =
  | {
      readonly kind: 'rects';
      readonly rects: Readonly<Record<string, readonly Box[] | undefined>>;
      readonly classes: Readonly<Record<string, readonly (readonly string[])[]>>;
      readonly spacing: Readonly<Record<string, readonly (Spacing | undefined)[]>>;
    }
  | {
      readonly kind: 'node-classes';
      readonly classes: Readonly<Record<string, readonly string[]>>;
    }
  | { readonly kind: 'rendered-nodes'; readonly paths: readonly string[] }
  | {
      readonly kind: 'node-states';
      readonly hidden: readonly string[];
      readonly inert: readonly string[];
      readonly before: readonly string[];
      readonly after: readonly string[];
    }
  | { readonly kind: 'modifiers'; readonly shiftKey: boolean; readonly altKey: boolean }
  | ({
      readonly kind: 'hover-node';
      readonly pseudo: PseudoLayer | undefined;
      readonly deep: DeepHoverNode | undefined;
      readonly boxes: readonly Box[] | undefined;
    } & LocatedEvent)
  | ({
      readonly kind: 'click-node';
      readonly outside: boolean;
      readonly pseudo: PseudoLayer | undefined;
      readonly x: number | undefined;
      readonly y: number | undefined;
      readonly pressedAtMs: number | undefined;
      readonly box: CanvasClickBox | undefined;
      readonly replay: number | undefined;
      readonly boxes: readonly Box[] | undefined;
      readonly iterations: readonly PreviewIteration[] | undefined;
    } & LocatedEvent)
  | ({ readonly kind: 'open-node' } & LocatedEvent)
  | { readonly kind: 'image-close' }
  | ({ readonly kind: 'image-edit'; readonly paths: readonly string[]; readonly token: Digest | undefined } & ContextPoint)
  | ({ readonly kind: 'context-node'; readonly outside: boolean; readonly pseudo: PseudoLayer | undefined } & LocatedEvent & ContextPoint)
  | { readonly kind: 'canvas-ready' }
  | { readonly kind: 'guide'; readonly metrics: GuideMetrics }
  | { readonly kind: 'render'; readonly render: PreviewRender }
  | { readonly kind: 'render-problem'; readonly problem: FrameRenderProblem }
  | { readonly kind: 'preview-reload'; readonly reason: PreviewReloadReason }
  | { readonly kind: 'error-overlay'; readonly shown: boolean; readonly message: string | undefined }
  | { readonly kind: 'query-result'; readonly input: unknown }
  | { readonly kind: 'point-result'; readonly input: unknown }
  | {
      readonly kind: 'text-marks';
      readonly hover: TextMarkBox | undefined;
      readonly picked: TextMarkBox | undefined;
    }
  | { readonly kind: 'canvas-drag'; readonly drag: CanvasDragMessage };

export interface TextMarks {
  readonly hover: TextMarkBox | undefined;
  readonly picked: TextMarkBox | undefined;
}

export const NO_TEXT_MARKS: TextMarks = { hover: undefined, picked: undefined };

export interface TextMarkBox extends Box {
  readonly label: string;
  readonly kind: 'component' | 'text' | 'refused';
  readonly scope?: string;
  readonly owner: Ownership;
}

export const PREVIEW_RELOAD_REASONS = ['markers-over-cap', 'diff-over-cap', 'scripts-changed', 'patch-failed'] as const;
export type PreviewReloadReason = (typeof PREVIEW_RELOAD_REASONS)[number];

export function describePreviewReload(reason: PreviewReloadReason, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  switch (reason) {
    case 'markers-over-cap':
      return translate('preview.reload.markersOverCap');
    case 'diff-over-cap':
      return translate('preview.reload.diffOverCap');
    case 'scripts-changed':
    case 'patch-failed':
      return undefined;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export type ShortcutMessage =
  | { readonly name: 'insert' }
  | { readonly name: 'preview' }
  | { readonly name: 'pull' }
  | { readonly name: 'panel'; readonly code: string }
  | { readonly name: 'arrow'; readonly key: string }
  | { readonly name: 'key'; readonly key: string; readonly meta: boolean }
  | { readonly name: 'appCommand'; readonly shortcut: AppReservedShortcut };

const SHORTCUT_KEY_CHARS_MAX = 32;

function shortcutKey(input: unknown): string {
  if (typeof input === 'string') {
    if (input.length <= SHORTCUT_KEY_CHARS_MAX) {
      return input;
    }
    throw new Error('Shortcut key exceeds limit');
  }
  throw new Error('Expected shortcut key');
}

export function parseShortcutMessage(input: unknown): ShortcutMessage | undefined {
  try {
    const value = record(input);
    if (value['type'] !== 'avb:shortcut') {
      return undefined;
    }
    switch (value['name']) {
      case 'insert':
        return { name: 'insert' };
      case 'preview':
        return { name: 'preview' };
      case 'pull':
        return { name: 'pull' };
      case 'panel': {
        const code = shortcutKey(value['code']);
        return /^Key[A-Z]$/.test(code) ? { name: 'panel', code } : undefined;
      }
      case 'arrow':
        return { name: 'arrow', key: shortcutKey(value['key']) };
      case 'key':
        return { name: 'key', key: shortcutKey(value['key']), meta: value['meta'] === true };
      case 'appCommand': {
        const shortcut = shortcutKey(value['shortcut']);
        return isReservedShortcut(shortcut) ? { name: 'appCommand', shortcut } : undefined;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export interface LocatedEvent {
  readonly path: string | undefined;
  readonly occurrence: number;
  readonly token: Digest | undefined;
}

export function parsePreviewMessage(input: unknown): PreviewMessage | undefined {
  let value: Readonly<Record<string, unknown>>;
  try {
    value = record(input);
    return parseKnownMessage(value);
  } catch {
    return undefined;
  }
}

function parseKnownMessage(value: Readonly<Record<string, unknown>>): PreviewMessage | undefined {
  switch (value['type']) {
    case 'avb:rects':
      return parseRects(value);
    case 'avb:node-classes':
      return { kind: 'node-classes', classes: dictionary(list(pathText))(value['classes']) };
    case 'avb:rendered-nodes':
      return { kind: 'rendered-nodes', paths: list(pathText)(value['paths']) };
    case 'avb:node-states':
      return {
        kind: 'node-states',
        hidden: list(pathText)(value['hidden']),
        inert: list(pathText)(value['inert']),
        before: list(pathText)(value['before']),
        after: list(pathText)(value['after']),
      };
    case 'avb:modifiers':
      return {
        kind: 'modifiers',
        shiftKey: boolean(value['shiftKey']),
        altKey: boolean(value['altKey']),
      };
    case 'avb:hover-node':
      return {
        kind: 'hover-node',
        ...parseLocatedMessage(value),
        pseudo: parseLocatedPseudo(value),
        deep: parseDeepHoverNode(value['deep']),
        boxes: parseSentBoxes(value['boxes']),
      };
    case 'avb:click-node':
      return {
        kind: 'click-node',
        ...parseLocatedMessage(value),
        outside: boolean(value['outside']),
        pseudo: parseLocatedPseudo(value),
        x: coordinateOf(value['x']),
        y: coordinateOf(value['y']),
        pressedAtMs: pressStamp(value['pressedAtMs']),
        box: canvasClickBox(value['box']),
        replay: optional(parseReplayId)(value['replay']),
        boxes: parseSentBoxes(value['boxes']),
        iterations: parseIterations(value['iterations']),
      };
    case 'avb:context-node':
      return {
        kind: 'context-node',
        ...parseLocatedMessage(value),
        ...parseContextPoint(value),
        outside: boolean(value['outside']),
        pseudo: parseLocatedPseudo(value),
      };
    case 'avb:open-node':
      return { kind: 'open-node', ...parseLocatedMessage(value) };
    case 'avb:image-close':
      return { kind: 'image-close' };
    case 'avb:image-edit':
      return { kind: 'image-edit', paths: parseImagePaths(value['paths']), token: optional(digest)(value['token']), ...parseContextPoint(value) };
    case 'avb:canvas-ready':
      return { kind: 'canvas-ready' };
    case 'avb:guide':
      return { kind: 'guide', metrics: parseGuideMetrics(value) };
    case 'avb:render':
      return { kind: 'render', render: parsePreviewRender(value) };
    case 'avb:render-problem':
      return { kind: 'render-problem', problem: parseRenderProblem(value['problem']) };
    case 'avb:preview-reload':
      return { kind: 'preview-reload', reason: parseReloadReason(value['reason']) };
    case 'avb:error-overlay':
      return { kind: 'error-overlay', shown: boolean(value['shown']), message: optional(parseOverlayMessage)(value['message']) };
    case 'avb:query-result':
      return { kind: 'query-result', input: value };
    case 'avb:point-result':
      return { kind: 'point-result', input: value };
    case 'avb:text-marks':
      return {
        kind: 'text-marks',
        hover: optional(parseTextMarkBox)(value['hover']),
        picked: optional(parseTextMarkBox)(value['picked']),
      };
    case 'avb:drag-start':
    case 'avb:drag-over':
    case 'avb:drag-end':
    case 'avb:drag-cancel': {
      const drag = parseCanvasDragMessage(value);
      return drag === undefined ? undefined : { kind: 'canvas-drag', drag };
    }
    default:
      return undefined;
  }
}

function parseRects(value: Readonly<Record<string, unknown>>): PreviewMessage {
  return {
    kind: 'rects',
    rects: dictionary(optional(list(parseBox)))(value['rects']),
    classes: dictionary(list(list(pathText)))(value['classes']),
    spacing: dictionary(list(optional(parseSpacing)))(value['spacing']),
  };
}

function parseGuideMetrics(value: Readonly<Record<string, unknown>>): GuideMetrics {
  const rootFontPx = guideLength(value['rootFontSize']);
  if (rootFontPx === 0) {
    throw new Error('Preview guide: expected a positive root font size');
  }
  if (rootFontPx > GUIDE_LIMITS.rootFontPxMax) {
    throw new Error('Preview guide: root font size exceeds limit');
  }
  return {
    viewportWidthPx: guideLength(value['viewportWidth']),
    rootFontPx,
    marginPx: optional(guideLength)(value['margin']),
    gutterPx: optional(guideLength)(value['gutter']),
    widthMaxPx: optional(guideLength)(value['widthMax']),
    variablesPx: Object.fromEntries(guideVariableEntries(value['variables']).map(([name, px]) => [name, optional(guideLength)(px)])),
    variableCounts: Object.fromEntries(guideVariableEntries(value['counts']).map(([name, input]) => [name, declaredCount(input)])),
  };
}

function guideVariableEntries(input: unknown): ReadonlyArray<readonly [string, unknown]> {
  const entries = Object.entries(record(input));
  if (entries.length > GUIDE_LIMITS.variablesMax) {
    throw new Error('Preview guide: too many variables');
  }
  for (const [name] of entries) {
    if (parseGuideVariableName(name) === undefined) {
      throw new Error('Preview guide: not a variable name');
    }
  }
  return entries;
}

function guideLength(input: unknown): number {
  const value = nonnegativeFinite(input);
  if (value > GUIDE_LIMITS.lengthPxMax) {
    throw new Error('Preview guide: length exceeds limit');
  }
  return value;
}

function declaredCount(input: unknown): number | undefined {
  return optional(count)(input);
}

const REPLAY_ID_MAX = 2 ** 31;
function parseReplayId(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    throw new Error('Preview click: expected a replay id');
  }
  if (input < 1 || REPLAY_ID_MAX < input) {
    throw new Error('Preview click: replay id out of range');
  }
  return input;
}

function parseRenderProblem(input: unknown): FrameRenderProblem {
  const found = parseFrameRenderProblem(input);
  if (found === undefined) {
    throw new Error('Preview render problem: unknown value');
  }
  return found;
}

export const OVERLAY_MESSAGE_CHARS_MAX = 2_000;

function parseOverlayMessage(input: unknown): string {
  const message = text(input);
  if (message.length > OVERLAY_MESSAGE_CHARS_MAX) {
    throw new Error('Preview overlay: message exceeds limit');
  }
  return message;
}

function parseReloadReason(input: unknown): PreviewReloadReason {
  const found = PREVIEW_RELOAD_REASONS.find((reason) => reason === input);
  if (found === undefined) {
    throw new Error('Preview reload: unknown reason');
  }
  return found;
}

const IMAGE_PATHS_MAX = 128;
function parseImagePaths(input: unknown): readonly string[] {
  const paths = list(pathText)(input);
  if (paths.length > IMAGE_PATHS_MAX) {
    throw new Error('Preview image: too many marker paths');
  }
  return paths;
}

function parseLocatedMessage(value: Readonly<Record<string, unknown>>): LocatedEvent {
  return {
    path: optional(pathText)(value['path']),
    occurrence: count(value['occurrence']),
    token: optional(digest)(value['token']),
  };
}

function parseLocatedPseudo(value: Readonly<Record<string, unknown>>): PseudoLayer | undefined {
  const pseudo = value['pseudo'];
  if (pseudo === undefined) {
    return undefined;
  }
  if (pseudo !== 'before' && pseudo !== 'after') {
    throw new Error('Preview pseudo-element: expected before or after');
  }
  if (value['path'] === undefined) {
    throw new Error('Preview pseudo-element: expected the node it belongs to');
  }
  return pseudo;
}

function parseSentBoxes(input: unknown): readonly Box[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  try {
    return list(parseBox)(input);
  } catch {
    return undefined;
  }
}

function parseIterations(input: unknown): readonly PreviewIteration[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  try {
    const passes = list(parseIteration)(input);
    return passes.length > ITERATION_LIMITS.loopsMax ? undefined : passes;
  } catch {
    return undefined;
  }
}

function parseIteration(input: unknown): PreviewIteration {
  const value = record(input);
  const path = value['path'];
  const index = value['index'];
  if (typeof path !== 'string' || path.length === 0 || path.length > LIMITS.attrCharsMax) {
    throw new Error('Preview iteration: expected a path');
  }
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < -1) {
    throw new Error('Preview iteration: expected an item index or -1');
  }
  return { path, index };
}

function parseBox(input: unknown): Box {
  const value = record(input);
  const width = finite(value['w']);
  const height = finite(value['h']);
  if (width < 0 || height < 0) {
    throw new Error('Preview rectangle: expected nonnegative size');
  }
  const box = { x: finite(value['x']), y: finite(value['y']), w: width, h: height };
  return value['hidden'] === true ? { ...box, hidden: true } : box;
}

function pressStamp(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

function parseTextMarkBox(input: unknown): TextMarkBox {
  const value = record(input);
  const kind = value['kind'];
  if (kind !== 'component' && kind !== 'text' && kind !== 'refused') {
    throw new Error('Text mark: expected component, text or refused');
  }
  const owner = value['owner'];
  if (owner !== 'slot' && owner !== 'component') {
    throw new Error('Text mark: expected an owner, slot or component');
  }
  return {
    ...parseBox(value),
    label: pathText(value['label']),
    kind,
    ...(value['scope'] === undefined ? {} : { scope: pathText(value['scope']) }),
    owner,
  };
}

function parseSpacing(input: unknown): Spacing {
  const value = record(input);
  const padding = optional(parseSides(nonnegativeFinite))(value['padding']);
  const margin = optional(parseSides(finite))(value['margin']);
  const collapse = optional(parseCollapse)(value['collapse']);
  const gaps = optional(list(parseGap))(value['gaps']);
  const units = optional(dictionary(nonnegativeFinite))(value['units']);
  return {
    ...(padding === undefined ? {} : { padding }),
    ...(margin === undefined ? {} : { margin }),
    ...(collapse === undefined ? {} : { collapse }),
    ...(gaps === undefined ? {} : { gaps }),
    ...(units === undefined ? {} : { units }),
  };
}

function parseCollapse(input: unknown): NonNullable<Spacing['collapse']> {
  const value = record(input);
  const top = optional(parseMarginCollapse)(value['top']);
  const bottom = optional(parseMarginCollapse)(value['bottom']);
  return { ...(top === undefined ? {} : { top }), ...(bottom === undefined ? {} : { bottom }) };
}

function parseMarginCollapse(input: unknown): MarginCollapse {
  const value = record(input);
  const partner = value['partner'];
  if (partner !== 'previous' && partner !== 'next' && partner !== 'parent') {
    throw new Error('Preview margin collapse: unknown partner');
  }
  return { partner, margin: finite(value['margin']) };
}

function parseSides(side: (input: unknown) => number) {
  return (input: unknown) => {
    const value = record(input);
    return optionalFields({
      top: optional(side)(value['top']),
      right: optional(side)(value['right']),
      bottom: optional(side)(value['bottom']),
      left: optional(side)(value['left']),
    });
  };
}

function parseGap(input: unknown): Box & { readonly axis: 'row' | 'column' } {
  const value = record(input);
  const axis = value['axis'];
  if (axis !== 'row' && axis !== 'column') {
    throw new Error('Preview gap: unknown axis');
  }
  return { ...parseBox(value), axis };
}

function finite(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new Error('Preview measurement: expected finite number');
  }
  return input;
}

function nonnegativeFinite(input: unknown): number {
  const value = finite(input);
  if (value < 0) {
    throw new Error('Preview spacing: expected nonnegative number');
  }
  return value;
}

function optionalFields<Value extends Readonly<Record<string, unknown>>>(value: Value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
