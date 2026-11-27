import { parseAppNetwork, type AppNetworkHost } from './appAuth';
import { messageRef } from './i18n/messageRef';
import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';
import {
  APP_LIMITS,
  compareAppVersions,
  parseAppId,
  parseAppVersion,
  parseGitHubSource,
  parseSha256,
  parseStackiRange,
  parseStackiVersionMin,
  type AppGitHubSource,
} from './apps';
import { parseGitHubLogin } from './projectRoles';

export const MARKETPLACE_ORIGIN = 'https://stacki.build';
export const MARKETPLACE_INDEX_URL = `${MARKETPLACE_ORIGIN}/api/marketplace/index.json`;
export const MARKETPLACE_ICON_PREFIX = `${MARKETPLACE_ORIGIN}/api/marketplace/icons/`;
export const MARKETPLACE_SUBMIT_URL = `${MARKETPLACE_ORIGIN}/marketplace/submit`;
export const MARKETPLACE_SUBMISSIONS_URL = `${MARKETPLACE_ORIGIN}/api/marketplace/submissions`;
export const MARKETPLACE_CHECK_URL = `${MARKETPLACE_ORIGIN}/api/marketplace/check`;
export const MARKETPLACE_LICENSE = 'MIT';
export const MARKETPLACE_DISCLAIMER_REF = messageRef('apps.market.disclaimer');

export const MARKETPLACE_LIMITS = {
  indexBytesMax: 1024 * 1024,
  appsMax: 500,
  versionsMax: 20,
  categoriesMax: 4,
  categoryCharsMax: 32,
  iconURLCharsMax: 300,
  resultsMax: 50,
  queryCharsMax: 100,
  pageSize: 100,
} as const satisfies Record<string, number>;

export interface MarketplaceVersion {
  readonly version: string;
  readonly tag: string;
  readonly sha256: string;
  readonly stackiVersionMin: string | undefined;
}

export interface MarketplaceApp {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly iconURL: string;
  readonly categories: readonly string[];
  readonly source: AppGitHubSource;
  readonly versions: readonly MarketplaceVersion[];
  readonly license: typeof MARKETPLACE_LICENSE | undefined;
  readonly network: readonly AppNetworkHost[] | undefined;
}

export interface MarketplaceIndex {
  readonly version: 1;
  readonly apps: readonly MarketplaceApp[];
}

const CATEGORY = /^[a-z0-9][a-z0-9-]*$/;
const ICON_PATH = /^[A-Za-z0-9._/-]+\.(?:png|svg|webp)$/;

