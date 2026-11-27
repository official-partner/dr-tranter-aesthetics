import fs from 'fs';
import path from 'path';
import { once } from 'node:events';
import { createRequire } from 'module';
import { spawn, type ChildProcess } from 'child_process';

import { assert } from '../../shared/core/assert';
import { toRecord, toArray } from '../../shared/core/record';
import { MAIN_LIMITS } from '../lib/mainLimits';
import { contentWorkerPath } from '../../../../src/features/cms/cmsRuntime';


const SENTINEL = '<<<stacki:content-config>>>';
const RUN_TIMEOUT = 20000;

const CONFIG_FILES = [
  'src/content.config.ts',
  'src/content.config.js',
  'src/content.config.mjs',
  'src/content.config.mts',
  'src/content/config.ts',
  'src/content/config.js',
  'src/content/config.mjs',
];

function configPathOf(projectPath: string): { abs: string; rel: string } | undefined {
  for (const rel of CONFIG_FILES) {
    const abs = path.join(projectPath, rel);
    if (fs.existsSync(abs)) {
      return { abs, rel };
    }
  }
  return undefined;
}

type BuildFunction = (options: Record<string, unknown>) => Promise<unknown>;

export type ProjectBundler = { readonly kind: 'esbuild'; readonly build: BuildFunction } | { readonly kind: 'rolldown'; readonly build: BuildFunction };

const BUNDLER_SPECS = [
  { kind: 'esbuild', spec: 'esbuild' },
  { kind: 'esbuild', spec: 'vite/node_modules/esbuild' },
  { kind: 'rolldown', spec: 'rolldown' },
  { kind: 'rolldown', spec: 'vite/node_modules/rolldown' },
] as const;

function buildFunctionOf(input: unknown): BuildFunction | undefined {
  const candidate = toRecord(input);
  const build = candidate?.['build'];
  if (typeof build !== 'function') {
    return undefined;
  }
  return (options) => Promise.resolve(build.call(candidate, options));
}

export function bundlerOf(projectPath: string): ProjectBundler | undefined {
  assert(path.isAbsolute(projectPath), 'A bundler is resolved from a project by its full path');
  const projectRequire = createRequire(path.join(projectPath, 'package.json'));
  for (const { kind, spec } of BUNDLER_SPECS) {
    let mod: unknown;
    try {
      mod = projectRequire(spec);
    } catch {
      try {
        mod = createRequire(import.meta.url)(spec);
      } catch {
        continue;
      }
    }
    const build = buildFunctionOf(mod);
    if (build !== undefined) {
      return { kind, build };
    }
  }
  return undefined;
}

const workDirectoryOf = (projectPath: string): string => path.join(projectPath, '.studio-cms-runner');

function stageRunner(projectPath: string, configAbs: string): { directory: string; entry: string } {
  const directory = workDirectoryOf(projectPath);
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['stubAstroContent.mjs', 'stubAstroLoaders.mjs', 'schemaTools.mjs', 'introspect.mjs']) {
    fs.writeFileSync(path.join(directory, name), fs.readFileSync(contentWorkerPath(name), 'utf8'), 'utf8');
  }
  const entry = path.join(directory, 'read-config.entry.mjs');
  fs.writeFileSync(
    entry,
    [
      `import { describe, validate } from ${JSON.stringify('./introspect.mjs')};`,
      `import * as config from ${JSON.stringify(configAbs)};`,
      `const S = ${JSON.stringify(SENTINEL)};`,
      'const send = (value) => process.stdout.write(S + JSON.stringify(value) + "\\n");',
      'send({ type: "manifest", value: describe(config) });',
      'let buffer = "";',
      'process.stdin.on("data", (chunk) => {',
      '  buffer += chunk;',
      '  let at;',
      '  while ((at = buffer.indexOf("\\n")) >= 0) {',
      '    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);',
      '    if (!line.trim()) continue;',
      '    let request;',
      '    try { request = JSON.parse(line); } catch { continue; }',
      '    try {',
      '      const value = request.op === "validate" ? validate(config, request) : ' + '{ error: "unknown request" };',
      '      send({ type: "reply", id: request.id, value });',
      '    } catch (err) {',
      '      send({ type: "reply", id: request.id, value: ' + '{ error: String(err && err.message || err) } });',
      '    }',
      '  }',
      '});',
      'process.stdin.resume();',
      '',
    ].join('\n'),
    'utf8',
  );
  return { directory, entry };
}

