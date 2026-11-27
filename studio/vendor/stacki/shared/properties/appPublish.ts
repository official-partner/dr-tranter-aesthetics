import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { parseMessageRef, parseOptionalMessageRef, type MessageRef } from '../core/i18n/messageReference';
import { toArray } from '../core/record';
import { described, englishText, messageRef, type Described, type TypedMessageRef } from './i18n/messageRef';
import { APP_LIMITS, parseAppId, parseAppVersion, parseGitHubSource, parseReleaseTag, parseSha256, type AppGitHubSource } from './apps';
import { MARKETPLACE_LICENSE } from './appMarketplace';
import { parseGitHubLogin } from './projectRoles';

export const APP_PUBLISH_LIMITS = {
  repositoryNameCharsMax: 100,
  submissionSourceCharsMax: 300,
  submissionReplyBytesMax: 16 * 1024,
  createdMax: 8,
  holderCharsMax: 100,
} as const satisfies Record<string, number>;


export const APP_SHARE_VISIBILITIES = ['private', 'public'] as const;
export type AppShareVisibility = (typeof APP_SHARE_VISIBILITIES)[number];
export const DEFAULT_APP_SHARE_VISIBILITY: AppShareVisibility = 'private';

export const APP_SHARE_STEPS = ['create-repository', 'add-topic', 'commit-files', 'create-release'] as const;
export type AppShareStep = (typeof APP_SHARE_STEPS)[number];

export const APP_LICENSE_STEPS = ['commit-license'] as const;

export type AppStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AppStepState<S extends string> {
  readonly step: S;
  readonly status: AppStepStatus;
}

export type AppRepositoryOwnerKind = 'user' | 'organization';

export interface AppShareRequest {
  readonly id: string;
  readonly account: string;
  readonly owner: string;
  readonly ownerKind: AppRepositoryOwnerKind;
  readonly name: string;
  readonly visibility: AppShareVisibility;
}

export interface AppShared {
  readonly owner: string;
  readonly repository: string;
  readonly visibility: AppShareVisibility;
  readonly tag: string;
  readonly asset: string;
  readonly sha256: string;
}

export type AppShareOutcome =
  | { readonly kind: 'shared'; readonly shared: AppShared }
  | {
      readonly kind: 'failed';
      readonly step: AppShareStep;
      readonly message: string;
      readonly messageRef?: MessageRef | undefined;
      readonly created: readonly string[];
      readonly createdRefs?: readonly MessageRef[] | undefined;
    };

const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;

export function repositoryNameProblem(name: string): string | undefined {
  return repositoryNameProblemDescribed(name)?.message;
}

export function repositoryNameProblemDescribed(name: string): (Described & { readonly messageRef: TypedMessageRef }) | undefined {
  if (name.length === 0) {
    return described('apps.publish.nameEmpty');
  }
  if (name.length > APP_PUBLISH_LIMITS.repositoryNameCharsMax) {
    return described('apps.publish.nameTooLong', { max: APP_PUBLISH_LIMITS.repositoryNameCharsMax });
  }
  if (!REPOSITORY_NAME.test(name)) {
    return described('apps.publish.nameCharacters');
  }
  if (name === '.' || name === '..') {
    return described('apps.publish.nameReserved');
  }
  if (name.toLowerCase().endsWith('.git')) {
    return described('apps.publish.nameGit');
  }
  return undefined;
}

export function parseNewRepositoryName(input: unknown): string {
  const name = text(input);
  const problem = repositoryNameProblem(name);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  assert(name.length <= APP_PUBLISH_LIMITS.repositoryNameCharsMax, 'A parsed repository name is within GitHub’s limit');
  return name;
}

export function suggestedRepositoryName(appId: string): string {
  const name = appId.replace(/\.git$/i, '-app');
  assert(repositoryNameProblem(name) === undefined, 'An app id makes a valid repository name');
  return name;
}

