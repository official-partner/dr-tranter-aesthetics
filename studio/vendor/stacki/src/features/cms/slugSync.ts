import { assert } from '../../../shared/core/assert';
import { remoteObject, type RemoteValue } from '../../../shared/properties/cmsRemoteSchema';
import type { RemoteDocumentField } from '../../../shared/properties/cmsRemote';
import { ENTRY_SLUG_LIMITS, slugify as entrySlugify } from '../../../shared/properties/entrySlug';

export const SLUG_SYNC_LIMITS = {
  slugCharsMax: ENTRY_SLUG_LIMITS.charsMax,
} as const;

export interface SlugPair {
  readonly source: string;
  readonly slug: string;
}

const SOURCE_NAMES = ['title', 'name'] as const;

export function slugPairOf(fields: readonly RemoteDocumentField[]): SlugPair | undefined {
  const slug = fields.find((field) => field.type.kind === 'slug');
  if (slug === undefined) {
    return undefined;
  }
  for (const name of SOURCE_NAMES) {
    const source = fields.find((field) => field.name === name && field.type.kind === 'string');
    if (source !== undefined) {
      assert(source.name !== slug.name, 'A slug never follows itself');
      return { source: source.name, slug: slug.name };
    }
  }
  return undefined;
}

export const slugify: (text: string) => string = entrySlugify;

export function slugText(value: RemoteValue | undefined): string {
  const current = remoteObject(value)?.['current'];
  return typeof current === 'string' ? current : '';
}

export function slugValue(text: string): RemoteValue | undefined {
  return text === '' ? undefined : { _type: 'slug', current: text };
}

export function slugInStep(source: RemoteValue | undefined, slug: RemoteValue | undefined) {
  const current = slugText(slug);
  return current === '' || current === slugify(typeof source === 'string' ? source : '');
}
