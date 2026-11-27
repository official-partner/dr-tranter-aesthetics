import type { WireAssetEntry } from '../../shared/ipc/ipcResults';
import { assert } from '../../shared/core/assert';
import type { AppMediaKind } from '../../shared/properties/appsRpc';
import { askAppOverride } from './appOverrideSlot';
import { isExternalAsset } from './assetPath';


export interface AssetRequest {
  readonly mediaKind: 'image' | 'video' | 'audio' | 'asset';
  readonly current: string;
  readonly onPick: (rel: string, entry?: WireAssetEntry) => void;
  readonly onPickURL?: ((url: string) => void) | undefined;
  readonly presentation?: 'panel' | 'overlay';
  readonly onPickWithAlt?: ((pick: AssetAltPick, alt: string) => void) | undefined;
}

export type AssetAltPick = { readonly kind: 'url'; readonly url: string } | { readonly kind: 'file'; readonly rel: string };

export interface AssetPickTarget {
  readonly nodeId: string | undefined;
  readonly field: string;
}

const ACCEPTS: Readonly<Record<AssetRequest['mediaKind'], readonly AppMediaKind[]>> = {
  image: ['image'],
  video: ['video'],
  audio: ['audio'],
  asset: ['image', 'video', 'audio', 'file'],
};

export async function chooseAsset(request: AssetRequest, options: { readonly bypass: boolean; readonly target: AssetPickTarget | undefined }): Promise<void> {
  const call = askAppOverride(
    {
      point: 'assets.pick',
      context: {
        nodeId: options.target?.nodeId,
        field: options.target?.field,
        accepts: ACCEPTS[request.mediaKind],
        current: request.current,
        acceptsURL: request.onPickURL !== undefined,
      },
    },
    { bypass: options.bypass },
  );
  const answer = await call.answer;
  assert(answer.point === 'assets.pick', 'An asset pick is answered at its own point');
  const { result } = answer;
  switch (result.kind) {
    case 'default':
      requestAsset(request);
      return;
    case 'cancel':
      return;
    case 'picked':
      if (!applyPickedAsset(request, result.url, result.alt)) {
        requestAsset(request);
      }
      return;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

function applyPickedAsset(request: AssetRequest, url: string, alt: string | undefined): boolean {
  const external = isExternalAsset(url);
  if (external) {
    if (request.onPickURL === undefined) {
      return false;
    }
  }
  const pick: AssetAltPick = external ? { kind: 'url', url } : { kind: 'file', rel: url };
  if (alt !== undefined) {
    if (request.onPickWithAlt !== undefined) {
      request.onPickWithAlt(pick, alt);
      return true;
    }
  }
  switch (pick.kind) {
    case 'url':
      assert(request.onPickURL !== undefined, 'A URL is written only to a field that takes one');
      request.onPickURL(pick.url);
      return true;
    case 'file':
      request.onPick(pick.rel, undefined);
      return true;
    default: {
      const exhaustive: never = pick;
      return exhaustive;
    }
  }
}

type AssetListener = (request: AssetRequest | undefined) => void;
let listener: AssetListener | undefined = undefined;
let pending: AssetRequest | undefined = undefined;

export function onAssetRequest(handler: AssetListener): () => void {
  listener = handler;
  return () => {
    if (listener === handler) {
      listener = undefined;
    }
  };
}

export function requestAsset(request: AssetRequest): void {
  pending = request;
  listener?.(request);
}

export function getPendingAsset(): AssetRequest | undefined {
  return pending;
}

export function clearAssetRequest(): void {
  pending = undefined;
  listener?.(undefined);
}
