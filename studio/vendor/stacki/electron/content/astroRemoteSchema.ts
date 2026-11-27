
import { assert } from '../../shared/core/assert';
import { toArray, toRecord } from '../../shared/core/record';
import { REMOTE_SCHEMA_LIMITS, type RemoteOption, type RemoteRule, type RemoteSchemaField, type RemoteType } from '../../shared/properties/cmsRemoteSchema';

export type ReferenceTargets = ReadonlyMap<string, readonly RemoteOption[]>;

export function astroSchemaFields(schema: unknown, targets: ReferenceTargets): readonly RemoteSchemaField[] {
  const root = toRecord(schema);
  if (root === undefined) {
    return [];
  }
  const fields = objectFields(root, { root, targets, depth: 0 });
  assert(fields.length <= REMOTE_SCHEMA_LIMITS.fieldsMax, 'A collection maps to bounded fields');
  assert(new Set(fields.map((field) => field.name)).size === fields.length, 'Names are unique');
  return fields;
}

export function referencedCollections(schema: unknown): readonly string[] {
  const found = new Set<string>();
  const pending: unknown[] = [schema];
  for (let visited = 0; pending.length > 0 && visited < REMOTE_SCHEMA_LIMITS.valueNodesMax;) {
    const node = pending.pop();
    visited += 1;
    const value = toRecord(node);
    const items = toArray(node);
    if (items !== undefined) {
      pending.push(...items);
    } else if (value !== undefined) {
      const target = value['astroReference'];
      if (typeof target === 'string') {
        found.add(target);
      }
      pending.push(...Object.values(value));
    }
  }
  assert(found.size <= REMOTE_SCHEMA_LIMITS.valueNodesMax, 'Targets are bounded by the nodes read');
  return [...found];
}

interface MapContext {
  readonly root: Readonly<Record<string, unknown>>;
  readonly targets: ReferenceTargets;
  readonly depth: number;
}

type SchemaNode = Readonly<Record<string, unknown>>;

function objectFields(node: SchemaNode, context: MapContext): RemoteSchemaField[] {
  const properties = toRecord(node['properties']) ?? {};
  const required = new Set((toArray(node['required']) ?? []).filter(isString));
  const fields: RemoteSchemaField[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (fields.length >= REMOTE_SCHEMA_LIMITS.fieldsMax) {
      break;
    }
    const field = fieldOf(name, toRecord(property), { listed: required.has(name) }, context);
    if (field !== undefined) {
      fields.push(field);
    }
  }
  return fields;
}

function fieldOf(name: string, property: SchemaNode | undefined, placement: { readonly listed: boolean }, context: MapContext): RemoteSchemaField | undefined {
  if (property === undefined || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) {
    return undefined;
  }
  const { node, nullable } = unwrapNullable(property);
  const type = typeOf(name, node, context);
  if (type === undefined) {
    return undefined;
  }
  const required = placement.listed && !nullable && node['default'] === undefined;
  const description = typeof node['description'] === 'string' ? node['description'] : '';
  return {
    name,
    title: labelize(name),
    description: description.slice(0, REMOTE_SCHEMA_LIMITS.descriptionCharsMax),
    required,
    rules: rulesOf(node, type, { required }),
    type,
  };
}

function typeOf(name: string, input: SchemaNode, context: MapContext): RemoteType | undefined {
  if (context.depth >= REMOTE_SCHEMA_LIMITS.typeDepthMax) {
    return undefined;
  }
  const node = dereferenced(input, context.root);
  if (node === undefined) {
    return undefined;
  }
  const reference = node['astroReference'];
  if (typeof reference === 'string') {
    return { kind: 'string', options: context.targets.get(reference) ?? [] };
  }
  if (node['astroImage'] === true) {
    return { kind: 'string', options: [], asset: 'image' };
  }
  if (node['astroDate'] === true) {
    return { kind: 'date', options: [] };
  }
  const choices = toArray(node['enum']);
  if (choices !== undefined) {
    return enumType(choices);
  }
  switch (node['type']) {
    case 'string':
      return stringType(name, node);
    case 'number':
    case 'integer':
      return { kind: 'number', options: [] };
    case 'boolean':
      return { kind: 'boolean', options: [] };
    case 'array':
      return arrayType(name, node, context);
    case 'object':
      return objectType(name, node, context);
    default:
      return undefined;
  }
}

