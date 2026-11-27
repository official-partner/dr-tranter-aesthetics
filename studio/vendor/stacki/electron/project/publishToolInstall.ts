
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { assert } from '../../shared/core/assert';
import { toRecord } from '../../shared/core/record';
import { err, ok, type Result } from '../../shared/core/result';
import { toolPathHome } from '../lib/nodeTools';

export const WRANGLER_PIN = {
  name: 'wrangler',
  version: '4.151.1',
  integrity: 'sha512-OAsa9UAHZshM6mq2PXcVoyxXgWThAanZMBc/IirtqEWd/BauRtmUKzAniOu/pU0pd3pxKuMZ2vsbF4eo6RiNDA==',
} as const;

export const NETLIFY_PIN = {
  name: 'netlify-cli',
  version: '27.20.1',
  integrity: 'sha512-z1CdFqJZqp41DJcYlJscJTQO9jg0wG/GsenfCgqvezhca1gIs6ni4KNWeq7pGFRWX3/J4eeSeJvgGkgFSnBlGQ==',
} as const;

export interface ToolPin {
  readonly name: 'wrangler' | 'netlify-cli';
  readonly version: string;
  readonly integrity: string;
}

const TOOL_INSTALL_LIMITS = {
  manifestBytesMax: 65_536,
  lockfileBytesMax: 16_777_216,
  sweptEntriesMax: 64,
} as const;

const STAGING_PREFIX = '.staging-';

let toolsDirectoryOverride: string | undefined = undefined;
export function setAppToolsDirectory(directory: string | undefined): void {
  assert(directory === undefined || path.isAbsolute(directory), 'The tools folder override is absolute');
  toolsDirectoryOverride = directory;
}
export function appToolsDirectory(): string {
  return toolsDirectoryOverride ?? publishToolsDirectory(toolPathHome ?? homedir(), process.platform, process.env);
}

export function publishToolsDirectory(home: string, platform: NodeJS.Platform, environment: Readonly<Record<string, string | undefined>>): string {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  assert(paths.isAbsolute(home), 'The tools folder starts from an absolute home');
  const directory = paths.join(toolsBase(home, platform, environment, paths), 'Stacki', 'tools');
  assert(paths.isAbsolute(directory), 'The tools folder is absolute');
  return directory;
}

function toolsBase(home: string, platform: NodeJS.Platform, environment: Readonly<Record<string, string | undefined>>, paths: path.PlatformPath): string {
  if (platform === 'darwin') {
    return paths.join(home, 'Library', 'Application Support');
  }
  if (platform === 'win32') {
    const appData = environment['APPDATA'];
    return appData !== undefined && paths.isAbsolute(appData) ? appData : paths.join(home, 'AppData', 'Roaming');
  }
  const config = environment['XDG_CONFIG_HOME'];
  return config !== undefined && paths.isAbsolute(config) ? config : paths.join(home, '.config');
}

export function pinnedToolRoot(tools: string, pin: ToolPin): string {
  assert(path.isAbsolute(tools), 'The tools folder is absolute');
  return path.join(tools, pin.name, pin.version);
}

export function wranglerToolRoot(tools: string): string {
  return pinnedToolRoot(tools, WRANGLER_PIN);
}

export type ToolCheck =
  { readonly kind: 'ready' } | { readonly kind: 'missing' } | { readonly kind: 'mismatch'; readonly version: string } | { readonly kind: 'corrupt' };

export function checkAppWrangler(tools: string): ToolCheck {
  return checkPinnedTool(tools, WRANGLER_PIN);
}

export function checkPinnedTool(tools: string, pin: ToolPin): ToolCheck {
  const manifest = path.join(pinnedToolRoot(tools, pin), 'node_modules', pin.name, 'package.json');
  if (!existsSync(manifest)) {
    return { kind: 'missing' };
  }
  const value = readBoundedJSON(manifest, TOOL_INSTALL_LIMITS.manifestBytesMax);
  if (value === undefined) {
    return { kind: 'corrupt' };
  }
  const fields = toRecord(value);
  if (fields === undefined) {
    return { kind: 'corrupt' };
  }
  if (fields['name'] !== pin.name) {
    return { kind: 'corrupt' };
  }
  const version = fields['version'];
  if (typeof version !== 'string') {
    return { kind: 'corrupt' };
  }
  if (version !== pin.version) {
    return { kind: 'mismatch', version: version.slice(0, 64) };
  }
  return { kind: 'ready' };
}

export interface ToolInstallPlan {
  readonly pin: ToolPin;
  readonly tools: string;
  readonly staging: string;
  readonly target: string;
  readonly arguments: readonly string[];
}

export type ToolInstallFailure = 'disk' | 'verify';