export function parseAppShareRequest(input: unknown): AppShareRequest {
  const value = record(input);
  const visibility = APP_SHARE_VISIBILITIES.find((known) => known === value['visibility']);
  if (visibility === undefined) {
    throw new Error('A share is private or public');
  }
  const ownerKind = value['ownerKind'] === 'user' ? 'user' : value['ownerKind'] === 'organization' ? 'organization' : undefined;
  if (ownerKind === undefined) {
    throw new Error('A share’s owner is the account or an organization');
  }
  const name = parseNewRepositoryName(value['name']);
  const source = parseGitHubSource({ owner: value['owner'], repository: name, asset: 'app.zip' });
  return {
    id: parseAppId(value['id']),
    account: parseGitHubLogin(value['account']),
    owner: source.owner,
    ownerKind,
    name,
    visibility,
  };
}

export function parseAppShareOutcome(input: unknown): AppShareOutcome {
  const value = record(input);
  if (value['kind'] === 'shared') {
    const shared = record(value['shared']);
    const visibility = APP_SHARE_VISIBILITIES.find((known) => known === shared['visibility']);
    if (visibility === undefined) {
      throw new Error('A shared repository is private or public');
    }
    const source = parseGitHubSource({ owner: shared['owner'], repository: shared['repository'], asset: shared['asset'] });
    return {
      kind: 'shared',
      shared: {
        owner: source.owner,
        repository: source.repository,
        visibility,
        tag: parseReleaseTag(shared['tag']),
        asset: source.asset,
        sha256: parseSha256(shared['sha256']),
      },
    };
  }
  if (value['kind'] === 'failed') {
    const step = APP_SHARE_STEPS.find((known) => known === value['step']);
    if (step === undefined) {
      throw new Error('A failed share names its step');
    }
    const created = toArray(value['created']);
    if (created === undefined || created.length > APP_PUBLISH_LIMITS.createdMax) {
      throw new Error('A failed share lists what it created');
    }
    return {
      kind: 'failed',
      step,
      message: message(value['message']),
      ...optionalMessageRef(value['messageRef']),
      created: created.map(message),
      ...optionalCreatedRefs(value['createdRefs'], created.length),
    };
  }
  throw new Error('A share outcome is shared or failed');
}

export function shareReleaseTag(version: string): string {
  const tag = `v${parseAppVersion(version)}`;
  assert(tag.length <= APP_LIMITS.tagCharsMax, 'A release tag is within its bound');
  return tag;
}

export function shareStepRef(step: AppShareStep, visibility: AppShareVisibility): TypedMessageRef {
  switch (step) {
    case 'create-repository':
      return messageRef(visibility === 'public' ? 'apps.share.step.createPublic' : 'apps.share.step.createPrivate');
    case 'add-topic':
      return messageRef('apps.share.step.addTopic');
    case 'commit-files':
      return messageRef(visibility === 'public' ? 'apps.share.step.commitWithLicense' : 'apps.share.step.commit');
    case 'create-release':
      return messageRef('apps.share.step.release');
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}

export function shareStepLabel(step: AppShareStep, visibility: AppShareVisibility): string {
  return englishText(shareStepRef(step, visibility));
}

export function shareStepStates(current: AppShareStep | 'finished', failed: { readonly failed: boolean }): readonly AppStepState<AppShareStep>[] {
  const index = current === 'finished' ? APP_SHARE_STEPS.length : APP_SHARE_STEPS.indexOf(current);
  assert(index >= 0, 'The current step is a share step');
  const states = APP_SHARE_STEPS.map((step, position): AppStepState<AppShareStep> => {
    if (position < index) {
      return { step, status: 'done' };
    }
    if (position === index) {
      return { step, status: failed.failed ? 'failed' : 'running' };
    }
    return { step, status: 'pending' };
  });
  assert(states.length === APP_SHARE_STEPS.length, 'Every step has a state');
  return states;
}

export function parseAppShareProgress(input: unknown): { readonly id: string; readonly step: AppShareStep } {
  const value = record(input);
  const step = APP_SHARE_STEPS.find((known) => known === value['step']);
  if (step === undefined) {
    throw new Error('A share progress event names a step');
  }
  return { id: parseAppId(value['id']), step };
}


export function mitLicenseText(year: number, holder: string): string {
  assert(Number.isSafeInteger(year), 'A copyright year is a whole year');
  assert(year >= 2000, 'A copyright year is a recent one');
  const name = holder.trim().slice(0, APP_PUBLISH_LIMITS.holderCharsMax);
  assert(name.length > 0, 'A license names its copyright holder');
  return `MIT License

Copyright (c) ${year} ${name}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}


export type AppVisibilityOutcome =
  { readonly kind: 'public' } | { readonly kind: 'forbidden'; readonly reason: 'scope' | 'admin' | 'policy'; readonly settingsURL: string };

export function repositorySettingsURL(owner: string, repository: string): string {
  const source = parseGitHubSource({ owner, repository, asset: 'app.zip' });
  return `https://github.com/${source.owner}/${source.repository}/settings`;
}

export function repositoryURL(owner: string, repository: string): string {
  const source = parseGitHubSource({ owner, repository, asset: 'app.zip' });
  return `https://github.com/${source.owner}/${source.repository}`;
}

export function repositoryAccessURL(owner: string, repository: string): string {
  return `${repositorySettingsURL(owner, repository)}/access`;
}

export function parseAppVisibilityOutcome(input: unknown): AppVisibilityOutcome {
  const value = record(input);
  if (value['kind'] === 'public') {
    return { kind: 'public' };
  }
  if (value['kind'] !== 'forbidden') {
    throw new Error('A visibility outcome is public or forbidden');
  }
  const reason = value['reason'] === 'scope' ? 'scope' : value['reason'] === 'admin' ? 'admin' : value['reason'] === 'policy' ? 'policy' : undefined;
  if (reason === undefined) {
    throw new Error('A refusal says why');
  }
  const settingsURL = text(value['settingsURL']);
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/settings$/.test(settingsURL)) {
    throw new Error('A refusal links to the repository’s settings on GitHub');
  }
  return { kind: 'forbidden', reason, settingsURL };
}