function stringType(name: string, node: SchemaNode): RemoteType {
  switch (node['format']) {
    case 'email':
      return { kind: 'email', options: [] };
    case 'uri':
      return { kind: 'url', options: [] };
    case 'date':
      return { kind: 'date', options: [] };
    case 'date-time':
      return { kind: 'datetime', options: [] };
    default:
      return { kind: LONG_KEYS.test(name) ? 'text' : 'string', options: [] };
  }
}

const LONG_KEYS = /^(description|summary|bio|excerpt|abstract|intro|body|content|answer)$/i;

function enumType(choices: readonly unknown[]): RemoteType | undefined {
  const values = choices.filter(isString);
  if (values.length !== choices.length || values.length > REMOTE_SCHEMA_LIMITS.optionsMax) {
    return undefined;
  }
  return { kind: 'string', options: values.map((value) => ({ title: labelize(value), value })) };
}

function arrayType(name: string, node: SchemaNode, context: MapContext): RemoteType | undefined {
  const items = toRecord(node['items']);
  if (items === undefined) {
    return undefined;
  }
  const member = typeOf(name, unwrapNullable(items).node, { ...context, depth: context.depth + 1 });
  return member === undefined ? undefined : { kind: 'array', of: [member] };
}

function objectType(name: string, node: SchemaNode, context: MapContext): RemoteType | undefined {
  if (toRecord(node['properties']) === undefined) {
    return undefined;
  }
  const fields = objectFields(node, { ...context, depth: context.depth + 1 });
  return fields.length === 0 ? undefined : { kind: 'object', name, fields };
}

function rulesOf(node: SchemaNode, type: RemoteType, presence: { readonly required: boolean }): RemoteRule[] {
  const rules: RemoteRule[] = presence.required ? [{ level: 'error', kind: 'required' }] : [];
  const limit = (kind: 'min' | 'max', value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      rules.push({ level: 'error', kind, limit: value });
    }
  };
  if (type.kind === 'number') {
    limit('min', node['minimum']);
    limit('max', node['maximum']);
    if (node['type'] === 'integer') {
      rules.push({ level: 'error', kind: 'integer' });
    }
  } else if (type.kind === 'array') {
    limit('min', node['minItems']);
    limit('max', node['maxItems']);
  } else {
    limit('min', node['minLength']);
    limit('max', node['maxLength']);
  }
  if (type.kind === 'email') {
    rules.push({ level: 'error', kind: 'email' });
  }
  assert(rules.length <= REMOTE_SCHEMA_LIMITS.rulesMax, 'A field states few rules');
  return rules;
}

function unwrapNullable(node: SchemaNode): {
  readonly node: SchemaNode;
  readonly nullable: boolean;
} {
  const types = toArray(node['type']);
  if (types !== undefined) {
    const rest = types.filter((type) => type !== 'null');
    const only = rest[0];
    if (rest.length === 1 && types.length === 2 && typeof only === 'string') {
      return { node: { ...node, type: only }, nullable: true };
    }
    return { node, nullable: false };
  }
  const branches = toArray(node['anyOf']) ?? toArray(node['oneOf']);
  if (branches === undefined || branches.length !== 2) {
    return { node, nullable: false };
  }
  const records = branches.map(toRecord);
  const rest = records.filter((branch) => branch !== undefined && branch['type'] !== 'null');
  const only = rest[0];
  if (rest.length !== 1 || only === undefined) {
    return { node, nullable: false };
  }
  return { node: { ...only, default: node['default'] ?? only['default'] }, nullable: true };
}

function dereferenced(node: SchemaNode, root: SchemaNode): SchemaNode | undefined {
  const reference = node['$ref'];
  if (typeof reference !== 'string') {
    return node;
  }
  const name = reference.split('/').pop() ?? '';
  return toRecord(toRecord(root['$defs'])?.[name]);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function labelize(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, REMOTE_SCHEMA_LIMITS.titleCharsMax);
}
