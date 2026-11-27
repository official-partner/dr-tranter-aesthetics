import { digest, list, pathText, record, text } from '../core/boundary';
import { assert } from '../core/assert';

export interface CanvasTextTarget {
  readonly kind: 'element' | 'component';
  readonly key: string;
  readonly path: string;
  readonly parent: string;
  readonly value: string;
  readonly label: string;
  readonly nested: boolean;
  readonly tag: string;
  readonly siblings: readonly string[];
  readonly scope?: string;
  readonly from?: 'slot' | 'prop';
  readonly segment?: number;
  readonly literal?: true;
  readonly breaks?: CanvasTextBreaks;
  readonly richRoot?: string;
}

export type RichBlockChoice =
  | { readonly kind: 'block'; readonly block: RichBlockTag }
  | { readonly kind: 'list'; readonly list: 'ul' | 'ol' }
  | { readonly kind: 'rule' }
  | { readonly kind: 'link'; readonly href: string }
  | { readonly kind: 'media'; readonly media: 'image' | 'video'; readonly address: string };
export const RICH_BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'] as const;
export type RichBlockTag = (typeof RICH_BLOCK_TAGS)[number];
const RICH_ADDRESS_CHARS_MAX = 2_048;

export function parseRichBlockRequest(input: unknown): { readonly session: string; readonly choice: RichBlockChoice } | undefined {
  const data = record(input);
  if (data['type'] !== 'avb:rich-block') {
    return undefined;
  }
  return { session: pathText(data['session']), choice: parseRichChoice(record(data['choice'])) };
}

function parseRichChoice(data: Readonly<Record<string, unknown>>): RichBlockChoice {
  switch (data['kind']) {
    case 'block': {
      const block = RICH_BLOCK_TAGS.find((tag) => tag === data['block']);
      if (block === undefined) {
        throw new Error('Expected a rich text block tag');
      }
      return { kind: 'block', block };
    }
    case 'list':
      if (data['list'] !== 'ul' && data['list'] !== 'ol') {
        throw new Error('Expected a list kind');
      }
      return { kind: 'list', list: data['list'] };
    case 'rule':
      return { kind: 'rule' };
    case 'link':
      return { kind: 'link', href: richAddress(data['href']) };
    case 'media':
      if (data['media'] !== 'image' && data['media'] !== 'video') {
        throw new Error('Expected image or video');
      }
      return { kind: 'media', media: data['media'], address: richAddress(data['address']) };
    default:
      throw new Error('Expected a rich text choice');
  }
}

