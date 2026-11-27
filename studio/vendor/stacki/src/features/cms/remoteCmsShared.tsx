import { ErrorToast } from '../../ui/ErrorToast';
import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteCache } from './remoteCmsCache';
import { AstroIcon, CmsIcon, PayloadIcon, SanityIcon } from '../../ui/Icons';
import type { CmsSource } from '../../../shared/properties/astroContent';
import type { RemoteResult } from '../../../shared/properties/cmsRemote';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { SkeletonRows } from '../../ui/Skeleton';

export interface RemoteCmsSelection {
  readonly connection: CmsSource;
  readonly collection: string;
  readonly item: { readonly id: string; readonly title: string } | undefined;
  readonly mode?: 'settings' | undefined;
}

export type FieldChecks = 'shown' | 'held';
export const FieldChecksContext = createContext<FieldChecks>('shown');

export function useRemote<T>(cache: RemoteCache<T>, key: string, load: () => Promise<RemoteResult<T>>) {
  const [shown, setShown] = useState(() => ({ key, result: cache.get(key) }));
  const current = useRef(key);
  current.current = key;
  const run = useCallback(() => {
    setShown({ key, result: cache.get(key) });
    void cache.load(key, load).then((result) => {
      if (current.current === key) {
        setShown({ key, result });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names what `load` reads
  }, [cache, key]);
  useEffect(run, [run]);
  useEffect(() => {
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [run]);
  const replaceAt = useCallback(
    (at: string, value: T) => {
      cache.set(at, value);
      if (current.current === at) {
        setShown({ key: at, result: { ok: true, value } });
      }
    },
    [cache],
  );
  const replace = useCallback((value: T) => replaceAt(key, value), [replaceAt, key]);
  const result = shown.key === key ? shown.result : cache.get(key);
  return { result, retry: run, replace, replaceAt };
}

export function Loading<T>(props: {
  readonly result: RemoteResult<T> | undefined;
  readonly retry: () => void;
  readonly children: (value: T) => React.ReactNode;
}) {
  const translate = useTranslate();
  if (props.result === undefined) {
    return (
      <div className="remote-cms-loading">
        <SkeletonRows count={4} />
      </div>
    );
  }
  if (!props.result.ok) {
    return (
      <div className="remote-cms-loading">
        <ErrorToast message={props.result.message} />
        <button type="button" onClick={props.retry}>
          {translate('cmsRemote.common.tryAgain')}
        </button>
      </div>
    );
  }
  return props.children(props.result.value);
}

export function ConnectionLogo(props: { readonly kind: CmsSource['kind']; readonly size?: number }) {
  const size = props.size ?? 14;
  switch (props.kind) {
    case 'sanity':
      return <SanityIcon size={size} />;
    case 'payload':
      return <PayloadIcon size={size} />;
    case 'custom':
      return <CmsIcon size={size} />;
    case 'astro':
      return <AstroIcon size={size} />;
    default: {
      const exhaustive: never = props.kind;
      return exhaustive;
    }
  }
}
