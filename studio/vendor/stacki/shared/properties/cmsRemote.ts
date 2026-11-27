
import { record, text } from '../core/boundary';
import { assert } from '../core/assert';
import { parseConnectionId } from './cmsConnections';
import { parseEntrySlug, type EntrySlug } from './entrySlug';
import { parseProjectFile, parseRemoteSchemaField, parseRemoteValue, type RemoteSchemaField, type RemoteValue } from './cmsRemoteSchema';
import { parseMessageRef, parseOptionalMessageRef, type MessageRef } from '../core/i18n/messageReference';

export const CMS_REMOTE_LIMITS = {
  collectionsMax: 200,
  documentsMax: 500,
  columnsMax: 12,
  cellDepthMax: 2,
  fieldsMax: 200,
  assetsMax: 500,
  revisionsMax: 100,
  referenceTypesMax: 24,
  previewCharsMax: 200,
  fieldGroupsMax: 24,
} as const;

export interface RemoteCollection {
  readonly name: string;
  readonly count: number;
  readonly icon: string | undefined;
}

export type RemoteCell = string | number | boolean;

export type RemoteStatus = 'draft' | 'published' | 'changed';

export interface RemoteDocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | undefined;
  readonly imageURL: string | undefined;
  readonly imageFile?: string;
  readonly cells?: Readonly<Record<string, RemoteCell>>;
  readonly status: RemoteStatus;
  readonly updatedAt: string;
}

export interface RemoteDocumentList {
  readonly documents: readonly RemoteDocumentSummary[];
  readonly orderable: boolean;
}

export interface RemoteMove {
  readonly collection: string;
  readonly id: string;
  readonly after: string | undefined;
  readonly before: string | undefined;
}

export interface RemoteDocumentField extends RemoteSchemaField {
  readonly value: RemoteValue | undefined;
  readonly groups?: readonly string[];
}

export interface RemoteFieldGroup {
  readonly name: string;
  readonly title: string;
}

export interface RemoteAsset {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
}

export interface RemoteRevision {
  readonly id: string;
  readonly timestamp: string;
  readonly author: string;
  readonly authorRef?: MessageRef | undefined;
}

export type RemoteDocumentAction = 'publish' | 'discard' | 'unpublish';

export interface RemoteReferenceOption {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly imageURL: string | undefined;
}

export interface RemoteDocument {
  readonly id: string;
  readonly type: string;
  readonly status: RemoteStatus;
  readonly fields: readonly RemoteDocumentField[];
  readonly assets: readonly RemoteAsset[];
  readonly editedAt: string | undefined;
  readonly publishedAt: string | undefined;
  readonly editURL: string | undefined;
  readonly fieldGroups?: readonly RemoteFieldGroup[];
  readonly file?: string;
  readonly slug?: EntrySlug;
  readonly appliesLive?: boolean;
}

export type RemoteResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string; readonly messageRef?: MessageRef | undefined };

export interface RemoteWrite {
  readonly id: string;
  readonly field: string;
  readonly value: RemoteValue | undefined;
}

export const REMOTE_TEMPLATE_ID = 'new-item';

const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

export function parseRemoteCollectionName(input: unknown): string {
  const name = text(input);
  if (!/^[A-Za-z_][\w.-]{0,127}$/.test(name)) {
    throw new Error('Invalid CMS collection name.');
  }
  assert(name.length <= 128, 'A collection name is short');
  return name;
}

export function parseRemoteDocumentId(input: unknown): string {
  const id = text(input);
  if (!/^[\w][\w.-]{0,127}$/.test(id) || id.startsWith('drafts.') || id.startsWith('versions.')) {
    throw new Error('Invalid CMS document id.');
  }
  assert(!id.startsWith('drafts.'), 'A document is named by its published id');
  return id;
}

export function parseRemoteFieldName(input: unknown): string {
  const name = text(input);
  if (!IDENTIFIER.test(name) || name.startsWith('_')) {
    throw new Error('Invalid field name.');
  }
  assert(name.length <= 64, 'A field name is short');
  return name;
}

export function parseRemoteWrite(input: unknown): RemoteWrite {
  const value = record(input);
  return {
    id: parseRemoteDocumentId(value['id']),
    field: parseRemoteFieldName(value['field']),
    value: parseRemoteValue(value['value']),
  };
}