const REQUIRE_BANNER = ["import { createRequire as __stackiRequire } from 'node:module';", 'const require = __stackiRequire(import.meta.url);'].join('\n');

async function bundle(bundler: ProjectBundler, projectPath: string, directory: string, entry: string): Promise<{ outfile: string; inputs: string[] }> {
  const outfile = path.join(directory, 'read-config.mjs');
  const tsconfig = ['tsconfig.json', 'jsconfig.json'].map((fileName) => path.join(projectPath, fileName)).find((candidate) => fs.existsSync(candidate));
  const alias = {
    'astro:content': path.join(directory, 'stubAstroContent.mjs'),
    'astro/loaders': path.join(directory, 'stubAstroLoaders.mjs'),
  };
  switch (bundler.kind) {
    case 'esbuild':
      return bundleWithEsbuild(bundler.build, { projectPath, entry, outfile, tsconfig, alias });
    case 'rolldown':
      return bundleWithRolldown(bundler.build, { projectPath, entry, outfile, tsconfig, alias });
    default: {
      const exhaustive: never = bundler;
      return exhaustive;
    }
  }
}

interface BundleJob {
  readonly projectPath: string;
  readonly entry: string;
  readonly outfile: string;
  readonly tsconfig: string | undefined;
  readonly alias: Readonly<Record<string, string>>;
}

async function bundleWithEsbuild(build: BuildFunction, job: BundleJob): Promise<{ outfile: string; inputs: string[] }> {
  const { projectPath, entry, outfile, tsconfig, alias } = job;
  const result = toRecord(
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      write: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      absWorkingDir: projectPath,
      tsconfig,
      alias,
      external: ['astro/zod', 'astro:*'],
      banner: { js: REQUIRE_BANNER },
      logLevel: 'silent',
      metafile: true,
      sourcemap: false,
    }),
  );
  const inputs = Object.keys(toRecord(toRecord(result?.['metafile'])?.['inputs']) ?? {});
  assert(inputs.length <= MAIN_LIMITS.runnerInputsMax, 'A content config bundle has bounded inputs');
  return { outfile, inputs };
}

async function bundleWithRolldown(build: BuildFunction, job: BundleJob): Promise<{ outfile: string; inputs: string[] }> {
  const { projectPath, entry, outfile, tsconfig, alias } = job;
  const external = (id: string): boolean => {
    if (id in alias) {
      return false;
    }
    return id === 'astro/zod' || id.startsWith('astro:');
  };
  const result = toRecord(
    await build({
      input: entry,
      cwd: projectPath,
      platform: 'node',
      ...(tsconfig === undefined ? {} : { tsconfig }),
      resolve: { alias },
      external,
      logLevel: 'silent',
      transform: { target: 'node20' },
      write: true,
      output: { file: outfile, format: 'esm', banner: REQUIRE_BANNER, sourcemap: false, codeSplitting: false },
    }),
  );
  const chunks = toArray(result?.['output']) ?? [];
  assert(chunks.length > 0, 'A rolldown build answers with the chunk it wrote');
  const inputs = chunks
    .flatMap((chunk) => toArray(toRecord(chunk)?.['moduleIds']) ?? [])
    .filter((id): id is string => typeof id === 'string' && !id.startsWith('\0'))
    .map((id) => toPosix(path.relative(projectPath, id)));
  assert(inputs.length <= MAIN_LIMITS.runnerInputsMax, 'A content config bundle has bounded inputs');
  return { outfile, inputs };
}

const toPosix = (file: string): string => file.split(path.sep).join('/');

function cleanError(text: unknown): string {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^at\s/.test(line) && !/^node:internal/.test(line));
  return lines.slice(0, 3).join(' ').slice(0, 500);
}

