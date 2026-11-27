import { assert } from '../core/assert';
import { list, record, text } from '../core/boundary';
import { retainedPath } from './studioRelease';

export const STUDIO_UPGRADE_LIMITS = {
  changesListedMax: 25,
  filesScannedMax: 6000,
  bytesScannedMax: 64_000_000,
  versionCharsMax: 40,
  pathCharsMax: 500,
  backupNameCharsMax: 120,
} as const;

export const STUDIO_GENERATED_ROOTS = ['node_modules', 'dist', 'test-results'] as const;
export const STUDIO_UPGRADE_MANIFEST = 'last-upgrade.json';

export type StudioVersionOrder = 'behind' | 'current' | 'ahead' | 'invalid';
export type StudioChangeKind = 'modifiedFile' | 'addedFile' | 'removedFile';

export interface StudioChange {
  readonly kind: StudioChangeKind;
  readonly path: string;
}

export interface StudioChangedFiles {
  readonly listed: readonly StudioChange[];
  readonly total: number;
}

export interface StudioUpgradeNote {
  readonly from: string;
  readonly to: string;
  readonly changed: StudioChangedFiles | undefined;
}

export type StudioUpgradeCheck =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'current'; readonly version: string; readonly previous: StudioUpgradeNote | undefined }
  | { readonly kind: 'ready'; readonly installed: string; readonly latest: string; readonly previous: StudioUpgradeNote | undefined };

export type StudioUpgradeResult =
  { readonly kind: 'upgraded'; readonly version: string; readonly note: StudioUpgradeNote } | { readonly kind: 'error'; readonly message: string };
export type StudioRestoreResult = { readonly kind: 'restored'; readonly version: string } | { readonly kind: 'error'; readonly message: string };

export interface StudioUpgradeManifest {
  readonly format: 1;
  readonly backup: string;
  readonly note: StudioUpgradeNote;
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BACKUP_NAME_PATTERN = /^backup-[0-9A-Za-z.-]+$/;

export function parseStableVersion(input: string): readonly [number, number, number] | undefined {
  if (input.length > STUDIO_UPGRADE_LIMITS.versionCharsMax) {
    return undefined;
  }
  const match = VERSION_PATTERN.exec(input);
  if (!match) {
    return undefined;
  }
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  for (const part of parts) {
    if (!Number.isSafeInteger(part)) {
      return undefined;
    }
  }
  return parts;
}

export function compareStudioVersions(installed: string, latest: string): StudioVersionOrder {
  const have = parseStableVersion(installed);
  const want = parseStableVersion(latest);
  if (have === undefined || want === undefined) {
    return 'invalid';
  }
  for (let index = 0; index < have.length; index += 1) {
    const before = have[index];
    const after = want[index];
    assert(before !== undefined, 'A parsed version has three parts');
    assert(after !== undefined, 'A parsed version has three parts');
    if (after > before) {
      return 'behind';
    }
    if (after < before) {
      return 'ahead';
    }
  }
  return 'current';
}

function isGeneratedPath(file: string): boolean {
  const first = file.split('/')[0] ?? '';
  return STUDIO_GENERATED_ROOTS.some((root) => root === first);
}

export function detectChangedFiles(input: {
  readonly pristine: ReadonlyMap<string, string>;
  readonly installed: ReadonlyMap<string, string>;
}): StudioChangedFiles {
  assert(input.pristine.size > 0, 'A release always carries files');
  const modified: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [file, digest] of input.installed) {
    if (retainedPath(file) || isGeneratedPath(file)) {
      continue;
    }
    const expected = input.pristine.get(file);
    if (expected === undefined) {
      added.push(file);
    } else if (expected !== digest) {
      modified.push(file);
    }
  }
  for (const file of input.pristine.keys()) {
    if (!input.installed.has(file)) {
      removed.push(file);
    }
  }
  const changes: StudioChange[] = [];
  for (const [kind, files] of [
    ['modifiedFile', modified],
    ['addedFile', added],
    ['removedFile', removed],
  ] as const) {
    for (const path of [...files].sort()) {
      changes.push({ kind, path });
    }
  }
  const listed = changes.slice(0, STUDIO_UPGRADE_LIMITS.changesListedMax);
  assert(listed.length <= changes.length, 'The listed changes are a prefix of all of them');
  return { listed, total: changes.length };
}

