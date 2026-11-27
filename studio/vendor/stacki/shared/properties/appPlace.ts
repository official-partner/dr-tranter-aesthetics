import { assert } from '../core/assert';
import { record } from '../core/boundary';
import { described, type MessageKey, type TypedMessageRef } from './i18n/messageRef';
import { parseGitHubSource, type AppInstallSource } from './apps';
import { marketplaceApp, type MarketplaceIndex } from './appMarketplace';

export const APP_PLACE_LIMITS = {
  visibilityCacheMsMax: 10 * 60_000,
  visibilityFailureMsMax: 60_000,
  visibilityReposMax: 100,
} as const satisfies Record<string, number>;

export const APP_REPOSITORY_VISIBILITIES = ['private', 'public'] as const;
export type AppRepositoryVisibility = (typeof APP_REPOSITORY_VISIBILITIES)[number];

export interface AppRepositoryLocation {
  readonly owner: string;
  readonly repository: string;
  readonly account: string | undefined;
}

export interface AppRepositoryPlace {
  readonly owner: string;
  readonly repository: string;
  readonly visibility: AppRepositoryVisibility | undefined;
}

export interface AppRepositoryPlaceReply {
  readonly place: AppRepositoryPlace | undefined;
}

export type AppPillKind = 'local' | 'github' | 'marketplace';

export interface AppPill {
  readonly kind: AppPillKind;
  readonly label: string;
  readonly labelRef: TypedMessageRef;
  readonly tooltip: string;
  readonly tooltipRef: TypedMessageRef;
}

function pill(
  kind: AppPillKind,
  label: { readonly key: MessageKey },
  tooltip: { readonly key: MessageKey; readonly params?: Readonly<Record<string, string>> },
): AppPill {
  const labelText = described(label.key);
  const tooltipText = tooltip.params === undefined ? described(tooltip.key) : described(tooltip.key, tooltip.params);
  return { kind, label: labelText.message, labelRef: labelText.messageRef, tooltip: tooltipText.message, tooltipRef: tooltipText.messageRef };
}

export function parseAppRepositoryPlaceReply(input: unknown): AppRepositoryPlaceReply {
  const value = record(input);
  if (value['place'] === undefined) {
    return { place: undefined };
  }
  return { place: parseAppRepositoryPlace(value['place']) };
}

export function parseAppRepositoryPlace(input: unknown): AppRepositoryPlace {
  const value = record(input);
  const source = parseGitHubSource({ owner: value['owner'], repository: value['repository'], asset: 'app.zip' });
  const visibility = value['visibility'];
  if (visibility === undefined) {
    return { owner: source.owner, repository: source.repository, visibility: undefined };
  }
  const known = APP_REPOSITORY_VISIBILITIES.find((entry) => entry === visibility);
  if (known === undefined) {
    throw new Error('A repository is "private" or "public"');
  }
  return { owner: source.owner, repository: source.repository, visibility: known };
}

export function appRepositoryLocation(source: AppInstallSource, index: MarketplaceIndex | undefined): AppRepositoryLocation | undefined {
  switch (source.kind) {
    case 'github':
      return { owner: source.owner, repository: source.repository, account: source.account };
    case 'marketplace': {
      const listed = index === undefined ? undefined : marketplaceApp(index, source.id);
      if (listed === undefined) {
        return undefined;
      }
      assert(listed.source.account === undefined, 'A marketplace repository is read as public');
      return { owner: listed.source.owner, repository: listed.source.repository, account: undefined };
    }
    case 'file':
    case 'local':
      return undefined;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export function appListedInMarketplace(index: MarketplaceIndex, app: { readonly id: string; readonly source: AppInstallSource }): boolean {
  assert(app.id.length > 0, 'An installed app has an id');
  const { source } = app;
  switch (source.kind) {
    case 'github': {
      const listed = marketplaceApp(index, app.id);
      if (listed === undefined) {
        return false;
      }
      return sameRepository(listed.source, source);
    }
    case 'marketplace':
      assert(source.id === app.id, 'A marketplace install names its own entry');
      return marketplaceApp(index, source.id) !== undefined;
    case 'file':
    case 'local':
      return false;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export function appPlacePills(
  source: AppInstallSource,
  facts: { readonly place: AppRepositoryPlace | undefined; readonly listed: boolean },
): readonly AppPill[] {
  const pills: readonly AppPill[] =
    source.kind === 'marketplace' || facts.listed
      ? [pill('marketplace', { key: 'apps.place.marketplace' }, { key: 'apps.place.marketplaceTip' })]
      : [appHomePill(source, facts.place)];
  assert(pills.length === 1, 'A row says where the app comes from with one pill');
  return pills;
}

function appHomePill(source: AppInstallSource, place: AppRepositoryPlace | undefined): AppPill {
  switch (source.kind) {
    case 'file':
      return pill('local', { key: 'apps.place.local' }, { key: 'apps.place.uploadedTip', params: { fileName: source.fileName } });
    case 'local':
      return pill('local', { key: 'apps.place.local' }, { key: 'apps.place.localTip' });
    case 'github':
    case 'marketplace':
      return githubPill(place);
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function githubPill(place: AppRepositoryPlace | undefined): AppPill {
  if (place === undefined) {
    return pill('github', { key: 'apps.place.github' }, { key: 'apps.place.githubReleaseTip' });
  }
  const repository = `${place.owner}/${place.repository}`;
  switch (place.visibility) {
    case 'private':
      return pill('github', { key: 'apps.place.githubPrivate' }, { key: 'apps.place.githubPrivateTip', params: { repository } });
    case 'public':
      return pill('github', { key: 'apps.place.githubPublic' }, { key: 'apps.place.githubPublicTip', params: { repository } });
    case undefined:
      return pill('github', { key: 'apps.place.github' }, { key: 'apps.place.githubRepositoryTip', params: { repository } });
    default: {
      const exhaustive: never = place.visibility;
      return exhaustive;
    }
  }
}

function sameRepository(
  left: { readonly owner: string; readonly repository: string },
  right: { readonly owner: string; readonly repository: string },
): boolean {
  if (left.owner.toLowerCase() === right.owner.toLowerCase()) {
    return left.repository.toLowerCase() === right.repository.toLowerCase();
  }
  return false;
}