export interface AppRepositoryStatus {
  readonly owner: string;
  readonly repository: string;
  readonly private: boolean;
  readonly topic: boolean;
  readonly license: string | undefined;
  readonly release: { readonly tag: string; readonly asset: string } | undefined;
  readonly holder: string;
}

export function parseAppRepositoryStatus(input: unknown): AppRepositoryStatus {
  const value = record(input);
  const source = parseGitHubSource({ owner: value['owner'], repository: value['repository'], asset: 'app.zip' });
  if (typeof value['private'] !== 'boolean' || typeof value['topic'] !== 'boolean') {
    throw new Error('A repository status says whether it is private and tagged');
  }
  const license = value['license'] === undefined ? undefined : text(value['license']).slice(0, 64);
  const release =
    value['release'] === undefined
      ? undefined
      : (() => {
          const fields = record(value['release']);
          const asset = parseGitHubSource({ owner: source.owner, repository: source.repository, asset: fields['asset'] }).asset;
          return { tag: parseReleaseTag(fields['tag']), asset };
        })();
  const holder = text(value['holder']).trim();
  if (holder.length === 0 || holder.length > APP_PUBLISH_LIMITS.holderCharsMax) {
    throw new Error('A repository status names the copyright holder');
  }
  return { owner: source.owner, repository: source.repository, private: value['private'], topic: value['topic'], license, release, holder };
}

export type MarketplaceCheck = 'public' | 'topic' | 'release' | 'license' | 'scan';

export interface MarketplaceReadiness {
  readonly checks: readonly { readonly check: MarketplaceCheck; readonly passed: boolean }[];
  readonly ready: boolean;
}

export function marketplaceReadiness(status: AppRepositoryStatus, scan: { readonly clean: boolean }): MarketplaceReadiness {
  const checks: { readonly check: MarketplaceCheck; readonly passed: boolean }[] = [
    { check: 'public', passed: !status.private },
    { check: 'topic', passed: status.topic },
    { check: 'release', passed: status.release !== undefined },
    { check: 'license', passed: status.license === MARKETPLACE_LICENSE },
    { check: 'scan', passed: scan.clean },
  ];
  const ready = checks.every((entry) => entry.passed);
  assert(checks.length === 5, 'Every requirement is checked');
  assert(!ready || status.license === MARKETPLACE_LICENSE, 'A ready repository is MIT licensed');
  return { checks, ready };
}

