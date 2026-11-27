
import { assert } from '../../shared/core/assert';

export type RemoteMediaHint = 'image' | 'video' | 'audio' | 'asset';

export type RemoteMedia =
  { readonly kind: 'image'; readonly source: string } | { readonly kind: 'video'; readonly source: string } | { readonly kind: 'unknown' };

export const REMOTE_MEDIA_LIMITS = {
  urlLengthMax: 2 * 1024 * 1024,
} as const satisfies Record<string, number>;

export const VIDEO_FRAME_SECONDS = 0.1;

const VIDEO_PATH = /\.(mp4|webm|mov|m4v|ogv)$/i;
const OGG_PATH = /\.ogg$/i;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const AUDIO_PATH = /\.(mp3|wav|m4a|aac|flac|oga)$/i;
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i;

export function classifyRemoteMedia(value: string, hint: RemoteMediaHint): RemoteMedia {
  const text = value.trim();
  if (text.length === 0) {
    return { kind: 'unknown' };
  }
  if (text.length > REMOTE_MEDIA_LIMITS.urlLengthMax) {
    return { kind: 'unknown' };
  }
  const url = parseAbsoluteURL(text.startsWith('//') ? `https:${text}` : text);
  if (url === undefined) {
    return { kind: 'unknown' };
  }
  const media = mediaForURL(url, hint);
  assertAllowedSource(media);
  return media;
}

export function remotePosterSource(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const media = classifyRemoteMedia(value, 'image');
  if (media.kind === 'image') {
    return media.source;
  }
  return undefined;
}

function parseAbsoluteURL(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

function mediaForURL(url: URL, hint: RemoteMediaHint): RemoteMedia {
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      return mediaForPath(url, hint);
    case 'data:':
      if (DATA_IMAGE.test(url.href)) {
        return { kind: 'image', source: url.href };
      }
      return { kind: 'unknown' };
    case 'blob:':
      if (hint === 'video') {
        return { kind: 'video', source: videoFrameSource(url) };
      }
      if (hint === 'audio') {
        return { kind: 'unknown' };
      }
      return { kind: 'image', source: url.href };
    default:
      return { kind: 'unknown' };
  }
}

function mediaForPath(url: URL, hint: RemoteMediaHint): RemoteMedia {
  const path = url.pathname;
  if (VIDEO_PATH.test(path)) {
    return { kind: 'video', source: videoFrameSource(url) };
  }
  if (OGG_PATH.test(path)) {
    if (hint === 'audio') {
      return { kind: 'unknown' };
    }
    return { kind: 'video', source: videoFrameSource(url) };
  }
  if (IMAGE_PATH.test(path)) {
    return { kind: 'image', source: url.href };
  }
  if (AUDIO_PATH.test(path)) {
    return { kind: 'unknown' };
  }
  switch (hint) {
    case 'video':
      return { kind: 'video', source: videoFrameSource(url) };
    case 'audio':
      return { kind: 'unknown' };
    case 'image':
    case 'asset':
      return { kind: 'image', source: url.href };
    default: {
      const exhaustive: never = hint;
      return exhaustive;
    }
  }
}

function videoFrameSource(url: URL): string {
  const framed = new URL(url.href);
  framed.hash = `t=${VIDEO_FRAME_SECONDS}`;
  assert(framed.protocol === url.protocol, 'Video frame source keeps its scheme');
  return framed.href;
}

function assertAllowedSource(media: RemoteMedia): void {
  if (media.kind === 'unknown') {
    return;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(media.source)?.[1]?.toLowerCase();
  assert(scheme === 'http' || scheme === 'https' || scheme === 'data' || scheme === 'blob', 'Remote media loads an allowed scheme');
  if (scheme === 'data') {
    assert(media.kind === 'image', 'Remote data: media is an image');
  }
}