const stampOf = (projectPath: string, inputs: readonly string[]): string =>
  inputs
    .map((rel) => {
      try {
        const stat = fs.statSync(path.resolve(projectPath, rel));
        return `${rel}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${rel}:gone`;
      }
    })
    .join('|');

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const RELOADED = 'The content config was reloaded.';

class ConfigService {
  readonly projectPath: string;
  readonly configAbs: string;
  stopped = false;
  inputs: readonly string[] = [];
  stamp = '';
  ready: Promise<ConfigService> | undefined = undefined;
  manifest: unknown = undefined;
  private child: ChildProcess | undefined = undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private stderr = '';
  private stdoutBuffer = '';
  private idle: NodeJS.Timeout | undefined = undefined;
  private timer: NodeJS.Timeout | undefined = undefined;
  private resolveManifest: ((value: unknown) => void) | undefined = undefined;
  private rejectManifest: ((error: unknown) => void) | undefined = undefined;

  constructor(projectPath: string, configAbs: string) {
    this.projectPath = projectPath;
    this.configAbs = configAbs;
  }

  stop(error: Error): void {
    if (this.stopped) {
      return;
    }
    if (services.get(this.projectPath) === this) {
      services.delete(this.projectPath);
    }
    this.stopped = true;
    clearTimeout(this.idle);
    clearTimeout(this.timer);
    this.rejectManifest?.(error);
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    try {
      this.child?.kill();
    } catch {
    }
  }

  async stopAndWait(error: Error): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.stop(error);
      return;
    }
    const closed = once(child, 'close', { signal: AbortSignal.timeout(5000) });
    this.stop(error);
    await closed;
  }

  touch(): void {
    if (this.stopped) {
      return;
    }
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(new Error(RELOADED)), IDLE_TIMEOUT);
    this.idle.unref?.();
  }

  async start(): Promise<ConfigService> {
    try {
      const outfile = await this.bundleRunner();
      const manifest = this.spawnRunner(outfile);
      this.manifest = await manifest;
      if (this.stopped) {
        throw new Error(RELOADED);
      }
      this.touch();
      return this;
    } catch (error: unknown) {
      this.stop(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      clearTimeout(this.timer);
    }
  }

  nextRequestId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  request(message: string, id: number): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const finish = <T>(value: T, callback: (value: T) => void): void => {
        clearTimeout(timer);
        this.pending.delete(id);
        callback(value);
      };
      const timer = setTimeout(() => finish(new Error('Checking the entry timed out.'), reject), RUN_TIMEOUT);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => finish(toRecord(value) ?? {}, resolve),
        reject: (error) => finish(error instanceof Error ? error : new Error(String(error)), reject),
      });
      try {
        this.child?.stdin?.write(message, (error) => {
          if (error) {
            this.pending.get(id)?.reject(error);
          }
        });
      } catch (error: unknown) {
        this.pending.get(id)?.reject(error);
      }
    });
  }

  private async bundleRunner(): Promise<string> {
    const { projectPath, configAbs } = this;
    if (this.stopped) {
      throw new Error(RELOADED);
    }
    const bundler = bundlerOf(projectPath);
    if (bundler === undefined) {
      throw new Error('Reading the content config needs the project dependencies installed.');
    }
    const { directory, entry } = stageRunner(projectPath, configAbs);
    const { outfile, inputs } = await bundle(bundler, projectPath, directory, entry);
    if (this.stopped) {
      throw new Error(RELOADED);
    }
    this.inputs = inputs;
    this.stamp = stampOf(projectPath, inputs);
    return outfile;
  }

  private spawnRunner(outfile: string): Promise<unknown> {
    const child = spawn(process.execPath, [outfile], {
      cwd: this.projectPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'] as const,
    });
    this.child = child;
    const manifest = new Promise<unknown>((resolve, reject) => {
      this.resolveManifest = resolve;
      this.rejectManifest = reject;
    });
    const fail = (error: Error): void => this.stop(error);
    child.stdout.on('data', (chunk) => this.readStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-MAIN_LIMITS.runnerStderrCharsMax);
    });
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('exit', () => fail(new Error(cleanError(this.stderr) || 'The content config could not be read.')));
    this.timer = setTimeout(() => fail(new Error('Reading the content config timed out.')), RUN_TIMEOUT);
    this.timer.unref?.();
    return manifest;
  }

  private readStdout(chunk: unknown): void {
    this.stdoutBuffer += String(chunk);
    let at;
    while ((at = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, at);
      this.stdoutBuffer = this.stdoutBuffer.slice(at + 1);
      const start = line.indexOf(SENTINEL);
      if (start === -1) {
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line.slice(start + SENTINEL.length));
      } catch {
        continue;
      }
      const record = toRecord(message);
      if (!record) {
        continue;
      }
      if (record['type'] === 'manifest') {
        this.resolveManifest?.(record['value']);
      } else if (record['type'] === 'reply') {
        const id = record['id'];
        this.pending.get(typeof id === 'number' ? id : -1)?.resolve(record['value']);
      }
    }
    if (this.stdoutBuffer.length > MAIN_LIMITS.runnerLineCharsMax) {
      this.stop(new Error('The content config runner wrote a line past its limit.'));
    }
  }
}