function richAddress(input: unknown): string {
  const value = text(input);
  if (value.length === 0 || value.length > RICH_ADDRESS_CHARS_MAX || /[\s<>"]/.test(value)) {
    throw new Error('Expected a bounded address without spaces or markup');
  }
  return value;
}

export const CANVAS_TEXT_BREAKS = ['line', 'rich'] as const;
export type CanvasTextBreaks = (typeof CANVAS_TEXT_BREAKS)[number];

export const CANVAS_LINE_END = '\u200B';

export function canvasTextWithoutLineEnds(value: string): string {
  const saved = value.replaceAll('\n' + CANVAS_LINE_END, '\n');
  assert(saved.length <= value.length, 'Removing line ends never adds characters');
  return saved;
}

export interface CanvasTextCatalog {
  readonly type: 'avb:text-catalog';
  readonly session: string;
  readonly file: string;
  readonly checksum: string;
  readonly targets: readonly CanvasTextTarget[];
  readonly boxes?: readonly string[];
  readonly blocked?: readonly CanvasTextBlocked[];
}

export interface CanvasTextBlocked {
  readonly key: string;
  readonly path: string;
  readonly scope?: string;
}

export interface CanvasTextRunValue {
  readonly key: string;
  readonly value: string;
}

export interface CanvasRichEditName {
  readonly id: string;
  readonly file: string;
  readonly root: string;
  readonly breaks: CanvasTextBreaks;
}

function parseRichEditName(input: unknown): CanvasRichEditName {
  const data = record(input);
  return { id: pathText(data['id']), file: pathText(data['file']), root: pathText(data['root']), breaks: parseBreaks(data['breaks']) };
}

export type CanvasTextEvent =
  | {
      readonly type: 'avb:text-save';
      readonly session: string;
      readonly key: string;
      readonly value: string;
      readonly also?: readonly CanvasTextRunValue[];
    }
  | {
      readonly type: 'avb:text-draft';
      readonly session: string;
      readonly key: string;
      readonly value: string;
    }
  | {
      readonly type: 'avb:rich-draft';
      readonly session: string;
      readonly key: string;
      readonly html: string;
      readonly caret: readonly number[];
      readonly edit: CanvasRichEditName;
    }
  | {
      readonly type: 'avb:rich-save';
      readonly session: string;
      readonly key: string;
      readonly html: string;
      readonly edit: CanvasRichEditName;
      readonly base: string;
    }
  | {
      readonly type: 'avb:rich-plus';
      readonly session: string;
      readonly rect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
    }
  | {
      readonly type: 'avb:text-refused';
      readonly message: string;
      readonly reason?: CanvasTextRefusal | undefined;
      readonly key?: string | undefined;
    };

export const CANVAS_TEXT_LIMIT = 10_000;
export const RICH_HTML_CHARS_MAX = 200_000;

function parseRichBox(data: Readonly<Record<string, unknown>>) {
  const read = (key: string) => {
    const value = data[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      throw new Error('Expected a finite box coordinate');
    }
    return value;
  };
  return { x: read('x'), y: read('y'), w: read('w'), h: read('h') };
}
export const CANVAS_TARGET_LIMIT = 2_000;
export const CANVAS_RUNS_SAVED_MAX = 100;
export const CANVAS_BLOCKED_LIMIT = 200;

export function canvasTextValue(input: unknown): string {
  const value = text(input);
  if (value.length > CANVAS_TEXT_LIMIT) {
    throw new Error('Canvas text exceeds limit');
  }
  return value;
}

export function parseCanvasTextCatalog(input: unknown): CanvasTextCatalog {
  const data = record(input);
  if (data['type'] !== 'avb:text-catalog') {
    throw new Error('Expected canvas text catalog');
  }
  const targets = list(parseTarget)(data['targets']);
  if (targets.length > CANVAS_TARGET_LIMIT) {
    throw new Error('Too many canvas text targets');
  }
  return {
    type: 'avb:text-catalog',
    session: pathText(data['session']),
    file: pathText(data['file']),
    checksum: digest(data['checksum']),
    targets,
    ...(data['boxes'] === undefined ? {} : { boxes: parseBoxes(data['boxes']) }),
    ...(data['blocked'] === undefined ? {} : { blocked: parseBlocked(data['blocked']) }),
  };
}

function parseBoxes(input: unknown): readonly string[] {
  const boxes = list(pathText)(input);
  if (boxes.length > CANVAS_BLOCKED_LIMIT) {
    throw new Error('Too many canvas rich text boxes');
  }
  return boxes;
}

function parseBlocked(input: unknown): readonly CanvasTextBlocked[] {
  const blocked = list((entry) => {
    const data = record(entry);
    return { key: pathText(data['key']), path: pathText(data['path']), ...(data['scope'] === undefined ? {} : { scope: pathText(data['scope']) }) };
  })(input);
  if (blocked.length > CANVAS_BLOCKED_LIMIT) {
    throw new Error('Too many blocked canvas texts');
  }
  return blocked;
}

function parseTarget(input: unknown): CanvasTextTarget {
  const data = record(input);
  if (data['kind'] !== 'element' && data['kind'] !== 'component') {
    throw new Error('Expected text container kind');
  }
  if (typeof data['nested'] !== 'boolean') {
    throw new Error('Expected nested text flag');
  }
  const siblings = list(pathText)(data['siblings']);
  if (siblings.length > 100) {
    throw new Error('Too many protected text siblings');
  }
  return {
    kind: data['kind'],
    tag: pathText(data['tag']),
    siblings,
    key: pathText(data['key']),
    path: pathText(data['path']),
    parent: pathText(data['parent']),
    value: canvasTextValue(data['value']),
    label: pathText(data['label']),
    nested: data['nested'],
    ...(data['scope'] === undefined ? {} : { scope: pathText(data['scope']) }),
    ...(data['from'] === undefined ? {} : { from: parseFrom(data['from']) }),
    ...(data['segment'] === undefined ? {} : { segment: parseSegment(data['segment']) }),
    ...(data['literal'] === undefined ? {} : { literal: parseLiteral(data['literal']) }),
    ...(data['breaks'] === undefined ? {} : { breaks: parseBreaks(data['breaks']) }),
    ...(data['richRoot'] === undefined ? {} : { richRoot: pathText(data['richRoot']) }),
  };
}

function parseBreaks(input: unknown): CanvasTextBreaks {
  const breaks = CANVAS_TEXT_BREAKS.find((value) => value === input);
  if (breaks === undefined) {
    throw new Error('Expected what Enter types in canvas text');
  }
  return breaks;
}

function parseLiteral(input: unknown): true {
  if (input !== true) {
    throw new Error('Expected literal canvas text to say so');
  }
  return input;
}

function parseFrom(input: unknown): 'slot' | 'prop' {
  if (input !== 'slot' && input !== 'prop') {
    throw new Error('Expected where canvas text comes from');
  }
  return input;
}

function parseSegment(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    throw new Error('Expected a text segment index');
  }
  if (input < 0 || input >= CANVAS_TEXT_LIMIT) {
    throw new Error('Text segment index out of range');
  }
  return input;
}

