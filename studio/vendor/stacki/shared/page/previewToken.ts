import { assert } from '../core/assert';
import { toDigest, type Digest } from '../core/brand';
import { LIMITS } from '../core/limits';
import { err, ok, type Result } from '../core/result';

export const PREVIEW_STAMP_PREFIX = 'avb-d:';
export const PREVIEW_STAMP_ATTRIBUTE = 'data-avb-d';

export const PREVIEW_UNMARKED_ATTRIBUTE = 'data-stacki-unmarked';

export interface PreviewStamp {
  readonly file: string;
  readonly checksum: Digest;
}

export interface PreviewRender {
  readonly token: Digest;
  readonly stamps: readonly PreviewStamp[];
}

export const PREVIEW_STALE_REASONS = [
  'no-render',
  'superseded',
  'token-mismatch',
  'file-changed',
  'file-missing',
  'unstamped-file',
  'shown-page-differs',
] as const;

export type PreviewStaleReason = (typeof PREVIEW_STALE_REASONS)[number];

export const FRAME_RENDER_PROBLEMS = [
  'conflicting-stamps',
  'too-many-stamps',
  'page-too-large',
  'no-digest',
] as const;

export type FrameRenderProblem = (typeof FRAME_RENDER_PROBLEMS)[number];

export function parseFrameRenderProblem(input: unknown): FrameRenderProblem | undefined {
  return FRAME_RENDER_PROBLEMS.find((known) => known === input);
}

export type StampedFileState = { readonly tag: 'present'; readonly checksum: Digest } | { readonly tag: 'missing' };

export type PreviewVerdict =
  | { readonly tag: 'current' }
  | {
      readonly tag: 'stale';
      readonly reason: PreviewStaleReason;
      readonly file: string | undefined;
    };

export function stampPathProblem(file: string): string | undefined {
  if (file.length === 0) {
    return 'empty';
  }
  if (LIMITS.ipcPathCharsMax < file.length) {
    return 'too long';
  }
  if (/[\0\\\r\n]/.test(file) || file.includes('-->')) {
    return 'forbidden character';
  }
  if (file.startsWith('/') || /^[A-Za-z]:/.test(file)) {
    return 'absolute';
  }
  if (file.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    return 'not normalized';
  }
  return undefined;
}

export function stampData(stamp: PreviewStamp): string {
  const problem = stampPathProblem(stamp.file);
  assert(problem === undefined, `A stamped path is a project-relative path (${problem})`);
  return `${PREVIEW_STAMP_PREFIX}${stamp.checksum}:${stamp.file}`;
}

export function stampComment(stamp: PreviewStamp): string {
  return `<!--${stampData(stamp)}-->`;
}

export function parseStampData(data: string): PreviewStamp | undefined {
  if (!data.startsWith(PREVIEW_STAMP_PREFIX)) {
    return undefined;
  }
  const rest = data.slice(PREVIEW_STAMP_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon !== 64) {
    return undefined;
  }
  const checksum = rest.slice(0, colon);
  const file = rest.slice(colon + 1);
  if (!/^[0-9a-f]{64}$/.test(checksum)) {
    return undefined;
  }
  if (stampPathProblem(file) !== undefined) {
    return undefined;
  }
  return { file, checksum: toDigest(checksum) };
}

export type ManifestProblem = 'conflicting-stamps';

export function manifestOf(stamps: readonly PreviewStamp[]): Result<readonly PreviewStamp[], ManifestProblem> {
  const byFile = new Map<string, Digest>();
  for (const stamp of stamps) {
    const seen = byFile.get(stamp.file);
    if (seen === undefined) {
      byFile.set(stamp.file, stamp.checksum);
    } else if (seen !== stamp.checksum) {
      return err('conflicting-stamps');
    }
  }
  const files = [...byFile.keys()].sort(compareCodeUnits);
  const manifest = files.map((file) => {
    const checksum = byFile.get(file);
    assert(checksum !== undefined, 'A sorted file came from the map');
    return { file, checksum };
  });
  assert(manifest.length === byFile.size, 'One manifest entry per stamped file');
  return ok(manifest);
}

export function canonicalManifest(stamps: readonly PreviewStamp[]): string {
  assert(manifestSorted(stamps), 'A canonical manifest is sorted with one entry per file');
  return stamps.map((stamp) => `${stamp.checksum} ${stamp.file}\n`).join('');
}

export function parsePreviewRender(input: unknown): PreviewRender {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('PreviewRender: expected object');
  }
  const token = 'token' in input ? input.token : undefined;
  const stamps = 'stamps' in input ? input.stamps : undefined;
  if (typeof token !== 'string') {
    throw new Error('PreviewRender.token: expected digest');
  }
  if (!Array.isArray(stamps)) {
    throw new Error('PreviewRender.stamps: expected list');
  }
  const parsed = stamps.map(parseStamp);
  if (!manifestSorted(parsed)) {
    throw new Error('PreviewRender.stamps: expected sorted, one per file');
  }
  return { token: toDigest(token), stamps: parsed };
}

