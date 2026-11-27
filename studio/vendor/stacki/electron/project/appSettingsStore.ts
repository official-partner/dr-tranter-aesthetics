import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { assert } from '../../shared/core/assert';
import { record, text } from '../../shared/core/boundary';
import { APPS_DIRECTORY, parseAppId, type AppManifest } from '../../shared/properties/apps';
import {
  APP_SETTINGS_FILE,
  APP_SETTINGS_LIMITS,
  EMPTY_APP_SETTINGS_FILE,
  parseAppSettingsFileSource,
  serializeAppSettingsFile,
  splitAppSettingValues,
  type AppSettingValues,
  type AppSettingsFile,
} from '../../shared/properties/appSettings';

export interface SecretSeal {
  readonly refusal: () => string | undefined;
  readonly seal: (value: string) => string;
  readonly open: (sealed: string) => string;
}

export interface SecretVault {
  readonly directory: () => string;
  readonly seal: SecretSeal;
}

const VAULT_LIMITS = {
  fileBytesMax: 2 * 1024 * 1024,
  sealedCharsMax: APP_SETTINGS_LIMITS.valueCharsMax * 2 + 256,
} as const satisfies Record<string, number>;

export function readAppSettings(projectRoot: string, vault: SecretVault, manifest: AppManifest): AppSettingValues {
  const plain = readSettingsFile(projectRoot).apps[manifest.id] ?? {};
  const secrets = readVaultApp(vault, projectRoot, manifest.id);
  const values: Record<string, string> = {};
  for (const declaration of manifest.settings) {
    const value = declaration.kind === 'secret' ? secrets[declaration.id] : plain[declaration.id];
    if (value !== undefined) {
      values[declaration.id] = value;
    }
  }
  assert(Object.keys(values).length <= manifest.settings.length, 'Only declared settings are read');
  return values;
}

export function writeAppSettings(projectRoot: string, vault: SecretVault, manifest: AppManifest, values: AppSettingValues): AppSettingValues {
  const { plain, secret } = splitAppSettingValues(manifest.settings, values);
  const refusal = Object.keys(secret).length > 0 ? vault.seal.refusal() : undefined;
  if (refusal !== undefined) {
    throw new Error(`${refusal} Nothing was saved.`);
  }
  const file = readSettingsFile(projectRoot);
  writeSettingsFile(projectRoot, { version: 1, apps: { ...file.apps, [manifest.id]: plain } });
  writeVaultApp(vault, projectRoot, manifest.id, secret);
  const written = readAppSettings(projectRoot, vault, manifest);
  assert(Object.keys(written).length === Object.keys(plain).length + Object.keys(secret).length, 'Settings read back as written');
  return written;
}

export function forgetAppSettings(projectRoot: string, vault: SecretVault, id: string): void {
  const file = readSettingsFile(projectRoot);
  if (file.apps[id] !== undefined) {
    const apps = { ...file.apps };
    delete apps[id];
    writeSettingsFile(projectRoot, { version: 1, apps });
  }
  writeVaultApp(vault, projectRoot, id, {});
}

export function secretVaultFile(vault: Pick<SecretVault, 'directory'>, projectRoot: string): string {
  const real = realPath(projectRoot);
  const name = createHash('sha256').update(real).digest('hex').slice(0, 32);
  const file = path.join(vault.directory(), `${name}.json`);
  assert(!isInsideOrEqual(real, path.resolve(file)), 'A secret vault is never inside the project');
  assert(!isInsideOrEqual(path.resolve(projectRoot), path.resolve(file)), 'A secret vault is never inside the project path');
  return file;
}

function readSettingsFile(projectRoot: string): AppSettingsFile {
  const file = path.join(projectRoot, APP_SETTINGS_FILE);
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error: unknown) {
    if (isMissing(error)) {
      return EMPTY_APP_SETTINGS_FILE;
    }
    throw error;
  }
  return parseAppSettingsFileSource(source, parseAppId);
}

function writeSettingsFile(projectRoot: string, settings: AppSettingsFile): void {
  const file = path.join(projectRoot, APP_SETTINGS_FILE);
  assert(path.dirname(file) === path.join(projectRoot, APPS_DIRECTORY), 'The settings file sits in .stacki/apps');
  const source = serializeAppSettingsFile(settings);
  atomicWrite(file, source, { mode: 0o644 });
  assert(fs.readFileSync(file, 'utf8') === source, 'The settings file reads back as written');
}

function readVaultApp(vault: SecretVault, projectRoot: string, id: string): AppSettingValues {
  const sealed = readVault(vault, projectRoot)[id] ?? {};
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(sealed)) {
    try {
      values[key] = vault.seal.open(value);
    } catch {
    }
  }
  return values;
}

function writeVaultApp(vault: SecretVault, projectRoot: string, id: string, secret: AppSettingValues): void {
  const current = readVault(vault, projectRoot);
  const sealed: Record<string, string> = {};
  for (const [key, value] of Object.entries(secret)) {
    sealed[key] = vault.seal.seal(value);
    assert(sealed[key] !== value, 'A secret is never kept as typed');
  }
  const next: Record<string, Record<string, string>> = { ...current };
  if (Object.keys(sealed).length === 0) {
    delete next[id];
  } else {
    next[id] = sealed;
  }
  const file = secretVaultFile(vault, projectRoot);
  if (Object.keys(next).length === 0 && !fs.existsSync(file)) {
    return;
  }
  const source = `${JSON.stringify({ version: 1, apps: next })}\n`;
  if (source.length > VAULT_LIMITS.fileBytesMax) {
    throw new Error('The secret settings exceed their limit; nothing was saved.');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  atomicWrite(file, source, { mode: 0o600 });
  assert(!isInsideOrEqual(realPath(projectRoot), realPath(file)), 'A written vault is outside the project');
}

function readVault(vault: SecretVault, projectRoot: string): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const file = secretVaultFile(vault, projectRoot);
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error: unknown) {
    if (isMissing(error)) {
      return {};
    }
    throw error;
  }
  if (source.length > VAULT_LIMITS.fileBytesMax) {
    throw new Error('The secret settings file exceeds its limit.');
  }
  const parsed: unknown = JSON.parse(source);
  const value = record(parsed);
  if (value['version'] !== 1) {
    throw new Error('The secret settings file version must be 1');
  }
  const apps = Object.entries(record(value['apps']));
  if (apps.length > APP_SETTINGS_LIMITS.appsMax) {
    throw new Error('The secret settings file names too many apps');
  }
  const result: Record<string, Record<string, string>> = {};
  for (const [id, sealed] of apps) {
    const entries = Object.entries(record(sealed));
    if (entries.length > APP_SETTINGS_LIMITS.settingsMax) {
      throw new Error('An app has too many secret settings');
    }
    const values: Record<string, string> = {};
    for (const [key, raw] of entries) {
      const sealedValue = text(raw);
      if (sealedValue.length > VAULT_LIMITS.sealedCharsMax) {
        throw new Error('A sealed setting exceeds its limit');
      }
      values[key] = sealedValue;
    }
    result[parseAppId(id)] = values;
  }
  return result;
}

function atomicWrite(file: string, source: string, options: { readonly mode: number }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, source, { flag: 'wx', mode: options.mode });
  fs.renameSync(temporary, file);
}

function realPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