export const MARKETPLACE_TERMS =
  'I confirm this app is open source under the MIT license, I own the rights to publish it, and I understand Stacki does not review, vet or take responsibility for marketplace apps.';

export interface MarketplaceSubmission {
  readonly owner: string;
  readonly repository: string;
  readonly account: string;
  readonly acceptedTerms: true;
}

export function parseMarketplaceSubmission(input: unknown): MarketplaceSubmission {
  const value = record(input);
  if (value['acceptedTerms'] !== true) {
    throw new Error('Accept the marketplace terms to submit.');
  }
  const source = parseGitHubSource({ owner: value['owner'], repository: value['repository'], asset: 'app.zip' });
  return {
    owner: source.owner,
    repository: source.repository,
    account: parseGitHubLogin(value['account']),
    acceptedTerms: true,
  };
}

export function submissionBody(submission: MarketplaceSubmission, release: { readonly tag: string }): string {
  assert(submission.acceptedTerms, 'Only an accepted submission is sent');
  const repository = `${repositoryURL(submission.owner, submission.repository)}/releases/tag/${encodeURIComponent(release.tag)}`;
  assert(repository.length <= APP_PUBLISH_LIMITS.submissionSourceCharsMax, 'The release address is within the Worker’s bound');
  return JSON.stringify({ repository, accept: true });
}

export type MarketplaceSubmissionOutcome =
  | { readonly kind: 'submitted'; readonly id: number | undefined; readonly updated: boolean }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string; readonly messageRef?: MessageRef | undefined };

export function submissionOutcome(status: number, body: string): MarketplaceSubmissionOutcome {
  assert(Number.isSafeInteger(status), 'An HTTP status is a whole number');
  let parsed: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(body.slice(0, APP_PUBLISH_LIMITS.submissionReplyBytesMax));
    parsed = record(value);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) {
    return { kind: 'unavailable', ...described('apps.publish.httpAnswered', { status }) };
  }
  if (status >= 200 && status < 300 && parsed['ok'] === true) {
    const id = parsed['id'];
    return { kind: 'submitted', id: typeof id === 'number' && Number.isSafeInteger(id) ? id : undefined, updated: parsed['updated'] === true };
  }
  const code = typeof parsed['code'] === 'string' ? parsed['code'].slice(0, 40) : '';
  const said = typeof parsed['message'] === 'string' ? parsed['message'].trim().slice(0, APP_LIMITS.messageCharsMax) : '';
  if (code === 'unconfigured' || status === 404 || status >= 500 || code === '' || said === '') {
    return said === '' ? { kind: 'unavailable', ...described('apps.publish.httpAnswered', { status }) } : { kind: 'unavailable', message: said };
  }
  return { kind: 'refused', code, message: said };
}

export type MarketplacePrecheck =
  | { readonly kind: 'ready'; readonly id: string; readonly name: string; readonly version: string; readonly iconPresent: boolean }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string; readonly messageRef?: MessageRef | undefined };

export function marketplaceCheckAddress(checkURL: string, owner: string, repository: string): string {
  const source = parseGitHubSource({ owner, repository, asset: 'app.zip' });
  const url = new URL(checkURL);
  url.searchParams.set('repository', `${source.owner}/${source.repository}`);
  return url.toString();
}

export function precheckOutcome(status: number, body: string): MarketplacePrecheck {
  let parsed: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(body.slice(0, APP_PUBLISH_LIMITS.submissionReplyBytesMax));
    parsed = record(value);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) {
    return { kind: 'unavailable', ...described('apps.publish.httpAnswered', { status }) };
  }
  if (parsed['ok'] === true) {
    try {
      return parseMarketplacePrecheck({ kind: 'ready', ...record(parsed['app']) });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Assertion failed')) {
        throw error;
      }
      return { kind: 'unavailable', ...described('apps.publish.checkShape') };
    }
  }
  const code = typeof parsed['code'] === 'string' ? parsed['code'].slice(0, 40) : '';
  const said = typeof parsed['message'] === 'string' ? parsed['message'].trim().slice(0, APP_LIMITS.messageCharsMax) : '';
  if (code === 'unconfigured' || status === 404 || status >= 500 || code === '' || said === '') {
    return said === '' ? { kind: 'unavailable', ...described('apps.publish.httpAnswered', { status }) } : { kind: 'unavailable', message: said };
  }
  return { kind: 'refused', code, message: said };
}

