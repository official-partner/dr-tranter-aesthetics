
import { MAIN_LIMITS } from './mainLimits';
import { commandNeedsShell, mergeToolPaths, pathEnvironmentValue, setPathEnvironment, staticToolPathGuesses } from './platform';
import { userInfo } from 'os';
import type { ChildProcess, ExecFileOptions } from 'child_process';
import { toRecord } from '../../shared/core/record';
import { assert } from '../../shared/core/assert';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { spawn, execFile, execFileSync } from 'child_process';
import { isWin, capture, readJson, parseRecord, parseOptionalString } from './mainHelpers';


export function shellPathDirectories() {
  let shell: string | undefined = process.env['SHELL'];
  if (!shell) {
    try {
      shell = userInfo().shell || undefined;
    } catch {
      shell = undefined;
    }
  }
  if (!shell) {
    return [];
  }
  try {
    const out = execFileSync(shell, ['-ilc', 'printf "__AVB__%s__AVB__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, TERM: 'dumb', DISABLE_AUTO_UPDATE: 'true' },
    });
    const match = /__AVB__([\s\S]*?)__AVB__/.exec(out);
    return match ? (capture(match, 1) ?? '').split(path.delimiter).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export const cmpVersion = (left: string, right: string) => {
  const parts = (version: string) =>
    version
      .replace(/^v/, '')
      .split('.')
      .map((part) => parseInt(part, 10) || 0);
  const [x, y] = [parts(left), parts(right)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) {
      return (x[i] ?? 0) - (y[i] ?? 0);
    }
  }
  return 0;
};

export function nodeDirectoryGuesses(home: string) {
  const directories = isWin
    ? [...staticToolPathGuesses(home, process.env)]
    : [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/opt/local/bin',
        '/snap/bin',
        path.join(home, '.volta/bin'),
        path.join(home, '.asdf/shims'),
        path.join(home, '.nodenv/shims'),
        path.join(home, '.local/share/mise/shims'),
        path.join(home, '.local/bin'),
        path.join(home, '.npm-global/bin'),
        path.join(home, 'n/bin'),
        path.join(home, '.bun/bin'),
      ];
  const versioned: readonly (readonly [string, string])[] = isWin
    ? [[path.join(home, 'AppData', 'Roaming', 'nvm'), '']]
    : [
        [path.join(home, '.nvm/versions/node'), 'bin'],
        [path.join(home, '.local/share/fnm/node-versions'), 'installation/bin'],
        [path.join(home, 'Library/Application Support/fnm/node-versions'), 'installation/bin'],
        [path.join(home, '.fnm/node-versions'), 'installation/bin'],
        [path.join(home, '.asdf/installs/nodejs'), 'bin'],
        [path.join(home, '.nodenv/versions'), 'bin'],
        [path.join(home, '.local/share/mise/installs/node'), 'bin'],
        ['/usr/local/n/versions/node', 'bin'],
      ];
  for (const [base, suffix] of versioned) {
    try {
      const newest = fs
        .readdirSync(base)
        .filter((version) => /^v?\d/.test(version))
        .sort(cmpVersion)
        .pop();
      if (newest) {
        directories.push(suffix ? path.join(base, newest, suffix) : path.join(base, newest));
      }
    } catch {
    }
  }
  return directories;
}

export let toolPathHome: string | undefined = undefined;
export function setToolPathHome(home: string): void {
  assert(path.isAbsolute(home), 'The tool path home is an absolute path');
  toolPathHome = home;
}

export let toolPathReady = false;
export function ensureToolPath() {
  if (toolPathReady) {
    return;
  }
  assert(toolPathHome !== undefined, 'setToolPathHome runs before any child process starts');
  toolPathReady = true;
  const candidates: string[] = [];
  if (!isWin) {
    candidates.push(...shellPathDirectories());
  }
  for (const directory of nodeDirectoryGuesses(toolPathHome)) {
    if (fs.existsSync(directory)) {
      candidates.push(directory);
    }
  }
  const current = pathEnvironmentValue(process.env);
  setPathEnvironment(process.env, mergeToolPaths(current, candidates));
}

export function resolveNodeBin() {
  ensureToolPath();
  const exe = isWin ? 'node.exe' : 'node';
  for (const directory of pathEnvironmentValue(process.env).split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, exe);
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
    }
  }
  return undefined;
}

