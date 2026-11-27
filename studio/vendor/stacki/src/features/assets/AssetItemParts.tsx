import { useFormat, useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../lib/i18n/localeContext';
import type { Formatters } from '../../../shared/core/i18n/format';
import { readAssetDimensions } from '../../ipc/assetBridge';
import { AUDIO_EXT, FONT_EXT, IMAGE_EXT, TEXT_EXT, VIDEO_EXT } from '../../ui/AssetThumb';
import { createDimensionCache, useDimensions, type DimensionCache, type DimensionState } from './assetDimensionCache';
import { middleParts } from './assetOrder';
import { parentOf, type AssetFile } from './assetPaths';

export function AssetName({ name, tailChars, onDoubleClick }: { readonly name: string; readonly tailChars: number; readonly onDoubleClick?: () => void }) {
  const parts = middleParts(name, tailChars);
  return (
    <div className="asset-name" title={name} onDoubleClick={onDoubleClick}>
      <span className="asset-name-head">{parts.head}</span>
      <span className="asset-name-tail">{parts.tail}</span>
    </div>
  );
}

const PATH_TAIL_CHARS = 18;

export function AssetPath({ file }: { readonly file: AssetFile }) {
  const folder = `/${parentOf(file.rel)}`;
  const parts = middleParts(folder, PATH_TAIL_CHARS);
  return (
    <div className="asset-path" title={folder}>
      <span className="asset-path-head">{parts.head}</span>
      <span className="asset-path-tail">{parts.tail}</span>
    </div>
  );
}

export type AssetKind = 'image' | 'video' | 'audio' | 'font' | 'text' | 'file';

export function assetKind(name: string): AssetKind {
  if (TEXT_EXT.test(name)) {
    return 'text';
  }
  if (VIDEO_EXT.test(name)) {
    return 'video';
  }
  if (IMAGE_EXT.test(name)) {
    return 'image';
  }
  if (AUDIO_EXT.test(name)) {
    return 'audio';
  }
  return FONT_EXT.test(name) ? 'font' : 'file';
}

export function AssetDetail({ file, cache }: { readonly file: AssetFile; readonly cache: DimensionCache }) {
  const translate = useTranslate();
  const format = useFormat();
  const kind = assetKind(file.name);
  const state = useDimensions(cache, file, { wanted: kind === 'image' });
  return <div className="asset-detail">{detailText(kind, state, file.size, { translate, format })}</div>;
}

export function detailText(
  kind: AssetKind,
  state: DimensionState,
  sizeBytes: number,
  text: { readonly translate: Translator; readonly format: Pick<Formatters, 'formatBytes'> },
): string {
  const size = text.format.formatBytes(sizeBytes);
  const hasPixels = kind === 'image' || kind === 'video';
  if (hasPixels && state.kind === 'known') {
    const dimensions = text.translate('assets.item.dimensions', { width: String(state.size.widthPx), height: String(state.size.heightPx) });
    return text.translate('assets.item.detail', { dimensions, size });
  }
  if (kind === 'image' && state.kind === 'pending') {
    return text.translate('assets.item.detail', { dimensions: '…', size });
  }
  return text.translate('assets.item.kindDetail', { kind: kindText(kind, text.translate), size });
}

function kindText(kind: AssetKind, translate: Translator): string {
  switch (kind) {
    case 'image':
      return translate('assets.kind.image');
    case 'video':
      return translate('assets.kind.video');
    case 'audio':
      return translate('assets.kind.audio');
    case 'font':
      return translate('assets.kind.font');
    case 'text':
      return translate('assets.kind.text');
    case 'file':
      return translate('assets.kind.file');
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function videoSizeRecorder(file: AssetFile, cache: DimensionCache): ((size: { readonly w: number; readonly h: number }) => void) | undefined {
  if (!VIDEO_EXT.test(file.name)) {
    return undefined;
  }
  return (size) => {
    if (size.w > 0 && size.h > 0) {
      cache.put(file, { widthPx: size.w, heightPx: size.h });
    }
  };
}

export function thumbnailKey(file: AssetFile): string {
  return `${file.abs}\u0000${file.size}\u0000${file.modifiedMs ?? ''}`;
}

const caches = new Map<string, DimensionCache>();
const CACHED_PROJECTS_MAX = 8;

export function dimensionCacheFor(projectPath: string): DimensionCache {
  const known = caches.get(projectPath);
  if (known !== undefined) {
    return known;
  }
  const created = createDimensionCache(async (rel) => {
    const result = await readAssetDimensions(projectPath, rel);
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: result.value === undefined ? undefined : { widthPx: result.value.w, heightPx: result.value.h } };
  });
  caches.set(projectPath, created);
  if (caches.size > CACHED_PROJECTS_MAX) {
    const oldest = caches.keys().next().value;
    if (oldest !== undefined) {
      caches.delete(oldest);
    }
  }
  return created;
}
