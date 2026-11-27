import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assert } from '../../../shared/core/assert';
import type { ScanComponent } from '../../../shared/properties/projectScan';
import type { MessageKey } from '../../lib/i18n/localeContext';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { TrailingSlash } from '../../editor/pageState';
import { componentPreviewURL, prettyComponentName, type ComponentPreviewGesture, type ComponentPreviewMessage } from './paletteModel';
import { useResolvedPreviewURL, usePreviewGestures, usePreviewMessages } from './previewSource';

interface PreviewTarget {
  readonly url: string;
  readonly name: string;
}

interface PreviewEntry {
  readonly target: PreviewTarget;
  readonly status: 'loading' | 'ready' | 'empty';
}

const previewFramesMax = 4;

export type PreviewStatusHandler = (url: string, status: 'ready' | 'empty', reason?: PreviewReason) => void;

export type PreviewReason = { readonly key: MessageKey } | { readonly text: string };

export const previewSilenceMs = 3000;

export const PREVIEW_SILENT_REASON: PreviewReason = { key: 'palette.preview.silent' };

export const PREVIEW_UNRESOLVED_REASON: PreviewReason = { key: 'palette.preview.unresolved' };

export function ComponentPreviewPopup({
  preview,
  devURL,
  trailingSlash,
  resolvePreviewURL,
}: {
  readonly preview: {
    readonly component: ScanComponent;
    readonly left: number;
    readonly top: number;
  };
  readonly devURL: string;
  readonly trailingSlash: TrailingSlash;
  readonly resolvePreviewURL?: (url: string) => Promise<string>;
}) {
  const url = componentPreviewURL(devURL, preview.component, trailingSlash);
  const name = preview.component.name;
  const target = useMemo(() => ({ url, name }), [url, name]);
  const translate = useTranslate();
  const { frames, receive } = usePreviewCache(target);
  const active = frames.find((frame) => frame.target.url === url);
  assert(active, 'The hovered preview must be cached');
  const empty = active.status === 'empty';
  const loading = active.status === 'loading';
  return (
    <div
      className="comp-preview"
      style={{ left: preview.left, top: preview.top, visibility: empty ? 'hidden' : 'visible' }}
      aria-hidden={empty}
      data-loading={loading}
    >
      <div className="comp-preview-title">{prettyComponentName(name)}</div>
      <div className="comp-preview-content">
        {loading && (
          <div className="comp-preview-loading" role="status">
            <span className="panel-loading-label">{translate('palette.preview.loading')}</span>
          </div>
        )}
        {frames.map((frame) => (
          <ComponentPreviewFrame
            key={frame.target.url}
            url={frame.target.url}
            name={frame.target.name}
            visible={frame.target.url === url && frame.status === 'ready'}
            surface="popup"
            resolvePreviewURL={resolvePreviewURL}
            onStatus={receive}
          />
        ))}
      </div>
    </div>
  );
}

function usePreviewCache(target: PreviewTarget) {
  const [cache, setCache] = useState<{
    readonly frames: ReadonlyArray<PreviewEntry>;
    readonly recentURLs: ReadonlyArray<string>;
  }>({ frames: [{ target, status: 'loading' }], recentURLs: [target.url] });
  assert(cache.frames.length > 0, 'The preview cache must contain its current target');
  assert(cache.frames.length <= previewFramesMax, 'The preview cache must remain bounded');
  let frames = cache.frames;
  if (cache.recentURLs.at(-1) !== target.url) {
    const recent = cache.recentURLs.filter((url) => url !== target.url);
    const recentURLs = [...recent.slice(-(previewFramesMax - 1)), target.url];
    frames = cache.frames.filter((entry) => recentURLs.includes(entry.target.url));
    if (!frames.some((entry) => entry.target.url === target.url)) {
      frames = [...frames, { target, status: 'loading' }];
    }
    setCache({ frames, recentURLs });
  }
  const receive = useCallback<PreviewStatusHandler>((readyURL, status) => {
    setCache((current) => ({
      ...current,
      frames: current.frames.map((entry) => (entry.target.url === readyURL ? { ...entry, status } : entry)),
    }));
  }, []);
  return { frames, receive };
}

export function ComponentPreviewFrame({
  url,
  name,
  visible,
  surface,
  resolvePreviewURL,
  onStatus,
  onGesture,
}: {
  readonly url: string;
  readonly name: string;
  readonly visible: boolean;
  readonly surface: 'popup' | 'card';
  readonly resolvePreviewURL?: ((url: string) => Promise<string>) | undefined;
  readonly onStatus: PreviewStatusHandler;
  readonly onGesture?: ((gesture: ComponentPreviewGesture) => void) | undefined;
}) {
  assert(url.length > 0, 'A preview frame has a URL');
  assert(onGesture === undefined || surface === 'card', 'Only a card frame reports gestures');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resolvedURL = useResolvedPreviewURL(url, resolvePreviewURL);
  const answered = useRef(false);
  const [pageLoaded, setPageLoaded] = useState(false);
  const receive = useCallback(
    (message: ComponentPreviewMessage): void => {
      answered.current = true;
      onStatus(url, message.status, message.reason === undefined ? undefined : { text: message.reason });
    },
    [url, onStatus],
  );
  usePreviewMessages(frameRef, receive);
  usePreviewGestures(frameRef, onGesture);
  useEffect(() => {
    if (resolvedURL.kind === 'empty') {
      onStatus(url, 'empty', PREVIEW_UNRESOLVED_REASON);
    }
  }, [resolvedURL.kind, url, onStatus]);
  useEffect(() => {
    if (!pageLoaded) {
      return;
    }
    const timer = setTimeout(() => {
      if (!answered.current) {
        onStatus(url, 'empty', PREVIEW_SILENT_REASON);
      }
    }, previewSilenceMs);
    return () => clearTimeout(timer);
  }, [pageLoaded, url, onStatus]);
  if (resolvedURL.kind !== 'ready') {
    return undefined;
  }
  return (
    <iframe
      ref={frameRef}
      className={surface === 'card' ? 'insert-frame' : undefined}
      src={resolvedURL.url}
      title={`${name} preview`}
      tabIndex={surface === 'card' ? -1 : undefined}
      sandbox={surface === 'card' ? 'allow-scripts allow-same-origin' : undefined}
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden={surface === 'card' ? true : !visible}
      onLoad={() => setPageLoaded(true)}
    />
  );
}
