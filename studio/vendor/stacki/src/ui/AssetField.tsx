import React, { useContext, useEffect, useMemo, useState } from 'react';
import { AssetPickPresentationContext } from './assetPickPresentation';
import { ElementImageIcon } from './Icons';
import { listAssetEntries, onAssetEntriesChanged } from '../ipc/assetBridge';
import type { WireAssetEntry } from '../../shared/ipc/ipcResults';
import type { AssetAltPick, AssetPickTarget, AssetRequest } from './assetPick';
import type { AssetDimensions } from './AssetThumb';
import AssetThumb from './AssetThumb';
import { chooseAsset } from './assetPick';
import { useAppOverrideOwner } from './appOverrideSlot';
import { OverrideNote, overrideTitle } from './OverrideNote';
import { assetRelCandidates, assetValueFor, isExternalAsset } from './assetPath';
import { classifyRemoteMedia, remotePosterSource, type RemoteMediaHint } from './remoteMedia';
import type { MessageKey, Translator } from '../lib/i18n/localeContext';
import { useFormat, useTranslate } from '../lib/i18n/useTranslate';

const CHOOSE_KEYS = {
  image: 'ui.assetField.chooseImage',
  video: 'ui.assetField.chooseVideo',
  audio: 'ui.assetField.chooseAudio',
  asset: 'ui.assetField.chooseAsset',
} as const satisfies Record<'image' | 'video' | 'audio' | 'asset', MessageKey>;
const ASSET_REFRESH_CHAIN_MAX = 256;

