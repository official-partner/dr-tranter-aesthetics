import fs from 'node:fs';
import path from 'node:path';
import { assert } from '../../shared/core/assert';
import {
  APP_FILE_LIMITS,
  appFilePathRefusal,
  type AppFileAnswer,
  type AppFileContent,
  type AppFileEntry,
  type AppFileListing,
  type AppFileOperation,
  type AppFileState,
} from '../../shared/properties/appFiles';
import { appsFailure, type AppsResult } from '../../shared/properties/apps';

export type AppFileWriter = (absolute: string, bytes: Uint8Array, text: string | undefined) => void;

export interface AppFileBudget {
  readonly spend: (appId: string, bytes: number) => void;
}

export function createAppFileBudget(now: () => number): AppFileBudget {
  const spent = new Map<string, { atMs: number; bytes: number }[]>();
  return {
    spend: (appId, bytes) => {
      assert(bytes >= 0, 'A write spends a nonnegative number of bytes');
      const nowMs = now();
      const recent = (spent.get(appId) ?? []).filter((entry) => nowMs - entry.atMs < APP_FILE_LIMITS.budgetWindowMs);
      if (recent.length >= APP_FILE_LIMITS.writesPerMinuteMax) {
        throw new Error(`An app may change at most ${APP_FILE_LIMITS.writesPerMinuteMax} files a minute; try again shortly`);
      }
      const bytesSpent = recent.reduce((total, entry) => total + entry.bytes, 0);
      if (bytesSpent + bytes > APP_FILE_LIMITS.writeBytesPerMinuteMax) {
        throw new Error(`An app may write at most ${APP_FILE_LIMITS.writeBytesPerMinuteMax} bytes a minute; try again shortly`);
      }
      recent.push({ atMs: nowMs, bytes });
      spent.delete(appId);
      spent.set(appId, recent);
      for (const key of spent.keys()) {
        if (spent.size <= APP_FILE_LIMITS.budgetAppsMax) {
          break;
        }
        spent.delete(key);
      }
      assert(recent.length <= APP_FILE_LIMITS.writesPerMinuteMax, 'The budget window is bounded');
    },
  };
}

export function runAppFileOperation(
  projectRoot: string,
  appId: string,
  operation: AppFileOperation,
  host: { readonly budget: AppFileBudget; readonly writeFile: AppFileWriter },
): AppsResult<AppFileAnswer> {
  try {
    const root = fs.realpathSync(projectRoot);
    return { ok: true, value: dispatch(root, appId, operation, host) };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Assertion failed')) {
      throw error;
    }
    return { ok: false, ...appsFailure(error) };
  }
}

function dispatch(
  root: string,
  appId: string,
  operation: AppFileOperation,
  host: { readonly budget: AppFileBudget; readonly writeFile: AppFileWriter },
): AppFileAnswer {
  switch (operation.kind) {
    case 'list':
      return { kind: 'listing', listing: listFolder(root, appId, operation.dir) };
    case 'read':
      return { kind: 'content', content: readFile(root, appId, operation.path) };
    case 'write': {
      const bytes = operation.encoding === 'base64' ? Buffer.from(operation.content, 'base64') : Buffer.from(operation.content, 'utf8');
      const target = resolveInside(root, appId, operation.path);
      if (isDirectory(target)) {
        throw new Error(`${operation.path} is a folder`);
      }
      host.budget.spend(appId, bytes.byteLength);
      return change(root, appId, [...missingParents(root, operation.path), operation.path], () => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        host.writeFile(target, bytes, operation.encoding === 'utf8' ? operation.content : textOf(bytes));
      });
    }
    case 'delete': {
      const target = resolveInside(root, appId, operation.path);
      const stats = lstatOf(target);
      if (stats === undefined) {
        throw new Error(`${operation.path} does not exist`);
      }
      if (stats.isDirectory() && fs.readdirSync(target).length > 0) {
        throw new Error(`${operation.path} is a folder with files in it; delete its files first`);
      }
      host.budget.spend(appId, 0);
      return change(root, appId, [operation.path], () => removePath(target));
    }
    case 'move': {
      const source = resolveInside(root, appId, operation.from);
      const target = resolveInside(root, appId, operation.to);
      if (!lstatOf(source)?.isFile()) {
        throw new Error(`${operation.from} is not a file; apps move one file at a time`);
      }
      if (lstatOf(target) !== undefined) {
        throw new Error(`${operation.to} already exists`);
      }
      host.budget.spend(appId, 0);
      return change(root, appId, [operation.from, ...missingParents(root, operation.to), operation.to], () => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(source, target);
      });
    }
    case 'mkdir': {
      const target = resolveInside(root, appId, operation.path);
      const existing = lstatOf(target);
      if (existing !== undefined && !existing.isDirectory()) {
        throw new Error(`${operation.path} is a file`);
      }
      host.budget.spend(appId, 0);
      return change(root, appId, [...missingParents(root, operation.path), ...(existing === undefined ? [operation.path] : [])], () => {
        fs.mkdirSync(target, { recursive: true });
      });
    }
    case 'restore':
      return change(
        root,
        appId,
        operation.states.map((state) => state.path),
        () => restoreStates(root, appId, operation.states, host.writeFile),
      );
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

