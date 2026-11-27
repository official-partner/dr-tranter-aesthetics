import { parseAppCommands, parseShortcutClaims, type AppCommand } from './appShortcuts';
import { parseAppSettingDeclarations, type AppSettingDeclaration } from './appSettings';
import { parseAppPermissionDeclarations, type AppPermissionDeclaration } from './appPermissions';
import { parseSecretsAllowlist, type AppSecretAllowance } from './appSecrets';
import { parseAppAuthProviders, parseAppNetwork, type AppAuthProvider, type AppNetworkHost } from './appAuth';
import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';
import { parseGitHubLogin } from './projectRoles';
import { parseMessageRef, parseOptionalMessageRef, type MessageRef } from '../core/i18n/messageReference';
import { described, type Described, type TypedMessageRef } from './i18n/messageRef';
import { ReferencedError } from './i18n/referencedError';

export const APPS_DIRECTORY = '.stacki/apps';
export const APPS_LOCK_FILE = '.stacki/apps/apps.json';
export const APP_MANIFEST_FILE = 'stacki-app.json';
export const APP_SDK_FILE = 'stacki-sdk.js';
export const APP_HOST_FOLDER = '__stacki';

export const APP_LIMITS = {
  idCharsMax: 64,
  nameCharsMax: 60,
  descriptionCharsMax: 280,
  versionCharsMax: 32,
  appsMax: 50,
  updateAdditionsMax: 64,
  updateAdditionCharsMax: 160,
  filesMax: 200,
  fileBytesMax: 5 * 1024 * 1024,
  bundleBytesMax: 20 * 1024 * 1024,
  archiveBytesMax: 10 * 1024 * 1024,
  pathCharsMax: 200,
  pathDepthMax: 8,
  manifestBytesMax: 16 * 1024,
  lockBytesMax: 256 * 1024,
  windowWidthPxMin: 240,
  windowWidthPxMax: 1600,
  windowHeightPxMin: 160,
  windowHeightPxMax: 1200,
  ownerCharsMax: 39,
  repositoryCharsMax: 100,
  assetNameCharsMax: 120,
  tagCharsMax: 128,
  messageCharsMax: 1000,
  iconBytesMax: 256 * 1024,
  iconPxMax: 512,
} as const satisfies Record<string, number>;

export const APP_WINDOW_MODES = ['panel', 'popup'] as const;
export type AppWindowMode = (typeof APP_WINDOW_MODES)[number];

export const APP_WINDOW_DEFAULT = { widthPx: 360, heightPx: 480 } as const satisfies Record<string, number>;

export interface AppWindow {
  readonly mode: AppWindowMode;
  readonly widthPx: number | undefined;
  readonly heightPx: number | undefined;
}

export interface AppGitHubSource {
  readonly kind: 'github';
  readonly owner: string;
  readonly repository: string;
  readonly asset: string;
  readonly account?: string | undefined;
}

export interface AppManifest {
  readonly manifestVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly icon: string | undefined;
  readonly entry: string;
  readonly window: AppWindow;
  readonly source: AppGitHubSource | undefined;
  readonly authorGitHub: string | undefined;
  readonly commands: readonly AppCommand[];
  readonly shortcutClaims: readonly string[];
  readonly settings: readonly AppSettingDeclaration[];
  readonly secretsAllowlist: readonly AppSecretAllowance[];
  readonly network: readonly AppNetworkHost[];
  readonly auth: readonly AppAuthProvider[];
  readonly permissions: readonly AppPermissionDeclaration[];
  readonly stackiVersionMin: string | undefined;
}

export type AppInstallSource =
  | { readonly kind: 'file'; readonly fileName: string }
  | { readonly kind: 'local' }
  | (AppGitHubSource & { readonly tag: string })
  | { readonly kind: 'marketplace'; readonly id: string; readonly version: string };

export interface AppAvailableUpdate {
  readonly version: string;
  readonly tag: string;
  readonly sha256: string;
  readonly additions: readonly string[];
}

export interface AppLockEntry {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
  readonly installedAt: string;
  readonly source: AppInstallSource;
  readonly update: AppAvailableUpdate | undefined;
  readonly autoUpdate: boolean;
}

export interface AppsLock {
  readonly version: 1;
  readonly apps: readonly AppLockEntry[];
}

export const EMPTY_APPS_LOCK: AppsLock = { version: 1, apps: [] };

export interface AppSummary {
  readonly manifest: AppManifest;
  readonly lock: AppLockEntry;
}

export interface AppStaged {
  readonly token: string;
  readonly manifest: AppManifest;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly source: AppInstallSource;
  readonly replaces: string | undefined;
}

export type AppsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly messageRef?: MessageRef | undefined };