const remoteName = (url: string) => {
  const path = url.split(/[?#]/)[0] ?? '';
  return path.split('/').filter(Boolean).pop() || path;
};
const remoteHost = (url: string, translate: Translator) => {
  if (/^data:/i.test(url)) {
    return 'data URI';
  }
  try {
    return new URL(/^\/\//.test(url) ? `https:${url}` : url).hostname;
  } catch {
    return translate('ui.assetField.external');
  }
};

export function RemoteThumb({
  url,
  hint,
  poster,
  onLoad,
}: {
  readonly url: string;
  readonly hint: RemoteMediaHint;
  readonly poster?: string | undefined;
  readonly onLoad?: ((dimensions: AssetDimensions) => void) | undefined;
}) {
  const media = useMemo(() => classifyRemoteMedia(url, hint), [url, hint]);
  const posterSource = useMemo(() => remotePosterSource(poster), [poster]);
  const [failedSource, setFailedSource] = useState<string | undefined>(undefined);
  if (media.kind === 'unknown') {
    return <ElementImageIcon size={18} />;
  }
  if (failedSource === media.source) {
    return <ElementImageIcon size={18} />;
  }
  if (media.kind === 'image') {
    return (
      <img
        key={media.source}
        src={media.source}
        alt=""
        draggable={false}
        onLoad={(event) => onLoad?.({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
        onError={() => setFailedSource(media.source)}
      />
    );
  }
  return (
    <video
      key={media.source}
      src={media.source}
      {...(posterSource === undefined ? {} : { poster: posterSource })}
      muted
      playsInline
      preload="metadata"
      autoPlay={false}
      draggable={false}
      onLoadedMetadata={(event) => onLoad?.({ w: event.currentTarget.videoWidth, h: event.currentTarget.videoHeight })}
      onError={() => setFailedSource(media.source)}
    />
  );
}

export interface PickedAsset {
  readonly rel: string;
  readonly root: string;
}
export type AssetReference = 'url' | 'module';
export type AltPick = { readonly kind: 'value'; readonly value: string } | { readonly kind: 'entry'; readonly entry: PickedAsset };
export interface AssetFieldProps {
  readonly value?: string | undefined;
  readonly fallbackValue?: string | undefined;
  readonly onChange: (value: string, immediate?: boolean) => void;
  readonly mediaKind?: AssetRequest['mediaKind'];
  readonly projectPath: string;
  readonly showModeToggle?: boolean;
  readonly initialMode?: 'asset' | 'url';
  readonly plainLabel?: string;
  readonly onDimensions?: ((dimensions: AssetDimensions) => void) | undefined;
  readonly onPickEntry?: ((entry: PickedAsset) => void) | false | undefined;
  readonly srcRel?: string | undefined;
  readonly baseDir?: string | undefined;
  readonly onCurrentDimensions?: ((dimensions: AssetDimensions) => void) | undefined;
  readonly posterValue?: string | undefined;
  readonly pickPresentation?: AssetRequest['presentation'];
  readonly pickTarget?: AssetPickTarget | undefined;
  readonly onPickWithAlt?: ((pick: AltPick, alt: string) => void) | undefined;
}

export default function AssetField(props: AssetFieldProps) {
  const translate = useTranslate();
  const { showModeToggle = true, plainLabel = 'URL', mediaKind = 'asset', onChange } = props;
  const state = useAssetField(props);
  const toggle = showModeToggle && <AssetMode mode={state.mode} onMode={state.setMode} plainLabel={plainLabel} />;
  const remoteCard = state.external && <RemoteCard state={state} mediaKind={mediaKind} posterValue={props.posterValue} />;
  const owner = useAppOverrideOwner('assets.pick');
  if (state.mode === 'url') {
    return (
      <div className="asset-field">
        {toggle}
        {remoteCard}
        <input
          value={props.value ?? ''}
          placeholder={state.isFallback ? state.current : 'https://…'}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }
  return (
    <div className="asset-field">
      {toggle}
      {remoteCard || <LocalCard state={state} srcRel={props.srcRel} />}
      <button className="af-choose" onClick={state.choose} title={owner === undefined ? undefined : overrideTitle(translate, owner)}>
        {translate(CHOOSE_KEYS[mediaKind])}
      </button>
      <OverrideNote point="assets.pick" />
    </div>
  );
}

function useAssetField({
  value,
  fallbackValue,
  onChange,
  mediaKind = 'asset',
  projectPath,
  showModeToggle = true,
  initialMode,
  onDimensions,
  onPickEntry,
  srcRel: sourceRel,
  baseDir: baseDirectory,
  onCurrentDimensions,
  pickPresentation: ownPresentation,
  pickTarget,
  onPickWithAlt,
}: AssetFieldProps) {
  const inherited = useContext(AssetPickPresentationContext);
  const pickPresentation = ownPresentation ?? inherited;
  const current = value ?? fallbackValue ?? '';
  const isFallback = value === undefined && Boolean(fallbackValue);
  const external = isExternalAsset(current);
  const [mode, setMode] = useState(() => initialMode || (showModeToggle && external ? 'url' : 'asset'));
  const entries = useAssetEntries(projectPath);
  const [dims, setDims] = useState<AssetDimensions | undefined>(undefined);
  const justPicked = React.useRef(false);

  useEffect(() => {
    if (showModeToggle && isExternalAsset(current)) {
      setMode('url');
    }
  }, [current, showModeToggle]);

  const candidates = useMemo(() => (sourceRel ? [sourceRel] : assetRelCandidates(current, baseDirectory)), [sourceRel, current, baseDirectory]);
  const byRel = useMemo(() => {
    const map = new Map<string, Extract<WireAssetEntry, { readonly isDir: false }>>();
    for (const entry of entries) {
      if (!entry.isDir) {
        map.set(entry.rel, entry);
      }
    }
    return map;
  }, [entries]);
  const entry = useMemo(() => candidates.map((candidate) => byRel.get(candidate)).find(Boolean) || undefined, [candidates, byRel]);
  const target = candidates[0] || undefined;

  useEffect(() => setDims(undefined), [current]);

  const noteDims = (dimensions: AssetDimensions) => {
    setDims(dimensions);
    onCurrentDimensions?.(dimensions);
    if (justPicked.current) {
      justPicked.current = false;
      onDimensions?.(dimensions);
    }
  };

  const choose = (event: React.MouseEvent): void => {
    void chooseAsset(pickRequest(), { bypass: event.altKey, target: pickTarget });
  };
  const pickRequest = (): AssetRequest => ({
    mediaKind,
    ...(pickPresentation === undefined ? {} : { presentation: pickPresentation }),
    onPickWithAlt:
      onPickWithAlt === undefined
        ? undefined
        : (pick: AssetAltPick, alt: string) => {
            justPicked.current = true;
            onPickWithAlt(altPickFor({ pick, onPickEntry, baseDirectory }), alt);
          },
    current: entry?.rel || target || '',
    onPick: (pickedRel, picked) => {
      justPicked.current = true;
      answerPick({ pickedRel, picked, onPickEntry, onChange, baseDirectory });
    },
    onPickURL: (url) => {
      justPicked.current = true;
      onChange(url, true);
    },
  });
  return { current, isFallback, external, mode, setMode, dims, entry, target, noteDims, choose };
}

function answerPick(answer: {
  readonly pickedRel: string;
  readonly picked: WireAssetEntry | undefined;
  readonly onPickEntry: AssetFieldProps['onPickEntry'];
  readonly onChange: AssetFieldProps['onChange'];
  readonly baseDirectory: string | undefined;
}): void {
  const { pickedRel, picked, onPickEntry } = answer;
  if (onPickEntry) {
    onPickEntry(picked || { rel: pickedRel, root: pickedRel.split('/')[0] ?? '' });
    return;
  }
  answer.onChange(assetValueFor(pickedRel, answer.baseDirectory), true);
}

function altPickFor(answer: {
  readonly pick: AssetAltPick;
  readonly onPickEntry: AssetFieldProps['onPickEntry'];
  readonly baseDirectory: string | undefined;
}): AltPick {
  const { pick } = answer;
  switch (pick.kind) {
    case 'url':
      return { kind: 'value', value: pick.url };
    case 'file':
      if (answer.onPickEntry) {
        return { kind: 'entry', entry: { rel: pick.rel, root: pick.rel.split('/')[0] ?? '' } };
      }
      return { kind: 'value', value: assetValueFor(pick.rel, answer.baseDirectory) };
    default: {
      const exhaustive: never = pick;
      return exhaustive;
    }
  }
}

type AssetFieldState = ReturnType<typeof useAssetField>;
function AssetMode({
  mode,
  onMode,
  plainLabel,
}: {
  readonly mode: 'asset' | 'url';
  readonly onMode: (mode: 'asset' | 'url') => void;
  readonly plainLabel: string;
}) {
  const translate = useTranslate();
  return (
    <div className="af-mode">
      <button className={`af-mode-btn ${mode === 'asset' ? 'on' : ''}`} title={translate('ui.assetField.modeAssetTitle')} onClick={() => onMode('asset')}>
        {translate('ui.assetField.modeAsset')}
      </button>
      <button className={`af-mode-btn ${mode === 'url' ? 'on' : ''}`} title={translate('ui.assetField.modePlainTitle')} onClick={() => onMode('url')}>
        {plainLabel}
      </button>
    </div>
  );
}
function RemoteCard({
  state,
  mediaKind,
  posterValue,
}: {
  readonly state: AssetFieldState;
  readonly mediaKind: RemoteMediaHint;
  readonly posterValue: string | undefined;
}) {
  const translate = useTranslate();
  const { current, noteDims, dims } = state;
  return (
    <div className="af-card">
      <div className="af-thumb">
        <RemoteThumb url={current} hint={mediaKind} poster={posterValue} onLoad={noteDims} />
      </div>
      <div className="af-meta">
        <div className="af-name" title={current}>
          {remoteName(current)}
        </div>
        <div className="af-sub">{remoteHost(current, translate)}</div>
        {state.isFallback && <div className="af-sub">{translate('ui.assetField.componentFallback')}</div>}
        {dims && (
          <div className="af-sub">
            {dims.w} x {dims.h}px
          </div>
        )}
      </div>
    </div>
  );
}
function LocalCard({ state, srcRel: sourceRel }: { readonly state: AssetFieldState; readonly srcRel: string | undefined }) {
  const translate = useTranslate();
  const { formatBytes } = useFormat();
  const { entry, noteDims, current, dims, target } = state;
  return (
    <div className="af-card">
      <div className="af-thumb">{entry ? <AssetThumb file={entry} onImageLoad={noteDims} /> : <ElementImageIcon size={18} />}</div>
      <div className="af-meta">
        <div className="af-name" title={sourceRel || current}>
          {entry ? entry.name : sourceRel || current || translate('ui.assetField.noneSelected')}
        </div>
        {state.isFallback && <div className="af-sub">{translate('ui.assetField.componentFallback')}</div>}
        {dims && (
          <div className="af-sub">
            {dims.w} x {dims.h}px
          </div>
        )}
        {entry && entry.size !== undefined && <div className="af-sub">{formatBytes(entry.size)}</div>}
        {!entry && (sourceRel || current) && (
          <div className="af-sub">
            {target
              ? translate('ui.assetField.notFoundIn', { folder: target.startsWith('src/') ? 'src/' : 'public/' })
              : translate('ui.assetField.fileNotFound')}
          </div>
        )}
      </div>
    </div>
  );
}

export function useAssetEntries(projectPath: string): readonly WireAssetEntry[] {
  const [entries, setEntries] = useState<readonly WireAssetEntry[]>([]);
  useEffect(() => {
    let active = true;
    let reading = false;
    let requested = false;
    const refresh = async (): Promise<void> => {
      requested = true;
      if (reading) {
        return;
      }
      reading = true;
      try {
        for (let attempt = 0; requested && active; attempt++) {
          if (attempt >= ASSET_REFRESH_CHAIN_MAX) {
            throw new Error('AssetField: refresh chain limit exceeded');
          }
          requested = false;
          const result = await listAssetEntries(projectPath);
          if (!active) {
            return;
          }
          if (result.ok) {
            setEntries(result.value);
          } else {
            console.warn('Could not read project assets:', result.error);
          }
        }
      } finally {
        reading = false;
      }
    };
    void refresh();
    const off = onAssetEntriesChanged(() => {
      void refresh();
    });
    return () => {
      active = false;
      off();
    };
  }, [projectPath]);
  return entries;
}
