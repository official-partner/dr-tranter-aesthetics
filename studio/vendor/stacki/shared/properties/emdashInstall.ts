
import { assert } from '../core/assert';
import { boolean, list, object, optional, pathText, record, text } from '../core/boundary';
import { parseEmDashProject, type EmDashProject } from './emdash';
import { PACKAGE_MANAGERS, type PackageManager } from './packageManager';

export const EMDASH_INSTALL_LIMITS = {
  logCharsMax: 64_000,
  runMsMax: 10 * 60 * 1000,
  filesMax: 16,
  devServerWaitMsMax: 90_000,
  devServerPollMs: 1000,
  outputTailCharsMax: 4000,
} as const satisfies Record<string, number>;

export const EMDASH_PACKAGES = ['emdash', '@astrojs/node', '@astrojs/react', 'react', 'react-dom'] as const;

export const EMDASH_LIVE_CONFIG_FILE = 'src/live.config.ts';
export const EMDASH_LIVE_CONFIG_TEXT = [
  'import { defineLiveCollection } from "astro:content";',
  'import { emdashLoader } from "emdash/runtime";',
  '',
  'export const collections = {',
  '\t_emdash: defineLiveCollection({ loader: emdashLoader() }),',
  '};',
  '',
].join('\n');
export const EMDASH_IGNORE_LINES = ['data.db', 'uploads/', '.env'] as const;
export const EMDASH_SECRETS_COMMAND = 'npx emdash secrets generate --write .env';
export const EMDASH_INIT_ARGUMENTS = ['emdash', 'init'] as const;
export const EMDASH_SECRETS_ARGUMENTS = ['emdash', 'secrets', 'generate', '--write', '.env'] as const;
export const EMDASH_SAVE_MESSAGE = 'Before Adding EmDash';
export const EMDASH_CONFIG_EXAMPLE = [
  'import node from "@astrojs/node";',
  'import react from "@astrojs/react";',
  'import { defineConfig } from "astro/config";',
  'import emdash, { local } from "emdash/astro";',
  'import { sqlite } from "emdash/db";',
  '',
  'export default defineConfig({',
  '  output: "server",',
  '  adapter: node({ mode: "standalone" }),',
  '  integrations: [',
  '    react(),',
  '    emdash({',
  '      database: sqlite({ url: "file:./data.db" }),',
  '      storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),',
  '    }),',
  '  ],',
  '});',
].join('\n');

export const EMDASH_MANUAL_STEPS = ['astroConfig', 'liveConfig', 'secrets', 'admin'] as const;
export type EmDashManualStep = (typeof EMDASH_MANUAL_STEPS)[number];

export const EMDASH_INSTALL_WARNINGS = ['otherAdapter'] as const;
export type EmDashInstallWarning = (typeof EMDASH_INSTALL_WARNINGS)[number];

export const EMDASH_PREVIEW_STATES = ['running', 'notRunning', 'failed'] as const;
export type EmDashPreviewState = (typeof EMDASH_PREVIEW_STATES)[number];

export const EMDASH_CONFIG_OUTCOMES = ['created', 'merged', 'unchanged', 'otherAdapter', 'unusualShape'] as const;
export type EmDashConfigOutcome = (typeof EMDASH_CONFIG_OUTCOMES)[number];

export const EMDASH_INSTALL_REFUSALS = ['noPackageJson', 'notAstro', 'astroTooOld', 'alreadyInstalled', 'busy', 'notConfirmed'] as const;
export type EmDashInstallRefusal = (typeof EMDASH_INSTALL_REFUSALS)[number];

export const EMDASH_INSTALL_FAILURES = [
  'saveFailed',
  'noNetwork',
  'managerMissing',
  'peerConflict',
  'engineMismatch',
  'permission',
  'timeout',
  'other',
] as const;
export type EmDashInstallFailure = (typeof EMDASH_INSTALL_FAILURES)[number];

export interface EmDashInstallFile {
  readonly path: string;
  readonly change: 'edit' | 'create';
}

export type EmDashInstallPlan =
  | { readonly kind: 'unavailable'; readonly reason: EmDashInstallRefusal }
  | {
      readonly kind: 'ready';
      readonly manager: PackageManager;
      readonly command: string;
      readonly files: readonly EmDashInstallFile[];
      readonly saveFirst: boolean;
      readonly warnings: readonly EmDashInstallWarning[];
    };

export type EmDashInstallResult =
  | { readonly kind: 'refused'; readonly reason: EmDashInstallRefusal }
  | {
      readonly kind: 'installed';
      readonly complete: boolean;
      readonly saved: boolean;
      readonly keyGenerated: boolean;
      readonly config: EmDashConfigOutcome;
      readonly preview: EmDashPreviewState;
      readonly adminUrl: string | undefined;
      readonly databaseReady: boolean;
      readonly onDemand: boolean;
      readonly project: EmDashProject;
      readonly changedFiles: readonly string[];
      readonly manual: readonly EmDashManualStep[];
    }
  | { readonly kind: 'failed'; readonly reason: EmDashInstallFailure; readonly changedFiles: readonly string[] }
  | { readonly kind: 'cancelled'; readonly changedFiles: readonly string[] };

