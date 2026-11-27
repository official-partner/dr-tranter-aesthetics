import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';
import type { AppSettingDeclaration } from './appSettings';
import { STACKI_CONNECTION_PROVIDERS, STACKI_CONNECTION_PROVIDER_IDS, isStackiConnectionProvider, type StackiConnectionProviderId } from './appConnections';

export const APP_NETWORK_LIMITS = {
  hostsMax: 16,
  hostCharsMax: 253,
  purposeCharsMax: 120,
} as const satisfies Record<string, number>;

export const APP_AUTH_LIMITS = {
  providersMax: 4,
  idCharsMax: 32,
  labelCharsMax: 60,
  urlCharsMax: 2048,
  scopesMax: 32,
  scopeCharsMax: 256,
  flowTimeoutMs: 5 * 60_000,
  tokenRequestTimeoutMs: 20_000,
  tokenResponseBytesMax: 64 * 1024,
  tokenCharsMax: 8192,
  refreshSkewMs: 60_000,
  accountCharsMax: 256,
  authorizeParamsMax: 8,
  authorizeParamCharsMax: 128,
} as const satisfies Record<string, number>;

export interface AppNetworkHost {
  readonly host: string;
  readonly purpose: string;
}

export interface AppAuthProvider {
  readonly id: string;
  readonly label: string;
  readonly authorizeURL: string;
  readonly tokenURL: string;
  readonly scopes: readonly string[];
  readonly pkce: true;
  readonly connection: StackiConnectionProviderId | undefined;
  readonly clientIdSetting: string | undefined;
  readonly clientSecretSetting: string | undefined;
  readonly authorizeParams: Readonly<Record<string, string>>;
}

export const RESERVED_AUTHORIZE_PARAMS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method'] as const;

export type AppAuthStatus =
  | { readonly provider: string; readonly connected: false }
  | { readonly provider: string; readonly connected: false; readonly code: 'unconfigured'; readonly message: string }
  | { readonly provider: string; readonly connected: true; readonly account: string | undefined; readonly expiresAtMs: number | undefined };

export interface AppAccessToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresAtMs: number | undefined;
}

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const PROVIDER_ID = /^[a-z][a-z0-9_-]*$/;


export function parseAppNetwork(input: unknown): readonly AppNetworkHost[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('network is a list of { host, purpose }');
  }
  if (items.length > APP_NETWORK_LIMITS.hostsMax) {
    throw new Error(`An app declares at most ${APP_NETWORK_LIMITS.hostsMax} network hosts`);
  }
  const hosts = items.map((item) => {
    const value = record(item);
    return { host: parseNetworkHost(value['host']), purpose: boundedText(value['purpose'], APP_NETWORK_LIMITS.purposeCharsMax, 'network purpose') };
  });
  if (new Set(hosts.map((entry) => entry.host)).size !== hosts.length) {
    throw new Error('A network host is declared twice');
  }
  assert(hosts.length <= APP_NETWORK_LIMITS.hostsMax, 'Network hosts are bounded');
  return hosts;
}

export function parseNetworkHost(input: unknown): string {
  const host = text(input).trim();
  if (host.length === 0 || host.length > APP_NETWORK_LIMITS.hostCharsMax) {
    throw new Error(`A network host is 1 to ${APP_NETWORK_LIMITS.hostCharsMax} characters`);
  }
  if (!HOST.test(host)) {
    throw new Error(`"${host.slice(0, 80)}" is not a host name: write it like api.example.com, without https:// or a path`);
  }
  assert(!host.includes('/'), 'A host never carries a path');
  assert(!host.includes(':'), 'A host never carries a scheme or port');
  return host;
}

export function parseAppAuthProviders(input: unknown, settings: readonly AppSettingDeclaration[]): readonly AppAuthProvider[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('auth is a list of providers');
  }
  if (items.length > APP_AUTH_LIMITS.providersMax) {
    throw new Error(`An app declares at most ${APP_AUTH_LIMITS.providersMax} auth providers`);
  }
  const providers = items.map((item) => parseProvider(item, settings));
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
    throw new Error('Two auth providers share an id');
  }
  return providers;
}

