import { record, text } from '../../shared/core/boundary';
import { assert } from '../../shared/core/assert';
import { described, type Described, type MessageKey } from '../../shared/properties/i18n/messageRef';
import {
  discoveryIdentifier,
  discoveryLabel,
  discoveryList,
  DISCOVERY_LIMITS,
  type ConnectionFailure,
  type PublishAccount,
  type PublishProject,
} from '../../shared/properties/publishDiscovery';
import type { NetlifyHosting, NetlifySiteRequest, NetlifySiteResult } from '../../shared/properties/publishNetlify';
import { parseNetlifySiteRequest, parseNetlifySiteResult } from '../../shared/properties/publishNetlify';
import { netlifyAPI, type NetlifyFailure } from './publishNetlifyCommand';
import { DiscoveryCommandError } from './publishDiscoveryCommand';

const SITES_PER_PAGE = 50;
const SITE_PAGES_MAX = DISCOVERY_LIMITS.itemsMax / SITES_PER_PAGE;

export function netlifyConnectionFailure(failure: NetlifyFailure): ConnectionFailure {
  switch (failure) {
    case 'refused':
    case 'not-found':
      return 'unknown';
    case 'timeout':
      return 'network';
    case 'missing-cli':
    case 'signed-out':
    case 'expired':
    case 'network':
    case 'unknown':
      return failure;
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

async function netlifyRead(root: string, method: 'listAccountsForUser' | 'listSitesForAccount' | 'getSite', data: Readonly<Record<string, unknown>>) {
  const result = await netlifyAPI(root, method, data);
  if (!result.ok) {
    throw new DiscoveryCommandError(netlifyConnectionFailure(result.error), 'Netlify');
  }
  return result.value;
}

export async function netlifyAccounts(root: string): Promise<readonly PublishAccount[]> {
  const accounts = discoveryList(await netlifyRead(root, 'listAccountsForUser', {}));
  return accounts.map((entry) => {
    const account = record(entry);
    return { id: discoveryIdentifier(account['slug']), name: discoveryLabel(account['name']) };
  });
}

export async function netlifyProjects(root: string, team: string): Promise<readonly PublishProject[]> {
  const projects: PublishProject[] = [];
  for (let page = 1; page <= SITE_PAGES_MAX; page++) {
    const sites = discoveryList(await netlifyRead(root, 'listSitesForAccount', { account_slug: team, page, per_page: SITES_PER_PAGE }));
    projects.push(
      ...sites.map((entry): PublishProject => {
        const site = record(entry);
        return { name: discoveryLabel(site['name']), account: team, hosting: { provider: 'netlify', siteId: discoveryIdentifier(site['id']) } };
      }),
    );
    discoveryList(projects);
    if (sites.length < SITES_PER_PAGE) {
      return projects;
    }
  }
  throw new Error('Netlify has too many sites to list. Use manual configuration.');
}

export function netlifySiteDomains(input: unknown): readonly string[] {
  const site = record(input);
  const custom = site['custom_domain'];
  const secure = site['ssl_url'];
  return [
    ...(typeof custom === 'string' && custom !== '' ? [custom] : []),
    ...(typeof secure === 'string' && secure !== '' ? [new URL(secure).hostname] : []),
  ];
}

export async function netlifySite(root: string, hosting: NetlifyHosting): Promise<unknown> {
  return netlifyRead(root, 'getSite', { site_id: hosting.siteId });
}

export async function createNetlifySite(root: string, input: NetlifySiteRequest): Promise<NetlifySiteResult> {
  const request = parseNetlifySiteRequest(input);
  const created = await netlifyAPI(root, 'createSiteInTeam', { account_slug: request.team, body: { name: request.name } });
  if (!created.ok) {
    return failedSite(createProblem(created.error));
  }
  try {
    const site = record(created.value);
    assert(text(site['name']) === request.name, 'Netlify created the requested name');
    return parseNetlifySiteResult({ kind: 'ready', name: request.name, hosting: { provider: 'netlify', siteId: text(site['id']) } });
  } catch {
    return failedSite(described('publish.netlify.error.createUnconfirmed'));
  }
}

function createProblem(failure: NetlifyFailure): Described {
  switch (failure) {
    case 'refused':
      return described('publish.netlify.error.nameRefused');
    case 'timeout':
      return described('publish.netlify.error.createUnconfirmed');
    case 'not-found':
    case 'unknown':
      return described('publish.netlify.error.createFailed');
    case 'missing-cli':
    case 'signed-out':
    case 'expired':
    case 'network':
      return connectionSentence(failure);
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

function failedSite(problem: Described): NetlifySiteResult {
  return problem.messageRef === undefined
    ? { kind: 'failed', message: problem.message }
    : { kind: 'failed', message: problem.message, messageRef: problem.messageRef };
}

export function netlifyDeployProblem(failure: NetlifyFailure): Described {
  return failure === 'not-found' ? described('publish.netlify.error.siteNotFound') : connectionSentence(netlifyConnectionFailure(failure));
}

const CONNECTION_KEYS = {
  'missing-cli': 'publish.connection.failure.missingCli',
  'signed-out': 'publish.connection.failure.signedOut',
  expired: 'publish.connection.failure.expired',
  network: 'publish.connection.failure.network',
  unknown: 'publish.connection.failure.unknown',
} as const satisfies Record<ConnectionFailure, MessageKey>;

function connectionSentence(reason: ConnectionFailure): Described {
  return described(CONNECTION_KEYS[reason], { provider: 'Netlify' });
}
