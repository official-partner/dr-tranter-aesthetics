
import { assert } from '../../../shared/core/assert';
import { ASTRO_CONTENT_ID } from '../../../shared/properties/astroContent';
import type { RemoteSchemaField, RemoteType } from '../../../shared/properties/cmsRemoteSchema';
import { ITEM_FIELD_LIMITS, type ItemFieldDeclaration, type ItemFieldKind } from '../../editor/itemFields';
import type { LoopField, LoopFieldKind, LoopSource, LoopSourceKind } from '../../editor/loopQuery';
import { isFieldPath, ITEM_FIELD } from '../../editor/loopQuery';
import { listCmsConnections, remoteReferenceOptions } from '../../ipc/cmsConnectionsBridge';
import { readText } from '../../ipc/bridge';
import { hasDependency } from '../../lib/packageManifest';
import { remoteCollections, remoteTemplate } from '../../ipc/remoteSource';

export const LOOP_CATALOG_LIMITS = {
  collectionsMax: 200,
  fieldsMax: 200,
  optionsMax: 500,
  projectsCachedMax: 8,
  nestingDepthMax: 4,
} as const;

export interface CatalogCollection {
  readonly source: LoopSource;
  readonly title: string;
  readonly count: number | undefined;
}

export type SanityAvailability =
  | { readonly kind: 'none' }
  | { readonly kind: 'connected'; readonly label: string; readonly connectionId: string; readonly client: 'available' | 'unavailable' };

export interface LoopCatalog {
  readonly collections: readonly CatalogCollection[];
  readonly sanity: SanityAvailability;
}

export interface CatalogField extends LoopField {
  readonly references: readonly string[];
}

export function listItemFields(fields: readonly ItemFieldDeclaration[], prefix = '', depth = 1): readonly CatalogField[] {
  assert(fields.length <= LOOP_CATALOG_LIMITS.fieldsMax, 'A list’s item fields are bounded');
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'A list’s item fields nest within their bound');
  const out: CatalogField[] = [];
  for (const field of fields) {
    const path = `${prefix}${field.name}`;
    if (field.kind === 'group') {
      out.push(...listItemFields(field.fields, `${path}.`, depth + 1));
    } else {
      const options = field.kind === 'option' ? field.options.map((option) => ({ title: option, value: option })) : [];
      out.push({ path, title: titled(path), kind: itemFieldKind(field.kind), options, references: [] });
    }
  }
  assert(out.length <= LOOP_CATALOG_LIMITS.fieldsMax, 'A list’s offered fields are bounded');
  return out;
}