export function decideUpgrade(input: {
  readonly installed: string;
  readonly latest: string | undefined;
  readonly previous: StudioUpgradeNote | undefined;
}): StudioUpgradeCheck {
  if (input.latest === undefined) {
    return { kind: 'unavailable' };
  }
  const order = compareStudioVersions(input.installed, input.latest);
  switch (order) {
    case 'invalid':
      return { kind: 'unavailable' };
    case 'current':
    case 'ahead':
      return { kind: 'current', version: input.installed, previous: input.previous };
    case 'behind':
      return { kind: 'ready', installed: input.installed, latest: input.latest, previous: input.previous };
    default: {
      const exhaustive: never = order;
      return exhaustive;
    }
  }
}

export function manualUpgradeCommand(latest: string): string {
  assert(parseStableVersion(latest) !== undefined, 'The manual command names an exact stable version');
  return `node studio/dist/cli.mjs update . ${latest} --replace-customizations`;
}

const CHANGE_KINDS = ['modifiedFile', 'addedFile', 'removedFile'] as const;

function parseChange(input: unknown): StudioChange {
  const value = record(input);
  const kind = CHANGE_KINDS.find((candidate) => candidate === value['kind']);
  if (kind === undefined) {
    throw new Error('Invalid Studio changed file');
  }
  const path = text(value['path']);
  if (path.length === 0 || path.length > STUDIO_UPGRADE_LIMITS.pathCharsMax) {
    throw new Error('Invalid Studio changed file path');
  }
  return { kind, path };
}

function parseChanged(input: unknown): StudioChangedFiles {
  const value = record(input);
  const listed = list(parseChange)(value['listed']);
  if (listed.length > STUDIO_UPGRADE_LIMITS.changesListedMax) {
    throw new Error('Too many listed Studio changed files');
  }
  const total = value['total'];
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < listed.length) {
    throw new Error('Invalid Studio changed file total');
  }
  return { listed, total };
}

function parseVersion(input: unknown): string {
  const version = text(input);
  if (parseStableVersion(version) === undefined) {
    throw new Error('Expected an exact stable Studio version');
  }
  return version;
}

export function parseStudioUpgradeNote(input: unknown): StudioUpgradeNote {
  const value = record(input);
  const changed = value['changed'];
  return { from: parseVersion(value['from']), to: parseVersion(value['to']), changed: changed === undefined ? undefined : parseChanged(changed) };
}

function parseOptionalNote(input: unknown): StudioUpgradeNote | undefined {
  return input === undefined ? undefined : parseStudioUpgradeNote(input);
}

export function parseStudioUpgradeCheck(input: unknown): StudioUpgradeCheck {
  const value = record(input);
  switch (value['kind']) {
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'current':
      return { kind: 'current', version: parseVersion(value['version']), previous: parseOptionalNote(value['previous']) };
    case 'ready':
      return {
        kind: 'ready',
        installed: parseVersion(value['installed']),
        latest: parseVersion(value['latest']),
        previous: parseOptionalNote(value['previous']),
      };
    default:
      throw new Error('Invalid Studio upgrade check');
  }
}

export function parseStudioUpgradeResult(input: unknown): StudioUpgradeResult {
  const value = record(input);
  switch (value['kind']) {
    case 'upgraded':
      return { kind: 'upgraded', version: parseVersion(value['version']), note: parseStudioUpgradeNote(value['note']) };
    case 'error':
      return { kind: 'error', message: text(value['message']) };
    default:
      throw new Error('Invalid Studio upgrade result');
  }
}

export function parseStudioRestoreResult(input: unknown): StudioRestoreResult {
  const value = record(input);
  switch (value['kind']) {
    case 'restored':
      return { kind: 'restored', version: parseVersion(value['version']) };
    case 'error':
      return { kind: 'error', message: text(value['message']) };
    default:
      throw new Error('Invalid Studio restore result');
  }
}

export function parseStudioUpgradeManifest(input: unknown): StudioUpgradeManifest {
  const value = record(input);
  if (value['format'] !== 1) {
    throw new Error('Unsupported Studio upgrade manifest');
  }
  const backup = text(value['backup']);
  if (backup.length > STUDIO_UPGRADE_LIMITS.backupNameCharsMax || !BACKUP_NAME_PATTERN.test(backup)) {
    throw new Error('Invalid Studio backup name');
  }
  return { format: 1, backup, note: parseStudioUpgradeNote(value['note']) };
}
