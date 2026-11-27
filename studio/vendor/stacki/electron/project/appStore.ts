import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { assert } from '../../shared/core/assert';
import { ReferencedError } from '../../shared/properties/i18n/referencedError';
import {
  APP_LIMITS,
  APP_MANIFEST_FILE,
  APPS_DIRECTORY,
  APPS_LOCK_FILE,
  EMPTY_APPS_LOCK,
  EMPTY_APPS_LOCK_READING,
  appFileType,
  parseAppId,
  parseAppManifestSource,
  parseAppsLockSource,
  parseBundlePath,
  readAppsLockEntries,
  serializeAppsLock,
  type AppLockEntry,
  type AppManifest,
  type AppSummary,
  type AppsLock,
  type AppsLockReading,
} from '../../shared/properties/apps';
import type { AppBundle } from '../../shared/properties/appBundle';
import { lockEntriesWithFolders, readFolderBundle, readInstalledApps, type InstalledApps } from './appScan';

const STAGING_PREFIX = '.staging-';

export function readAppsLock(projectRoot: string): AppsLock {
  const file = path.join(projectRoot, APPS_LOCK_FILE);
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error: unknown) {
    if (isMissing(error)) {
      return EMPTY_APPS_LOCK;
    }
    throw error;
  }
  return parseAppsLockSource(source);
}

export function listInstalledApps(projectRoot: string): readonly AppSummary[] {
  const summaries = listInstalledFolders(projectRoot).apps;
  assert(summaries.length <= APP_LIMITS.appsMax, 'Installed apps are bounded');
  return summaries;
}

export function listInstalledFolders(projectRoot: string): InstalledApps {
  return readInstalledApps(projectRoot, readAppsLockForList(projectRoot));
}

export function readAppsLockForList(projectRoot: string): AppsLockReading {
  let source: string;
  try {
    source = fs.readFileSync(path.join(projectRoot, APPS_LOCK_FILE), 'utf8');
  } catch (error: unknown) {
    if (isMissing(error)) {
      return EMPTY_APPS_LOCK_READING;
    }
    return { ...EMPTY_APPS_LOCK_READING, fileFailure: `${APPS_LOCK_FILE} cannot be read: ${String(error).slice(0, 200)}` };
  }
  const reading = readAppsLockEntries(source);
  assert(reading.lock.apps.length <= APP_LIMITS.appsMax, 'A read lockfile is bounded by the app bound');
  return reading;
}

export function readInstalledManifest(projectRoot: string, id: string): AppManifest {
  const file = path.join(appDirectory(projectRoot, id), APP_MANIFEST_FILE);
  const manifest = parseAppManifestSource(fs.readFileSync(file, 'utf8'));
  if (manifest.id !== id) {
    throw new ReferencedError('apps.error.folderHoldsOtherApp', { folder: `.stacki/apps/${id}`, found: manifest.id });
  }
  return manifest;
}

export function readInstalledBundle(projectRoot: string, id: string): AppBundle {
  const bundle = readFolderBundle(appDirectory(projectRoot, id), id);
  if (bundle.manifest.id !== id) {
    throw new ReferencedError('apps.error.folderHoldsOtherApp', { folder: `.stacki/apps/${id}`, found: bundle.manifest.id });
  }
  assert(
    bundle.files.some((file) => file.path === APP_MANIFEST_FILE),
    'An installed app holds its manifest',
  );
  return bundle;
}

