import { assert } from '../core/assert';
import { boolean, count, list, pathText, record, text } from '../core/boundary';
import { err, ok, type Result } from '../core/result';
import { PACKAGE_MANAGERS, type PackageManager } from '../properties/packageManager';

export const ASTRO_COPY_LIMITS = {
  nameBytesMax: 255,
  reportPathsMax: 50,
} as const satisfies Record<string, number>;

export const ASTRO_COPY_SUFFIX = '-astro';

export const ASTRO_COPY_TARGET_PROBLEMS = [
  'name-empty',
  'name-invalid',
  'target-exists',
  'location-missing',
  'location-unwritable',
  'inside-original',
] as const;
export type AstroCopyTargetProblem = (typeof ASTRO_COPY_TARGET_PROBLEMS)[number];

export type AstroCopyFailure =
  | { readonly code: AstroCopyTargetProblem }
  | { readonly code: 'not-plain-website' }
  | { readonly code: 'too-many-files'; readonly limit: number }
  | { readonly code: 'too-many-bytes'; readonly limit: number }
  | { readonly code: 'file-too-large'; readonly limit: number; readonly file: string }
  | { readonly code: 'package-manager-missing'; readonly manager: PackageManager }
  | { readonly code: 'copy-failed'; readonly detail: string };

export interface AstroCopyRequest {
  readonly sourcePath: string;
  readonly parentPath: string;
  readonly name: string;
}

export type SiteFolderChoice =
  | { readonly kind: 'canceled' }
  | { readonly kind: 'astro'; readonly projectPath: string }
  | {
      readonly kind: 'plainWebsite';
      readonly sourcePath: string;
      readonly parentPath: string;
      readonly name: string;
      readonly homePath: string;
    }
  | { readonly kind: 'notWebsite'; readonly folderPath: string };

export type AstroCopyCheck = Result<{ readonly targetPath: string }, AstroCopyTargetProblem>;

export type AstroCopyInstall = { readonly kind: 'done' } | { readonly kind: 'failed'; readonly detail: string };

export interface AstroCopyCreated {
  readonly projectPath: string;
  readonly pageCount: number;
  readonly assetCount: number;
  readonly keptAsFiles: readonly string[];
  readonly keptAsFilesCount: number;
  readonly skippedCount: number;
  readonly install: AstroCopyInstall;
}

export type AstroCopyReply = Result<AstroCopyCreated, AstroCopyFailure>;

const NAME_FORBIDDEN = /[/\\<>:"|?*\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const UTF8 = new TextEncoder();

export function astroCopyNameProblem(name: string): 'name-empty' | 'name-invalid' | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'name-empty';
  }
  if (trimmed !== name) {
    return 'name-invalid';
  }
  if (NAME_FORBIDDEN.test(name)) {
    return 'name-invalid';
  }
  if (name.startsWith('.') || name.endsWith('.')) {
    return 'name-invalid';
  }
  if (WINDOWS_RESERVED.test(name)) {
    return 'name-invalid';
  }
  if (UTF8.encode(name).length > ASTRO_COPY_LIMITS.nameBytesMax) {
    return 'name-invalid';
  }
  return undefined;
}

export function defaultAstroCopyName(folderName: string): string {
  assert(folderName.length > 0, 'defaultAstroCopyName: the folder has a name');
  const characters = [...folderName];
  const suffixBytes = UTF8.encode(ASTRO_COPY_SUFFIX).length;
  let stem = '';
  for (const character of characters) {
    if (UTF8.encode(stem + character).length + suffixBytes > ASTRO_COPY_LIMITS.nameBytesMax) {
      break;
    }
    stem += character;
  }
  const name = stem + ASTRO_COPY_SUFFIX;
  assert(UTF8.encode(name).length <= ASTRO_COPY_LIMITS.nameBytesMax, 'defaultAstroCopyName: the name fits');
  assert(name.endsWith(ASTRO_COPY_SUFFIX), 'defaultAstroCopyName: the suffix is kept');
  return name;
}

export function shortenLocation(location: string, homePath: string, segmentsMax = 3): string {
  assert(segmentsMax > 0, 'shortenLocation: at least one folder is shown');
  const separator = location.includes('\\') && !location.includes('/') ? '\\' : '/';
  let shown = location;
  let prefix = '';
  if (homePath.length > 0 && (location === homePath || location.startsWith(homePath + separator))) {
    shown = location.slice(homePath.length);
    prefix = '~';
  }
  const segments = shown.split(separator).filter((segment) => segment.length > 0);
  if (segments.length <= segmentsMax) {
    return prefix === '' ? location : prefix + shown;
  }
  return `…${separator}${segments.slice(-segmentsMax).join(separator)}`;
}