export function wranglerInstallPlan(tools: string, nonce: string): ToolInstallPlan {
  return toolInstallPlan(tools, WRANGLER_PIN, nonce);
}

export function toolInstallPlan(tools: string, pin: ToolPin, nonce: string): ToolInstallPlan {
  assert(/^[a-zA-Z0-9-]{1,64}$/.test(nonce), 'A staging nonce is a plain token');
  const target = pinnedToolRoot(tools, pin);
  const staging = path.join(path.dirname(target), `${STAGING_PREFIX}${nonce}`);
  assert(path.dirname(staging) === path.dirname(target), 'Staging sits beside the target');
  return {
    pin,
    tools,
    staging,
    target,
    arguments: [
      'install',
      '--prefix',
      staging,
      '--global=false',
      '--package-lock=true',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-update-notifier',
      '--omit=dev',
      '--loglevel=error',
    ],
  };
}

export function prepareWranglerInstall(tools: string, nonce: string = randomUUID()): Result<ToolInstallPlan, ToolInstallFailure> {
  return prepareToolInstall(tools, WRANGLER_PIN, nonce);
}

export function prepareToolInstall(tools: string, pin: ToolPin, nonce: string = randomUUID()): Result<ToolInstallPlan, ToolInstallFailure> {
  const plan = toolInstallPlan(tools, pin, nonce);
  try {
    sweepToolFolder(path.dirname(plan.target), plan.target);
    mkdirSync(plan.staging, { recursive: true });
    const manifest = { name: 'stacki-publish-tools', private: true, dependencies: { [pin.name]: pin.version } };
    writeFileSync(path.join(plan.staging, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, { flag: 'wx' });
  } catch {
    discardWranglerInstall(plan);
    return err('disk');
  }
  assert(existsSync(path.join(plan.staging, 'package.json')), 'The staging manifest was written');
  return ok(plan);
}

export function finishToolInstall(plan: ToolInstallPlan): Result<void, ToolInstallFailure> {
  assert(existsSync(plan.staging), 'A finished install has its staging folder');
  if (!stagedToolVerified(plan.staging, plan.pin)) {
    discardWranglerInstall(plan);
    return err('verify');
  }
  try {
    rmSync(plan.target, { recursive: true, force: true });
    renameSync(plan.staging, plan.target);
  } catch {
    discardWranglerInstall(plan);
    return err('disk');
  }
  assert(!existsSync(plan.staging), 'The staging folder became the target');
  const check = checkPinnedTool(plan.tools, plan.pin);
  assert(check.kind === 'ready', 'A verified install is detected as ready');
  return ok(undefined);
}

export function finishWranglerInstall(plan: ToolInstallPlan): Result<void, ToolInstallFailure> {
  assert(plan.pin.name === WRANGLER_PIN.name, 'This finishes a Wrangler install');
  return finishToolInstall(plan);
}

export function discardWranglerInstall(plan: Pick<ToolInstallPlan, 'staging' | 'target'>): void {
  assert(plan.staging !== plan.target, 'Discarding never removes the installed tool');
  assert(path.basename(plan.staging).startsWith(STAGING_PREFIX), 'Only staging folders are discarded');
  try {
    rmSync(plan.staging, { recursive: true, force: true });
  } catch {
  }
}

function stagedToolVerified(staging: string, pin: ToolPin): boolean {
  const lockfile = toRecord(readBoundedJSON(path.join(staging, 'package-lock.json'), TOOL_INSTALL_LIMITS.lockfileBytesMax));
  const locked = toRecord(toRecord(lockfile?.['packages'])?.[`node_modules/${pin.name}`]);
  if (locked === undefined) {
    return false;
  }
  if (locked['version'] !== pin.version) {
    return false;
  }
  if (locked['integrity'] !== pin.integrity) {
    return false;
  }
  const manifest = toRecord(readBoundedJSON(path.join(staging, 'node_modules', pin.name, 'package.json'), TOOL_INSTALL_LIMITS.manifestBytesMax));
  return manifest?.['version'] === pin.version;
}

function sweepToolFolder(folder: string, target: string): void {
  let entries: readonly string[];
  try {
    entries = readdirSync(folder);
  } catch {
    return;
  }
  for (const name of entries.slice(0, TOOL_INSTALL_LIMITS.sweptEntriesMax)) {
    const entry = path.join(folder, name);
    if (entry === target) {
      continue;
    }
    if (name.startsWith(STAGING_PREFIX) || /^\d+\.\d+\.\d+/.test(name)) {
      rmSync(entry, { recursive: true, force: true });
    }
  }
}

function readBoundedJSON(file: string, bytesMax: number): unknown {
  try {
    if (statSync(file).size > bytesMax) {
      return undefined;
    }
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}