export function installAppBundle(projectRoot: string, bundle: AppBundle, entry: AppLockEntry): AppSummary {
  assert(bundle.manifest.id === entry.id, 'A lock entry names the bundle it records');
  assert(bundle.manifest.version === entry.version, 'A lock entry records the bundle’s version');
  const lock = readAppsLock(projectRoot);
  const others = lock.apps.filter((app) => app.id !== entry.id);
  if (others.length >= APP_LIMITS.appsMax) {
    throw new ReferencedError('apps.error.appLimit', { count: APP_LIMITS.appsMax });
  }
  const target = appDirectory(projectRoot, entry.id);
  const staging = path.join(path.dirname(target), `${STAGING_PREFIX}${randomBytes(8).toString('hex')}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const file of bundle.files) {
      const relative = parseBundlePath(file.path);
      const destination = path.join(staging, ...relative.split('/'));
      assert(isInside(staging, destination), 'A bundle file is written inside its staging folder');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, file.bytes, { flag: 'wx' });
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (error: unknown) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  writeAppsLock(projectRoot, { version: 1, apps: [...others, entry] });
  const summary = { manifest: readInstalledManifest(projectRoot, entry.id), lock: entry };
  assert(summary.manifest.version === entry.version, 'The installed manifest reads back as written');
  return summary;
}

export function updateLockEntry(projectRoot: string, id: string, change: (entry: AppLockEntry) => AppLockEntry): AppLockEntry {
  const lock = readAppsLock(projectRoot);
  const current = lock.apps.find((app) => app.id === id);
  if (current === undefined) {
    throw new ReferencedError('apps.error.notInstalled', { id });
  }
  const next = change(current);
  assert(next.id === id, 'A lock change keeps the app id');
  writeAppsLock(projectRoot, { version: 1, apps: lock.apps.map((app) => (app.id === id ? next : app)) });
  return next;
}

export function recordLockEntry(projectRoot: string, entry: AppLockEntry): AppLockEntry {
  assert(fs.existsSync(appDirectory(projectRoot, entry.id)), 'A recorded app’s folder is in place');
  const lock = readAppsLock(projectRoot);
  assert(!lock.apps.some((app) => app.id === entry.id), 'Only an app the lockfile does not name is recorded');
  if (lock.apps.length >= APP_LIMITS.appsMax) {
    throw new ReferencedError('apps.error.appLimit', { count: APP_LIMITS.appsMax });
  }
  writeAppsLock(projectRoot, { version: 1, apps: [...lock.apps, entry] });
  assert(
    readAppsLock(projectRoot).apps.some((app) => app.id === entry.id),
    'A recorded entry reads back',
  );
  return entry;
}

export function uninstallApp(projectRoot: string, id: string): void {
  const lock = readAppsLock(projectRoot);
  if (!lock.apps.some((app) => app.id === id) && !fs.existsSync(appDirectory(projectRoot, id))) {
    throw new ReferencedError('apps.error.notInstalled', { id });
  }
  writeAppsLock(projectRoot, { version: 1, apps: lock.apps.filter((app) => app.id !== id) });
  fs.rmSync(appDirectory(projectRoot, id), { recursive: true, force: true });
  assert(!fs.existsSync(appDirectory(projectRoot, id)), 'An uninstalled app leaves no files');
}

export function readAppFile(projectRoot: string, id: string, requestPath: string): { readonly bytes: Uint8Array; readonly type: string } | undefined {
  const relative = parseBundlePath(requestPath);
  const type = appFileType(relative);
  assert(type !== undefined, 'parseBundlePath accepts only typed files');
  const directory = appDirectory(projectRoot, id);
  const file = path.join(directory, ...relative.split('/'));
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
  if (!isInside(fs.realpathSync(directory), real)) {
    return undefined;
  }
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size > APP_LIMITS.fileBytesMax) {
    return undefined;
  }
  return { bytes: fs.readFileSync(real), type };
}

function appDirectory(projectRoot: string, id: string): string {
  const directory = path.join(projectRoot, APPS_DIRECTORY, parseAppId(id));
  assert(isInside(path.join(projectRoot, APPS_DIRECTORY), directory), 'An app folder is inside .stacki/apps');
  return directory;
}

function writeAppsLock(projectRoot: string, lock: AppsLock): void {
  const file = path.join(projectRoot, APPS_LOCK_FILE);
  const source = serializeAppsLock({ version: 1, apps: lockEntriesWithFolders(projectRoot, lock.apps) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, source, { flag: 'wx' });
  fs.renameSync(temporary, file);
  assert(fs.readFileSync(file, 'utf8') === source, 'The lockfile reads back as written');
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
