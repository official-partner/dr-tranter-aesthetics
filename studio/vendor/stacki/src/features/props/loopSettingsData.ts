
import { useEffect, useMemo, useState } from 'react';
import { groqQueryText, isItemId, type LoopQuery, type LoopSource } from '../../editor/loopQuery';
import { assert } from '../../../shared/core/assert';
import { described, type Described, type TypedMessageRef } from '../../../shared/properties/i18n/messageRef';
import { toRecord } from '../../../shared/core/record';
import { parseIpcPayload } from '../../../shared/ipc/ipcPayloads';
import { cmsTransport } from '../../ipc/editorEnvironment';
import { remoteDocument, remoteDocuments } from '../../ipc/remoteSource';
import { loadCatalog, loadFields, loadReferenceChoices, LOOP_CATALOG_LIMITS, type CatalogField, type LoopCatalog } from './loopCatalog';
import { parseSourceKey, sourceKey } from './loopSettingsModel';
import { type TracedCollection } from './LoopLineage';
import { rewrittenGroqLiteral, type GroqLiteral } from '../../editor/loopTrace';
import { readText, writeText } from '../../ipc/bridge';
import type { ChoiceContext } from './LoopFilters';
export function editableTrace(traced: TracedCollection): { readonly query: LoopQuery; readonly literal: GroqLiteral; readonly file: string } | undefined {
  const groq = traced.groq;
  const literal = traced.literal;
  if (groq === undefined || literal === undefined || traced.source.kind !== 'sanity') {
    return undefined;
  }
  const query: LoopQuery = {
    source: traced.source,
    match: groq.match,
    conditions: groq.conditions,
    sorts: groq.sorts,
    random: false,
    offset: groq.offset,
    limit: groq.limit,
    projection: groq.projection ?? '',
    parameter: { kind: 'data' },
  };
  return { query, literal, file: traced.file };
}

export async function writeTracedQuery(
  projectPath: string,
  literal: GroqLiteral,
  change: { readonly file: string; readonly query: LoopQuery },
): Promise<{ readonly ok: true } | ({ readonly ok: false } & Described & { readonly messageRef: TypedMessageRef })> {
  try {
    const text = await readText(projectPath, change.file);
    const next = rewrittenGroqLiteral(text, literal, groqQueryText(change.query, []));
    if (next === undefined) {
      return { ok: false, ...described('props.loop.save.changed', { file: change.file }) };
    }
    await writeText(projectPath, change.file, next);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, ...described('props.loop.save.failed', { file: change.file, detail: error instanceof Error ? error.message : String(error) }) };
  }
}


const catalogs = new Map<string, LoopCatalog>();

export function useLoopCatalog(projectPath: string | undefined): LoopCatalog | undefined {
  const [catalog, setCatalog] = useState<LoopCatalog | undefined>(projectPath ? catalogs.get(projectPath) : undefined);
  useEffect(() => {
    if (!projectPath) {
      return undefined;
    }
    let live = true;
    void loadCatalog(projectPath).then((loaded) => {
      if (catalogs.size >= LOOP_CATALOG_LIMITS.projectsCachedMax && !catalogs.has(projectPath)) {
        catalogs.clear();
      }
      catalogs.set(projectPath, loaded);
      if (live) {
        setCatalog(loaded);
      }
    });
    return () => {
      live = false;
    };
  }, [projectPath]);
  return catalog;
}

export function useCatalogFields(
  projectPath: string | undefined,
  catalog: LoopCatalog | undefined,
  source: LoopSource | undefined,
): readonly CatalogField[] | undefined {
  const key = source === undefined ? '' : sourceKey(source);
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly fields: readonly CatalogField[] } | undefined>(undefined);
  useEffect(() => {
    const parsed = parseSourceKey(key);
    if (!projectPath || !catalog || parsed?.kind !== 'collection') {
      return undefined;
    }
    let live = true;
    void loadFields(projectPath, catalog, parsed.source).then((fields) => {
      if (live) {
        setLoaded({ key, fields: fields ?? [] });
      }
    });
    return () => {
      live = false;
    };
  }, [projectPath, catalog, key]);
  return loaded?.key === key ? loaded.fields : undefined;
}

export function useReferenceChoices(context: ChoiceContext, field: CatalogField | undefined): readonly { readonly title: string; readonly value: string }[] {
  const types = field?.references ?? [];
  const typesKey = types.join(',');
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly choices: readonly { readonly title: string; readonly value: string }[] } | undefined>(
    undefined,
  );
  const { projectPath, catalog } = context;
  const sourceName = sourceKey(context.query.source);
  const key = `${sourceName}|${typesKey}`;
  useEffect(() => {
    const parsed = parseSourceKey(sourceName);
    if (!projectPath || !catalog || typesKey === '' || parsed?.kind !== 'collection') {
      return undefined;
    }
    let live = true;
    void loadReferenceChoices(projectPath, catalog, parsed.source, typesKey.split(',')).then((choices) => {
      if (live) {
        setLoaded({ key, choices });
      }
    });
    return () => {
      live = false;
    };
  }, [projectPath, catalog, key, sourceName, typesKey]);
  return useMemo(() => (loaded?.key === key ? loaded.choices : []), [loaded, key]);
}

