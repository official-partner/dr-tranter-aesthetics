import { assert } from '../../core/assert';
import { toArray, toRecord } from '../../core/record';
import { AI_LIMITS } from './aiLimits';
import { isProjectRelativePath } from './mentions';

export const PIN_LIMITS = {
  pinsMax: 40,
  commentCharsMax: 4_000,
  imagesPerPinMax: 4,
  boardImageCharsMax: AI_LIMITS.attachmentsImageCharsMax,
  pinsPerSendMax: AI_LIMITS.attachmentsMax,
  concurrencyMax: 4,
  labelCharsMax: 120,
  canvasPathCharsMax: 4_096,
  tagCharsMax: 120,
  textCharsMax: 80,
  occurrenceMax: 100_000,
  breakpointPxMax: 20_000,
  numberMax: 9_999,
  imageNameCharsMax: 200,
} as const satisfies Record<string, number>;

export const PIN_SEND_MODES = ['subagents', 'single'] as const;
export type PinSendMode = (typeof PIN_SEND_MODES)[number];


export interface PinBriefEntry {
  readonly number: number;
  readonly comment: string;
  readonly pageLabel: string;
  readonly page: string;
  readonly elementLabel: string;
  readonly file: string;
  readonly locator: string;
  readonly tag: string;
  readonly text: string | undefined;
  readonly componentFile: string | undefined;
  readonly breakpointPx: number | undefined;
  readonly images: readonly number[];
}

export interface PinBrief {
  readonly mode: PinSendMode;
  readonly pins: readonly PinBriefEntry[];
}

export interface SentPin {
  readonly number: number;
  readonly comment: string;
  readonly pageLabel: string;
  readonly elementLabel: string;
  readonly image: number | undefined;
}

export function parsePinBrief(input: unknown): PinBrief {
  const value = object(input, 'brief');
  const mode = oneOf(value['mode'], PIN_SEND_MODES, 'brief.mode');
  const pins = list(value['pins'], PIN_LIMITS.pinsPerSendMax, 'brief.pins').map(parseBriefEntry);
  if (pins.length === 0) {
    throw new Error('brief.pins: expected at least one pin');
  }
  if (mode === 'single' && pins.length !== 1) {
    throw new Error('brief.pins: a single send carries one pin');
  }
  if (new Set(pins.map((pin) => pin.number)).size !== pins.length) {
    throw new Error('brief.pins: repeated number');
  }
  const images = pins.flatMap((pin) => pin.images);
  if (new Set(images).size !== images.length) {
    throw new Error('brief.pins: an image belongs to one pin');
  }
  assert(
    images.every((index) => index < AI_LIMITS.attachmentsMax),
    'parsePinBrief: images index the attachments',
  );
  assert(pins.length <= PIN_LIMITS.pinsPerSendMax, 'parsePinBrief: a send is bounded');
  return { mode, pins };
}

function parseBriefEntry(input: unknown): PinBriefEntry {
  const value = object(input, 'brief.pin');
  const breakpoint = value['breakpointPx'];
  return {
    number: pinNumber(value['number']),
    comment: text(value['comment'], PIN_LIMITS.commentCharsMax, 'brief.pin.comment'),
    pageLabel: nonEmpty(value['pageLabel'], PIN_LIMITS.labelCharsMax, 'brief.pin.pageLabel'),
    page: projectFile(value['page'], 'brief.pin.page'),
    elementLabel: nonEmpty(value['elementLabel'], PIN_LIMITS.labelCharsMax, 'brief.pin.elementLabel'),
    file: projectFile(value['file'], 'brief.pin.file'),
    locator: locator(value['locator']),
    tag: nonEmpty(value['tag'], PIN_LIMITS.tagCharsMax, 'brief.pin.tag'),
    text: value['text'] === undefined ? undefined : text(value['text'], PIN_LIMITS.textCharsMax, 'brief.pin.text'),
    componentFile: value['componentFile'] === undefined ? undefined : projectFile(value['componentFile'], 'brief.pin.componentFile'),
    breakpointPx: breakpoint === undefined ? undefined : positive(breakpoint, PIN_LIMITS.breakpointPxMax, 'brief.pin.breakpointPx'),
    images: list(value['images'], PIN_LIMITS.imagesPerPinMax, 'brief.pin.images').map((index) =>
      bounded(count(index, 'brief.pin.image'), AI_LIMITS.attachmentsMax - 1, 'brief.pin.image'),
    ),
  };
}

export function sentPinsOf(brief: PinBrief): readonly SentPin[] {
  const sent = brief.pins.map((pin) => ({
    number: pin.number,
    comment: pin.comment,
    pageLabel: pin.pageLabel,
    elementLabel: pin.elementLabel,
    image: pin.images[0],
  }));
  assert(sent.length === brief.pins.length, 'sentPinsOf: one sent pin per pin');
  return sent;
}

export function parseSentPins(input: unknown): readonly SentPin[] {
  const pins = list(input, PIN_LIMITS.pinsPerSendMax, 'sentPins').map((entry) => {
    const value = object(entry, 'sentPin');
    const image = value['image'];
    return {
      number: pinNumber(value['number']),
      comment: text(value['comment'], PIN_LIMITS.commentCharsMax, 'sentPin.comment'),
      pageLabel: nonEmpty(value['pageLabel'], PIN_LIMITS.labelCharsMax, 'sentPin.pageLabel'),
      elementLabel: nonEmpty(value['elementLabel'], PIN_LIMITS.labelCharsMax, 'sentPin.elementLabel'),
      image: image === undefined ? undefined : bounded(count(image, 'sentPin.image'), AI_LIMITS.attachmentsMax - 1, 'sentPin.image'),
    };
  });
  if (pins.length === 0) {
    throw new Error('sentPins: expected at least one pin');
  }
  assert(pins.length <= PIN_LIMITS.pinsPerSendMax, 'parseSentPins: a send is bounded');
  return pins;
}