function itemFieldKind(kind: ItemFieldKind): LoopFieldKind {
  switch (kind) {
    case 'text':
    case 'longText':
    case 'richText':
    case 'link':
    case 'email':
    case 'phone':
    case 'color':
    case 'option':
      return 'text';
    case 'number':
      return 'number';
    case 'switch':
      return 'boolean';
    case 'date':
      return 'date';
    case 'image':
    case 'video':
    case 'file':
      return 'image';
    case 'list':
    case 'group':
      return 'list';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export async function loadCatalog(projectPath: string): Promise<LoopCatalog> {
  const [astro, sanity] = await Promise.all([astroCollections(projectPath), sanityCatalog(projectPath)]);
  const collections = [...astro, ...sanity.collections].slice(0, LOOP_CATALOG_LIMITS.collectionsMax);
  assert(collections.length <= LOOP_CATALOG_LIMITS.collectionsMax, 'The catalog is bounded');
  return { collections, sanity: sanity.availability };
}

async function astroCollections(projectPath: string): Promise<readonly CatalogCollection[]> {
  const result = await remoteCollections(projectPath, ASTRO_CONTENT_ID).catch(() => undefined);
  if (!result?.ok) {
    return [];
  }
  return result.value.map((collection) => ({
    source: { kind: 'astro', collection: collection.name },
    title: titled(collection.name),
    count: collection.count,
  }));
}

async function sanityCatalog(projectPath: string): Promise<{ readonly collections: readonly CatalogCollection[]; readonly availability: SanityAvailability }> {
  const list = await listCmsConnections(projectPath).catch(() => undefined);
  const connection = list?.connections.find((candidate) => candidate.kind === 'sanity');
  if (connection === undefined) {
    return { collections: [], availability: { kind: 'none' } };
  }
  const [result, client] = await Promise.all([remoteCollections(projectPath, connection.id).catch(() => undefined), sanityClientIn(projectPath)]);
  const collections: CatalogCollection[] = result?.ok
    ? result.value.map((collection) => ({ source: { kind: 'sanity', collection: collection.name }, title: titled(collection.name), count: collection.count }))
    : [];
  return { collections, availability: { kind: 'connected', label: connection.label, connectionId: connection.id, client } };
}

async function sanityClientIn(projectPath: string): Promise<'available' | 'unavailable'> {
  const text = await readText(projectPath, 'package.json').catch(() => '');
  return hasDependency(text, '@sanity/astro') ? 'available' : 'unavailable';
}

export async function loadFields(projectPath: string, catalog: LoopCatalog, source: LoopSource): Promise<readonly CatalogField[] | undefined> {
  const connectionId = connectionOf(catalog, source.kind);
  if (connectionId === undefined) {
    return undefined;
  }
  const template = await remoteTemplate(projectPath, connectionId, source.collection).catch(() => undefined);
  if (!template?.ok) {
    return undefined;
  }
  return catalogFields(template.value.fields, source.kind);
}

export async function loadReferenceChoices(
  projectPath: string,
  catalog: LoopCatalog,
  source: LoopSource,
  types: readonly string[],
): Promise<readonly { readonly title: string; readonly value: string }[]> {
  const connectionId = connectionOf(catalog, source.kind);
  if (connectionId === undefined || source.kind !== 'sanity' || types.length === 0) {
    return [];
  }
  const result = await remoteReferenceOptions(projectPath, connectionId, types).catch(() => undefined);
  if (!result?.ok) {
    return [];
  }
  return result.value.slice(0, LOOP_CATALOG_LIMITS.optionsMax).map((option) => ({ title: option.title, value: option.id }));
}

function connectionOf(catalog: LoopCatalog, kind: LoopSourceKind): string | undefined {
  if (kind === 'astro') {
    return ASTRO_CONTENT_ID;
  }
  return catalog.sanity.kind === 'connected' ? catalog.sanity.connectionId : undefined;
}

const SANITY_SYSTEM_FIELDS: readonly CatalogField[] = [
  { path: '_createdAt', title: 'Created on', kind: 'date', options: [], references: [] },
  { path: '_updatedAt', title: 'Updated on', kind: 'date', options: [], references: [] },
];

export function catalogFields(fields: readonly RemoteSchemaField[], kind: LoopSourceKind): readonly CatalogField[] {
  const out: CatalogField[] = [];
  const pending: { readonly field: RemoteSchemaField; readonly parent: CatalogField | undefined; readonly depth: number }[] = fields
    .slice(0, LOOP_CATALOG_LIMITS.fieldsMax)
    .map((field) => ({ field, parent: undefined, depth: 0 }));
  for (let index = 0; index < pending.length && out.length < LOOP_CATALOG_LIMITS.fieldsMax; index++) {
    const entry = pending[index];
    assert(entry !== undefined, 'A pending field is in bounds');
    const own = catalogField(entry.field, kind);
    const mapped = own === undefined || entry.parent === undefined ? own : nestedIn(own, entry.parent);
    if (mapped !== undefined && isFieldPath(mapped.path)) {
      out.push(mapped, ...imageMeasures(mapped, kind));
      if (entry.depth + 1 < LOOP_CATALOG_LIMITS.nestingDepthMax) {
        for (const inner of innerFields(entry.field)) {
          if (pending.length < LOOP_CATALOG_LIMITS.fieldsMax * 2) {
            pending.push({ field: inner, parent: mapped, depth: entry.depth + 1 });
          }
        }
      }
    }
  }
  const own = out.slice(0, LOOP_CATALOG_LIMITS.fieldsMax);
  const all = kind === 'sanity' ? [...own, ...SANITY_SYSTEM_FIELDS] : own;
  assert(all.length <= LOOP_CATALOG_LIMITS.fieldsMax + SANITY_SYSTEM_FIELDS.length, 'Catalog fields are bounded');
  return all;
}

function catalogField(field: RemoteSchemaField, source: LoopSourceKind): CatalogField | undefined {
  const type = field.type;
  const base = { title: field.title || titled(field.name), options: [], references: [] };
  switch (type.kind) {
    case 'string':
    case 'text':
    case 'url':
    case 'email': {
      if (type.asset === 'image') {
        return { ...base, path: field.name, kind: 'image' };
      }
      const options = type.options.slice(0, LOOP_CATALOG_LIMITS.optionsMax).map((option) => ({ title: option.title, value: option.value }));
      const kind: LoopFieldKind = options.length > 0 && source === 'astro' ? 'reference' : 'text';
      return { ...base, path: field.name, kind, options };
    }
    case 'slug':
      return { ...base, path: source === 'sanity' ? `${field.name}.current` : field.name, kind: 'text' };
    case 'number':
      return { ...base, path: field.name, kind: 'number' };
    case 'boolean':
      return { ...base, path: field.name, kind: 'boolean' };
    case 'date':
    case 'datetime':
      return { ...base, path: field.name, kind: 'date' };
    case 'image':
      return { ...base, path: field.name, kind: 'image' };
    case 'reference':
      return { ...base, path: field.name, kind: 'reference', references: type.to };
    case 'array':
      return listField(field, type.of, base);
    case 'geopoint':
    case 'object':
    case 'file':
    case 'richText':
      return { ...base, path: field.name, kind: 'other' };
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function innerFields(field: RemoteSchemaField): readonly RemoteSchemaField[] {
  const type = field.type;
  if (type.kind === 'object') {
    return type.fields;
  }
  if (type.kind === 'geopoint') {
    const number = { kind: 'number' as const, options: [] };
    return [
      { name: 'lat', title: 'Latitude', type: number },
      { name: 'lng', title: 'Longitude', type: number },
    ].map((inner) => ({ ...field, ...inner }));
  }
  return [];
}

function nestedIn(field: CatalogField, parent: CatalogField): CatalogField {
  const path = `${parent.path}.${field.path}`;
  assert(path.startsWith(parent.path), 'A nested field is under its parent');
  return { ...field, path, title: `${parent.title} › ${field.title}` };
}

function imageMeasures(field: CatalogField, source: LoopSourceKind): readonly CatalogField[] {
  if (field.kind !== 'image' || source !== 'astro') {
    return [];
  }
  const measures: readonly CatalogField[] = [
    { path: `${field.path}.width`, title: `${field.title} width`, kind: 'number', options: [], references: [] },
    { path: `${field.path}.height`, title: `${field.title} height`, kind: 'number', options: [], references: [] },
  ];
  assert(
    measures.every((measure) => isFieldPath(measure.path)),
    'An image field names its measures',
  );
  return measures;
}

function listField(field: RemoteSchemaField, members: readonly RemoteType[], base: Pick<CatalogField, 'title' | 'options' | 'references'>): CatalogField {
  if (members.length > 0 && members.every((member) => member.kind === 'reference')) {
    const references = members.flatMap((member) => (member.kind === 'reference' ? member.to : []));
    return { ...base, path: field.name, kind: 'list', references };
  }
  const textual = members.length > 0 && members.every((member) => member.kind === 'string' || member.kind === 'text');
  const options = members.flatMap((member) => (member.kind === 'string' ? member.options : [])).map((option) => ({ title: option.title, value: option.value }));
  return { ...base, path: field.name, kind: textual ? 'list' : 'other', options: options.slice(0, LOOP_CATALOG_LIMITS.optionsMax) };
}

export function titled(name: string): string {
  if (name === ITEM_FIELD) {
    return 'Item';
  }
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter((word) => word !== '');
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || name;
}
