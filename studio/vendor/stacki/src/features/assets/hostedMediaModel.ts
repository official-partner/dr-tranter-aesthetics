
import { assert } from '../../../shared/core/assert';
import type { AssetRequest } from '../../ui/assetPick';
import type { MediaConnection, MediaFileKind, MediaProviderKind } from '../../../shared/properties/mediaHosting';


export const PROVIDER_NAMES: Readonly<Record<MediaProviderKind, string>> = {
  r2: 'Cloudflare R2',
  bunny: 'Bunny Storage',
  s3: 'S3-compatible',
};

export function hostedKindMatches(wanted: AssetRequest['mediaKind'], kind: MediaFileKind): boolean {
  switch (wanted) {
    case 'asset':
      return true;
    case 'image':
    case 'video':
    case 'audio':
      return kind === wanted;
    default: {
      const exhaustive: never = wanted;
      return exhaustive;
    }
  }
}

export function movedOrder(names: readonly string[], move: { readonly moved: string; readonly before: string | undefined }): readonly string[] {
  const { moved, before } = move;
  if (!names.includes(moved) || moved === before) {
    return names;
  }
  const rest = names.filter((name) => name !== moved);
  if (before === undefined) {
    return [...rest, moved];
  }
  const index = rest.indexOf(before);
  if (index < 0) {
    return names;
  }
  const next = [...rest.slice(0, index), moved, ...rest.slice(index)];
  assert(next.length === names.length, 'A move keeps every name');
  assert(new Set(next).size === next.length, 'A move names each file once');
  return next;
}

export interface Crumb {
  readonly label: string;
  readonly folder: string;
}

export function hostedCrumbs(rootLabel: string, folder: string): readonly Crumb[] {
  const crumbs: Crumb[] = [{ label: rootLabel, folder: '' }];
  if (folder === '') {
    return crumbs;
  }
  const segments = folder.split('/');
  segments.forEach((segment, index) => crumbs.push({ label: segment, folder: segments.slice(0, index + 1).join('/') }));
  assert(crumbs.at(-1)?.folder === folder, 'The last crumb is the open folder');
  return crumbs;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function connectionDetail(connection: MediaConnection): string {
  switch (connection.kind) {
    case 'r2':
      return `Cloudflare R2 · ${connection.bucket}`;
    case 'bunny':
      return `Bunny · ${connection.storageZone}`;
    case 's3':
      return `${new URL(connection.endpoint).host} · ${connection.bucket}`;
    default: {
      const exhaustive: never = connection;
      return exhaustive;
    }
  }
}

export interface ConnectFields {
  readonly label: string;
  readonly accountId: string;
  readonly bucket: string;
  readonly storageZone: string;
  readonly region: string;
  readonly endpoint: string;
  readonly addressing: string;
  readonly publicBaseUrl: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly accessKey: string;
}

export const EMPTY_CONNECT_FIELDS: ConnectFields = {
  label: '',
  accountId: '',
  bucket: '',
  storageZone: '',
  region: '',
  endpoint: '',
  addressing: 'path',
  publicBaseUrl: '',
  accessKeyId: '',
  secretAccessKey: '',
  accessKey: '',
};

export function draftFields(kind: MediaProviderKind, fields: ConnectFields): Record<string, unknown> {
  const label = fields.label.trim() || PROVIDER_NAMES[kind];
  const keyPair = { kind: 'keyPair', accessKeyId: fields.accessKeyId, secretAccessKey: fields.secretAccessKey };
  switch (kind) {
    case 'r2':
      return { kind, label, accountId: fields.accountId, bucket: fields.bucket, publicBaseUrl: fields.publicBaseUrl, secret: keyPair };
    case 'bunny':
      return {
        kind,
        label,
        storageZone: fields.storageZone,
        region: fields.region || 'de',
        publicBaseUrl: fields.publicBaseUrl,
        secret: { kind: 'accessKey', accessKey: fields.accessKey },
      };
    case 's3':
      return {
        kind,
        label,
        endpoint: fields.endpoint,
        region: fields.region || 'us-east-1',
        bucket: fields.bucket,
        addressing: fields.addressing,
        publicBaseUrl: fields.publicBaseUrl,
        secret: keyPair,
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function fieldsOf(connection: MediaConnection): ConnectFields {
  switch (connection.kind) {
    case 'r2':
      return {
        ...EMPTY_CONNECT_FIELDS,
        label: connection.label,
        accountId: connection.accountId,
        bucket: connection.bucket,
        publicBaseUrl: connection.publicBaseUrl,
      };
    case 'bunny':
      return {
        ...EMPTY_CONNECT_FIELDS,
        label: connection.label,
        storageZone: connection.storageZone,
        region: connection.region,
        publicBaseUrl: connection.publicBaseUrl,
      };
    case 's3':
      return {
        ...EMPTY_CONNECT_FIELDS,
        label: connection.label,
        endpoint: connection.endpoint,
        region: connection.region,
        bucket: connection.bucket,
        addressing: connection.addressing,
        publicBaseUrl: connection.publicBaseUrl,
      };
    default: {
      const exhaustive: never = connection;
      return exhaustive;
    }
  }
}
