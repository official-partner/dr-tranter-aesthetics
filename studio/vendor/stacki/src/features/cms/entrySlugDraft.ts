import { assert } from '../../../shared/core/assert';
import type { RemoteDocument, RemoteDocumentField } from '../../../shared/properties/cmsRemote';
import { remoteObject, type RemoteValue } from '../../../shared/properties/cmsRemoteSchema';
import { checkEntrySlug, slugify, type EntrySlug, type SlugCheck } from '../../../shared/properties/entrySlug';
import { entryNameOf, type TitleFields } from '../../../shared/properties/entryTitle';

export type SlugDraft = { readonly kind: 'follows' } | { readonly kind: 'typed'; readonly text: string };

export const FOLLOWS_NAME: SlugDraft = { kind: 'follows' };

export function committable(check: SlugCheck, stored: string): string | undefined {
  if (check.kind !== 'ok') {
    return undefined;
  }
  assert(check.slug !== '', 'A slug that passed is never empty');
  return check.slug === stored ? undefined : check.slug;
}

export function draftSlugText(document: Pick<RemoteDocument, 'fields'>, draft: SlugDraft): string {
  switch (draft.kind) {
    case 'typed':
      return draft.text;
    case 'follows':
      return slugify(draftName(document) ?? '');
    default: {
      const exhaustive: never = draft;
      return exhaustive;
    }
  }
}

export function draftName(document: Pick<RemoteDocument, 'fields'>): string | undefined {
  return entryNameOf(valuesRecord(document.fields), titleFieldsOfDocument(document.fields));
}

export function draftSlugBlock(slug: EntrySlug | undefined, text: string): SlugCheck | undefined {
  if (slug === undefined) {
    return undefined;
  }
  if (slug.rename.kind === 'locked') {
    return undefined;
  }
  if (text === '') {
    return undefined;
  }
  const check = checkEntrySlug(text, { taken: slug.taken });
  return check.kind === 'ok' ? undefined : check;
}

export function draftSlugToSave(slug: EntrySlug | undefined, text: string): string | undefined {
  if (slug === undefined) {
    return undefined;
  }
  if (slug.rename.kind === 'locked') {
    return undefined;
  }
  const check = checkEntrySlug(text, { taken: slug.taken });
  return check.kind === 'ok' ? check.slug : undefined;
}

export function copiedSlug(slug: EntrySlug): EntrySlug {
  const taken = slug.taken.includes(slug.value) ? slug.taken : [...slug.taken, slug.value];
  assert(taken.includes(slug.value), 'A copy cannot take its source’s slug');
  return { ...slug, value: '', taken };
}

function titleFieldsOfDocument(fields: readonly RemoteDocumentField[]): TitleFields {
  const order = fields.map((field) => field.name);
  const skipped = fields.filter(namesNothing).map((field) => field.name);
  assert(skipped.length <= order.length, 'Only listed fields are skipped');
  return { order, skipped };
}

function namesNothing(field: RemoteDocumentField): boolean {
  if (field.type.kind !== 'string') {
    return false;
  }
  if (field.type.asset === 'image') {
    return true;
  }
  return field.type.options.length > 0;
}

function valuesRecord(fields: readonly RemoteDocumentField[]): Readonly<Record<string, RemoteValue>> {
  const values: Record<string, RemoteValue> = {};
  for (const field of fields) {
    if (field.value !== undefined) {
      values[field.name] = field.value;
    }
  }
  assert(remoteObject(values) !== undefined, 'Values are a record');
  return values;
}
