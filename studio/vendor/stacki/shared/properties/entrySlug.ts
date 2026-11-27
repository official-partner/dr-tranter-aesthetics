
import { record, text } from '../core/boundary';
import { assert } from '../core/assert';
import { parseOptionalMessageRef, type MessageRef } from '../core/i18n/messageReference';
import { ENGLISH_TRANSLATE } from './i18n/englishTranslator';
import type { Translator } from './i18n/messageRef';

export const ENTRY_SLUG_LIMITS = {
  charsMax: 96,
  takenMax: 2000,
  folderCharsMax: 512,
  reasonCharsMax: 400,
} as const;

export type EntrySlugRename = { readonly kind: 'editable' } | { readonly kind: 'locked'; readonly reason: string; readonly reasonRef?: MessageRef | undefined };

export interface EntrySlug {
  readonly folder: string;
  readonly value: string;
  readonly taken: readonly string[];
  readonly rename: EntrySlugRename;
}

export type SlugCheck =
  | { readonly kind: 'ok'; readonly slug: string; readonly normalised: boolean }
  | { readonly kind: 'empty' }
  | { readonly kind: 'tooLong'; readonly slug: string }
  | { readonly kind: 'taken'; readonly slug: string; readonly normalised: boolean };

export function slugWords(typed: string): string {
  const words = typed
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  assert(!words.startsWith('-'), 'A slug never starts with a hyphen');
  assert(!words.endsWith('-'), 'A slug never ends with a hyphen');
  return words;
}

export function slugify(typed: string): string {
  const words = slugWords(typed);
  const slug = cut(words, ENTRY_SLUG_LIMITS.charsMax);
  assert(slug.length <= ENTRY_SLUG_LIMITS.charsMax, 'A slug stays within its bound');
  assert(!slug.startsWith('-'), 'A slug never starts with a hyphen');
  return slug;
}

export function checkEntrySlug(typed: string, context: { readonly taken: readonly string[] }): SlugCheck {
  const slug = slugWords(typed);
  if (slug === '') {
    return { kind: 'empty' };
  }
  if (slug.length > ENTRY_SLUG_LIMITS.charsMax) {
    return { kind: 'tooLong', slug };
  }
  const normalised = slug !== typed;
  if (context.taken.includes(slug)) {
    return { kind: 'taken', slug, normalised };
  }
  assert(slug.length > 0, 'A saved slug is never empty');
  return { kind: 'ok', slug, normalised };
}

export function slugProblem(check: SlugCheck, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  switch (check.kind) {
    case 'ok':
      return undefined;
    case 'empty':
      return translate('cmsBackend.slug.empty');
    case 'tooLong':
      return translate('cmsBackend.slug.tooLong', { count: ENTRY_SLUG_LIMITS.charsMax });
    case 'taken':
      return translate('cmsBackend.slug.taken');
    default: {
      const exhaustive: never = check;
      return exhaustive;
    }
  }
}

export function slugNote(check: SlugCheck, translate: Translator = ENGLISH_TRANSLATE): string | undefined {
  switch (check.kind) {
    case 'ok':
    case 'taken':
      return check.normalised ? translate('cmsBackend.slug.saved', { slug: check.slug }) : undefined;
    case 'empty':
    case 'tooLong':
      return undefined;
    default: {
      const exhaustive: never = check;
      return exhaustive;
    }
  }
}

export function splitEntryId(id: string): { readonly folder: string; readonly value: string } {
  const slash = id.lastIndexOf('/');
  const folder = slash < 0 ? '' : id.slice(0, slash + 1);
  const value = id.slice(folder.length);
  assert(`${folder}${value}` === id, 'A split id joins back to itself');
  return { folder, value };
}

export function parseEntrySlugText(input: unknown): string {
  const slug = text(input);
  if (slug.length === 0) {
    throw new Error('A slug cannot be empty.');
  }
  if (slug.length > ENTRY_SLUG_LIMITS.charsMax) {
    throw new Error('The slug is too long.');
  }
  if (slugWords(slug) !== slug) {
    throw new Error('A slug is lower case letters, numbers and single hyphens.');
  }
  assert(!slug.includes('/'), 'A slug never names a folder');
  return slug;
}

export function parseEntrySlug(input: unknown): EntrySlug {
  const value = record(input);
  const folder = text(value['folder']);
  if (folder.length > ENTRY_SLUG_LIMITS.folderCharsMax) {
    throw new Error('The entry folder is too long.');
  }
  if (folder !== '' && !folder.endsWith('/')) {
    throw new Error('An entry folder ends with a slash.');
  }
  const stored = text(value['value']);
  if (stored.length > ENTRY_SLUG_LIMITS.folderCharsMax || stored.includes('/')) {
    throw new Error('Invalid entry slug.');
  }
  const taken = value['taken'];
  if (!Array.isArray(taken) || taken.length > ENTRY_SLUG_LIMITS.takenMax) {
    throw new Error('Expected the slugs already taken, within the bound.');
  }
  const slugs = taken.map((each: unknown) => text(each));
  assert(slugs.length <= ENTRY_SLUG_LIMITS.takenMax, 'Taken slugs are bounded');
  return { folder, value: stored, taken: slugs, rename: parseRename(value['rename']) };
}

function parseRename(input: unknown): EntrySlugRename {
  const value = record(input);
  if (value['kind'] === 'editable') {
    return { kind: 'editable' };
  }
  if (value['kind'] !== 'locked') {
    throw new Error('Expected whether the slug can be renamed.');
  }
  const reason = text(value['reason']);
  if (reason.length === 0 || reason.length > ENTRY_SLUG_LIMITS.reasonCharsMax) {
    throw new Error('A locked slug says why, briefly.');
  }
  const reasonRef = parseOptionalMessageRef(value['reasonRef']);
  return reasonRef === undefined ? { kind: 'locked', reason } : { kind: 'locked', reason, reasonRef };
}

function cut(slug: string, max: number): string {
  if (slug.length <= max) {
    return slug;
  }
  const head = slug.slice(0, max);
  const lastHyphen = head.lastIndexOf('-');
  return (lastHyphen > 0 ? head.slice(0, lastHyphen) : head).replace(/-+$/, '');
}
