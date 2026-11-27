import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { assert } from '../../shared/core/assert';
import { APP_LIMITS, parseAppId } from '../../shared/properties/apps';
import {
  APP_DATA_DIRECTORY,
  appStorageChange,
  changedAppStorageKeys,
  nextAppStorageValues,
  parseAppStorageSource,
  serializeAppStorage,
  type AppStorageChange,
  type AppStorageValues,
} from '../../shared/properties/appStorage';

export type AppStorageTarget = { readonly scope: 'project' } | { readonly scope: 'local'; readonly directory: string };

export type AppStorageOutcome = { readonly applied: true } | { readonly applied: false; readonly reason: string };

export interface AppStorageStore {
  readonly get: (appId: string, target: AppStorageTarget, key: string) => string | undefined;
  readonly keys: (appId: string, target: AppStorageTarget) => readonly string[];
  readonly set: (appId: string, target: AppStorageTarget, key: string, value: string | undefined, writer: string) => AppStorageOutcome;
  readonly watch: () => () => void;
}

const STORAGE_LIMITS = {
  settleMs: 100,
  filesPerPassMax: APP_LIMITS.appsMax * 2,
} as const satisfies Record<string, number>;

const TEMPORARY_PREFIX = '.';

export function localAppStorageDirectory(root: string, projectKey: string, personKey: string): string {
  assert(projectKey.length > 0, 'Local storage names its project');
  assert(personKey.length > 0, 'Local storage names its person');
  const project = createHash('sha256').update(projectKey).digest('hex').slice(0, 24);
  const person = createHash('sha256').update(personKey).digest('hex').slice(0, 24);
  return path.join(root, project, person);
}

export function forgetAppStorage(projectRoot: string, localDirectory: string, appId: string): void {
  const name = `${parseAppId(appId)}.json`;
  for (const file of [path.join(projectRoot, APP_DATA_DIRECTORY, name), path.join(localDirectory, name)]) {
    fs.rmSync(file, { force: true });
    assert(!fs.existsSync(file), 'A forgotten app keeps no stored values');
  }
}

export function createAppStorageStore(options: {
  readonly projectRoot: string;
  readonly notify: (change: AppStorageChange) => void;
  readonly watch?: typeof fs.watch;
}): AppStorageStore {
  const { projectRoot, notify } = options;
  const watch = options.watch ?? fs.watch;
  const dataDirectory = path.join(projectRoot, APP_DATA_DIRECTORY);
  const remembered = new Map<string, AppStorageValues>();
  let rearm: (() => void) | undefined;

  const fileOf = (appId: string, target: AppStorageTarget): string => {
    const name = `${parseAppId(appId)}.json`;
    const directory = target.scope === 'project' ? dataDirectory : target.directory;
    const file = path.join(directory, name);
    assert(path.dirname(file) === directory, 'A storage file sits directly in its folder');
    return file;
  };
  const read = (file: string): AppStorageValues => {
    const values = readValues(file);
    remembered.set(file, values);
    return values;
  };
  const store: AppStorageStore = {
    get: (appId, target, key) => read(fileOf(appId, target)).get(key),
    keys: (appId, target) => [...read(fileOf(appId, target)).keys()].sort(),
    set: (appId, target, key, value, writer) => {
      const file = fileOf(appId, target);
      const current = read(file);
      if (current.get(key) === value) {
        return { applied: true };
      }
      const next = nextAppStorageValues(current, key, value);
      if (!next.ok) {
        return { applied: false, reason: next.reason };
      }
      const created = !fs.existsSync(path.dirname(file));
      writeValues(file, next.values);
      remembered.set(file, next.values);
      notify(appStorageChange(appId, target.scope, [key], writer));
      if (created && target.scope === 'project') {
        rearm?.();
      }
      return { applied: true };
    },
    watch: () => {
      let watcher: fs.FSWatcher | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      const settle = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!stopped) {
            compare();
          }
        }, STORAGE_LIMITS.settleMs);
        timer.unref();
      };
      const compare = (): void => {
        const changes = outsideChanges(dataDirectory, remembered);
        for (const change of changes) {
          notify(change);
        }
      };
      const arm = (): void => {
        watcher?.close();
        watcher = undefined;
        const target = fs.existsSync(dataDirectory) ? dataDirectory : path.dirname(dataDirectory);
        if (!fs.existsSync(target)) {
          return;
        }
        if (target === dataDirectory) {
          rememberAll(dataDirectory, remembered);
        }
        watcher = watch(target, { recursive: false }, (_event, filename) => {
          if (stopped) {
            return;
          }
          const name = filename === null ? undefined : String(filename);
          if (target !== dataDirectory) {
            if (name === path.basename(dataDirectory)) {
              rearm?.();
              settle();
            }
            return;
          }
          if (name !== undefined && name.startsWith(TEMPORARY_PREFIX)) {
            return;
          }
          settle();
        });
        watcher.unref();
      };
      rearm = arm;
      arm();
      return () => {
        stopped = true;
        clearTimeout(timer);
        watcher?.close();
        rearm = undefined;
      };
    },
  };
  return store;
}

function outsideChanges(dataDirectory: string, remembered: Map<string, AppStorageValues>): readonly AppStorageChange[] {
  const changes: AppStorageChange[] = [];
  const present = new Set<string>();
  for (const file of appFiles(dataDirectory)) {
    present.add(file);
    let values: AppStorageValues;
    try {
      values = readValues(file);
    } catch {
      continue;
    }
    const keys = changedAppStorageKeys(remembered.get(file) ?? new Map(), values);
    remembered.set(file, values);
    if (keys.length > 0) {
      changes.push(appStorageChange(path.basename(file, '.json'), 'project', keys, undefined));
    }
  }
  for (const [file, values] of [...remembered]) {
    if (path.dirname(file) === dataDirectory && !present.has(file)) {
      remembered.delete(file);
      if (values.size > 0) {
        changes.push(appStorageChange(path.basename(file, '.json'), 'project', [...values.keys()].sort(), undefined));
      }
    }
  }
  assert(changes.length <= STORAGE_LIMITS.filesPerPassMax * 2, 'One pass notices each file at most once');
  return changes;
}

function rememberAll(dataDirectory: string, remembered: Map<string, AppStorageValues>): void {
  for (const file of appFiles(dataDirectory)) {
    if (!remembered.has(file)) {
      try {
        remembered.set(file, readValues(file));
      } catch {
        remembered.set(file, new Map());
      }
    }
  }
}

function appFiles(dataDirectory: string): readonly string[] {
  let names: readonly string[];
  try {
    names = fs.readdirSync(dataDirectory);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const name of names) {
    if (files.length >= STORAGE_LIMITS.filesPerPassMax) {
      break;
    }
    if (!name.endsWith('.json') || name.startsWith(TEMPORARY_PREFIX)) {
      continue;
    }
    try {
      parseAppId(name.slice(0, -'.json'.length));
    } catch {
      continue;
    }
    files.push(path.join(dataDirectory, name));
  }
  return files;
}

function readValues(file: string): AppStorageValues {
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error: unknown) {
    if (isMissing(error)) {
      return new Map();
    }
    throw error;
  }
  return parseAppStorageSource(source);
}

function writeValues(file: string, values: AppStorageValues): void {
  const source = serializeAppStorage(values);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `${TEMPORARY_PREFIX}${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, source, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error: unknown) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  assert(fs.readFileSync(file, 'utf8') === source, 'Stored values read back as written');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
