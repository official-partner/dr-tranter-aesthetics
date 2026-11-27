import { assert } from '../../../shared/core/assert';
import { openHostedLink } from '../../ipc/mediaHostingBridge';
import type { Translator } from '../../../shared/properties/i18n/messageRef';

export function localAssetLink(rel: string): string {
  assert(rel.length > 0, 'An asset link names a file');
  assert(!rel.startsWith('/'), 'An asset path is relative to the project');
  const link = rel.startsWith('public/') ? `/${rel.slice('public/'.length)}` : `/${rel}`;
  assert(link.startsWith('/'), 'A link is root-relative');
  return link;
}

export async function copyLink(link: string, translate: Translator, showToast: (message: string, kind: 'error' | 'success') => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
  } catch (error: unknown) {
    showToast(translate('assets.link.copyFailed', { error: error instanceof Error ? error.message : String(error) }), 'error');
    return;
  }
  showToast(translate('assets.link.copied'), 'success');
}

export function openLink(url: string): Promise<void> {
  return openHostedLink(url);
}
