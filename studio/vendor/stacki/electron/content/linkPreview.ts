
import { assert } from '../../shared/core/assert';
import { toRecord } from '../../shared/core/record';
import { LINK_PREVIEW_LIMITS, videoHostOf, videoLinkOf, type LinkPreview, type VideoLink } from '../../shared/properties/linkPreview';

export const LINK_PREVIEW_FETCH = {
  timeoutMs: 8_000,
  oembedBytesMax: 256 * 1024,
  pageBytesMax: 768 * 1024,
  thumbnailBytesMax: 1_500_000,
} as const satisfies Record<string, number>;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export async function fetchLinkPreview(url: string, fetcher: Fetch = fetch): Promise<LinkPreview | undefined> {
  const link = videoLinkOf(url);
  assert(link !== undefined, 'A link preview is asked for a video host link');
  const described = await fetchLinkPreviewDescribed(link, fetcher);
  if (described === undefined) {
    return undefined;
  }
  const description = textOf(described['description']) ?? (await fetchLinkPreviewDescription(link, fetcher));
  const thumbnail = await fetchLinkPreviewThumbnail(described['thumbnail_url'], fetcher);
  const title = textOf(described['title']) ?? link.url;
  const author = textOf(described['author_name']);
  const preview: LinkPreview = {
    url: link.url,
    title: clip(title, LINK_PREVIEW_LIMITS.titleCharsMax),
    source: link.host.name,
    ...(description === undefined ? {} : { description: clip(description, LINK_PREVIEW_LIMITS.descriptionCharsMax) }),
    ...(author === undefined ? {} : { author: clip(author, LINK_PREVIEW_LIMITS.authorCharsMax) }),
    ...(thumbnail === undefined ? {} : { thumbnail }),
  };
  assert(preview.title.length > 0, 'A card has a title');
  return preview;
}

async function fetchLinkPreviewDescribed(link: VideoLink, fetcher: Fetch): Promise<Record<string, unknown> | undefined> {
  const endpoint = new URL(link.host.oembed);
  endpoint.searchParams.set('url', link.url);
  assert(endpoint.protocol === 'https:', 'oEmbed endpoints are HTTPS');
  const response = await fetcher(endpoint.href, request('application/json'));
  if (response.status >= 400 && response.status < 500) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`${link.host.name} returned ${response.status}`);
  }
  const bytes = await readBounded(response, LINK_PREVIEW_FETCH.oembedBytesMax);
  if (bytes === undefined) {
    throw new Error(`${link.host.name} sent an oversized description`);
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return toRecord(parsed);
}

async function fetchLinkPreviewDescription(link: VideoLink, fetcher: Fetch): Promise<string | undefined> {
  try {
    const response = await fetcher(link.url, request('text/html'));
    const landed = URL.canParse(response.url) ? new URL(response.url).hostname : '';
    if (!response.ok) {
      return undefined;
    }
    if (videoHostOf(landed) === undefined) {
      return undefined;
    }
    const head = await readPrefix(response, LINK_PREVIEW_FETCH.pageBytesMax);
    return metaDescription(new TextDecoder().decode(head));
  } catch {
    return undefined;
  }
}

async function fetchLinkPreviewThumbnail(input: unknown, fetcher: Fetch): Promise<string | undefined> {
  const address = textOf(input);
  if (address === undefined || !URL.canParse(address)) {
    return undefined;
  }
  if (new URL(address).protocol !== 'https:') {
    return undefined;
  }
  try {
    const response = await fetcher(address, request('image/*'));
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    const known = IMAGE_TYPES.find((candidate) => candidate === type);
    if (!response.ok || known === undefined) {
      return undefined;
    }
    const bytes = await readBounded(response, LINK_PREVIEW_FETCH.thumbnailBytesMax);
    return bytes === undefined ? undefined : `data:${known};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return undefined;
  }
}

export function metaDescription(html: string): string | undefined {
  for (const property of ['og:description', 'description', 'twitter:description']) {
    const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`, 'i').exec(html)?.[0];
    const content = tag === undefined ? undefined : /content=["']([^"']*)["']/i.exec(tag)?.[1];
    const text = content === undefined ? undefined : decodeEntities(content).trim();
    if (text !== undefined && text.length > 0) {
      return text;
    }
  }
  return undefined;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }
    if (lower.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }
    const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    return named[lower] ?? entity;
  });
}

function request(accept: string): RequestInit {
  return {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: accept, 'User-Agent': 'Stacki link preview' },
    signal: AbortSignal.timeout(LINK_PREVIEW_FETCH.timeoutMs),
  };
}

async function readBounded(response: Response, bytesMax: number): Promise<Uint8Array | undefined> {
  const bytes = await readPrefix(response, bytesMax + 1);
  return bytes.length > bytesMax ? undefined : bytes;
}

async function readPrefix(response: Response, bytesMax: number): Promise<Uint8Array> {
  assert(bytesMax > 0, 'A read has room for some bytes');
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < bytesMax) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    const value: unknown = chunk.value;
    assert(value instanceof Uint8Array, 'A response body streams bytes');
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel();
  const joined = Buffer.concat(chunks);
  return joined.subarray(0, Math.min(joined.length, bytesMax));
}

function textOf(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim().length > 0 ? input.trim() : undefined;
}

function clip(text: string, charsMax: number): string {
  return text.length > charsMax ? text.slice(0, charsMax - 1) + '…' : text;
}