export const parseRemoteConnection = parseConnectionId;

export function parseRemoteResult<T>(input: unknown, parseValue: (value: unknown) => T): RemoteResult<T> {
  const value = record(input);
  if (value['ok'] === true) {
    return { ok: true, value: parseValue(value['value']) };
  }
  const message = text(value['message']);
  assert(message.length > 0, 'A CMS failure says what went wrong');
  assert(message.length <= 1000, 'A CMS failure message is short');
  const ref = value['messageRef'] === undefined ? undefined : parseMessageRef(value['messageRef']);
  return ref?.ok === true ? { ok: false, message, messageRef: ref.value } : { ok: false, message };
}

export function parseRemoteCollections(input: unknown): RemoteCollection[] {
  return boundedList(input, CMS_REMOTE_LIMITS.collectionsMax).map((entry) => {
    const value = record(entry);
    const count = value['count'];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('Invalid collection count.');
    }
    const icon = value['icon'];
    if (icon !== undefined && (typeof icon !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(icon))) {
      throw new Error('Invalid collection icon.');
    }
    return { name: parseRemoteCollectionName(value['name']), count, icon };
  });
}

export function parseRemoteDocuments(input: unknown): RemoteDocumentSummary[] {
  return boundedList(input, CMS_REMOTE_LIMITS.documentsMax).map((entry) => {
    const value = record(entry);
    return {
      id: parseRemoteDocumentId(value['id']),
      title: preview(value['title']),
      subtitle: value['subtitle'] === undefined ? undefined : preview(value['subtitle']),
      imageURL: value['imageURL'] === undefined ? undefined : parseHTTPS(value['imageURL']),
      ...(value['imageFile'] === undefined ? {} : { imageFile: parseProjectFile(value['imageFile']) }),
      status: parseStatus(value['status']),
      updatedAt: preview(value['updatedAt']),
      ...(value['cells'] === undefined ? {} : { cells: parseCells(value['cells']) }),
    };
  });
}

export function parseRemoteColumns(input: unknown): readonly string[] {
  const columns = boundedList(input, CMS_REMOTE_LIMITS.columnsMax).map(parseRemoteFieldName);
  if (new Set(columns).size !== columns.length) {
    throw new Error('A column is named twice.');
  }
  assert(columns.length <= CMS_REMOTE_LIMITS.columnsMax, 'A list shows few columns');
  return columns;
}

function parseCells(input: unknown): Readonly<Record<string, RemoteCell>> {
  const value = record(input);
  const entries = Object.entries(value);
  if (entries.length > CMS_REMOTE_LIMITS.columnsMax) {
    throw new Error('Too many columns.');
  }
  const cells: Record<string, RemoteCell> = {};
  for (const [name, cell] of entries) {
    if (typeof cell === 'number' && Number.isFinite(cell)) {
      cells[parseRemoteFieldName(name)] = cell;
    } else if (typeof cell === 'boolean') {
      cells[parseRemoteFieldName(name)] = cell;
    } else {
      cells[parseRemoteFieldName(name)] = preview(cell);
    }
  }
  assert(Object.keys(cells).length === entries.length, 'Every cell parses');
  return cells;
}

export function remoteCell(value: unknown, depth = 0): RemoteCell | undefined {
  assert(depth <= CMS_REMOTE_LIMITS.cellDepthMax, 'A cell looks into a value boundedly');
  if (typeof value === 'string') {
    return value.length > CMS_REMOTE_LIMITS.previewCharsMax ? value.slice(0, CMS_REMOTE_LIMITS.previewCharsMax) : value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    if (depth >= CMS_REMOTE_LIMITS.cellDepthMax) {
      return undefined;
    }
    const names = items
      .slice(0, CMS_REMOTE_LIMITS.columnsMax)
      .map((item) => remoteCell(item, depth + 1))
      .filter((cell) => cell !== undefined);
    return names.length === 0 ? undefined : remoteCell(names.join(', '), depth + 1);
  }
  if (typeof value === 'object' && value !== null && depth < CMS_REMOTE_LIMITS.cellDepthMax) {
    const named = ['current', 'title', 'name', 'label'].map((key): unknown => Reflect.get(value, key));
    const first = named.find((part) => typeof part === 'string');
    return first === undefined ? undefined : remoteCell(first, depth + 1);
  }
  return undefined;
}