export function parseMarketplaceIndexSource(source: string): MarketplaceIndex {
  if (source.length > MARKETPLACE_LIMITS.indexBytesMax) {
    throw new Error(`The marketplace index exceeds ${MARKETPLACE_LIMITS.indexBytesMax} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error: unknown) {
    throw new Error(`The marketplace index is not JSON: ${String(error).slice(0, 200)}`);
  }
  return parseMarketplaceIndex(parsed);
}

export function parseMarketplaceIndex(input: unknown): MarketplaceIndex {
  const value = record(input);
  if (value['version'] !== 1) {
    throw new Error('Marketplace index version must be 1');
  }
  const items = toArray(value['apps']);
  if (items === undefined) {
    throw new Error('The marketplace index needs an apps list');
  }
  if (items.length > MARKETPLACE_LIMITS.appsMax) {
    throw new Error(`The marketplace lists at most ${MARKETPLACE_LIMITS.appsMax} apps`);
  }
  const apps = items.map(parseMarketplaceApp);
  const ids = new Set(apps.map((app) => app.id));
  if (ids.size !== apps.length) {
    throw new Error('An app is listed twice in the marketplace index');
  }
  assert(apps.length <= MARKETPLACE_LIMITS.appsMax, 'Marketplace apps are bounded');
  return { version: 1, apps };
}

export function parseMarketplaceApp(input: unknown): MarketplaceApp {
  const value = record(input);
  const id = parseAppId(value['id']);
  const versions = parseVersions(value['versions'], id);
  const app: MarketplaceApp = {
    id,
    name: boundedText(value['name'], APP_LIMITS.nameCharsMax, 'App name'),
    description: boundedText(value['description'], APP_LIMITS.descriptionCharsMax, 'App description'),
    author: parseGitHubLogin(value['author']),
    iconURL: parseMarketplaceIconURL(iconOrParsed(value)),
    categories: parseCategories(value['categories']),
    source: publicSource(value['source']),
    versions,
    license: parseMarketplaceLicense(value['license']),
    network: value['network'] === undefined ? undefined : parseAppNetwork(value['network']),
  };
  assert(app.versions.length > 0, 'An approved app has an approved version');
  return app;
}

export function parseMarketplaceIconURL(input: unknown): string {
  const url = text(input);
  if (url.length > MARKETPLACE_LIMITS.iconURLCharsMax) {
    throw new Error('A marketplace icon address exceeds its limit');
  }
  if (!url.startsWith(MARKETPLACE_ICON_PREFIX)) {
    throw new Error(`A marketplace icon lives under ${MARKETPLACE_ICON_PREFIX}`);
  }
  const rest = url.slice(MARKETPLACE_ICON_PREFIX.length);
  if (!ICON_PATH.test(rest) || rest.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('A marketplace icon is a PNG, SVG or WebP file under the marketplace icon path');
  }
  const parsed = new URL(url);
  assert(parsed.origin === MARKETPLACE_ORIGIN, 'An icon is served by stacki.build');
  assert(parsed.pathname.startsWith('/api/marketplace/icons/'), 'An icon stays under the icon path');
  return url;
}

export function parseMarketplaceLicense(input: unknown): typeof MARKETPLACE_LICENSE | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input !== MARKETPLACE_LICENSE) {
    throw new Error(`A marketplace app is licensed ${MARKETPLACE_LICENSE}; "${String(input).slice(0, 40)}" is not accepted`);
  }
  return MARKETPLACE_LICENSE;
}

function publicSource(input: unknown): AppGitHubSource {
  const value = record(input);
  if (value['account'] !== undefined) {
    throw new Error('A marketplace source names no account: approved apps are public');
  }
  const source = parseGitHubSource(value);
  assert(source.account === undefined, 'A marketplace source is read as public');
  return source;
}

function parseCategories(input: unknown): readonly string[] {
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('An app’s categories are a list');
  }
  if (items.length > MARKETPLACE_LIMITS.categoriesMax) {
    throw new Error(`An app has at most ${MARKETPLACE_LIMITS.categoriesMax} categories`);
  }
  const categories = items.map((item) => {
    const category = text(item);
    if (category.length === 0 || category.length > MARKETPLACE_LIMITS.categoryCharsMax) {
      throw new Error(`A category is 1 to ${MARKETPLACE_LIMITS.categoryCharsMax} characters`);
    }
    if (!CATEGORY.test(category)) {
      throw new Error(`Category "${category}" must be lowercase letters, digits and hyphens`);
    }
    return category;
  });
  assert(categories.length === items.length, 'Every category parsed');
  return [...new Set(categories)];
}

function parseVersions(input: unknown, id: string): readonly MarketplaceVersion[] {
  const items = toArray(input);
  if (items === undefined || items.length === 0) {
    throw new Error(`${id}: a marketplace app has at least one approved version`);
  }
  if (items.length > MARKETPLACE_LIMITS.versionsMax) {
    throw new Error(`${id}: at most ${MARKETPLACE_LIMITS.versionsMax} approved versions`);
  }
  const versions = items.map((item): MarketplaceVersion => {
    const value = record(item);
    return {
      version: parseAppVersion(value['version']),
      tag: boundedText(value['tag'], APP_LIMITS.tagCharsMax, 'Release tag'),
      sha256: parseSha256(value['sha256']),
      stackiVersionMin: versionStackiMin(value),
    };
  });
  if (new Set(versions.map((entry) => entry.version)).size !== versions.length) {
    throw new Error(`${id}: a version is approved twice`);
  }
  if (new Set(versions.map((entry) => entry.tag)).size !== versions.length) {
    throw new Error(`${id}: two versions name the same tag`);
  }
  const newestFirst = [...versions].sort((left, right) => compareAppVersions(right.version, left.version));
  assert(newestFirst.length === versions.length, 'Ordering keeps every version');
  return newestFirst;
}

function iconOrParsed(value: Readonly<Record<string, unknown>>): unknown {
  const icon = value['icon'];
  if (icon === undefined) {
    return value['iconURL'];
  }
  if (value['iconURL'] !== undefined) {
    throw new Error('Name icon or iconURL, not both');
  }
  return icon;
}

function versionStackiMin(value: Readonly<Record<string, unknown>>): string | undefined {
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


export function latestApprovedVersion(app: MarketplaceApp): MarketplaceVersion {
  const latest = app.versions[0];
  assert(latest !== undefined, 'A parsed marketplace app has an approved version');
  assert(
    app.versions.every((entry) => compareAppVersions(entry.version, latest.version) <= 0),
    'Versions are newest first',
  );
  return latest;
}

export function approvedVersion(app: MarketplaceApp, version: string): MarketplaceVersion | undefined {
  assert(version.length > 0, 'A version to look up is never empty');
  const found = app.versions.find((entry) => entry.version === version);
  assert(found === undefined || found.version === version, 'A found version is the one asked for');
  return found;
}

export function approvedUpdate(app: MarketplaceApp, installed: string): MarketplaceVersion | undefined {
  const latest = latestApprovedVersion(app);
  if (compareAppVersions(latest.version, installed) > 0) {
    return latest;
  }
  return undefined;
}

export function marketplaceApp(index: MarketplaceIndex, id: string): MarketplaceApp | undefined {
  assert(id.length > 0, 'An app id to look up is never empty');
  const found = index.apps.find((app) => app.id === id);
  assert(found === undefined || found.id === id, 'A found app is the one asked for');
  return found;
}

export function searchMarketplace(index: MarketplaceIndex, query: string): readonly MarketplaceApp[] {
  const words = query.trim().toLowerCase().slice(0, MARKETPLACE_LIMITS.queryCharsMax).split(/\s+/).filter(Boolean);
  const found = index.apps.filter((app) => {
    const haystack = `${app.name} ${app.description} ${app.id} ${app.author} ${app.categories.join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const shown = found.slice(0, MARKETPLACE_LIMITS.resultsMax);
  assert(shown.length <= MARKETPLACE_LIMITS.resultsMax, 'Search results are bounded');
  return shown;
}
