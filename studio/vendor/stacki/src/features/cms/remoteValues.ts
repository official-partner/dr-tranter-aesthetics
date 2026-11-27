import { assert } from '../../../shared/core/assert';
import { REMOTE_SCHEMA_LIMITS, remoteList, remoteObject, type RemoteSchemaField, type RemoteValue } from '../../../shared/properties/cmsRemoteSchema';
import { labelize } from './cmsSchema';

export function fieldTitle(field: Pick<RemoteSchemaField, 'name' | 'title'>): string {
  return field.title || labelize(field.name);
}

export function isEmptyValue(value: RemoteValue | undefined, depth = 0): boolean {
  assert(depth <= REMOTE_SCHEMA_LIMITS.valueDepthMax, 'An emptiness check follows the value bound');
  if (value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  if (typeof value !== 'object') {
    return false;
  }
  const list = remoteList(value);
  if (list !== undefined) {
    return list.length === 0;
  }
  const object = remoteObject(value) ?? {};
  if (typeof object['_ref'] === 'string' && object['_ref'] !== '') {
    return false;
  }
  const own = Object.entries(object).filter(([key]) => !key.startsWith('_'));
  return own.every(([, entry]) => isEmptyValue(entry, depth + 1));
}

export function remoteKey(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