export function parseRemoteDocument(input: unknown): RemoteDocument {
  const value = record(input);
  const editURL = value['editURL'];
  return {
    id: parseRemoteDocumentId(value['id']),
    type: parseRemoteCollectionName(value['type']),
    status: parseStatus(value['status']),
    fields: boundedList(value['fields'], CMS_REMOTE_LIMITS.fieldsMax).map(parseField),
    assets: parseRemoteAssets(value['assets']),
    editedAt: optionalTime(value['editedAt']),
    publishedAt: optionalTime(value['publishedAt']),
    editURL: editURL === undefined ? undefined : parseHTTPS(editURL),
    ...(value['fieldGroups'] === undefined ? {} : { fieldGroups: parseRemoteFieldGroups(value['fieldGroups']) }),
    ...(value['file'] === undefined ? {} : { file: parseProjectFile(value['file']) }),
    ...(value['slug'] === undefined ? {} : { slug: parseEntrySlug(value['slug']) }),
    ...(value['appliesLive'] === true ? { appliesLive: true } : {}),
  };
}

function parseField(input: unknown): RemoteDocumentField {
  const value = record(input);
  const field = parseRemoteSchemaField(value);
  assert(!field.name.startsWith('_'), 'System keys are not fields');
  const groups = value['groups'];
  return {
    ...field,
    value: parseRemoteValue(value['value']),
    ...(groups === undefined ? {} : { groups: boundedList(groups, CMS_REMOTE_LIMITS.fieldGroupsMax).map(parseGroupName) }),
  };
}

export function parseRemoteFieldGroups(input: unknown): RemoteFieldGroup[] {
  const groups = boundedList(input, CMS_REMOTE_LIMITS.fieldGroupsMax).map((entry) => {
    const group = record(entry);
    const title = text(group['title']);
    if (title.length === 0 || title.length > CMS_REMOTE_LIMITS.previewCharsMax) {
      throw new Error('Invalid field group title.');
    }
    return { name: parseGroupName(group['name']), title };
  });
  const names = groups.map((group) => group.name);
  if (new Set(names).size !== names.length) {
    throw new Error('A field group is named twice.');
  }
  assert(groups.length <= CMS_REMOTE_LIMITS.fieldGroupsMax, 'A document has few field groups');
  assert(new Set(names).size === groups.length, 'Each tab is named once');
  return groups;
}

function parseGroupName(input: unknown): string {
  const name = text(input);
  if (!/^[A-Za-z_][\w-]{0,63}$/.test(name)) {
    throw new Error('Invalid field group name.');
  }
  assert(name.length <= 64, 'A group name is short');
  return name;
}

export function parseRemoteAsset(input: unknown): RemoteAsset {
  const value = record(input);
  const id = text(value['id']);
  if (!/^(image|file)-[\w-]{1,200}$/.test(id)) {
    throw new Error('Invalid asset id.');
  }
  const filename = text(value['filename']);
  assert(filename.length <= 1000, 'An asset file name is bounded');
  return { id, url: parseHTTPS(value['url']), filename };
}

export function parseRemoteAssets(input: unknown): RemoteAsset[] {
  return boundedList(input, CMS_REMOTE_LIMITS.assetsMax).map(parseRemoteAsset);
}

export function parseRemoteReferenceOptions(input: unknown): RemoteReferenceOption[] {
  return boundedList(input, CMS_REMOTE_LIMITS.documentsMax).map((entry) => {
    const value = record(entry);
    return {
      id: parseRemoteDocumentId(value['id']),
      type: parseRemoteCollectionName(value['type']),
      title: preview(value['title']),
      imageURL: value['imageURL'] === undefined ? undefined : parseHTTPS(value['imageURL']),
    };
  });
}

export function parseRemoteTypes(input: unknown): readonly string[] {
  const types = boundedList(input, CMS_REMOTE_LIMITS.referenceTypesMax).map(parseRemoteCollectionName);
  assert(types.length <= CMS_REMOTE_LIMITS.referenceTypesMax, 'Reference types are bounded');
  return types;
}

export type RemoteAssetKind = 'image' | 'file';