function parseProvider(input: unknown, settings: readonly AppSettingDeclaration[]): AppAuthProvider {
  const value = record(input);
  const connectionInput = connectionNamed(value);
  if (connectionInput !== undefined) {
    if (!isStackiConnectionProvider(connectionInput)) {
      throw new Error(`auth provider must be one of ${STACKI_CONNECTION_PROVIDER_IDS.join(', ')}; name your own endpoints for any other`);
    }
    return parseConnection(value, connectionInput, settings);
  }
  const id = parseAuthProviderId(value['id']);
  if (value['pkce'] !== true) {
    throw new Error(`Auth provider ${id}: pkce must be true; Stacki signs in with PKCE only`);
  }
  const clientIdSetting = parseClientIdSetting(value['clientIdSetting'], id, settings);
  if (clientIdSetting === undefined) {
    throw new Error(`Auth provider ${id}: clientIdSetting names a text or secret setting the manifest declares`);
  }
  return {
    id,
    label: boundedText(value['label'], APP_AUTH_LIMITS.labelCharsMax, `Auth provider ${id} label`),
    authorizeURL: parseEndpointURL(value['authorizeURL'], `Auth provider ${id} authorizeURL`),
    tokenURL: parseEndpointURL(value['tokenURL'], `Auth provider ${id} tokenURL`),
    scopes: parseScopes(value['scopes'], id),
    pkce: true,
    connection: undefined,
    clientIdSetting,
    clientSecretSetting: parseClientSecretSetting(value['clientSecretSetting'], id, settings),
    authorizeParams: parseAuthorizeParams(value['authorizeParams'], id),
  };
}

function parseConnection(
  value: Readonly<Record<string, unknown>>,
  connection: StackiConnectionProviderId,
  settings: readonly AppSettingDeclaration[],
): AppAuthProvider {
  const registered = STACKI_CONNECTION_PROVIDERS[connection];
  const id = value['id'] === undefined ? connection : parseAuthProviderId(value['id']);
  const scopes = parseScopes(value['scopes'], id);
  for (const scope of scopes) {
    if (!registered.scopes.includes(scope)) {
      throw new Error(`Auth provider ${id}: Stacki's ${registered.label} connection does not offer the scope "${scope.slice(0, 80)}"`);
    }
  }
  if (value['clientIdSetting'] !== undefined && !registered.loopbackClients) {
    throw new Error(
      `Auth provider ${id}: ${registered.label} accepts only exact redirect URLs, so an installer's own client cannot sign in through Stacki's loopback; leave out clientIdSetting and use Stacki's connection`,
    );
  }
  if (!endpointFromRegistry(value['authorizeURL'], registered.authorizeURL)) {
    throw new Error(`Auth provider ${id}: a Stacki connection takes its endpoints from Stacki; leave out authorizeURL and tokenURL`);
  }
  if (!endpointFromRegistry(value['tokenURL'], registered.tokenURL)) {
    throw new Error(`Auth provider ${id}: a Stacki connection takes its endpoints from Stacki; leave out authorizeURL and tokenURL`);
  }
  return {
    id,
    label: value['label'] === undefined ? registered.label : boundedText(value['label'], APP_AUTH_LIMITS.labelCharsMax, `Auth provider ${id} label`),
    authorizeURL: registered.authorizeURL,
    tokenURL: registered.tokenURL,
    scopes,
    pkce: true,
    connection,
    clientIdSetting: parseClientIdSetting(value['clientIdSetting'], id, settings),
    clientSecretSetting: parseClientSecretSetting(value['clientSecretSetting'], id, settings),
    authorizeParams: registered.authorizeParams,
  };
}

function connectionNamed(value: Readonly<Record<string, unknown>>): unknown {
  const named = value['provider'];
  const parsed = value['connection'];
  if (named === undefined) {
    return parsed;
  }
  if (parsed !== undefined) {
    if (parsed !== named) {
      throw new Error('An auth provider names one Stacki connection: provider and connection differ');
    }
  }
  return named;
}

function endpointFromRegistry(input: unknown, registered: string): boolean {
  if (input === undefined) {
    return true;
  }
  return input === registered;
}

function parseScopes(input: unknown, id: string): readonly string[] {
  const scopes = toArray(input ?? []);
  if (scopes === undefined || scopes.length > APP_AUTH_LIMITS.scopesMax) {
    throw new Error(`Auth provider ${id}: scopes is a list of at most ${APP_AUTH_LIMITS.scopesMax}`);
  }
  return scopes.map((scope) => {
    const parsed = boundedText(scope, APP_AUTH_LIMITS.scopeCharsMax, `Auth provider ${id} scope`);
    if (/\s/.test(parsed)) {
      throw new Error(`Auth provider ${id}: a scope has no spaces`);
    }
    return parsed;
  });
}

function parseClientIdSetting(input: unknown, id: string, settings: readonly AppSettingDeclaration[]): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const setting = text(input);
  const declared = settings.find((entry) => entry.id === setting);
  if (declared === undefined || declared.kind === 'url') {
    throw new Error(`Auth provider ${id}: clientIdSetting names a text or secret setting the manifest declares`);
  }
  return setting;
}