function change(root: string, appId: string, paths: readonly string[], work: () => void): AppFileAnswer {
  assert(paths.length <= APP_FILE_LIMITS.restorePathsMax, 'A change touches a bounded number of paths');
  const before = paths.map((relative) => stateOf(root, appId, relative));
  work();
  const after = paths.map((relative) => stateOf(root, appId, relative));
  assert(before.length === after.length, 'A change records each path before and after');
  return { kind: 'changed', change: { paths, before, after } };
}

function restoreStates(root: string, appId: string, states: readonly AppFileState[], writeFile: AppFileWriter): void {
  const depth = (state: AppFileState): number => state.path.split('/').length;
  const removals = states.filter((state) => state.kind === 'absent').sort((left, right) => depth(right) - depth(left));
  const creations = states.filter((state) => state.kind !== 'absent').sort((left, right) => depth(left) - depth(right));
  assert(removals.length + creations.length === states.length, 'Every state is restored once');
  for (const state of removals) {
    const target = resolveInside(root, appId, state.path);
    const stats = lstatOf(target);
    if (stats?.isDirectory() === true && fs.readdirSync(target).length > 0) {
      throw new Error(`${state.path} now holds other files; it was left as it is`);
    }
    if (stats !== undefined) {
      removePath(target);
    }
  }
  for (const state of creations) {
    const target = resolveInside(root, appId, state.path);
    if (state.kind === 'directory') {
      fs.mkdirSync(target, { recursive: true });
    } else if (state.kind === 'file') {
      const bytes = Buffer.from(state.base64, 'base64');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeFile(target, bytes, textOf(bytes));
    }
  }
}

function missingParents(root: string, relative: string): readonly string[] {
  const segments = relative.split('/');
  const missing: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const parent = segments.slice(0, index).join('/');
    if (lstatOf(path.join(root, parent)) === undefined) {
      missing.push(parent);
    }
  }
  assert(missing.length < APP_FILE_LIMITS.pathSegmentsMax, 'Missing parents are bounded by the path depth');
  return missing;
}

function stateOf(root: string, appId: string, relative: string): AppFileState {
  const target = resolveInside(root, appId, relative);
  const stats = lstatOf(target);
  if (stats === undefined) {
    return { path: relative, kind: 'absent' };
  }
  if (stats.isDirectory()) {
    return { path: relative, kind: 'directory' };
  }
  return { path: relative, kind: 'file', base64: fs.readFileSync(target).toString('base64') };
}

function listFolder(root: string, appId: string, relative: string): AppFileListing {
  const folder = relative === '' ? root : resolveInside(root, appId, relative);
  if (!isDirectory(folder)) {
    throw new Error(`${relative} is not a folder`);
  }
  const entries: AppFileEntry[] = [];
  const names = fs.readdirSync(folder, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1));
  for (const entry of names) {
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink() || appFilePathRefusal(child, appId) !== undefined) {
      continue;
    }
    if (entry.isDirectory()) {
      entries.push({ path: child, kind: 'directory', sizeBytes: 0 });
    } else if (entry.isFile()) {
      const sizeBytes = fs.statSync(path.join(folder, entry.name)).size;
      entries.push({ path: child, kind: 'file', sizeBytes });
    }
  }
  assert(entries.length <= names.length, 'A listing holds no more entries than the folder');
  return { entries, truncated: false };
}

function readFile(root: string, appId: string, relative: string): AppFileContent {
  const target = resolveInside(root, appId, relative);
  const stats = lstatOf(target);
  if (stats === undefined || !stats.isFile()) {
    throw new Error(`${relative} is not a file`);
  }
  const bytes = fs.readFileSync(target);
  const text = textOf(bytes);
  return text === undefined
    ? { path: relative, encoding: 'base64', content: bytes.toString('base64'), sizeBytes: bytes.byteLength }
    : { path: relative, encoding: 'utf8', content: text, sizeBytes: bytes.byteLength };
}

function resolveInside(root: string, appId: string, relative: string): string {
  const segments = relative.split('/');
  let existing = root;
  let rest: string[] = segments;
  for (let index = segments.length; index > 0; index -= 1) {
    const candidate = path.join(root, ...segments.slice(0, index));
    if (lstatOf(candidate) !== undefined) {
      existing = candidate;
      rest = segments.slice(index);
      break;
    }
  }
  const real = fs.realpathSync(existing);
  const resolved = path.join(real, ...rest);
  const inside = path.relative(root, resolved);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`${relative} leads outside the project`);
  }
  const refusal = appFilePathRefusal(inside.split(path.sep).join('/'), appId);
  if (refusal !== undefined) {
    throw new Error(refusal);
  }
  assert(resolved.startsWith(root + path.sep), 'A resolved app path is inside the project');
  return resolved;
}

function removePath(target: string): void {
  const stats = lstatOf(target);
  assert(stats !== undefined, 'Only an existing path is removed');
  if (stats.isDirectory()) {
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

function lstatOf(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return undefined;
    }
    throw error;
  }
}

function isDirectory(target: string): boolean {
  return lstatOf(target)?.isDirectory() === true;
}

function textOf(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