export function resolveCliEntry(binPath: string) {
  const name = path.basename(binPath).replace(/\.(cmd|ps1|exe|bat)$/i, '');
  const pkgDirectory = path.join(path.dirname(binPath), '..', name);
  try {
    const pkg = parseRecord(readJson(path.join(pkgDirectory, 'package.json')));
    const bin = pkg['bin'];
    const rel = parseOptionalString(typeof bin === 'string' ? bin : toRecord(bin)?.[name]);
    if (rel) {
      const entry = path.join(pkgDirectory, rel);
      if (fs.existsSync(entry)) {
        return entry;
      }
    }
  } catch {
  }
  try {
    const real = fs.realpathSync(binPath);
    if (/\.(js|mjs|cjs)$/i.test(real)) {
      return real;
    }
  } catch {
  }
  return undefined;
}

export function nodeCliCommand(binPath: string, args: readonly string[]): [string, string[]] {
  const node = resolveNodeBin();
  if (!node) {
    return [binPath, [...args]];
  }
  const entry = resolveCliEntry(binPath);
  return entry ? [node, [entry, ...args]] : [binPath, [...args]];
}

export function run(cmd: string, args: readonly string[], cwd: string, options: ExecFileOptions = {}) {
  ensureToolPath();
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      cmd,
      [...args],
      {
        cwd,
        timeout: options.timeout || 60000,
        shell: commandNeedsShell(cmd),
        maxBuffer: MAIN_LIMITS.commandOutputBytesMax,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      },
    );
  });
}

const GIT_ENVIRONMENT = {
  LC_ALL: 'C',
  LANGUAGE: 'C',
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_OPTIONAL_LOCKS: '0',
} as const;

function gitFailureText(error: Error & { stdout?: unknown; stderr?: unknown }): string {
  const parts = [error.stderr, error.stdout].map((stream) => (typeof stream === 'string' ? stream.trim() : '')).filter((stream) => stream.length > 0);
  const joined = parts.join('\n');
  return joined.length > MAIN_LIMITS.gitMessageCharsMax ? `…${joined.slice(-MAIN_LIMITS.gitMessageCharsMax)}` : joined;
}

export async function git(projectPath: string, args: readonly string[], options: ExecFileOptions = {}) {
  try {
    return await run('git', args, projectPath, {
      maxBuffer: MAIN_LIMITS.gitOutputBytesMax,
      ...options,
      env: { ...(options.env ?? process.env), ...GIT_ENVIRONMENT },
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const words = gitFailureText(error);
      if (words.length > 0 && error.message.startsWith('Command failed:')) {
        error.message = words;
      }
    }
    throw error;
  }
}

export async function findFreePort(start: number): Promise<number> {
  assert(Number.isSafeInteger(start), 'Starting port must be an integer');
  assert(start > 0, 'Starting port must be positive');
  for (let attempt = 0; attempt < MAIN_LIMITS.portAttemptsMax; attempt++) {
    const port = start + attempt;
    if (port > 65535) {
      break;
    }
    const available = await findFreePortProbe(port);
    if (available) {
      return port;
    }
  }
  const assigned = await findSystemAssignedPort();
  if (assigned !== undefined) {
    return assigned;
  }
  throw new Error('No available preview port within the search limit');
}

function findSystemAssignedPort(): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(undefined);
      } else {
        reject(error);
      }
    });
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : undefined;
      server.close(() => resolve(port));
    });
    server.listen(0, '127.0.0.1');
  });
}

export function findFreePortProbe(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      switch (error.code) {
        case 'EADDRINUSE':
        case 'EACCES':
          resolve(false);
          break;
        case undefined:
        default:
          reject(error);
      }
    });
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

export function stopProcessTree(proc: ChildProcess | undefined) {
  if (!proc?.pid) {
    return;
  }
  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {
        try {
          proc.kill('SIGTERM');
        } catch {
        }
      });
    } else {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
    }
  }
}

export function spawnAstroServer(projectPath: string, localBin: string, args: readonly string[], extraEnvironment: Readonly<Record<string, string>> = {}) {
  const [cmd, argv] = nodeCliCommand(localBin, args);
  return spawn(cmd, argv, {
    cwd: projectPath,
    shell: commandNeedsShell(cmd),
    detached: !isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnvironment, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
}
