import type { IncomingMessage, ServerResponse } from 'node:http';
import { assert } from '../../shared/core/assert';

export const LOOPBACK_ONLY_PREFIXES = ['/__avb', '/studio', '/__open-in-editor'] as const;

const HEADER_CHARS_MAX = 512;

export function isLoopbackAddress(remote: string | undefined): boolean {
  if (remote === undefined) {
    return false;
  }
  const address = remote.toLowerCase();
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') {
    return true;
  }
  const mapped = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(mapped);
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host.length === 0 || host.length > HEADER_CHARS_MAX) {
    return false;
  }
  const hostname = hostnameOf(host.toLowerCase());
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true;
  }
  if (hostname === '[::1]') {
    return true;
  }
  return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(hostname);
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }
  if (origin.length > HEADER_CHARS_MAX) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return isLoopbackHost(parsed.host);
  }
  return false;
}

export function isLoopbackOnlyRoute(url: string | undefined): boolean {
  const path = (url ?? '/').split('?')[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  const normalized = decoded.replace(/\/{2,}/g, '/').toLowerCase();
  return LOOPBACK_ONLY_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix + '/') || normalized.startsWith(prefix + '?'));
}

export type LoopbackVerdict = { readonly kind: 'pass' } | { readonly kind: 'refuse'; readonly reason: 'remote' | 'host' | 'origin' };

export function judgeRequest(request: {
  readonly url: string | undefined;
  readonly remoteAddress: string | undefined;
  readonly host: string | undefined;
  readonly origin: string | undefined;
}): LoopbackVerdict {
  if (!isLoopbackOnlyRoute(request.url)) {
    return { kind: 'pass' };
  }
  if (!isLoopbackAddress(request.remoteAddress)) {
    return { kind: 'refuse', reason: 'remote' };
  }
  if (!isLoopbackHost(request.host)) {
    return { kind: 'refuse', reason: 'host' };
  }
  if (!isLoopbackOrigin(request.origin)) {
    return { kind: 'refuse', reason: 'origin' };
  }
  return { kind: 'pass' };
}

export function loopbackGuardMiddleware(request: IncomingMessage, response: ServerResponse, next: () => void): void {
  const verdict = judgeRequest({
    url: request.url,
    remoteAddress: request.socket.remoteAddress,
    host: headerText(request.headers.host),
    origin: headerText(request.headers.origin),
  });
  switch (verdict.kind) {
    case 'pass': {
      next();
      return;
    }
    case 'refuse': {
      assert(isLoopbackOnlyRoute(request.url), 'loopbackGuardMiddleware: only Stacki routes are refused');
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Forbidden');
      return;
    }
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

function headerText(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return value?.[0];
}

function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}