export function parseCanvasTextEvent(input: unknown): CanvasTextEvent | undefined {
  const data = record(input);
  switch (data['type']) {
    case 'avb:text-save':
      return {
        type: 'avb:text-save',
        session: pathText(data['session']),
        key: pathText(data['key']),
        value: canvasTextValue(data['value']),
        ...(data['also'] === undefined ? {} : { also: parseRunValues(data['also']) }),
      };
    case 'avb:text-draft':
      return {
        type: 'avb:text-draft',
        session: pathText(data['session']),
        key: pathText(data['key']),
        value: canvasTextValue(data['value']),
      };
    case 'avb:rich-save':
      return {
        type: 'avb:rich-save',
        session: pathText(data['session']),
        key: pathText(data['key']),
        html: richHTML(data['html']),
        edit: parseRichEditName(data['edit']),
        base: richHTML(data['base']),
      };
    case 'avb:rich-draft':
      return {
        type: 'avb:rich-draft',
        session: pathText(data['session']),
        key: pathText(data['key']),
        html: richHTML(data['html']),
        caret: richCaret(data['caret']),
        edit: parseRichEditName(data['edit']),
      };
    case 'avb:rich-plus':
      return {
        type: 'avb:rich-plus',
        session: pathText(data['session']),
        ...(data['rect'] === undefined ? {} : { rect: parseRichBox(record(data['rect'])) }),
      };
    case 'avb:text-refused':
      return {
        type: 'avb:text-refused',
        message: pathText(data['message']),
        reason: canvasTextRefusal(data['reason']),
        ...(data['key'] === undefined ? {} : { key: pathText(data['key']) }),
      };
    default:
      return undefined;
  }
}

function richHTML(input: unknown): string {
  const html = text(input);
  if (html.length > RICH_HTML_CHARS_MAX) {
    throw new Error('Canvas rich text exceeds limit');
  }
  return html;
}

const RICH_CARET_DEPTH_MAX = 2;

function richCaret(input: unknown): readonly number[] {
  const positions = list(parseSegment)(input);
  if (positions.length > RICH_CARET_DEPTH_MAX) {
    throw new Error('Canvas rich text caret exceeds limit');
  }
  return positions;
}

function parseRunValues(input: unknown): readonly CanvasTextRunValue[] {
  const values = list((entry) => {
    const data = record(entry);
    return { key: pathText(data['key']), value: canvasTextValue(data['value']) };
  })(input);
  if (values.length === 0 || values.length > CANVAS_RUNS_SAVED_MAX) {
    throw new Error('Expected a bounded list of canvas text runs');
  }
  return values;
}

const FOLDABLE = /[\t\r\n ]/;

export function canvasTextFolded(text: string, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) {
    throw new Error('Canvas text offset is outside its text');
  }
  let count = 0;
  let started = false;
  let inSpace = false;
  assert(offset <= text.length, 'A folded offset lies inside its text');
  for (let index = 0; index < offset; index += 1) {
    if (FOLDABLE.test(text.charAt(index))) {
      if (started && !inSpace) {
        count += 1;
      }
      inSpace = true;
    } else {
      started = true;
      inSpace = false;
      count += 1;
    }
  }
  assert(count <= offset, 'Folding never adds characters');
  return count;
}

export function canvasTextUnfolded(text: string, folded: number, edge: 'start' | 'end'): number | undefined {
  if (!Number.isSafeInteger(folded) || folded < 0) {
    throw new Error('Canvas text position must be a non-negative integer');
  }
  assert(text.length <= CANVAS_TEXT_LIMIT * 2, 'Unfolded text is within the editing bound');
  let count = 0;
  let started = false;
  let inSpace = false;
  for (let index = 0; index <= text.length; index += 1) {
    const shown = index < text.length && !FOLDABLE.test(text.charAt(index));
    if (count === folded) {
      if (edge === 'end' || shown || index === text.length) {
        return index;
      }
    }
    if (count > folded || index === text.length) {
      return undefined;
    }
    if (shown) {
      started = true;
      inSpace = false;
      count += 1;
    } else {
      if (started && !inSpace) {
        count += 1;
      }
      inSpace = true;
    }
  }
  return undefined;
}

export const CANVAS_TEXT_REFUSALS = ['waiting-render', 'selection-reaches', 'unsafe', 'page-changed', 'source-blocked'] as const;
export type CanvasTextRefusal = (typeof CANVAS_TEXT_REFUSALS)[number];

function canvasTextRefusal(input: unknown): CanvasTextRefusal | undefined {
  return CANVAS_TEXT_REFUSALS.find((reason) => reason === input);
}
