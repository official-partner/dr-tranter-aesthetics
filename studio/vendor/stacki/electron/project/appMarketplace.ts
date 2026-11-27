import { assert } from '../../shared/core/assert';
import { ReferencedError } from '../../shared/properties/i18n/referencedError';
import {
  MARKETPLACE_INDEX_URL,
  MARKETPLACE_LIMITS,
  MARKETPLACE_CHECK_URL,
  MARKETPLACE_SUBMISSIONS_URL,
  parseMarketplaceIndexSource,
  type MarketplaceApp,
  type MarketplaceIndex,
  type MarketplaceVersion,
} from '../../shared/properties/appMarketplace';
import { downloadReleaseAsset, readBounded, releaseAsset, type DownloadedAsset, type GitHubFetch } from './appGitHub';

export const MARKETPLACE_INDEX_URL_VARIABLE = 'STACKI_MARKETPLACE_INDEX_URL';
export const MARKETPLACE_SUBMISSIONS_URL_VARIABLE = 'STACKI_MARKETPLACE_SUBMISSIONS_URL';
export const MARKETPLACE_CHECK_URL_VARIABLE = 'STACKI_MARKETPLACE_CHECK_URL';

export const APP_MARKETPLACE_LIMITS = {
  requestMsMax: 30_000,
} as const satisfies Record<string, number>;

export type MarketplaceBuild = 'development' | 'release';

export function marketplaceIndexURL(environment: Readonly<Record<string, string | undefined>>, build: MarketplaceBuild): string {
  return developmentOverride(environment, build, MARKETPLACE_INDEX_URL_VARIABLE, MARKETPLACE_INDEX_URL);
}

export function marketplaceSubmissionsURL(environment: Readonly<Record<string, string | undefined>>, build: MarketplaceBuild): string {
  return developmentOverride(environment, build, MARKETPLACE_SUBMISSIONS_URL_VARIABLE, MARKETPLACE_SUBMISSIONS_URL);
}

export function marketplaceCheckURL(environment: Readonly<Record<string, string | undefined>>, build: MarketplaceBuild): string {
  return developmentOverride(environment, build, MARKETPLACE_CHECK_URL_VARIABLE, MARKETPLACE_CHECK_URL);
}

function developmentOverride(environment: Readonly<Record<string, string | undefined>>, build: MarketplaceBuild, variable: string, official: string): string {
  const override = environment[variable];
  if (build === 'release' || override === undefined || override.trim() === '') {
    return official;
  }
  const url = new URL(override.trim());
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'https:') {
    return url.toString();
  }
  if (url.protocol === 'http:' && local) {
    return url.toString();
  }
  throw new Error(`${variable} must be an https: address, or http: on localhost`);
}

export async function fetchMarketplaceIndex(fetcher: GitHubFetch, url: string): Promise<MarketplaceIndex> {
  assert(url.length > 0, 'The marketplace has an address');
  const response = await fetcher(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Stacki' },
    redirect: 'error',
    signal: AbortSignal.timeout(APP_MARKETPLACE_LIMITS.requestMsMax),
  });
  if (!response.ok) {
    throw new ReferencedError('apps.error.marketplaceIndexStatus', { status: response.status });
  }
  const body = await readBounded(response, MARKETPLACE_LIMITS.indexBytesMax);
  const index = parseMarketplaceIndexSource(new TextDecoder().decode(body));
  assert(index.apps.length <= MARKETPLACE_LIMITS.appsMax, 'A parsed index is bounded');
  return index;
}

export async function downloadApprovedVersion(fetcher: GitHubFetch, app: MarketplaceApp, approved: MarketplaceVersion): Promise<DownloadedAsset> {
  assert(app.versions.includes(approved), 'Only an approved version of this app downloads');
  assert(app.source.account === undefined, 'A marketplace app is read without credentials');
  const asset = await releaseAsset(fetcher, app.source, { tag: approved.tag, token: undefined });
  const downloaded = await downloadReleaseAsset(fetcher, asset, undefined);
  if (downloaded.sha256 !== approved.sha256) {
    throw new ReferencedError('apps.error.marketplaceDigestMismatch', { name: app.name, version: approved.version });
  }
  assert(downloaded.sha256 === approved.sha256, 'An approved download carries the approved digest');
  return downloaded;
}