export function manualStepsFor(project: EmDashProject): readonly EmDashManualStep[] {
  const steps: EmDashManualStep[] = [];
  if (project.kind === 'absent') {
    return ['astroConfig', 'secrets', 'admin'];
  }
  if (project.problems.includes('noIntegration') || project.problems.includes('staticOutput') || project.problems.includes('notInstalled')) {
    steps.push('astroConfig');
  }
  if (project.problems.includes('noLiveCollection')) {
    steps.push('liveConfig');
  }
  if (project.problems.includes('noDatabase')) {
    steps.push('secrets', 'admin');
  }
  return steps;
}

export function emDashIsWired(project: EmDashProject): boolean {
  if (project.kind === 'absent') {
    return false;
  }
  const blocking = ['notInstalled', 'noIntegration', 'noLiveCollection', 'staticOutput'] as const;
  return !blocking.some((problem) => project.problems.includes(problem));
}

export function classifyInstallFailure(output: string): EmDashInstallFailure {
  const tail = output.slice(-EMDASH_INSTALL_LIMITS.outputTailCharsMax);
  assert(tail.length <= EMDASH_INSTALL_LIMITS.outputTailCharsMax, 'The classified output is bounded');
  if (/took over \d+ minutes and was stopped/i.test(tail)) {
    return 'timeout';
  }
  if (/could not be found|ENOENT|not recognized as an internal/i.test(tail)) {
    return 'managerMissing';
  }
  if (/ERESOLVE|peer dep|unable to resolve dependency tree|ERR_PNPM_PEER/i.test(tail)) {
    return 'peerConflict';
  }
  if (/EBADENGINE|Unsupported engine|engine "node"|The engine "node" is incompatible/i.test(tail)) {
    return 'engineMismatch';
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network|getaddrinfo|FETCH_ERROR/i.test(tail)) {
    return 'noNetwork';
  }
  if (/EACCES|EPERM|permission denied/i.test(tail)) {
    return 'permission';
  }
  return 'other';
}

const parseOptionalText = optional(text);

function oneOf<T extends string>(allowed: readonly T[], what: string): (input: unknown) => T {
  return (input: unknown): T => {
    const found = allowed.find((candidate) => candidate === input);
    if (found === undefined) {
      throw new Error(`EmDash install: unknown ${what}`);
    }
    return found;
  };
}

const parseFiles = list(
  object({
    path: pathText,
    change: oneOf(['edit', 'create'] as const, 'file change'),
  }),
);
const parseChangedFiles = list(pathText);

function bounded<T>(items: readonly T[], what: string): readonly T[] {
  if (items.length > EMDASH_INSTALL_LIMITS.filesMax) {
    throw new Error(`EmDash install: too many ${what}`);
  }
  return items;
}

export function parseEmDashInstallPlan(input: unknown): EmDashInstallPlan {
  const value = record(input);
  if (value['kind'] === 'unavailable') {
    return { kind: 'unavailable', reason: oneOf(EMDASH_INSTALL_REFUSALS, 'refusal')(value['reason']) };
  }
  if (value['kind'] !== 'ready') {
    throw new Error('EmDash install: unknown plan');
  }
  return {
    kind: 'ready',
    manager: oneOf(PACKAGE_MANAGERS, 'package manager')(value['manager']),
    command: text(value['command']),
    files: bounded(parseFiles(value['files']), 'files'),
    saveFirst: boolean(value['saveFirst']),
    warnings: list(oneOf(EMDASH_INSTALL_WARNINGS, 'warning'))(value['warnings']),
  };
}

export function parseEmDashInstallResult(input: unknown): EmDashInstallResult {
  const value = record(input);
  switch (value['kind']) {
    case 'refused':
      return { kind: 'refused', reason: oneOf(EMDASH_INSTALL_REFUSALS, 'refusal')(value['reason']) };
    case 'installed':
      return {
        kind: 'installed',
        complete: boolean(value['complete']),
        saved: boolean(value['saved']),
        keyGenerated: boolean(value['keyGenerated']),
        config: oneOf(EMDASH_CONFIG_OUTCOMES, 'config outcome')(value['config']),
        preview: oneOf(EMDASH_PREVIEW_STATES, 'preview state')(value['preview']),
        adminUrl: parseOptionalText(value['adminUrl']),
        databaseReady: boolean(value['databaseReady']),
        onDemand: boolean(value['onDemand']),
        project: parseEmDashProject(value['project']),
        changedFiles: bounded(parseChangedFiles(value['changedFiles']), 'files'),
        manual: list(oneOf(EMDASH_MANUAL_STEPS, 'step'))(value['manual']),
      };
    case 'failed':
      return {
        kind: 'failed',
        reason: oneOf(EMDASH_INSTALL_FAILURES, 'failure')(value['reason']),
        changedFiles: bounded(parseChangedFiles(value['changedFiles']), 'files'),
      };
    case 'cancelled':
      return { kind: 'cancelled', changedFiles: bounded(parseChangedFiles(value['changedFiles']), 'files') };
    default:
      throw new Error('EmDash install: unknown result');
  }
}

export const parseEmDashInstallRequest = object({ projectPath: pathText, confirmedCommand: text });

export function appendInstallLog(log: string, chunk: string): string {
  const joined = log + chunk;
  return joined.length > EMDASH_INSTALL_LIMITS.logCharsMax ? joined.slice(joined.length - EMDASH_INSTALL_LIMITS.logCharsMax) : joined;
}
