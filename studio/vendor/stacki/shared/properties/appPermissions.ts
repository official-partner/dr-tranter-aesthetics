import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';

export const APP_PERMISSION_LIMITS = {
  permissionsMax: 24,
  idCharsMax: 48,
  labelCharsMax: 60,
  descriptionCharsMax: 160,
} as const satisfies Record<string, number>;

export interface AppPermissionDeclaration {
  readonly id: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly default: boolean;
}

const PERMISSION_ID = /^[a-z][a-z0-9-]*$/;

export function parseAppPermissionDeclarations(input: unknown): readonly AppPermissionDeclaration[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('permissions is a list');
  }
  if (items.length > APP_PERMISSION_LIMITS.permissionsMax) {
    throw new Error(`An app declares at most ${APP_PERMISSION_LIMITS.permissionsMax} permissions`);
  }
  const permissions = items.map(parseDeclaration);
  if (new Set(permissions.map((permission) => permission.id)).size !== permissions.length) {
    throw new Error('Two permissions share an id');
  }
  assert(permissions.length <= APP_PERMISSION_LIMITS.permissionsMax, 'Permission declarations are bounded');
  return permissions;
}

export function parseAppPermissionId(input: unknown): string {
  const id = text(input);
  if (id.length === 0 || id.length > APP_PERMISSION_LIMITS.idCharsMax) {
    throw new Error(`A permission id is 1 to ${APP_PERMISSION_LIMITS.idCharsMax} characters`);
  }
  if (!PERMISSION_ID.test(id)) {
    throw new Error(`Permission id "${id}" must start with a letter and use lowercase letters, digits and -`);
  }
  assert(id.length <= APP_PERMISSION_LIMITS.idCharsMax, 'A parsed permission id is within its bound');
  return id;
}

function parseDeclaration(input: unknown): AppPermissionDeclaration {
  const value = record(input);
  const id = parseAppPermissionId(value['id']);
  const fallback = value['default'];
  if (typeof fallback !== 'boolean') {
    throw new Error(`Permission ${id}: default is true or false`);
  }
  const description = value['description'];
  return {
    id,
    label: boundedText(value['label'], APP_PERMISSION_LIMITS.labelCharsMax, `Permission ${id} label`),
    description: description === undefined ? undefined : boundedText(description, APP_PERMISSION_LIMITS.descriptionCharsMax, `Permission ${id} description`),
    default: fallback,
  };
}

function boundedText(input: unknown, charsMax: number, what: string): string {
  const value = text(input).trim();
  if (value.length === 0) {
    throw new Error(`${what} is empty`);
  }
  if (value.length > charsMax) {
    throw new Error(`${what} exceeds ${charsMax} characters`);
  }
  assert(value === value.trim(), 'Bounded text carries no outer spaces');
  return value;
}
