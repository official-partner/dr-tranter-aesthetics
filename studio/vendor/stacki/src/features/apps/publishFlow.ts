import { assert } from '../../../shared/core/assert';
import { APP_GITHUB_CHOICE_LIMITS, type AppRepository, type AppSummary } from '../../../shared/properties/apps';
import {
  DEFAULT_APP_SHARE_VISIBILITY,
  repositoryNameProblemDescribed,
  type AppRepositoryOwnerKind,
  type AppShareVisibility,
  type AppVisibilityOutcome,
  type MarketplaceCheck,
} from '../../../shared/properties/appPublish';
import { marketplaceApp, type MarketplaceIndex } from '../../../shared/properties/appMarketplace';
import { appListedInMarketplace } from '../../../shared/properties/appPlace';
import { messageRef } from '../../../shared/properties/i18n/messageRef';
import type { Translator, TypedMessageRef } from '../../../shared/properties/i18n/messageRef';
import { chooserRows, type ChooserRow } from './repositoryChooser';

export type PublishRow = ChooserRow | { readonly kind: 'uploaded'; readonly key: string; readonly app: AppSummary };

export type PublishPickable = Extract<PublishRow, { readonly kind: 'use' | 'repository' | 'uploaded' }>;

export interface AppPublication {
  readonly owner: string;
  readonly repository: string;
  readonly account: string | undefined;
  readonly listed: boolean;
}