export function parseRemoteDocumentAction(input: unknown): RemoteDocumentAction {
  if (input === 'publish' || input === 'discard' || input === 'unpublish') {
    return input;
  }
  throw new Error('Unknown document action.');
}

export function parseRemoteRevisionId(input: unknown): string {
  const id = text(input);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
    throw new Error('Invalid revision id.');
  }
  assert(id.length <= 64, 'A revision id is short');
  return id;
}

export function parseRemoteRevisions(input: unknown): RemoteRevision[] {
  return boundedList(input, CMS_REMOTE_LIMITS.revisionsMax).map((entry) => {
    const value = record(entry);
    const authorRef = parseOptionalMessageRef(value['authorRef']);
    return {
      id: parseRemoteRevisionId(value['id']),
      timestamp: preview(value['timestamp']),
      author: preview(value['author']),
      ...(authorRef === undefined ? {} : { authorRef }),
    };
  });
}

export function parseRemoteActedDocument(input: unknown): RemoteDocument | undefined {
  return input === undefined ? undefined : parseRemoteDocument(input);
}

export function parseRemoteAssetKind(input: unknown): RemoteAssetKind {
  if (input === 'image' || input === 'file') {
    return input;
  }
  throw new Error('Expected an image or a file.');
}

function optionalTime(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const value = text(input);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || value.length > 40) {
    throw new Error('Invalid CMS time.');
  }
  assert(!Number.isNaN(Date.parse(value)), 'A CMS time is a real date');
  return value;
}

function parseStatus(input: unknown): RemoteStatus {
  if (input === 'draft' || input === 'published' || input === 'changed') {
    return input;
  }
  throw new Error('Invalid document status.');
}

function parseHTTPS(input: unknown): string {
  const url = new URL(text(input));
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
  if (!secure || url.username || url.password) {
    throw new Error('Invalid CMS editor address.');
  }
  assert(secure, 'A CMS address is https, or http on this machine');
  return url.toString();
}

function preview(input: unknown): string {
  const value = text(input);
  const shown = value.length > CMS_REMOTE_LIMITS.previewCharsMax ? value.slice(0, CMS_REMOTE_LIMITS.previewCharsMax) : value;
  assert(shown.length <= CMS_REMOTE_LIMITS.previewCharsMax, 'A preview is cut to its bound');
  return shown;
}

function boundedList(input: unknown, max: number): unknown[] {
  assert(Number.isSafeInteger(max), 'A list bound is a whole number');
  assert(max > 0, 'A list bound allows at least one item');
  if (!Array.isArray(input)) {
    throw new Error('Expected a list.');
  }
  if (input.length > max) {
    throw new Error('Too many items.');
  }
  return input;
}

export function parseRemoteDocumentList(input: unknown): RemoteDocumentList {
  const value = record(input);
  const orderable = value['orderable'];
  if (typeof orderable !== 'boolean') {
    throw new Error('Expected whether the collection is ordered.');
  }
  const documents = parseRemoteDocuments(value['documents']);
  assert(documents.length <= CMS_REMOTE_LIMITS.documentsMax, 'A document list stays bounded');
  return { documents, orderable };
}

export function parseRemoteIds(input: unknown): readonly string[] {
  const ids = boundedList(input, CMS_REMOTE_LIMITS.documentsMax).map(parseRemoteDocumentId);
  if (ids.length === 0) {
    throw new Error('Choose at least one document.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('A document is named twice.');
  }
  assert(ids.length <= CMS_REMOTE_LIMITS.documentsMax, 'A delete names at most a page');
  assert(!ids.some((id) => id.startsWith('drafts.')), 'A delete names published ids');
  return ids;
}

export function parseRemoteMove(input: unknown): RemoteMove {
  const value = record(input);
  const id = parseRemoteDocumentId(value['id']);
  const after = value['after'] === undefined ? undefined : parseRemoteDocumentId(value['after']);
  const before = value['before'] === undefined ? undefined : parseRemoteDocumentId(value['before']);
  if (after === id || before === id) {
    throw new Error('A document cannot move next to itself.');
  }
  if (after !== undefined && after === before) {
    throw new Error('A move needs two different neighbours.');
  }
  assert(id !== after, 'A move names a neighbour other than itself');
  assert(id !== before, 'A move names a neighbour other than itself');
  return { collection: parseRemoteCollectionName(value['collection']), id, after, before };
}