export function parseAbsolutePath(input: unknown): string {
  const value = pathText(input);
  const windowsDrive = /^[A-Za-z]:[\\/]/.test(value);
  const unc = value.startsWith('\\\\');
  if (!value.startsWith('/') && !windowsDrive && !unc) {
    throw new Error('Path: expected an absolute path');
  }
  const rest = unc ? value.slice(2) : windowsDrive ? value.slice(3) : value.slice(1);
  if (rest.length === 0) {
    if (unc) {
      throw new Error('Path: expected a server and share');
    }
    return value;
  }
  const segments = rest.split(/[\\/]/);
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error('Path: expected a normalized path');
    }
    if (segment === '.' || segment === '..') {
      throw new Error('Path: expected no . or .. folders');
    }
  }
  return value;
}

export function parseAstroCopyName(input: unknown): string {
  const value = text(input);
  if (value.length > ASTRO_COPY_LIMITS.nameBytesMax * 4) {
    throw new Error('Name: exceeds limit');
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error('Name: expected a folder name, not a path');
  }
  return value;
}

export function parseAstroCopyRequest(input: unknown): AstroCopyRequest {
  const fields = record(input);
  return {
    sourcePath: parseAbsolutePath(fields['sourcePath']),
    parentPath: parseAbsolutePath(fields['parentPath']),
    name: parseAstroCopyName(fields['name']),
  };
}

export function parseSiteFolderChoice(input: unknown): SiteFolderChoice {
  const fields = record(input);
  const kind = fields['kind'];
  switch (kind) {
    case 'canceled':
      return { kind };
    case 'astro':
      return { kind, projectPath: parseAbsolutePath(fields['projectPath']) };
    case 'plainWebsite': {
      const name = parseAstroCopyName(fields['name']);
      const homePath = pathText(fields['homePath']);
      return { kind, sourcePath: parseAbsolutePath(fields['sourcePath']), parentPath: parseAbsolutePath(fields['parentPath']), name, homePath };
    }
    case 'notWebsite':
      return { kind, folderPath: parseAbsolutePath(fields['folderPath']) };
    default:
      throw new Error('SiteFolderChoice.kind: unknown value');
  }
}

export function parseAstroCopyTargetProblem(input: unknown): AstroCopyTargetProblem {
  const problem = ASTRO_COPY_TARGET_PROBLEMS.find((known) => known === input);
  if (problem === undefined) {
    throw new Error('AstroCopy problem: unknown value');
  }
  return problem;
}

export function parseAstroCopyCheck(input: unknown): AstroCopyCheck {
  const fields = record(input);
  if (fields['ok'] === true) {
    const value = record(fields['value']);
    return ok({ targetPath: parseAbsolutePath(value['targetPath']) });
  }
  if (fields['ok'] !== false) {
    throw new Error('AstroCopyCheck.ok: expected a boolean');
  }
  return err(parseAstroCopyTargetProblem(fields['error']));
}

export function parseAstroCopyFailure(input: unknown): AstroCopyFailure {
  const fields = record(input);
  const code = fields['code'];
  switch (code) {
    case 'not-plain-website':
      return { code };
    case 'too-many-files':
    case 'too-many-bytes':
      return { code, limit: count(fields['limit']) };
    case 'file-too-large':
      return { code, limit: count(fields['limit']), file: pathText(fields['file']) };
    case 'package-manager-missing': {
      const manager = PACKAGE_MANAGERS.find((known) => known === fields['manager']);
      if (manager === undefined) {
        throw new Error('AstroCopyFailure.manager: unknown value');
      }
      return { code, manager };
    }
    case 'copy-failed':
      return { code, detail: text(fields['detail']) };
    default:
      return { code: parseAstroCopyTargetProblem(code) };
  }
}

function parseReportPaths(input: unknown): readonly string[] {
  const paths = list(pathText)(input);
  if (paths.length > ASTRO_COPY_LIMITS.reportPathsMax) {
    throw new Error('AstroCopyCreated: too many listed paths');
  }
  return paths;
}

function parseAstroCopyInstall(input: unknown): AstroCopyInstall {
  const fields = record(input);
  if (fields['kind'] === 'done') {
    return { kind: 'done' };
  }
  if (fields['kind'] === 'failed') {
    return { kind: 'failed', detail: text(fields['detail']) };
  }
  throw new Error('AstroCopyInstall.kind: unknown value');
}

export function parseAstroCopyCreated(input: unknown): AstroCopyCreated {
  const fields = record(input);
  const keptAsFiles = parseReportPaths(fields['keptAsFiles']);
  const keptAsFilesCount = count(fields['keptAsFilesCount']);
  if (keptAsFilesCount < keptAsFiles.length) {
    throw new Error('AstroCopyCreated.keptAsFilesCount: fewer than listed');
  }
  return {
    projectPath: parseAbsolutePath(fields['projectPath']),
    pageCount: count(fields['pageCount']),
    assetCount: count(fields['assetCount']),
    keptAsFiles,
    keptAsFilesCount,
    skippedCount: count(fields['skippedCount']),
    install: parseAstroCopyInstall(fields['install']),
  };
}

export function parseAstroCopyReply(input: unknown): AstroCopyReply {
  const fields = record(input);
  if (boolean(fields['ok'])) {
    return ok(parseAstroCopyCreated(fields['value']));
  }
  return err(parseAstroCopyFailure(fields['error']));
}
