import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseTOML } from 'smol-toml';
import { assert } from '../../shared/core/assert';
import { record, text } from '../../shared/core/boundary';
import { toRecord } from '../../shared/core/record';
import { err, ok, type Result } from '../../shared/core/result';
import { described, type Described } from '../../shared/properties/i18n/messageRef';
import { DescribedError } from '../../shared/properties/describedError';
import { hostingCommand, type PublishCommand } from '../../shared/properties/publishCommands';
import type { NetlifyHosting } from '../../shared/properties/publishNetlify';
import { astroConfigSource, outputDirectory, siteFile } from './publishSiteBuild';
import { netlifyAPI } from './publishNetlifyCommand';
import { netlifyDeployProblem } from './publishNetlify';

const NETLIFY_ADAPTER = '@astrojs/netlify';
const OTHER_HOST_ADAPTERS = ['@astrojs/node', '@astrojs/vercel', '@astrojs/cloudflare', '@deno/astro-adapter'] as const;
const RESULT_CANDIDATES_MAX = 64;
const IDENTIFIER_CHARS_MAX = 100;

export type NetlifyBuildPlan =
  { readonly kind: 'netlify-build'; readonly directory?: string } | { readonly kind: 'prebuilt'; readonly directory: string };

interface NetlifySettings {
  readonly command: boolean;
  readonly publish?: string;
  readonly base: string;
}

export async function netlifyBuildPlan(root: string): Promise<Result<NetlifyBuildPlan, Described>> {
  assert(path.isAbsolute(root), 'A Netlify deploy reads an absolute site folder');
  const settings = await netlifySettings(root);
  if (!settings.ok) {
    return settings;
  }
  const { command, publish, base } = settings.value;
  const config = await astroConfigSource(path.join(root, base));
  const adapter = adapterProblem(config ?? '');
  if (adapter !== undefined) {
    return err(adapter);
  }
  const named = publish ?? outputDirectory(config);
  const directory = named === undefined ? undefined : siteDirectory(base, named);
  if (directory === undefined) {
    return err(described('publish.netlify.error.outputFolder'));
  }
  if (!command) {
    return ok({ kind: 'prebuilt', directory });
  }
  return ok(publish === undefined ? { kind: 'netlify-build', directory } : { kind: 'netlify-build' });
}

export function netlifyDeployCommand(hosting: NetlifyHosting, plan: NetlifyBuildPlan): PublishCommand {
  const command = hostingCommand(hosting);
  switch (plan.kind) {
    case 'prebuilt':
      return { ...command, arguments: [...command.arguments, '--no-build', '--dir', plan.directory] };
    case 'netlify-build':
      return {
        ...command,
        arguments: [...command.arguments, '--context', 'production', ...(plan.directory === undefined ? [] : ['--dir', plan.directory])],
      };
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

export async function deployNetlify(root: string, hosting: NetlifyHosting, run: (command: PublishCommand) => Promise<string>): Promise<void> {
  const plan = await netlifyBuildPlan(root);
  if (!plan.ok) {
    throw new DescribedError(plan.error);
  }
  if (plan.value.kind === 'prebuilt') {
    await requireBuildOutput(root, plan.value.directory);
  }
  await requireNetlifySite(root, hosting);
  const output = await run(netlifyDeployCommand(hosting, plan.value));
  const deployed = netlifyDeployResult(output);
  if (deployed === undefined) {
    throw new DescribedError(described('publish.netlify.error.unconfirmed'));
  }
  if (deployed.siteId !== hosting.siteId) {
    throw new DescribedError(described('publish.netlify.error.otherSite'));
  }
}

async function requireNetlifySite(root: string, hosting: NetlifyHosting): Promise<void> {
  const site = await netlifyAPI(root, 'getSite', { site_id: hosting.siteId });
  if (!site.ok) {
    throw new DescribedError(netlifyDeployProblem(site.error));
  }
  if (toRecord(site.value)?.['id'] !== hosting.siteId) {
    throw new DescribedError(described('publish.netlify.error.siteNotFound'));
  }
}

export function netlifyDeployResult(output: string): { readonly siteId: string; readonly deployId: string } | undefined {
  const starts = [...output.matchAll(/^\{/gm)].map((match) => match.index).slice(-RESULT_CANDIDATES_MAX);
  for (const start of starts.reverse()) {
    let value: unknown;
    try {
      value = JSON.parse(output.slice(start).trim());
    } catch {
      continue;
    }
    const fields = toRecord(value);
    const siteId = fields?.['site_id'];
    const deployId = fields?.['deploy_id'];
    if (typeof siteId === 'string' && typeof deployId === 'string') {
      if (siteId.length <= IDENTIFIER_CHARS_MAX && deployId.length > 0 && deployId.length <= IDENTIFIER_CHARS_MAX) {
        return { siteId, deployId };
      }
    }
  }
  return undefined;
}

function adapterProblem(config: string): Described | undefined {
  if (config.includes(NETLIFY_ADAPTER)) {
    return undefined;
  }
  if (OTHER_HOST_ADAPTERS.some((name) => config.includes(name))) {
    return described('publish.netlify.error.otherAdapter');
  }
  if (/\boutput\s*:\s*['"`]server['"`]/.test(config)) {
    return described('publish.netlify.error.adapterNeeded');
  }
  return undefined;
}

async function netlifySettings(root: string): Promise<Result<NetlifySettings, Described>> {
  const filename = path.join(root, 'netlify.toml');
  const source = await siteFile(filename);
  if (source === undefined) {
    return existsSync(filename) ? err(described('publish.netlify.error.config')) : ok({ command: false, base: '' });
  }
  try {
    const file = record(parseTOML(source));
    const production = optionalTable(optionalTable(file['context'])['production']);
    const build = { ...optionalTable(file['build']), ...production };
    const base = build['base'] === undefined ? '' : netlifyBase(text(build['base']));
    const command = build['command'] === undefined ? '' : text(build['command']);
    const publish = build['publish'] === undefined ? undefined : text(build['publish']);
    return ok({ command: command.trim() !== '', base, ...(publish === undefined ? {} : { publish }) });
  } catch {
    return err(described('publish.netlify.error.config'));
  }
}

function netlifyBase(input: string): string {
  if (input === '' || input === '/' || input === '.') {
    return '';
  }
  const base = siteDirectory('', input);
  if (base === undefined) {
    throw new Error('netlify.toml base must stay inside the project');
  }
  return base;
}

export function siteDirectory(base: string, input: string): string | undefined {
  if (input.length > 256) {
    return undefined;
  }
  const relative = input.replace(/^(?:\.\/|\/)+/, '');
  if (relative.split('/').includes('..')) {
    return undefined;
  }
  const folder = path.posix.normalize(relative).replace(/\/$/, '');
  if (folder === '' || folder === '.') {
    return undefined;
  }
  return base === '' ? folder : path.posix.join(base, folder);
}

async function requireBuildOutput(root: string, directory: string): Promise<void> {
  const folder = path.join(root, directory);
  if (!existsSync(folder)) {
    throw new DescribedError(described('publish.netlify.error.outputFolder'));
  }
  const relative = path.relative(await realpath(root), await realpath(folder));
  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    throw new DescribedError(described('publish.netlify.error.outputFolder'));
  }
}

function optionalTable(input: unknown): Readonly<Record<string, unknown>> {
  return input === undefined ? {} : record(input);
}
