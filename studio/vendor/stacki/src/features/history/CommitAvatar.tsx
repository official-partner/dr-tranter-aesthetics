import React, { useState } from 'react';
import { assert } from '../../../shared/core/assert';
import { authorColor, authorInitials } from './commitAvatars';

const LOADED_URLS_MAX = 512;
const loadedUrls = new Set<string>();

function rememberLoaded(url: string): void {
  loadedUrls.delete(url);
  loadedUrls.add(url);
  if (loadedUrls.size > LOADED_URLS_MAX) {
    const oldest = loadedUrls.values().next().value;
    assert(oldest !== undefined, 'CommitAvatar: a full set has an oldest picture');
    loadedUrls.delete(oldest);
  }
  assert(loadedUrls.size <= LOADED_URLS_MAX, 'CommitAvatar: the shown pictures stay within their bound');
}

function initialState(url: string | undefined): 'loading' | 'ready' {
  return url !== undefined && loadedUrls.has(url) ? 'ready' : 'loading';
}

export default function CommitAvatar({ name, email, url }: { readonly name: string; readonly email: string; readonly url: string | undefined }) {
  const [image, setImage] = useState<{ readonly url: string | undefined; readonly state: 'loading' | 'ready' | 'failed' }>(() => ({
    url,
    state: initialState(url),
  }));
  const state = image.url === url ? image.state : initialState(url);
  return (
    <span className="history-avatar" style={{ color: authorColor(email, name) }} aria-hidden="true">
      {authorInitials(name, email)}
      {url !== undefined && state !== 'failed' && (
        <img
          src={url}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          decoding={state === 'ready' ? 'sync' : 'async'}
          referrerPolicy="no-referrer"
          data-state={state}
          onLoad={() => {
            rememberLoaded(url);
            setImage({ url, state: 'ready' });
          }}
          onError={() => setImage({ url, state: 'failed' })}
        />
      )}
    </span>
  );
}