function parseClientSecretSetting(input: unknown, id: string, settings: readonly AppSettingDeclaration[]): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const setting = text(input);
  const declared = settings.find((entry) => entry.id === setting);
  if (declared === undefined || declared.kind !== 'secret') {
    throw new Error(`Auth provider ${id}: clientSecretSetting names a secret setting the manifest declares`);
  }
  return setting;
}

function parseAuthorizeParams(input: unknown, id: string): Readonly<Record<string, string>> {
  if (input === undefined) {
    return {};
  }
  const entries = Object.entries(record(input));
  if (entries.length > APP_AUTH_LIMITS.authorizeParamsMax) {
    throw new Error(`Auth provider ${id}: at most ${APP_AUTH_LIMITS.authorizeParamsMax} authorizeParams`);
  }
  const params: Record<string, string> = {};
  for (const [name, raw] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
      throw new Error(`Auth provider ${id}: "${name.slice(0, 40)}" is not a parameter name`);
    }
    if (RESERVED_AUTHORIZE_PARAMS.some((reserved) => reserved === name)) {
      throw new Error(`Auth provider ${id}: Stacki sets ${name} itself`);
    }
    params[name] = boundedText(raw, APP_AUTH_LIMITS.authorizeParamCharsMax, `Auth provider ${id} ${name}`);
  }
  return params;
}

export function parseAuthProviderId(input: unknown): string {
  const id = text(input);
  if (id.length === 0 || id.length > APP_AUTH_LIMITS.idCharsMax || !PROVIDER_ID.test(id)) {
    throw new Error(`An auth provider id is 1 to ${APP_AUTH_LIMITS.idCharsMax} lowercase letters, digits, - and _`);
  }
  return id;
}

export function parseEndpointURL(input: unknown, what: string): string {
  const value = text(input);
  if (value.length === 0 || value.length > APP_AUTH_LIMITS.urlCharsMax) {
    throw new Error(`${what} is 1 to ${APP_AUTH_LIMITS.urlCharsMax} characters`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${what} is not a URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${what} must start with https://`);
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error(`${what} carries no credentials or fragment`);
  }
  return url.toString();
}

export function appConnectHosts(network: readonly AppNetworkHost[], providers: readonly AppAuthProvider[]): readonly string[] {
  const hosts = new Set(network.map((entry) => entry.host));
  for (const provider of providers) {
    hosts.add(new URL(provider.tokenURL).host);
  }
  assert(hosts.size <= APP_NETWORK_LIMITS.hostsMax + APP_AUTH_LIMITS.providersMax, 'Connect hosts are bounded');
  return [...hosts];
}

export function networkSummary(network: readonly AppNetworkHost[]): string {
  if (network.length === 0) {
    return 'Works fully offline';
  }
  return `Uses external services: ${network.map((entry) => `${entry.host} (${entry.purpose})`).join(', ')}`;
}


export function parseAppAuthStatus(input: unknown): AppAuthStatus {
  const value = record(input);
  const provider = parseAuthProviderId(value['provider']);
  if (value['connected'] === false) {
    if (value['code'] === 'unconfigured') {
      return { provider, connected: false, code: 'unconfigured', message: boundedText(value['message'], 280, 'message') };
    }
    return { provider, connected: false };
  }
  if (value['connected'] !== true) {
    throw new Error('An auth status says whether it is connected');
  }
  return {
    provider,
    connected: true,
    account: value['account'] === undefined ? undefined : boundedText(value['account'], APP_AUTH_LIMITS.accountCharsMax, 'account'),
    expiresAtMs: optionalTime(value['expiresAtMs']),
  };
}

export function parseAppAuthStatuses(input: unknown): readonly AppAuthStatus[] {
  const items = toArray(input);
  if (items === undefined || items.length > APP_AUTH_LIMITS.providersMax) {
    throw new Error('Expected a bounded list of auth statuses');
  }
  return items.map(parseAppAuthStatus);
}

export function parseAppAccessToken(input: unknown): AppAccessToken {
  const value = record(input);
  return {
    accessToken: boundedText(value['accessToken'], APP_AUTH_LIMITS.tokenCharsMax, 'accessToken'),
    tokenType: boundedText(value['tokenType'], 40, 'tokenType'),
    expiresAtMs: optionalTime(value['expiresAtMs']),
  };
}

function optionalTime(input: unknown): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new Error('A time is whole milliseconds since 1970');
  }
  return input;
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