export interface PinWork {
  readonly number: number;
  readonly files: readonly string[];
}

export function pinWaves(work: readonly PinWork[], concurrencyMax: number = PIN_LIMITS.concurrencyMax): readonly (readonly number[])[] {
  assert(concurrencyMax >= 1, 'pinWaves: at least one pin runs at a time');
  assert(work.length <= PIN_LIMITS.pinsPerSendMax, 'pinWaves: a send is bounded');
  const ordered = [...work].sort((left, right) => left.number - right.number);
  const waves: number[][] = [];
  const lastWaveOf = new Map<string, number>();
  for (const pin of ordered) {
    let wave = 0;
    for (const file of pin.files) {
      const last = lastWaveOf.get(file);
      if (last !== undefined) {
        wave = Math.max(wave, last + 1);
      }
    }
    while (wave < waves.length && (waves[wave]?.length ?? 0) >= concurrencyMax) {
      wave += 1;
    }
    const target = waves[wave] ?? [];
    target.push(pin.number);
    waves[wave] = target;
    for (const file of pin.files) {
      lastWaveOf.set(file, wave);
    }
  }
  assert(waves.reduce((sum, wave) => sum + wave.length, 0) === work.length, 'pinWaves: every pin runs once');
  assert(
    waves.every((wave) => wave.length >= 1),
    'pinWaves: no wave is empty',
  );
  return waves;
}

export function pinFiles(pin: Pick<PinBriefEntry, 'file' | 'componentFile'>): readonly string[] {
  const files = pin.componentFile === undefined || pin.componentFile === pin.file ? [pin.file] : [pin.file, pin.componentFile];
  assert(new Set(files).size === files.length, 'pinFiles: each file is named once');
  return files;
}

export function pinImageNote(
  pin: Pick<PinBriefEntry, 'number' | 'breakpointPx'>,
  image: { readonly position: number; readonly kind: 'crop' | 'added' },
): string {
  assert(image.position >= 1, 'pinImageNote: images count from one');
  const what = image.kind === 'crop' ? 'the pinned area as the canvas showed it' : 'an image the person added';
  const width = pin.breakpointPx === undefined ? '' : `, canvas ${pin.breakpointPx}px wide`;
  return `Pin ${pin.number}, image ${image.position}: ${what}${width}`;
}

export function pinNumberOfTitle(title: string): number | undefined {
  const match = /^\s*\**\s*pin\s*#?\s*(\d{1,4})\b/iu.exec(title);
  if (match === null) {
    return undefined;
  }
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number >= 1 && number <= PIN_LIMITS.numberMax ? number : undefined;
}

export function withoutPinNumber(title: string): string {
  const match = /^\s*\**\s*pin\s*#?\s*\d{1,4}\s*\**\s*[:.\-–—]\s*/iu.exec(title);
  if (match === null) {
    return title;
  }
  const rest = title.slice(match[0].length).trim();
  return rest === '' ? title : rest;
}


function pinNumber(input: unknown): number {
  const value = count(input, 'pin.number');
  if (value < 1 || value > PIN_LIMITS.numberMax) {
    throw new Error('pin.number: out of range');
  }
  return value;
}

function object(input: unknown, name: string): Record<string, unknown> {
  const value = toRecord(input);
  if (value === undefined) {
    throw new Error(`${name}: expected object`);
  }
  return value;
}

function list(input: unknown, max: number, name: string): readonly unknown[] {
  const values = toArray(input);
  if (values === undefined) {
    throw new Error(`${name}: expected array`);
  }
  if (values.length > max) {
    throw new Error(`${name}: exceeds limit`);
  }
  return values;
}

function text(input: unknown, max: number, name: string): string {
  if (typeof input !== 'string') {
    throw new Error(`${name}: expected string`);
  }
  if (input.length > max) {
    throw new Error(`${name}: exceeds limit`);
  }
  return input;
}

function nonEmpty(input: unknown, max: number, name: string): string {
  const value = text(input, max, name);
  if (value.trim().length === 0) {
    throw new Error(`${name}: expected non-empty text`);
  }
  return value;
}

function projectFile(input: unknown, name: string): string {
  const value = text(input, PIN_LIMITS.canvasPathCharsMax, name);
  if (!isProjectRelativePath(value)) {
    throw new Error(`${name}: expected a project-relative path`);
  }
  return value;
}

function locator(input: unknown): string {
  const value = text(input, PIN_LIMITS.canvasPathCharsMax, 'locator');
  if (!/^\d+(?:\.\d+)*$/u.test(value)) {
    throw new Error('locator: expected child indexes');
  }
  return value;
}

function count(input: unknown, name: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new Error(`${name}: expected nonnegative integer`);
  }
  return input;
}

function bounded(value: number, max: number, name: string): number {
  if (value > max) {
    throw new Error(`${name}: exceeds limit`);
  }
  return value;
}

function positive(input: unknown, max: number, name: string): number {
  const value = bounded(count(input, name), max, name);
  if (value === 0) {
    throw new Error(`${name}: expected a positive width`);
  }
  return value;
}

function oneOf<T extends string>(input: unknown, allowed: readonly T[], name: string): T {
  const found = allowed.find((candidate) => candidate === input);
  if (found === undefined) {
    throw new Error(`${name}: unknown value`);
  }
  return found;
}