const services = new Map<string, ConfigService>();
const IDLE_TIMEOUT = 5 * 60 * 1000;

function stopService(projectPath: string): void {
  services.get(projectPath)?.stop(new Error(RELOADED));
}

export async function stopServiceAndWait(projectPath: string): Promise<void> {
  await services.get(projectPath)?.stopAndWait(new Error(RELOADED));
}

function serviceFor(projectPath: string, { force = false }: { readonly force?: boolean } = {}): Promise<ConfigService | undefined> {
  const found = configPathOf(projectPath);
  const existing = services.get(projectPath);
  if (!found) {
    stopService(projectPath);
    return Promise.resolve(undefined);
  }
  if (existing && !force && existing.configAbs === found.abs && (!existing.manifest || existing.stamp === stampOf(projectPath, existing.inputs))) {
    const ready = existing.ready ?? Promise.reject(new Error(RELOADED));
    return ready.then((service) => {
      if (service.stopped) {
        throw new Error(RELOADED);
      }
      service.touch();
      return service;
    });
  }
  stopService(projectPath);
  const service = new ConfigService(projectPath, found.abs);
  services.set(projectPath, service);
  service.ready = existing?.ready ? existing.ready.catch(() => undefined).then(() => service.start()) : service.start();
  return service.ready;
}

export type ContentConfigResult =
  | { readonly missing: true; readonly collections: unknown[] }
  | { readonly collections: unknown; readonly configPath: string }
  | { readonly collections: unknown[]; readonly configPath: string; readonly error: string };

async function readContentConfig(projectPath: string, { force = false }: { readonly force?: boolean } = {}): Promise<ContentConfigResult> {
  const found = configPathOf(projectPath);
  if (!found) {
    stopService(projectPath);
    return { missing: true, collections: [] };
  }
  try {
    const service = await serviceFor(projectPath, { force });
    const manifest = toRecord(service?.manifest) ?? {};
    return { collections: toArray(manifest['collections']) ?? [], configPath: found.rel };
  } catch (error: unknown) {
    return {
      collections: [],
      configPath: found.rel,
      error: cleanError(error instanceof Error ? error.message : error),
    };
  }
}

async function validateEntry(
  projectPath: string,
  { collection, data }: { readonly collection: string; readonly data: unknown },
): Promise<Record<string, unknown>> {
  let service: ConfigService | undefined;
  try {
    service = await serviceFor(projectPath);
  } catch (error: unknown) {
    return { issues: [], error: cleanError(error instanceof Error ? error.message : error) };
  }
  if (!service) {
    return { issues: [], unchecked: true };
  }
  if (service.stopped) {
    return { issues: [], error: RELOADED };
  }
  service.touch();
  const id = service.nextRequestId();
  try {
    const message = JSON.stringify({ id, op: 'validate', collection, data }) + '\n';
    return await service.request(message, id);
  } catch (error: unknown) {
    return { issues: [], error: cleanError(error instanceof Error ? error.message : error) };
  }
}

const stopAllServices = (): void => {
  for (const projectPath of [...services.keys()]) {
    stopService(projectPath);
  }
};

export { readContentConfig, validateEntry, configPathOf, stopService, stopAllServices };