export function appPublication(app: Pick<AppSummary, 'manifest' | 'lock'>, index: MarketplaceIndex | undefined): AppPublication | undefined {
  const { source } = app.lock;
  const { id } = app.manifest;
  assert(id.length > 0, 'An installed app has an id');
  switch (source.kind) {
    case 'github': {
      assert(source.owner.length > 0, 'A GitHub source names its owner');
      const listed = index !== undefined && appListedInMarketplace(index, { id, source });
      return { owner: source.owner, repository: source.repository, account: source.account, listed };
    }
    case 'file':
    case 'local': {
      const listing = index === undefined ? undefined : marketplaceApp(index, id);
      if (listing !== undefined) {
        assert(listing.source.owner.length > 0, 'A listing names its repository owner');
        return { owner: listing.source.owner, repository: listing.source.repository, account: undefined, listed: true };
      }
      const named = app.manifest.source;
      if (named !== undefined) {
        return { owner: named.owner, repository: named.repository, account: named.account, listed: false };
      }
      return undefined;
    }
    case 'marketplace':
      return undefined;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export function appNeedsShare(source: AppSummary['lock']['source'], publication: AppPublication | undefined): boolean {
  return appShareable(source) && publication === undefined;
}

export function uploadedApps(apps: readonly AppSummary[], options: { readonly published: (app: AppSummary) => boolean }): readonly AppSummary[] {
  const uploaded = apps.filter((app) => appShareable(app.lock.source) && !options.published(app));
  assert(uploaded.length <= apps.length, 'Uploaded apps are installed apps');
  return uploaded;
}

export function appShareable(source: AppSummary['lock']['source']): boolean {
  switch (source.kind) {
    case 'file':
    case 'local':
      return true;
    case 'github':
    case 'marketplace':
      return false;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export type MarketplaceSubmitRoute =
  | { readonly kind: 'publish'; readonly owner: string; readonly repository: string; readonly account: string | undefined }
  | { readonly kind: 'share-first' }
  | { readonly kind: 'none' };

export function marketplaceSubmitRoute(
  source: AppSummary['lock']['source'],
  options: { readonly mayShare: boolean; readonly publication: AppPublication | undefined },
): MarketplaceSubmitRoute {
  switch (source.kind) {
    case 'github':
      assert(source.owner.length > 0, 'A GitHub source names its owner');
      assert(source.repository.length > 0, 'A GitHub source names its repository');
      if (options.publication?.listed === true) {
        return { kind: 'none' };
      }
      return { kind: 'publish', owner: source.owner, repository: source.repository, account: source.account };
    case 'file':
    case 'local': {
      const { publication } = options;
      if (publication?.listed === true) {
        return { kind: 'none' };
      }
      if (publication !== undefined) {
        return { kind: 'publish', owner: publication.owner, repository: publication.repository, account: publication.account };
      }
      if (appShareable(source) && options.mayShare) {
        return { kind: 'share-first' };
      }
      return { kind: 'none' };
    }
    case 'marketplace':
      return { kind: 'none' };
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export function publishChooserRows(input: {
  readonly query: string;
  readonly repositories: readonly AppRepository[] | undefined;
  readonly uploaded: readonly AppSummary[];
}): readonly PublishRow[] {
  const github = chooserRows({ query: input.query, repositories: input.repositories }).map(
    (row): PublishRow => (row.kind === 'section' ? { ...row, label: 'Your GitHub apps', labelRef: messageRef('apps.chooser.sectionYours') } : row),
  );
  const needle = input.query.trim().toLowerCase();
  const uploaded = input.uploaded.filter((app) => needle === '' || `${app.manifest.name} ${app.manifest.id}`.toLowerCase().includes(needle));
  const rows: PublishRow[] = [...github];
  if (uploaded.length > 0) {
    rows.push({ kind: 'section', key: 'section:uploaded', label: 'Uploaded to this project', labelRef: messageRef('apps.chooser.sectionUploaded') });
    rows.push(...uploaded.map((app): PublishRow => ({ kind: 'uploaded', key: `uploaded:${app.manifest.id}`, app })));
  }
  assert(rows.length <= github.length + uploaded.length + 1, 'Rows come from the two sources');
  return rows;
}

export function publishPickables(rows: readonly PublishRow[]): readonly PublishPickable[] {
  return rows.filter((row): row is PublishPickable => row.kind === 'use' || row.kind === 'repository' || row.kind === 'uploaded');
}

export function shareOwners(
  account: string,
  repositories: readonly AppRepository[],
): readonly { readonly login: string; readonly kind: AppRepositoryOwnerKind }[] {
  assert(account.length > 0, 'A share has an account');
  const organizations = new Map<string, string>();
  for (const repository of repositories.slice(0, APP_GITHUB_CHOICE_LIMITS.repositoriesMax)) {
    if (repository.organization && repository.owner.toLowerCase() !== account.toLowerCase()) {
      organizations.set(repository.owner.toLowerCase(), repository.owner);
    }
  }
  const owners = [{ login: account, kind: 'user' as const }, ...[...organizations.values()].sort().map((login) => ({ login, kind: 'organization' as const }))];
  assert(owners[0]?.login === account, 'The account itself is offered first');
  return owners;
}

export interface ShareOwnerChoice {
  readonly key: string;
  readonly account: string;
  readonly login: string;
  readonly kind: AppRepositoryOwnerKind;
}

export const SHARE_ACCOUNTS_MAX = 16;

export function shareOwnerChoices(accounts: readonly string[], repositoriesOf: (account: string) => readonly AppRepository[]): readonly ShareOwnerChoice[] {
  const bounded = accounts.slice(0, SHARE_ACCOUNTS_MAX);
  const choices = bounded.flatMap((account) =>
    shareOwners(account, repositoriesOf(account)).map((owner) => ({ key: `${account}/${owner.login}`, account, login: owner.login, kind: owner.kind })),
  );
  assert(choices.length >= bounded.length, 'Each account offers itself');
  assert(new Set(choices.map((choice) => choice.key)).size === choices.length, 'Owner keys are unique');
  return choices;
}

export type ShareListing =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'ready'; readonly repositories: readonly AppRepository[] };

export type RepositoryNameStatus =
  | { readonly kind: 'invalid'; readonly message: string; readonly messageRef?: TypedMessageRef | undefined }
  | { readonly kind: 'checking' }
  | { readonly kind: 'exists' }
  | { readonly kind: 'available' }
  | { readonly kind: 'unchecked' };

export function repositoryNameStatus(input: {
  readonly owner: string;
  readonly ownerKind: AppRepositoryOwnerKind;
  readonly name: string;
  readonly listing: ShareListing;
}): RepositoryNameStatus {
  assert(input.owner.length > 0, 'A name is checked for an owner');
  const problem = repositoryNameProblemDescribed(input.name);
  if (problem !== undefined) {
    return { kind: 'invalid', ...problem };
  }
  const { listing } = input;
  switch (listing.kind) {
    case 'loading':
      return { kind: 'checking' };
    case 'unknown':
      return { kind: 'unchecked' };
    case 'ready': {
      const owner = input.owner.toLowerCase();
      const name = input.name.toLowerCase();
      const repositories = listing.repositories.slice(0, APP_GITHUB_CHOICE_LIMITS.repositoriesMax);
      if (repositories.some((repository) => repository.owner.toLowerCase() === owner && repository.name.toLowerCase() === name)) {
        return { kind: 'exists' };
      }
      if (input.ownerKind === 'user') {
        return repositories.length < APP_GITHUB_CHOICE_LIMITS.repositoriesMax ? { kind: 'available' } : { kind: 'unchecked' };
      }
      return { kind: 'unchecked' };
    }
    default: {
      const exhaustive: never = listing;
      return exhaustive;
    }
  }
}

export function repositoryNameUsable(status: RepositoryNameStatus): boolean {
  switch (status.kind) {
    case 'available':
    case 'unchecked':
    case 'checking':
      return true;
    case 'invalid':
    case 'exists':
      return false;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function visibilityChoices(
  owner: string,
  ownerKind: AppRepositoryOwnerKind,
  translate: Translator,
): readonly { readonly visibility: AppShareVisibility; readonly title: string; readonly detail: string }[] {
  assert(owner.length > 0, 'A visibility describes an owner');
  const action = translate('apps.loadFromGitHub');
  const choices = [
    {
      visibility: 'private' as const,
      title: translate('apps.visibility.private'),
      detail:
        ownerKind === 'organization'
          ? translate('apps.visibility.privateOrganization', { owner, action })
          : translate('apps.visibility.privateUser', { action }),
    },
    {
      visibility: 'public' as const,
      title: translate('apps.visibility.public'),
      detail: translate('apps.visibility.publicDetail'),
    },
  ];
  assert(choices[0]?.visibility === DEFAULT_APP_SHARE_VISIBILITY, 'The default visibility is offered first');
  return choices;
}

export function makePublicConfirmation(
  owner: string,
  repository: string,
  translate: Translator,
): { readonly title: string; readonly body: string; readonly confirmLabel: string } {
  const name = `${owner}/${repository}`;
  return {
    title: translate('apps.makePublic.title', { name }),
    body: translate('apps.makePublic.body', { name }),
    confirmLabel: translate('apps.makePublic.confirm'),
  };
}

export function publicShareConfirmation(
  owner: string,
  name: string,
  translate: Translator,
): { readonly title: string; readonly body: string; readonly confirmLabel: string } {
  return {
    title: translate('apps.publicShare.title', { name: `${owner}/${name}` }),
    body: translate('apps.publicShare.body'),
    confirmLabel: translate('apps.publicShare.confirm'),
  };
}

export function licenseConfirmation(
  owner: string,
  repository: string,
  holder: string,
  year: number,
  translate: Translator,
): { readonly title: string; readonly body: string; readonly confirmLabel: string } {
  return {
    title: translate('apps.license.title', { name: `${owner}/${repository}` }),
    body: translate('apps.license.body', { year, holder }),
    confirmLabel: translate('apps.license.confirm'),
  };
}

export function visibilityRefusal(
  outcome: Extract<AppVisibilityOutcome, { readonly kind: 'forbidden' }>,
  translate: Translator,
): { readonly title: string; readonly detail: string } {
  switch (outcome.reason) {
    case 'scope':
      return { title: translate('apps.refusal.scope.title'), detail: translate('apps.refusal.scope.detail') };
    case 'admin':
      return { title: translate('apps.refusal.admin.title'), detail: translate('apps.refusal.admin.detail') };
    case 'policy':
      return { title: translate('apps.refusal.policy.title'), detail: translate('apps.refusal.policy.detail') };
    default: {
      const exhaustive: never = outcome.reason;
      return exhaustive;
    }
  }
}

export function marketplaceCheckLabel(check: MarketplaceCheck, translate: Translator): string {
  switch (check) {
    case 'public':
      return translate('apps.check.public');
    case 'topic':
      return translate('apps.check.topic');
    case 'release':
      return translate('apps.check.release');
    case 'license':
      return translate('apps.check.license');
    case 'scan':
      return translate('apps.check.scan');
    default: {
      const exhaustive: never = check;
      return exhaustive;
    }
  }
}