export interface PickableItem {
  readonly id: string;
  readonly title: string;
  readonly picture?: ItemPicture;
}

export type ItemPicture = { readonly kind: 'file'; readonly file: string } | { readonly kind: 'url'; readonly url: string };

const PICTURE_PATH_CHARS_MAX = 1024;

const PICKABLE_ITEMS_MAX = 500;

export async function loadItems(
  projectPath: string,
  catalog: LoopCatalog,
  target: { readonly source: LoopSource; readonly ids: 'entry' | 'export' },
): Promise<readonly PickableItem[]> {
  const { source } = target;
  if (source.kind === 'sanity') {
    const connectionId = catalog.sanity.kind === 'connected' ? catalog.sanity.connectionId : undefined;
    const listed = connectionId === undefined ? undefined : await remoteDocuments(projectPath, connectionId, source.collection).catch(() => undefined);
    return listed?.ok
      ? listed.value.documents.slice(0, PICKABLE_ITEMS_MAX).map((document) => ({
          id: document.id,
          title: document.title,
          ...(document.imageURL === undefined ? {} : { picture: { kind: 'url' as const, url: document.imageURL } }),
        }))
      : [];
  }
  const payload = parseIpcPayload('content:entries', { projectPath, name: source.collection });
  const answer: unknown = await cmsTransport.contentEntries(payload).catch(() => undefined);
  const entries = toRecord(answer)?.['entries'];
  const items: PickableItem[] = [];
  for (const entry of Array.isArray(entries) ? entries.slice(0, PICKABLE_ITEMS_MAX) : []) {
    const item = pickableEntry(entry, target.ids);
    if (item !== undefined) {
      items.push(item);
    }
  }
  assert(items.length <= PICKABLE_ITEMS_MAX, 'Pickable items are bounded');
  return items;
}

export async function loadSanitySample(projectPath: string, catalog: LoopCatalog, type: string): Promise<Readonly<Record<string, unknown>> | undefined> {
  const connectionId = catalog.sanity.kind === 'connected' ? catalog.sanity.connectionId : undefined;
  if (connectionId === undefined) {
    return undefined;
  }
  const listed = await remoteDocuments(projectPath, connectionId, type).catch(() => undefined);
  const first = listed?.ok ? listed.value.documents[0] : undefined;
  const read = first === undefined ? undefined : await remoteDocument(projectPath, connectionId, first.id).catch(() => undefined);
  if (read === undefined || !read.ok) {
    return undefined;
  }
  return Object.fromEntries(read.value.fields.slice(0, LOOP_CATALOG_LIMITS.fieldsMax).map((field) => [field.name, field.value]));
}

function pickableEntry(input: unknown, ids: 'entry' | 'export'): PickableItem | undefined {
  const entry = toRecord(input);
  const id = entry?.['id'];
  const title = entry?.['title'];
  const known = toRecord(entry?.['data'])?.['_id'];
  const chosen = ids === 'export' && typeof known === 'string' ? known : id;
  if (typeof chosen !== 'string' || !isItemId(chosen)) {
    return undefined;
  }
  const picture = pictureFile(entry?.['imageFile']);
  return { id: chosen, title: typeof title === 'string' && title !== '' ? title : chosen, ...(picture === undefined ? {} : { picture }) };
}

function pictureFile(input: unknown): ItemPicture | undefined {
  if (typeof input !== 'string' || input === '' || input.length > PICTURE_PATH_CHARS_MAX) {
    return undefined;
  }
  if (input.startsWith('/') || input.split('/').includes('..')) {
    return undefined;
  }
  return { kind: 'file', file: input };
}

export function useCollectionSample(projectPath: string | undefined, catalog: LoopCatalog | undefined, source: LoopSource): unknown {
  const key = sourceKey(source);
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly sample: unknown } | undefined>(undefined);
  useEffect(() => {
    const parsed = parseSourceKey(key);
    if (projectPath === undefined || catalog === undefined || parsed?.kind !== 'collection') {
      return undefined;
    }
    let live = true;
    void collectionSample(projectPath, catalog, parsed.source).then((sample) => {
      if (live) {
        setLoaded({ key, sample });
      }
    });
    return () => {
      live = false;
    };
  }, [projectPath, catalog, key]);
  return loaded?.key === key ? loaded.sample : undefined;
}

async function collectionSample(projectPath: string, catalog: LoopCatalog, source: LoopSource): Promise<unknown> {
  if (source.kind === 'sanity') {
    return loadSanitySample(projectPath, catalog, source.collection).catch(() => undefined);
  }
  const payload = parseIpcPayload('content:entries', { projectPath, name: source.collection });
  const answer: unknown = await cmsTransport.contentEntries(payload).catch(() => undefined);
  const entries = toRecord(answer)?.['entries'];
  const first: unknown = Array.isArray(entries) ? entries[0] : undefined;
  return toRecord(first)?.['data'];
}
