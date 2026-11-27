import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { parseAuthProviderId } from './appAuth';

export const APP_NET_LIMITS = {
  urlCharsMax: 4096,
  requestBytesMax: 5 * 1024 * 1024,
  responseBytesMax: 5 * 1024 * 1024,
  headersMax: 32,
  headerCharsMax: 8192,
  timeoutMs: 30_000,
  redirectsMax: 3,
  requestsPerMinuteMax: 120,
  rateWindowMs: 60_000,
  rateAppsMax: 50,
} as const satisfies Record<string, number>;

export const APP_NET_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type AppNetMethod = (typeof APP_NET_METHODS)[number];

const FORBIDDEN_HEADERS = /^(?:cookie|cookie2|host|connection|content-length|transfer-encoding|keep-alive|upgrade|te|trailer|origin|referer|proxy-.*|sec-.*)$/;

export interface AppNetRequest {
  readonly url: string;
  readonly method: AppNetMethod;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly encoding: 'utf8' | 'base64';
  readonly auth: string | undefined;
}

export interface AppNetResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly encoding: 'utf8' | 'base64';
}

export function parseAppNetRequest(input: unknown): AppNetRequest {
  const value = record(input);
  const url = parseNetURL(value['url']);
  const method = value['method'] === undefined ? 'GET' : APP_NET_METHODS.find((known) => known === text(value['method']).toUpperCase());
  if (method === undefined) {
    throw new Error(`method is one of ${APP_NET_METHODS.join(', ')}`);
  }
  const auth = value['auth'] === undefined ? undefined : parseAuthProviderId(value['auth']);
  const headers = parseHeaders(value['headers'], { authBySigning: auth !== undefined });
  const encoding = value['encoding'] === undefined ? 'utf8' : value['encoding'] === 'base64' ? 'base64' : value['encoding'] === 'utf8' ? 'utf8' : undefined;
  if (encoding === undefined) {
    throw new Error('encoding is utf8 or base64');
  }
  let body: string | undefined;
  if (value['body'] !== undefined) {
    body = text(value['body']);
    if (method === 'GET' || method === 'HEAD') {
      throw new Error(`A ${method} request has no body`);
    }
    const bytesMax = encoding === 'base64' ? Math.ceil(APP_NET_LIMITS.requestBytesMax / 3) * 4 : APP_NET_LIMITS.requestBytesMax;
    if (body.length > bytesMax) {
      throw new Error(`body exceeds ${APP_NET_LIMITS.requestBytesMax} bytes`);
    }
    if (encoding === 'base64' && (!/^[A-Za-z0-9+/]*={0,2}$/.test(body) || body.length % 4 !== 0)) {
      throw new Error('body is not base64');
    }
  }
  return { url, method, headers, body, encoding, auth };
}

export function parseNetURL(input: unknown): string {
  const value = text(input);
  if (value.length === 0 || value.length > APP_NET_LIMITS.urlCharsMax) {
    throw new Error(`url is 1 to ${APP_NET_LIMITS.urlCharsMax} characters`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('url is not a URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('url starts with https://');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('url carries no credentials');
  }
  assert(url.hostname.length > 0, 'An https URL has a host');
  return url.toString();
}

function parseHeaders(input: unknown, options: { readonly authBySigning: boolean }): Readonly<Record<string, string>> {
  if (input === undefined) {
    return {};
  }
  const entries = Object.entries(record(input));
  if (entries.length > APP_NET_LIMITS.headersMax) {
    throw new Error(`A request sends at most ${APP_NET_LIMITS.headersMax} headers`);
  }
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(name)) {
      throw new Error(`"${rawName.slice(0, 40)}" is not a header name`);
    }
    if (FORBIDDEN_HEADERS.test(name)) {
      throw new Error(`Apps cannot send the ${name} header`);
    }
    if (name === 'authorization' && options.authBySigning) {
      throw new Error('With auth, Stacki sets the authorization header itself');
    }
    const headerValue = text(rawValue);
    if (headerValue.length > APP_NET_LIMITS.headerCharsMax || /[\r\n\0]/.test(headerValue)) {
      throw new Error(`The ${name} header is one line of at most ${APP_NET_LIMITS.headerCharsMax} characters`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

export function parseAppNetResponse(input: unknown): AppNetResponse {
  const value = record(input);
  const status = value['status'];
  if (typeof status !== 'number' || !Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw new Error('A response has an HTTP status');
  }
  const encoding = value['encoding'] === 'base64' ? 'base64' : value['encoding'] === 'utf8' ? 'utf8' : undefined;
  if (encoding === undefined) {
    throw new Error('A response body is utf8 or base64');
  }
  const body = text(value['body']);
  if (body.length > Math.ceil(APP_NET_LIMITS.responseBytesMax / 3) * 4) {
    throw new Error('A response body exceeds its bound');
  }
  const headerEntries = Object.entries(record(value['headers']));
  if (headerEntries.length > APP_NET_LIMITS.headersMax * 4) {
    throw new Error('A response has too many headers');
  }
  const headers: Record<string, string> = {};
  for (const [name, raw] of headerEntries) {
    headers[name] = text(raw).slice(0, APP_NET_LIMITS.headerCharsMax);
  }
  return { status, url: parseNetURL(value['url']), headers, body, encoding };
}
