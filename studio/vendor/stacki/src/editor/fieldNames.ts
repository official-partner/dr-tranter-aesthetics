
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

export const MEDIA_WORDS = new Set(['src', 'image', 'poster', 'icon', 'logo', 'avatar', 'thumb', 'thumbnail', 'photo', 'banner', 'cover', 'video', 'audio']);

export function mediaWord(name: string): string {
  const text = String(name || '');
  assert(text.length <= LIMITS.attrCharsMax, 'mediaWord: a name is bounded');
  const words = text
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
    .split(/\s+/);
  return words[words.length - 1] || '';
}

export function isMediaName(name: string): boolean {
  return MEDIA_WORDS.has(mediaWord(name));
}

export function isHrefName(name: string): boolean {
  return lastWord(name) === 'href';
}

export function isLinkName(name: string): boolean {
  const last = lastWord(name);
  return last === 'href' || last === 'url' || last === 'link';
}

function lastWord(name: string): string {
  const text = String(name);
  assert(text.length <= LIMITS.attrCharsMax, 'lastWord: a name is bounded');
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words[words.length - 1] ?? '';
}