export type AppUpdateOutcome =
  | { readonly kind: 'current'; readonly id: string }
  | { readonly kind: 'available'; readonly id: string; readonly version: string }
  | { readonly kind: 'failed'; readonly id: string; readonly message: string; readonly messageRef?: MessageRef | undefined }
  | { readonly kind: 'needs-approval'; readonly id: string; readonly version: string; readonly additions: readonly string[] }
  | { readonly kind: 'updated'; readonly id: string; readonly version: string };


const APP_ID = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z.-]{1,20}))?$/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9._-]+$/;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.zip$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function parseAppId(input: unknown): string {
  const id = text(input);
  if (id.length === 0 || id.length > APP_LIMITS.idCharsMax) {
    throw new Error(`An app id is 1 to ${APP_LIMITS.idCharsMax} characters`);
  }
  if (!APP_ID.test(id)) {
    throw new Error(`App id "${id}" must be lowercase letters, digits, dots, dashes and underscores`);
  }
  assert(!id.includes('/'), 'An app id never names a path');
  return id;
}

export function parseAppVersion(input: unknown): string {
  const version = text(input);
  if (version.length > APP_LIMITS.versionCharsMax) {
    throw new Error('App version exceeds limit');
  }
  if (!VERSION.test(version)) {
    throw new Error(`App version "${version}" is not MAJOR.MINOR.PATCH`);
  }
  return version;
}

const STACKI_RANGE = /^>=(\d+\.\d+\.\d+)$/;
const STACKI_RANGE_CHARS_MAX = APP_LIMITS.versionCharsMax + 2;

export function parseStackiRange(input: unknown): string {
  const range = text(input).trim();
  if (range.length === 0 || range.length > STACKI_RANGE_CHARS_MAX) {
    throw new Error(`stacki must be ">=MAJOR.MINOR.PATCH", at most ${STACKI_RANGE_CHARS_MAX} characters`);
  }
  const match = STACKI_RANGE.exec(range);
  if (match === null) {
    throw new Error(`stacki "${range.slice(0, 40)}" must be ">=MAJOR.MINOR.PATCH", such as ">=1.1.0"`);
  }
  const minimum = parseStackiVersionMin(match[1]);
  assert(range.endsWith(minimum), 'The minimum is the range’s own version');
  return minimum;
}

export function parseStackiVersionMin(input: unknown): string {
  const version = parseAppVersion(input);
  if (version.includes('-')) {
    throw new Error(`The minimum Stacki version "${version}" must be a release, not a prerelease`);
  }
  return version;
}

function parseManifestStackiVersionMin(value: Readonly<Record<string, unknown>>): string | undefined {
  const range = value['stacki'];
  const parsed = value['stackiVersionMin'];
  if (range !== undefined) {
    if (parsed !== undefined) {
      throw new Error('Name stacki or stackiVersionMin, not both');
    }
    return parseStackiRange(range);
  }
  return parsed === undefined ? undefined : parseStackiVersionMin(parsed);
}

export function stackiVersionDescribed(minimum: string): Described & { readonly messageRef: TypedMessageRef } {
  assert(minimum.length > 0, 'A minimum Stacki version is never empty');
  return described('apps.market.needsStacki', { minimum });
}

export function stackiVersionMessage(minimum: string): string {
  return stackiVersionDescribed(minimum).message;
}

export function stackiVersionProblem(minimum: string | undefined, running: string): string | undefined {
  return stackiVersionProblemDescribed(minimum, running)?.message;
}

export function stackiVersionProblemDescribed(
  minimum: string | undefined,
  running: string,
): (Described & { readonly messageRef: TypedMessageRef }) | undefined {
  if (minimum === undefined) {
    return undefined;
  }
  if (!VERSION.test(running)) {
    return undefined;
  }
  if (compareAppVersions(running, minimum) >= 0) {
    return undefined;
  }
  const problem = stackiVersionDescribed(minimum);
  assert(problem.message.includes(minimum), 'The message names the version needed');
  return problem;
}