export function parseMarketplacePrecheck(input: unknown): MarketplacePrecheck {
  const value = record(input);
  switch (value['kind']) {
    case 'ready': {
      const name = text(value['name']).trim();
      if (name.length === 0 || name.length > APP_LIMITS.nameCharsMax) {
        throw new Error('A checked app has a name');
      }
      return {
        kind: 'ready',
        id: parseAppId(value['id']),
        name,
        version: parseAppVersion(value['version']),
        iconPresent: value['iconPresent'] === true,
      };
    }
    case 'refused': {
      const code = text(value['code']);
      if (code.length === 0 || code.length > 40) {
        throw new Error('A refusal names its code');
      }
      return { kind: 'refused', code, message: message(value['message']) };
    }
    case 'unavailable':
      return { kind: 'unavailable', message: message(value['message']), ...optionalMessageRef(value['messageRef']) };
    default:
      throw new Error('A marketplace check is ready, refused or unavailable');
  }
}

export function parseSubmissionOutcome(input: unknown): MarketplaceSubmissionOutcome {
  const value = record(input);
  switch (value['kind']) {
    case 'submitted': {
      const id = value['id'];
      if (id !== undefined && (typeof id !== 'number' || !Number.isSafeInteger(id))) {
        throw new Error('A submission id is a whole number');
      }
      return { kind: 'submitted', id, updated: value['updated'] === true };
    }
    case 'refused': {
      const code = text(value['code']);
      if (code.length === 0 || code.length > 40) {
        throw new Error('A refusal names its code');
      }
      return { kind: 'refused', code, message: message(value['message']) };
    }
    case 'unavailable':
      return { kind: 'unavailable', message: message(value['message']), ...optionalMessageRef(value['messageRef']) };
    default:
      throw new Error('A submission outcome is submitted, refused or unavailable');
  }
}

function optionalMessageRef(input: unknown): { readonly messageRef?: MessageRef } {
  if (input === undefined) {
    return {};
  }
  const parsed = parseMessageRef(input);
  return parsed.ok ? { messageRef: parsed.value } : {};
}

function message(input: unknown): string {
  const value = text(input).trim();
  if (value.length === 0 || value.length > APP_LIMITS.messageCharsMax) {
    throw new Error('A message is 1 to 1000 characters');
  }
  return value;
}


export interface AppRepositoryRef {
  readonly owner: string;
  readonly repository: string;
  readonly account: string;
}

export function parseAppRepositoryRef(input: unknown): AppRepositoryRef {
  const value = record(input);
  const source = parseGitHubSource({ owner: value['owner'], repository: value['repository'], asset: 'app.zip' });
  return { owner: source.owner, repository: source.repository, account: parseGitHubLogin(value['account']) };
}

export type AppScanTarget = { readonly kind: 'installed'; readonly id: string } | ({ readonly kind: 'repository' } & AppRepositoryRef);

export function parseAppScanTarget(input: unknown): AppScanTarget {
  const value = record(input);
  if (value['kind'] === 'installed') {
    return { kind: 'installed', id: parseAppId(value['id']) };
  }
  if (value['kind'] === 'repository') {
    return { kind: 'repository', ...parseAppRepositoryRef(value) };
  }
  throw new Error('A scan reads an installed app or a repository');
}

export function parseSharedReleaseSource(input: unknown): AppGitHubSource & { readonly tag: string } {
  const value = record(input);
  return { ...parseGitHubSource(value), tag: parseReleaseTag(value['tag']) };
}

function optionalCreatedRefs(input: unknown, count: number): { readonly createdRefs?: readonly MessageRef[] } {
  const items = toArray(input);
  if (items === undefined || items.length !== count) {
    return {};
  }
  const refs: MessageRef[] = [];
  for (const item of items) {
    const parsed = parseOptionalMessageRef(item);
    if (parsed === undefined) {
      return {};
    }
    refs.push(parsed);
  }
  return { createdRefs: refs };
}
