
import { assert } from '../core/assert';

export const PREVIEW_SNAPSHOT_LIMITS = {
  attemptsMax: 4,
  htmlCharsMax: 3_000_000,
  boxPixelsMax: 100_000,
  keyChars: 28,
  reasonCharsMax: 500,
} as const;

export const PREVIEW_ATTEMPT_LABELS = ['authored', 'sample', 'sample-minimal', 'sample-bare'] as const;
export type PreviewAttemptLabel = (typeof PREVIEW_ATTEMPT_LABELS)[number];

export function hashText(text: string): string {
  assert(typeof text === 'string', 'hashText: expected a string');
  const first = cyrb53(text, 0x9e3779b9);
  const second = cyrb53(text, 0x85ebca6b);
  const result = first.toString(16).padStart(14, '0') + second.toString(16).padStart(14, '0');
  assert(result.length === PREVIEW_SNAPSHOT_LIMITS.keyChars, 'hashText: a hash is a fixed width');
  return result;
}

function cyrb53(text: string, seed: number): number {
  let high = 0xdeadbeef ^ seed;
  let low = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    high = Math.imul(high ^ code, 2654435761);
    low = Math.imul(low ^ code, 1597334677);
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
  return 4294967296 * (2097151 & low) + (high >>> 0);
}

export const PREVIEW_SNAPSHOT_VERSION = 'snapshot-1';

export interface SnapshotKeyParts {
  readonly source: string;
  readonly dependencies: readonly string[];
  readonly styles: string;
  readonly inputs: string;
  readonly theme: string;
}

export function snapshotKey(parts: SnapshotKeyParts): string {
  assert(parts.dependencies.length <= 4096, 'snapshotKey: dependencies are bounded');
  const key = hashText(
    [
      PREVIEW_SNAPSHOT_VERSION,
      hashText(parts.source),
      hashText(parts.dependencies.map((dependency) => `${dependency.length}:${hashText(dependency)}`).join('|')),
      hashText(parts.styles),
      hashText(parts.inputs),
      hashText(parts.theme),
    ].join('/'),
  );
  assert(isSnapshotKey(key), 'snapshotKey: a key is well formed');
  return key;
}

export function isSnapshotKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{28}$/.test(value);
}

export function previewRendersOnlyName(markup: string, name: string): boolean {
  if (typeof markup !== 'string' || typeof name !== 'string') {
    throw new Error('previewRendersOnlyName: expected strings');
  }
  const body = markup.replace(/<(script|style|template|noscript)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<(img|svg|video|canvas|picture|iframe|object|embed|input|textarea|select|hr)\b/i.test(body)) {
    return false;
  }
  const text = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[#\w]+;/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (text === '') {
    return false;
  }
  return text === name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function previewRendersNoContent(markup: string): boolean {
  if (typeof markup !== 'string') {
    throw new Error('previewRendersNoContent: expected a string');
  }
  const body = markup.replace(/<(script|style|template|noscript)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<(img|svg|video|canvas|picture|iframe|object|embed|input|textarea|select|hr)\b/i.test(body)) {
    return false;
  }
  return (
    body
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[#\w]+;/g, ' ')
      .trim() === ''
  );
}

export interface PreviewSnapshotMessage {
  readonly key: string;
  readonly html: string;
  readonly box: SnapshotBox;
  readonly attempt: PreviewAttemptLabel;
}

export interface SnapshotBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PreviewUnchangedMessage {
  readonly key: string;
}

export function parsePreviewSnapshotMessage(input: unknown): PreviewSnapshotMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('type' in input) || input.type !== 'avb:component-preview-snapshot') {
    return undefined;
  }
  const key = 'key' in input ? input.key : undefined;
  const html = 'html' in input ? input.html : undefined;
  const box = 'box' in input ? parseBox(input.box) : undefined;
  const attempt = 'attempt' in input ? parseAttempt(input.attempt) : undefined;
  if (!isSnapshotKey(key) || typeof html !== 'string' || box === undefined || attempt === undefined) {
    return undefined;
  }
  if (html.length === 0 || html.length > PREVIEW_SNAPSHOT_LIMITS.htmlCharsMax) {
    return undefined;
  }
  return { key, html, box, attempt };
}

export function parsePreviewUnchangedMessage(input: unknown): PreviewUnchangedMessage | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (!('type' in input) || input.type !== 'avb:component-preview-unchanged') {
    return undefined;
  }
  const key = 'key' in input ? input.key : undefined;
  return isSnapshotKey(key) ? { key } : undefined;
}

function parseAttempt(input: unknown): PreviewAttemptLabel | undefined {
  return PREVIEW_ATTEMPT_LABELS.find((label) => label === input);
}

function parseBox(input: unknown): SnapshotBox | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const left = 'left' in input ? input.left : undefined;
  const top = 'top' in input ? input.top : undefined;
  const width = 'width' in input ? input.width : undefined;
  const height = 'height' in input ? input.height : undefined;
  if (typeof left !== 'number' || typeof top !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
    return undefined;
  }
  const max = PREVIEW_SNAPSHOT_LIMITS.boxPixelsMax;
  const finite = [left, top, width, height].every((value) => Number.isFinite(value) && Math.abs(value) <= max);
  if (!finite || width < 1 || height < 1) {
    return undefined;
  }
  return { left, top, width, height };
}

export const SNAPSHOT_TILE_PADDING = 12;

export interface SnapshotFit {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export function fitSnapshot(box: SnapshotBox, tile: { readonly width: number; readonly height: number }): SnapshotFit {
  assert(box.width >= 1, 'fitSnapshot: the box has width');
  assert(box.height >= 1, 'fitSnapshot: the box has height');
  const availableWidth = Math.max(1, tile.width - SNAPSHOT_TILE_PADDING * 2);
  const availableHeight = Math.max(1, tile.height - SNAPSHOT_TILE_PADDING * 2);
  const scale = Math.min(1, availableWidth / box.width, availableHeight / box.height);
  const x = SNAPSHOT_TILE_PADDING + (availableWidth - box.width * scale) / 2;
  const y = SNAPSHOT_TILE_PADDING + (availableHeight - box.height * scale) / 2;
  assert(scale > 0, 'fitSnapshot: the scale is positive');
  assert(scale <= 1, 'fitSnapshot: a snapshot is never enlarged');
  return { scale, x, y };
}