export function compareAppVersions(left: string, right: string): number {
  const first = versionParts(left);
  const second = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (first.numbers[index] ?? 0) - (second.numbers[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (first.prerelease === second.prerelease) {
    return 0;
  }
  if (first.prerelease === undefined) {
    return 1;
  }
  if (second.prerelease === undefined) {
    return -1;
  }
  return first.prerelease < second.prerelease ? -1 : 1;
}

function versionParts(version: string): { readonly numbers: readonly number[]; readonly prerelease: string | undefined } {
  const match = VERSION.exec(version);
  assert(match !== null, 'compareAppVersions takes parsed versions');
  const numbers = [match[1], match[2], match[3]].map((part) => Number(part));
  assert(
    numbers.every((part) => Number.isSafeInteger(part)),
    'Version parts are integers',
  );
  return { numbers, prerelease: match[4] ?? undefined };
}

export function parseSha256(input: unknown): string {
  const value = text(input);
  if (!SHA256.test(value)) {
    throw new Error('Expected a lowercase hex SHA-256');
  }
  return value;
}

function boundedText(input: unknown, charsMax: number, what: string): string {
  const value = text(input).trim();
  if (value.length === 0) {
    throw new Error(`${what} is empty`);
  }
  if (value.length > charsMax) {
    throw new Error(`${what} exceeds ${charsMax} characters`);
  }
  return value;
}


export const APP_FILE_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

const PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

export function parseBundlePath(input: unknown): string {
  const value = text(input);
  if (value.length === 0 || value.length > APP_LIMITS.pathCharsMax) {
    throw new Error(`A bundle path is 1 to ${APP_LIMITS.pathCharsMax} characters`);
  }
  const segments = value.split('/');
  if (segments.length > APP_LIMITS.pathDepthMax) {
    throw new Error('A bundle path is nested too deeply');
  }
  for (const segment of segments) {
    if (!PATH_SEGMENT.test(segment)) {
      throw new Error(`Bundle path "${value.slice(0, 80)}" has an unsafe segment`);
    }
  }
  if (appFileType(value) === undefined) {
    throw new Error(`Bundle file "${value.slice(0, 80)}" is not a type an app may hold`);
  }
  assert(!value.startsWith('/'), 'A bundle path is relative');
  assert(!segments.includes('..'), 'A bundle path never climbs');
  return value;
}

export function appFileType(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0) {
    return undefined;
  }
  const extension = path.slice(dot + 1).toLowerCase();
  return Object.hasOwn(APP_FILE_TYPES, extension) ? APP_FILE_TYPES[extension] : undefined;
}


export function parseAppManifestSource(source: string): AppManifest {
  if (source.length > APP_LIMITS.manifestBytesMax) {
    throw new Error(`${APP_MANIFEST_FILE} exceeds ${APP_LIMITS.manifestBytesMax} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error: unknown) {
    throw new Error(`${APP_MANIFEST_FILE} is not JSON: ${String(error).slice(0, 200)}`);
  }
  return parseAppManifest(parsed);
}

export function parseAppManifest(input: unknown): AppManifest {
  const value = record(input);
  if (value['manifestVersion'] !== 1) {
    throw new Error('manifestVersion must be 1');
  }
  const entry = parseBundlePath(value['entry']);
  if (!entry.endsWith('.html')) {
    throw new Error('The entry must be an HTML file');
  }
  const icon = value['icon'] === undefined ? undefined : parseIconPath(value['icon']);
  const settings = parseAppSettingDeclarations(value['settings']);
  const manifest: AppManifest = {
    manifestVersion: 1,
    id: parseAppId(value['id']),
    name: boundedText(value['name'], APP_LIMITS.nameCharsMax, 'App name'),
    version: parseAppVersion(value['version']),
    description:
      value['description'] === undefined || value['description'] === ''
        ? ''
        : boundedText(value['description'], APP_LIMITS.descriptionCharsMax, 'App description'),
    icon,
    entry,
    window: parseAppWindow(value['window'] ?? {}),
    source: value['source'] === undefined ? undefined : parseGitHubSource(value['source']),
    authorGitHub: value['author'] === undefined ? parseParsedAuthor(value['authorGitHub']) : parseAuthor(value['author']),
    commands: parseAppCommands(value['commands']),
    shortcutClaims: parseShortcutClaims(value['shortcutClaims']),
    settings,
    secretsAllowlist: parseSecretsAllowlist(value['secretsAllowlist'], parseBundlePath),
    network: parseAppNetwork(value['network']),
    auth: parseAppAuthProviders(value['auth'], settings),
    permissions: parseAppPermissionDeclarations(value['permissions']),
    stackiVersionMin: parseManifestStackiVersionMin(value),
  };
  assert(manifest.entry !== APP_SDK_FILE, 'The entry is never the host SDK');
  return manifest;
}

function parseParsedAuthor(input: unknown): string | undefined {
  return input === undefined ? undefined : parseGitHubLogin(input);
}

function fileOrParsed(value: Readonly<Record<string, unknown>>, fileKey: string, parsedKey: string): unknown {
  const fromFile = value[fileKey];
  if (fromFile === undefined) {
    return value[parsedKey];
  }
  if (value[parsedKey] !== undefined) {
    throw new Error(`Name ${fileKey} or ${parsedKey}, not both`);
  }
  return fromFile;
}

function parseAuthor(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const github = record(input)['github'];
  return github === undefined ? undefined : parseGitHubLogin(github);
}

export function appAuthorLogin(summary: AppSummary): string | undefined {
  const source = summary.lock.source;
  const login = summary.manifest.authorGitHub ?? (source.kind === 'github' ? source.owner : undefined);
  assert(login === undefined || login.length > 0, 'An author login is never empty');
  return login;
}

function parseIconPath(input: unknown): string {
  const icon = parseBundlePath(input);
  if (!/\.(svg|png|webp)$/i.test(icon)) {
    throw new Error('An app icon is a PNG, SVG or WebP image');
  }
  return icon;
}

export function parseAppWindow(input: unknown): AppWindow {
  const value = record(input);
  if (value['kind'] !== undefined) {
    throw new Error('window.kind is now window.mode: "panel" or "popup"');
  }
  const mode = value['mode'] ?? 'panel';
  if (mode !== 'panel' && mode !== 'popup') {
    throw new Error('window.mode must be "panel" or "popup"');
  }
  const width = fileOrParsed(value, 'width', 'widthPx');
  const height = fileOrParsed(value, 'height', 'heightPx');
  const parsed: AppWindow = {
    mode,
    widthPx: width === undefined ? undefined : pixels(width, APP_LIMITS.windowWidthPxMin, APP_LIMITS.windowWidthPxMax, 'Window width'),
    heightPx: height === undefined ? undefined : pixels(height, APP_LIMITS.windowHeightPxMin, APP_LIMITS.windowHeightPxMax, 'Window height'),
  };
  assert(APP_WINDOW_MODES.includes(parsed.mode), 'A parsed window mode is a known mode');
  return parsed;
}

export function appPopupSize(placement: AppWindow): { readonly widthPx: number; readonly heightPx: number } {
  const size = { widthPx: placement.widthPx ?? APP_WINDOW_DEFAULT.widthPx, heightPx: placement.heightPx ?? APP_WINDOW_DEFAULT.heightPx };
  assert(size.widthPx >= APP_LIMITS.windowWidthPxMin, 'A popup is at least the minimum width');
  assert(size.widthPx <= APP_LIMITS.windowWidthPxMax, 'A popup is at most the maximum width');
  assert(size.heightPx >= APP_LIMITS.windowHeightPxMin, 'A popup is at least the minimum height');
  assert(size.heightPx <= APP_LIMITS.windowHeightPxMax, 'A popup is at most the maximum height');
  return size;
}

function pixels(input: unknown, minimum: number, maximum: number, what: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) {
    throw new Error(`${what} must be a whole number of pixels`);
  }
  if (input < minimum || input > maximum) {
    throw new Error(`${what} must be ${minimum} to ${maximum} pixels`);
  }
  return input;
}

export function parseGitHubSource(input: unknown): AppGitHubSource {
  const value = record(input);
  if (value['kind'] !== undefined && value['kind'] !== 'github') {
    throw new Error('source.kind must be "github"');
  }
  const owner = boundedText(value['owner'], APP_LIMITS.ownerCharsMax, 'GitHub owner');
  if (!GITHUB_OWNER.test(owner)) {
    throw new Error(`"${owner}" is not a GitHub owner`);
  }
  const repository = boundedText(value['repository'] ?? value['repo'], APP_LIMITS.repositoryCharsMax, 'GitHub repository');
  if (!GITHUB_REPOSITORY.test(repository) || repository === '.' || repository === '..') {
    throw new Error(`"${repository}" is not a GitHub repository name`);
  }
  const asset = boundedText(value['asset'], APP_LIMITS.assetNameCharsMax, 'Release asset');
  if (!ASSET_NAME.test(asset)) {
    throw new Error('The release asset must be a .zip file name');
  }
  if (value['account'] === undefined || value['account'] === null) {
    return { kind: 'github', owner, repository, asset };
  }
  return { kind: 'github', owner, repository, asset, account: parseGitHubLogin(value['account']) };
}


export type AppRepositoryListing =
  | { readonly kind: 'ready'; readonly repositories: readonly AppRepository[] }
  | { readonly kind: 'failed'; readonly message: string; readonly messageRef?: MessageRef | undefined }
  | { readonly kind: 'rate-limited'; readonly resetAtMs: number | undefined }
  | { readonly kind: 'restart' };

const RATE_LIMIT_MESSAGE = /^GitHub is limiting requests(?: until (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z))?\.$/;

export function rateLimitMessage(resetAtMs: number | undefined): string {
  if (resetAtMs === undefined) {
    return 'GitHub is limiting requests.';
  }
  assert(Number.isSafeInteger(resetAtMs), 'A rate-limit reset is a whole millisecond time');
  assert(resetAtMs >= 0, 'A rate-limit reset is after 1970');
  const message = `GitHub is limiting requests until ${new Date(resetAtMs).toISOString()}.`;
  assert(RATE_LIMIT_MESSAGE.test(message), 'The rate-limit message reads back');
  return message;
}

export function parseRateLimitMessage(message: string): { readonly resetAtMs: number | undefined } | undefined {
  const match = RATE_LIMIT_MESSAGE.exec(message) ?? undefined;
  if (match === undefined) {
    return undefined;
  }
  const iso = match[1];
  if (iso === undefined) {
    return { resetAtMs: undefined };
  }
  const resetAtMs = Date.parse(iso);
  return { resetAtMs: Number.isNaN(resetAtMs) ? undefined : resetAtMs };
}

export interface GitHubRepositoryReference {
  readonly owner: string;
  readonly repository: string;
}

const REPOSITORY_REFERENCE_CHARS_MAX = 300;

export function parseGitHubRepositoryReference(input: string): GitHubRepositoryReference | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > REPOSITORY_REFERENCE_CHARS_MAX) {
    return undefined;
  }
  const hosted = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+)(?:[/?#]\S*)?$/i.exec(trimmed) ?? undefined;
  const match = hosted ?? /^([^/\s]+)\/([^/\s]+?)\/?$/.exec(trimmed) ?? undefined;
  if (match === undefined) {
    return undefined;
  }
  const owner = match[1] ?? '';
  const repository = (match[2] ?? '').replace(/\.git$/i, '');
  if (owner.length === 0 || owner.length > APP_LIMITS.ownerCharsMax || !GITHUB_OWNER.test(owner)) {
    return undefined;
  }
  if (repository.length === 0 || repository.length > APP_LIMITS.repositoryCharsMax || !GITHUB_REPOSITORY.test(repository)) {
    return undefined;
  }
  if (repository === '.' || repository === '..') {
    return undefined;
  }
  assert(owner.length <= APP_LIMITS.ownerCharsMax, 'A parsed owner is within GitHub’s limit');
  return { owner, repository };
}

export const APP_GITHUB_CHOICE_LIMITS = {
  repositoriesMax: 300,
  releasesMax: 30,
  assetsMax: 100,
} as const satisfies Record<string, number>;

export interface AppRepository {
  readonly owner: string;
  readonly name: string;
  readonly private: boolean;
  readonly updatedAt: string;
  readonly stackiApp: boolean;
  readonly organization: boolean;
}

export interface AppReleaseAsset {
  readonly name: string;
  readonly sizeBytes: number;
}

export interface AppRelease {
  readonly tag: string;
  readonly name: string;
  readonly publishedAt: string;
  readonly prerelease: boolean;
  readonly assets: readonly AppReleaseAsset[];
}

export type AppAssetChoice =
  | { readonly kind: 'single'; readonly asset: AppReleaseAsset }
  | { readonly kind: 'choose'; readonly assets: readonly AppReleaseAsset[] }
  | { readonly kind: 'none' };

export function releaseAssetChoice(release: AppRelease): AppAssetChoice {
  const zips = release.assets.filter((asset) => ASSET_NAME.test(asset.name) && asset.sizeBytes <= APP_LIMITS.archiveBytesMax);
  assert(zips.length <= release.assets.length, 'Candidates come from the release');
  const only = zips[0];
  if (zips.length === 1 && only !== undefined) {
    return { kind: 'single', asset: only };
  }
  return zips.length === 0 ? { kind: 'none' } : { kind: 'choose', assets: zips };
}

export function orderReleases(releases: readonly AppRelease[]): readonly AppRelease[] {
  const ordered = releases
    .map((release, index) => ({ release, index, time: Date.parse(release.publishedAt) }))
    .sort((left, right) => (right.time || 0) - (left.time || 0) || left.index - right.index)
    .map((entry) => entry.release);
  assert(ordered.length === releases.length, 'Ordering keeps every release');
  return ordered;
}

function isoTime(input: unknown, what: string): string {
  const value = text(input);
  if (value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new Error(`${what} must be an ISO date`);
  }
  return value;
}

export function parseAppRepositories(input: unknown): readonly AppRepository[] {
  const items = toArray(input);
  if (items === undefined || items.length > APP_GITHUB_CHOICE_LIMITS.repositoriesMax) {
    throw new Error('Expected a bounded list of repositories');
  }
  return items.map((item) => {
    const value = record(item);
    const source = parseGitHubSource({ owner: value['owner'], repository: value['name'], asset: 'app.zip' });
    if (typeof value['private'] !== 'boolean') {
      throw new Error('A repository says whether it is private');
    }
    if (typeof value['stackiApp'] !== 'boolean') {
      throw new Error('A repository says whether it carries the stacki-app topic');
    }
    return {
      owner: source.owner,
      name: source.repository,
      private: value['private'],
      updatedAt: isoTime(value['updatedAt'], 'updatedAt'),
      stackiApp: value['stackiApp'],
      organization: value['organization'] === true,
    };
  });
}

export function parseAppReleases(input: unknown): readonly AppRelease[] {
  const items = toArray(input);
  if (items === undefined || items.length > APP_GITHUB_CHOICE_LIMITS.releasesMax) {
    throw new Error('Expected a bounded list of releases');
  }
  return items.map((item) => {
    const value = record(item);
    const assets = toArray(value['assets']);
    if (assets === undefined || assets.length > APP_GITHUB_CHOICE_LIMITS.assetsMax) {
      throw new Error('Expected a bounded list of assets');
    }
    if (typeof value['prerelease'] !== 'boolean') {
      throw new Error('A release says whether it is a pre-release');
    }
    return {
      tag: boundedText(value['tag'], APP_LIMITS.tagCharsMax, 'Release tag'),
      name: typeof value['name'] === 'string' ? value['name'].slice(0, APP_LIMITS.nameCharsMax * 2) : '',
      publishedAt: isoTime(value['publishedAt'], 'publishedAt'),
      prerelease: value['prerelease'],
      assets: assets.map((asset) => {
        const fields = record(asset);
        const sizeBytes = fields['sizeBytes'];
        if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
          throw new Error('An asset has a size');
        }
        return { name: boundedText(fields['name'], APP_LIMITS.assetNameCharsMax * 2, 'Asset name'), sizeBytes };
      }),
    };
  });
}

export function parseReleaseTag(input: unknown): string {
  return boundedText(input, APP_LIMITS.tagCharsMax, 'Release tag');
}


export function parseAppsLockSource(source: string): AppsLock {
  if (source.length > APP_LIMITS.lockBytesMax) {
    throw new Error(`${APPS_LOCK_FILE} exceeds ${APP_LIMITS.lockBytesMax} bytes`);
  }
  return parseAppsLock(JSON.parse(source) as unknown);
}

export function parseAppsLock(input: unknown): AppsLock {
  const value = record(input);
  if (value['version'] !== 1) {
    throw new Error('Apps lockfile version must be 1');
  }
  const items = toArray(value['apps']);
  if (items === undefined) {
    throw new Error('Apps lockfile needs an apps list');
  }
  if (items.length > APP_LIMITS.appsMax) {
    throw new Error(`A project has at most ${APP_LIMITS.appsMax} apps`);
  }
  const apps = items.map(parseLockEntry);
  const ids = new Set(apps.map((app) => app.id));
  if (ids.size !== apps.length) {
    throw new Error('An app is listed twice in the lockfile');
  }
  return { version: 1, apps };
}

export interface AppsLockReading {
  readonly lock: AppsLock;
  readonly entryFailures: ReadonlyMap<string, string>;
  readonly fileFailure: string | undefined;
}

export const EMPTY_APPS_LOCK_READING: AppsLockReading = { lock: EMPTY_APPS_LOCK, entryFailures: new Map(), fileFailure: undefined };

export function readAppsLockEntries(source: string): AppsLockReading {
  let input: unknown;
  try {
    if (source.length > APP_LIMITS.lockBytesMax) {
      throw new Error(`${APPS_LOCK_FILE} exceeds ${APP_LIMITS.lockBytesMax} bytes`);
    }
    input = JSON.parse(source) as unknown;
  } catch (error: unknown) {
    return { ...EMPTY_APPS_LOCK_READING, fileFailure: `${APPS_LOCK_FILE} cannot be read: ${appsFailureMessage(error)}` };
  }
  const items = lockItems(input);
  if (items === undefined) {
    return { ...EMPTY_APPS_LOCK_READING, fileFailure: `${APPS_LOCK_FILE} is not a version 1 lockfile of at most ${APP_LIMITS.appsMax} apps` };
  }
  const apps = new Map<string, AppLockEntry>();
  const entryFailures = new Map<string, string>();
  const unnamed: string[] = [];
  for (const item of items) {
    const id = lockEntryId(item);
    let entry: AppLockEntry;
    try {
      entry = parseLockEntry(item);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Assertion failed')) {
        throw error;
      }
      if (id === undefined) {
        unnamed.push(appsFailureMessage(error));
      } else {
        entryFailures.set(id, `Its entry in ${APPS_LOCK_FILE} is invalid: ${appsFailureMessage(error)}`);
      }
      continue;
    }
    if (apps.has(entry.id)) {
      apps.delete(entry.id);
      entryFailures.set(entry.id, `${APPS_LOCK_FILE} lists this app twice`);
    } else if (!entryFailures.has(entry.id)) {
      apps.set(entry.id, entry);
    }
  }
  assert(apps.size + entryFailures.size + unnamed.length <= items.length, 'Every lock entry is read at most once');
  const fileFailure =
    unnamed.length === 0 ? undefined : `${APPS_LOCK_FILE} has an entry with no valid id: ${unnamed[0] ?? ''}`.slice(0, APP_LIMITS.messageCharsMax);
  return { lock: { version: 1, apps: [...apps.values()] }, entryFailures, fileFailure };
}

function lockItems(input: unknown): readonly unknown[] | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  if (Reflect.get(input, 'version') !== 1) {
    return undefined;
  }
  const items = toArray(Reflect.get(input, 'apps'));
  if (items === undefined) {
    return undefined;
  }
  return items.length <= APP_LIMITS.appsMax ? items : undefined;
}

function lockEntryId(item: unknown): string | undefined {
  if (typeof item !== 'object' || item === null) {
    return undefined;
  }
  try {
    return parseAppId(Reflect.get(item, 'id'));
  } catch {
    return undefined;
  }
}

export function parseLockEntry(input: unknown): AppLockEntry {
  const value = record(input);
  const installedAt = text(value['installedAt']);
  if (installedAt.length > 40 || Number.isNaN(Date.parse(installedAt))) {
    throw new Error('installedAt must be an ISO date');
  }
  const update = value['update'] === undefined || value['update'] === null ? undefined : parseAvailableUpdate(value['update']);
  const id = parseAppId(value['id']);
  const source = parseInstallSource(value['source']);
  if (source.kind === 'marketplace' && source.id !== id) {
    throw new Error(`The lock entry "${id}" names the marketplace app "${source.id}"`);
  }
  return {
    id,
    version: parseAppVersion(value['version']),
    sha256: parseSha256(value['sha256']),
    installedAt,
    source,
    update,
    autoUpdate: parseAutoUpdate(value['autoUpdate']),
  };
}

function parseAutoUpdate(input: unknown): boolean {
  if (input === undefined || input === null) {
    return false;
  }
  if (typeof input !== 'boolean') {
    throw new Error('autoUpdate must be true or false');
  }
  return input;
}

export function parseInstallSource(input: unknown): AppInstallSource {
  const value = record(input);
  if (value['kind'] === 'file') {
    return { kind: 'file', fileName: boundedText(value['fileName'], APP_LIMITS.assetNameCharsMax, 'File name') };
  }
  if (value['kind'] === 'github') {
    return { ...parseGitHubSource(value), tag: boundedText(value['tag'], APP_LIMITS.tagCharsMax, 'Release tag') };
  }
  if (value['kind'] === 'marketplace') {
    return { kind: 'marketplace', id: parseAppId(value['id']), version: parseAppVersion(value['version']) };
  }
  if (value['kind'] === 'local') {
    return { kind: 'local' };
  }
  throw new Error('An install source is "file", "github", "marketplace" or "local"');
}

function parseAvailableUpdate(input: unknown): AppAvailableUpdate {
  const value = record(input);
  return {
    version: parseAppVersion(value['version']),
    tag: boundedText(value['tag'], APP_LIMITS.tagCharsMax, 'Release tag'),
    sha256: parseSha256(value['sha256']),
    additions: parseUpdateAdditions(value['additions']),
  };
}

export function parseUpdateAdditions(input: unknown): readonly string[] {
  if (input === undefined || input === null) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined || items.length > APP_LIMITS.updateAdditionsMax) {
    throw new Error('Update additions are a bounded list');
  }
  return items.map((item) => boundedText(item, APP_LIMITS.updateAdditionCharsMax, 'Update addition'));
}

export function serializeAppsLock(lock: AppsLock): string {
  const checked = parseAppsLock(JSON.parse(JSON.stringify(lock)) as unknown);
  assert(checked.apps.length === lock.apps.length, 'Serializing never drops apps');
  const sorted = [...checked.apps].sort((left, right) => (left.id < right.id ? -1 : 1));
  const source = `${JSON.stringify({ version: 1, apps: sorted }, undefined, 2)}\n`;
  assert(source.length <= APP_LIMITS.lockBytesMax, 'A serialized lockfile stays inside its bound');
  return source;
}


export function parseAppSummary(input: unknown): AppSummary {
  const value = record(input);
  const manifest = parseAppManifest(value['manifest']);
  const lock = parseLockEntry(value['lock']);
  if (manifest.id !== lock.id) {
    throw new Error('An app summary pairs one app’s manifest and lock entry');
  }
  return { manifest, lock };
}

export function parseAppSummaries(input: unknown): readonly AppSummary[] {
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('Expected a list of apps');
  }
  if (items.length > APP_LIMITS.appsMax) {
    throw new Error('Too many apps');
  }
  return items.map(parseAppSummary);
}

export function parseAppStaged(input: unknown): AppStaged {
  const value = record(input);
  const sizeBytes = value['sizeBytes'];
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > APP_LIMITS.archiveBytesMax) {
    throw new Error('A staged bundle has a bounded positive size');
  }
  const token = text(value['token']);
  if (!/^[0-9a-f]{32}$/.test(token)) {
    throw new Error('A staged bundle token is 32 hex characters');
  }
  return {
    token,
    manifest: parseAppManifest(value['manifest']),
    sha256: parseSha256(value['sha256']),
    sizeBytes,
    source: parseInstallSource(value['source']),
    replaces: value['replaces'] === undefined ? undefined : parseAppVersion(value['replaces']),
  };
}

export function parseStagedToken(input: unknown): string {
  const token = text(input);
  if (!/^[0-9a-f]{32}$/.test(token)) {
    throw new Error('A staged bundle token is 32 hex characters');
  }
  return token;
}

export function parseAppUpdateOutcome(input: unknown): AppUpdateOutcome {
  const value = record(input);
  const id = parseAppId(value['id']);
  switch (value['kind']) {
    case 'current':
      return { kind: 'current', id };
    case 'available':
      return { kind: 'available', id, version: parseAppVersion(value['version']) };
    case 'failed':
      return {
        kind: 'failed',
        id,
        message: boundedText(value['message'], APP_LIMITS.messageCharsMax, 'Failure message'),
        ...optionalRef(value['messageRef']),
      };
    case 'needs-approval':
      return { kind: 'needs-approval', id, version: parseAppVersion(value['version']), additions: parseUpdateAdditions(value['additions']) };
    case 'updated':
      return { kind: 'updated', id, version: parseAppVersion(value['version']) };
    default:
      throw new Error('Unknown update outcome');
  }
}

export function appManifestAdditions(
  previous: Pick<AppManifest, 'network' | 'auth' | 'permissions'>,
  next: Pick<AppManifest, 'network' | 'auth' | 'permissions'>,
): readonly string[] {
  const hosts = new Set(previous.network.map((entry) => entry.host));
  const providers = new Map(previous.auth.map((entry) => [entry.id, entry]));
  const switches = new Set(previous.permissions.map((entry) => entry.id));
  const lines: string[] = [];
  for (const entry of next.network) {
    if (!hosts.has(entry.host)) {
      lines.push(`reaches ${entry.host}`);
    }
  }
  for (const entry of next.auth) {
    const before = providers.get(entry.id);
    if (before === undefined) {
      lines.push(`signs in to ${entry.label}`);
    } else if (before.authorizeURL !== entry.authorizeURL || before.tokenURL !== entry.tokenURL) {
      lines.push(`changes where ${entry.label} signs in`);
    }
  }
  for (const entry of next.permissions) {
    if (!switches.has(entry.id)) {
      lines.push(`adds the “${entry.label}” permission`);
    }
  }
  const bounded = lines.slice(0, APP_LIMITS.updateAdditionsMax).map((line) => line.slice(0, APP_LIMITS.updateAdditionCharsMax));
  assert(bounded.length <= lines.length, 'Additions are only ever cut, never invented');
  return bounded;
}

export function parseAppsResult<T>(input: unknown, parse: (value: unknown) => T): AppsResult<T> {
  const value = record(input);
  if (value['ok'] === true) {
    return { ok: true, value: parse(value['value']) };
  }
  if (value['ok'] === false) {
    const reference = parseMessageRef(value['messageRef']);
    return {
      ok: false,
      message: boundedText(value['message'], APP_LIMITS.messageCharsMax, 'Failure message'),
      ...(value['messageRef'] !== undefined && reference.ok ? { messageRef: reference.value } : {}),
    };
  }
  throw new Error('An apps result says ok');
}

export function parseUpdateOutcomes(input: unknown): readonly AppUpdateOutcome[] {
  const items = toArray(input);
  if (items === undefined || items.length > APP_LIMITS.appsMax) {
    throw new Error('Expected a bounded list of update outcomes');
  }
  return items.map(parseAppUpdateOutcome);
}

export function appsFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const bounded = (message.trim() || 'The app operation failed.').slice(0, APP_LIMITS.messageCharsMax);
  assert(bounded.length > 0, 'A failure message is never empty');
  return bounded;
}

export function appsFailure(error: unknown): { readonly message: string; readonly messageRef?: TypedMessageRef } {
  const message = appsFailureMessage(error);
  return error instanceof ReferencedError ? { message, messageRef: error.messageRef } : { message };
}

function optionalRef(input: unknown): { readonly messageRef?: MessageRef } {
  const messageRef = parseOptionalMessageRef(input);
  return messageRef === undefined ? {} : { messageRef };
}