export function judgeEventToken(eventToken: Digest | undefined, render: PreviewRender | undefined): PreviewVerdict {
  if (render === undefined) {
    return stale('no-render', undefined);
  }
  if (eventToken === undefined) {
    return stale('no-render', undefined);
  }
  return eventToken === render.token ? CURRENT : stale('superseded', undefined);
}

export function judgeShownFile(render: PreviewRender, file: string, shown: Digest | undefined): PreviewVerdict {
  const stamp = render.stamps.find((entry) => entry.file === file);
  if (stamp === undefined) {
    return stale('unstamped-file', file);
  }
  if (shown === undefined) {
    return stale('shown-page-differs', file);
  }
  return stamp.checksum === shown ? CURRENT : stale('shown-page-differs', file);
}

export function judgePreviewRender(
  render: PreviewRender,
  current: ReadonlyMap<string, StampedFileState>,
  tokenOf: (canonical: string) => Digest,
): PreviewVerdict {
  if (tokenOf(canonicalManifest(render.stamps)) !== render.token) {
    return stale('token-mismatch', undefined);
  }
  for (const stamp of render.stamps) {
    const now = current.get(stamp.file);
    assert(now !== undefined, 'Main read every stamped file');
    switch (now.tag) {
      case 'present':
        if (now.checksum !== stamp.checksum) {
          return stale('file-changed', stamp.file);
        }
        break;
      case 'missing':
        return stale('file-missing', stamp.file);
      default: {
        const exhaustive: never = now;
        return exhaustive;
      }
    }
  }
  return CURRENT;
}

export function parsePreviewVerdict(input: unknown): PreviewVerdict {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('PreviewVerdict: expected object');
  }
  const tag = 'tag' in input ? input.tag : undefined;
  if (tag === 'current') {
    return CURRENT;
  }
  if (tag !== 'stale') {
    throw new Error('PreviewVerdict.tag: unknown value');
  }
  const reason = 'reason' in input ? input.reason : undefined;
  const found = PREVIEW_STALE_REASONS.find((known) => known === reason);
  if (found === undefined) {
    throw new Error('PreviewVerdict.reason: unknown value');
  }
  const file = 'file' in input ? input.file : undefined;
  if (file === undefined) {
    return stale(found, undefined);
  }
  if (typeof file !== 'string' || stampPathProblem(file) !== undefined) {
    throw new Error('PreviewVerdict.file: expected a project-relative path');
  }
  return stale(found, file);
}

export function describePreviewStale(reason: PreviewStaleReason): string {
  switch (reason) {
    case 'no-render':
      return 'The canvas is still loading.';
    case 'superseded':
      return 'The canvas changed under the click.';
    case 'token-mismatch':
      return 'The canvas sent a rendering it could not vouch for.';
    case 'file-changed':
      return 'A file on this page changed since the canvas rendered it.';
    case 'file-missing':
      return 'A file on this page is gone since the canvas rendered it.';
    case 'unstamped-file':
      return 'The canvas does not show the file open for editing.';
    case 'shown-page-differs':
      return 'The canvas has not caught up with your latest edit.';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}


const CURRENT: PreviewVerdict = { tag: 'current' };

function stale(reason: PreviewStaleReason, file: string | undefined): PreviewVerdict {
  return { tag: 'stale', reason, file };
}

function parseStamp(input: unknown): PreviewStamp {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('PreviewStamp: expected object');
  }
  const file = 'file' in input ? input.file : undefined;
  const checksum = 'checksum' in input ? input.checksum : undefined;
  if (typeof file !== 'string') {
    throw new Error('PreviewStamp.file: expected string');
  }
  const problem = stampPathProblem(file);
  if (problem !== undefined) {
    throw new Error(`PreviewStamp.file: ${problem}`);
  }
  if (typeof checksum !== 'string') {
    throw new Error('PreviewStamp.checksum: expected digest');
  }
  return { file, checksum: toDigest(checksum) };
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left === right ? 0 : 1;
}

function manifestSorted(stamps: readonly PreviewStamp[]): boolean {
  for (let index = 1; index < stamps.length; index++) {
    const previous = stamps[index - 1];
    const stamp = stamps[index];
    assert(previous !== undefined, 'The previous index lies inside the list');
    assert(stamp !== undefined, 'The index lies inside the list');
    if (compareCodeUnits(previous.file, stamp.file) >= 0) {
      return false;
    }
  }
  return true;
}
