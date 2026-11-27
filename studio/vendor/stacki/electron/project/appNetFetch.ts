import { assert } from '../../shared/core/assert';
import { appConnectHosts } from '../../shared/properties/appAuth';
import type { AppManifest } from '../../shared/properties/apps';
import { APP_NET_LIMITS, type AppNetRequest, type AppNetResponse } from '../../shared/properties/appNet';
import { readBounded } from './appGitHub';

export interface AppNetDependencies {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly now: () => number;
  readonly accessToken: (manifest: AppManifest, provider: string) => Promise<string>;
}

export function createAppNetRate(now: () => number): { readonly spend: (appId: string) => void } {
  const spent = new Map<string, number[]>();
  return {
    spend: (appId) => {
      const nowMs = now();
      const recent = (spent.get(appId) ?? []).filter((atMs) => nowMs - atMs < APP_NET_LIMITS.rateWindowMs);
      if (recent.length >= APP_NET_LIMITS.requestsPerMinuteMax) {
        throw new Error(`An app may make at most ${APP_NET_LIMITS.requestsPerMinuteMax} requests a minute through Stacki; try again shortly`);
      }
      recent.push(nowMs);
      spent.delete(appId);
      spent.set(appId, recent);
      for (const key of spent.keys()) {
        if (spent.size <= APP_NET_LIMITS.rateAppsMax) {
          break;
        }
        spent.delete(key);
      }
      assert(recent.length <= APP_NET_LIMITS.requestsPerMinuteMax, 'The rate window is bounded');
    },
  };
}

export async function appNetFetch(
  manifest: AppManifest,
  request: AppNetRequest,
  rate: { readonly spend: (appId: string) => void },
  dependencies: AppNetDependencies,
): Promise<AppNetResponse> {
  const allowed = new Set(appConnectHosts(manifest.network, manifest.auth));
  const first = new URL(request.url);
  if (!allowed.has(first.host)) {
    throw new Error(`${first.host} is not declared in ${manifest.name}'s network list`);
  }
  rate.spend(manifest.id);
  const headers = new Headers(request.headers);
  if (request.auth !== undefined) {
    headers.set('authorization', `Bearer ${await dependencies.accessToken(manifest, request.auth)}`);
  }
  const signal = AbortSignal.timeout(APP_NET_LIMITS.timeoutMs);
  let url = first;
  let method: string = request.method;
  let body: Blob | undefined =
    request.body === undefined ? undefined : new Blob([Buffer.from(request.body, request.encoding === 'base64' ? 'base64' : 'utf8')]);
  if (body !== undefined && body.size > APP_NET_LIMITS.requestBytesMax) {
    throw new Error(`The request body exceeds ${APP_NET_LIMITS.requestBytesMax} bytes`);
  }
  for (let redirects = 0; redirects <= APP_NET_LIMITS.redirectsMax; redirects += 1) {
    const response = await send(dependencies, url, { method, headers, body, signal });
    const location = response.status >= 300 && response.status < 400 ? (response.headers.get('location') ?? undefined) : undefined;
    if (location === undefined) {
      return answer(response, url);
    }
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || !allowed.has(next.host)) {
      throw new Error(`${manifest.name}'s request was redirected to ${next.host}, which its network list does not declare`);
    }
    if (next.host !== first.host) {
      headers.delete('authorization');
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      headers.delete('content-type');
    }
    url = next;
  }
  throw new Error(`${manifest.name}'s request was redirected more than ${APP_NET_LIMITS.redirectsMax} times`);
}

async function send(
  dependencies: AppNetDependencies,
  url: URL,
  init: { readonly method: string; readonly headers: Headers; readonly body: Blob | undefined; readonly signal: AbortSignal },
): Promise<Response> {
  try {
    return await dependencies.fetch(url.toString(), {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: 'manual',
      credentials: 'omit',
      signal: init.signal,
    });
  } catch (error: unknown) {
    throw new Error(`${url.host} did not answer: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
  }
}

async function answer(response: Response, url: URL): Promise<AppNetResponse> {
  const bytes = await readBounded(response, APP_NET_LIMITS.responseBytesMax);
  const headers: Record<string, string> = {};
  let count = 0;
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === 'set-cookie' || lower === 'set-cookie2' || count >= APP_NET_LIMITS.headersMax * 4) {
      return;
    }
    headers[lower] = value.slice(0, APP_NET_LIMITS.headerCharsMax);
    count += 1;
  });
  const text = textOf(bytes);
  return text === undefined
    ? { status: response.status, url: url.toString(), headers, body: Buffer.from(bytes).toString('base64'), encoding: 'base64' }
    : { status: response.status, url: url.toString(), headers, body: text, encoding: 'utf8' };
}

function textOf(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
