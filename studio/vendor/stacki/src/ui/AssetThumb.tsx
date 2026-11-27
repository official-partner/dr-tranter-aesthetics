import { assetSources } from '../ipc/editorEnvironment';
import React, { useRef, useState } from 'react';
import { assert } from '../../shared/core/assert';
import { BOUNDARY_LIMITS } from '../../shared/core/boundary';
import { FileIcon, CodeIcon } from './Icons';
import { Skeleton } from './Skeleton';
import { THUMBNAIL_EXT, useThumbnail } from './assetThumbnails';
import { FONT_PREVIEW_EXTENSIONS, acquireFontPreview, releaseFontPreview, useFontPreview } from './fontPreview';
import type { WireAssetEntry } from '../../shared/ipc/ipcResults';

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|oga|ogg)$/i;
export const TEXT_EXT = /\.(css|js|mjs|cjs|ts|json|txt|md|xml|csv|webmanifest|toml|yml|yaml)$/i;
const FONT_DOCUMENT_EXT = /\.(woff2?|ttf|otf|eot|pdf|zip)$/i;

const cleanPath = (value: unknown): string =>
  String(value || '')
    .trim()
    .split(/[?#]/)[0] ?? '';

export function looksLikeAssetPath(value: unknown) {
  const path = cleanPath(value);
  if (!path.startsWith('/') || path.startsWith('//')) {
    return false;
  }
  return IMAGE_EXT.test(path) || VIDEO_EXT.test(path) || AUDIO_EXT.test(path) || TEXT_EXT.test(path) || FONT_DOCUMENT_EXT.test(path);
}

export function mediaKindFor(value: unknown) {
  const path = cleanPath(value);
  if (VIDEO_EXT.test(path)) {
    return 'video';
  }
  if (AUDIO_EXT.test(path)) {
    return 'audio';
  }
  if (IMAGE_EXT.test(path)) {
    return 'image';
  }
  return 'asset';
}

const encodePath = (abs: string): string =>
  abs
    .replace(/\\/g, '/')
    .replace(/^\/(?!\/)/, '')
    .split('/')
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');

const fileURL = (encodedPath: string): string => (encodedPath.startsWith('//') ? `file:${encodedPath}` : `file:///${encodedPath}`);

export const sourceCandidates = (abs: string): readonly [string, string] =>
  assetSources(abs, [`stacki-asset://local/${encodePath(abs)}`, fileURL(encodePath(abs))]);

export const FONT_EXT = FONT_PREVIEW_EXTENSIONS;

const FONT_PRELOAD_COUNT_MAX = 4;
const FONT_PRELOAD_BYTES_MAX = 256 * 1024;
export function preloadFontPreviews(entries: readonly WireAssetEntry[]): void {
  assert(entries.length <= BOUNDARY_LIMITS.itemsMax, 'Font catalog stays bounded');
  let count = 0;
  for (const entry of entries) {
    if (entry.isDir) {
      continue;
    }
    if (!FONT_EXT.test(entry.name) || entry.size > FONT_PRELOAD_BYTES_MAX) {
      continue;
    }
    const key = `preload:${entry.abs}`;
    void acquireFontPreview(key, sourceCandidates(entry.abs)).finally(() => releaseFontPreview(key));
    count++;
    if (count === FONT_PRELOAD_COUNT_MAX) {
      break;
    }
  }
  assert(count <= FONT_PRELOAD_COUNT_MAX, 'Font preloads stay within their request budget');
}

export interface AssetDimensions {
  readonly w: number;
  readonly h: number;
}
interface AssetThumbProps {
  readonly file: { readonly abs: string; readonly name: string };
  readonly className?: string;
  readonly onImageLoad?: ((dimensions: AssetDimensions) => void) | undefined;
  readonly onClick?: React.MouseEventHandler<HTMLDivElement>;
  readonly downscale?: { readonly key: string } | undefined;
}
export default function AssetThumb({ file, className = '', onImageLoad, onClick, downscale }: AssetThumbProps) {
  const { videoRef, source, failed, nextSource, isText, isVideo, isImage, isFont, fontFamily, sourceIndex } = useAssetPreview(file);
  const thumbnail = useThumbnail(downscale?.key ?? file.abs, source, {
    wanted: downscale !== undefined && isImage && !failed && sourceIndex === 0 && THUMBNAIL_EXT.test(file.name),
  });
  return (
    <div
      className={`asset-thumb ${isFont && fontFamily ? 'is-font' : ''} ${className}`}
      onClick={onClick}
      onMouseEnter={isVideo ? () => assetHoverPlay(videoRef) : undefined}
      onMouseLeave={isVideo ? () => assetHoverStop(videoRef) : undefined}
    >
      {isImage && !failed && thumbnail.kind === 'pending' ? (
        <Skeleton width="100%" height="100%" radius="0" />
      ) : isImage && !failed ? (
        <img
          key={thumbnail.kind === 'ready' ? thumbnail.url : source}
          src={thumbnail.kind === 'ready' ? thumbnail.url : source}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(event) =>
            onImageLoad?.({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })
          }
          onError={nextSource}
        />
      ) : isVideo && !failed ? (
        <video
          key={source}
          ref={videoRef}
          src={`${source}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          draggable={false}
          onLoadedMetadata={(event) => onImageLoad?.({ w: event.currentTarget.videoWidth, h: event.currentTarget.videoHeight })}
          onError={nextSource}
        />
      ) : isFont && fontFamily ? (
        <span className="asset-font" style={{ fontFamily: `"${fontFamily}"` }}>
          Aa{}
        </span>
      ) : (
        <span className="asset-ext">
          {isText ? <CodeIcon size={16} /> : <FileIcon size={16} />}
          {(file.name.split('.').pop() || '').toUpperCase().slice(0, 5)}
        </span>
      )}
      {isVideo && !failed && <span className="asset-badge">▶</span>}
    </div>
  );
}

function useAssetPreview(file: AssetThumbProps['file']) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  React.useEffect(() => setSourceIndex(0), [file.abs]);
  const candidates = React.useMemo(() => sourceCandidates(file.abs), [file.abs]);
  const source = candidates[sourceIndex];
  const failed = sourceIndex >= candidates.length;
  const nextSource = () => setSourceIndex((i) => Math.min(i + 1, candidates.length));
  const isText = TEXT_EXT.test(file.name);
  const isVideo = !isText && VIDEO_EXT.test(file.name);
  const isImage = !isText && !isVideo && IMAGE_EXT.test(file.name);
  const isFont = !isText && !isVideo && !isImage && FONT_EXT.test(file.name);

  const fontFamily = useFontPreview(isFont ? file.abs : undefined, candidates);

  return {
    videoRef,
    source,
    failed,
    nextSource,
    isText,
    isVideo,
    isImage,
    isFont,
    fontFamily,
    sourceIndex,
  };
}

function assetHoverPlay(video: React.RefObject<HTMLVideoElement>): void {
  const player = video.current;
  if (!player) {
    return;
  }
  player.loop = true;
  player.muted = true;
  player.play().catch(() => {});
}
function assetHoverStop(video: React.RefObject<HTMLVideoElement>): void {
  const player = video.current;
  if (!player) {
    return;
  }
  player.pause();
  try {
    player.currentTime = 0.1;
  } catch {
  }
}
