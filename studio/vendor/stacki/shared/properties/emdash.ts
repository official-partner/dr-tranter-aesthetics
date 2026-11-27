
import { assert } from '../core/assert';
import { err, ok, type Result } from '../core/result';
import { list, object, optional, record, text } from '../core/boundary';

export const EMDASH_LIMITS = {
  collectionsMax: 100,
  fieldsMax: 200,
  optionsMax: 64,
  labelCharsMax: 200,
  slugCharsMax: 128,
  urlPatternCharsMax: 256,
  pathCharsMax: 512,
  entriesMax: 200,
  problemsMax: 16,
} as const satisfies Record<string, number>;

export const EMDASH_FIELD_TYPES = [
  'string',
  'text',
  'url',
  'number',
  'integer',
  'boolean',
  'datetime',
  'select',
  'multiSelect',
  'portableText',
  'image',
  'file',
  'reference',
  'json',
  'slug',
  'repeater',
  'blocks',
] as const;
export type EmDashFieldType = (typeof EMDASH_FIELD_TYPES)[number];

export type EmDashBinding = 'text' | 'richText' | 'image' | 'file' | 'link' | 'number' | 'boolean' | 'date' | 'list' | 'reference' | 'data';

export interface EmDashField {
  readonly slug: string;
  readonly label: string;
  readonly type: EmDashFieldType | 'unsupported';
  readonly required: boolean;
  readonly options: readonly string[];
  readonly binding: EmDashBinding;
}

export interface EmDashCollection {
  readonly slug: string;
  readonly label: string;
  readonly labelSingular?: string | undefined;
  readonly urlPattern?: string | undefined;
  readonly fields: readonly EmDashField[];
}

export type EmDashSchemaSource = 'database' | 'schema-json' | 'seed';

export type EmDashProblem =
  | 'notInstalled'
  | 'noIntegration'
  | 'noLiveCollection'
  | 'staticOutput'
  | 'noDatabase'
  | 'databaseTracked'
  | 'uploadsTracked'
  | 'noSchema'
  | 'schemaUnreadable'
  | 'databaseUnreadable';

const PROBLEMS = [
  'notInstalled',
  'noIntegration',
  'noLiveCollection',
  'staticOutput',
  'noDatabase',
  'databaseTracked',
  'uploadsTracked',
  'noSchema',
  'schemaUnreadable',
  'databaseUnreadable',
] as const satisfies readonly EmDashProblem[];

export type EmDashProject =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'present';
      readonly configFile: string | undefined;
      readonly output: 'server' | 'static' | 'unknown';
      readonly databaseFile: string | undefined;
      readonly schemaSource: EmDashSchemaSource | undefined;
      readonly collections: readonly EmDashCollection[];
      readonly problems: readonly EmDashProblem[];
    };

export interface EmDashEntrySummary {
  readonly slug: string;
  readonly title: string;
}

const FIELD_SLUG = /^[a-z][a-z0-9_]*$/;
const COLLECTION_SLUG = /^[a-z][a-z0-9_]*$/;

export function isEmDashCollectionSlug(value: string): boolean {
  return COLLECTION_SLUG.test(value) && value.length <= EMDASH_LIMITS.slugCharsMax;
}

export function bindingOf(type: EmDashFieldType | 'unsupported'): EmDashBinding {
  switch (type) {
    case 'string':
    case 'text':
    case 'slug':
    case 'select':
      return 'text';
    case 'url':
      return 'link';
    case 'portableText':
      return 'richText';
    case 'image':
      return 'image';
    case 'file':
      return 'file';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'datetime':
      return 'date';
    case 'multiSelect':
    case 'repeater':
    case 'blocks':
      return 'list';
    case 'reference':
      return 'reference';
    case 'json':
    case 'unsupported':
      return 'data';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function fieldTypeOf(input: unknown): EmDashFieldType | 'unsupported' {
  const found = EMDASH_FIELD_TYPES.find((type) => type === input);
  return found ?? 'unsupported';
}

function parseField(input: unknown): EmDashField | undefined {
  const value = record(input);
  const slug = text(value['slug']);
  if (!FIELD_SLUG.test(slug) || slug.length > EMDASH_LIMITS.slugCharsMax) {
    return undefined;
  }
  const label = typeof value['label'] === 'string' && value['label'].trim().length > 0 ? value['label'].slice(0, EMDASH_LIMITS.labelCharsMax) : slug;
  const type = fieldTypeOf(value['type']);
  return { slug, label, type, required: value['required'] === true || value['required'] === 1, options: optionsOf(value), binding: bindingOf(type) };
}

function optionsOf(field: Record<string, unknown>): readonly string[] {
  const validation = field['validation'];
  const holder = typeof validation === 'object' && validation !== null && !Array.isArray(validation) ? record(validation) : {};
  const raw = Array.isArray(holder['options']) ? holder['options'] : Array.isArray(field['options']) ? field['options'] : [];
  const choices: string[] = [];
  for (const choice of raw.slice(0, EMDASH_LIMITS.optionsMax)) {
    if (typeof choice === 'string' && choice.length > 0 && choice.length <= EMDASH_LIMITS.labelCharsMax) {
      choices.push(choice);
    }
  }
  return choices;
}

function parseCollection(input: unknown): EmDashCollection | undefined {
  const value = record(input);
  const slug = text(value['slug']);
  if (!isEmDashCollectionSlug(slug)) {
    return undefined;
  }
  const rawFields = value['fields'];
  const fieldList = Array.isArray(rawFields) ? rawFields.slice(0, EMDASH_LIMITS.fieldsMax) : [];
  const fields: EmDashField[] = [];
  const seen = new Set<string>();
  for (const raw of fieldList) {
    const field = parseField(raw);
    if (field !== undefined && !seen.has(field.slug)) {
      seen.add(field.slug);
      fields.push(field);
    }
  }
  const label = typeof value['label'] === 'string' && value['label'].trim().length > 0 ? value['label'].slice(0, EMDASH_LIMITS.labelCharsMax) : slug;
  const singular = value['labelSingular'];
  const pattern = value['urlPattern'];
  return {
    slug,
    label,
    labelSingular: typeof singular === 'string' && singular.length > 0 ? singular.slice(0, EMDASH_LIMITS.labelCharsMax) : undefined,
    urlPattern: typeof pattern === 'string' && pattern.startsWith('/') && pattern.length <= EMDASH_LIMITS.urlPatternCharsMax ? pattern : undefined,
    fields,
  };
}

export function parseEmDashSchema(input: unknown): Result<readonly EmDashCollection[], 'not-schema' | 'too-many'> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err('not-schema');
  }
  const raw = record(input)['collections'];
  if (!Array.isArray(raw)) {
    return err('not-schema');
  }
  if (raw.length > EMDASH_LIMITS.collectionsMax) {
    return err('too-many');
  }
  const collections: EmDashCollection[] = [];
  for (const candidate of raw) {
    const collection = parseCollection(candidate);
    if (collection !== undefined && !collections.some((known) => known.slug === collection.slug)) {
      collections.push(collection);
    }
  }
  assert(collections.length <= EMDASH_LIMITS.collectionsMax, 'parseEmDashSchema: the collections stay within the limit');
  return ok(collections);
}

const parseOptionalText = optional(text);
const parseProblemList = list((input: unknown): EmDashProblem => {
  const found = PROBLEMS.find((problem) => problem === input);
  if (found === undefined) {
    throw new Error('EmDash: unknown problem');
  }
  return found;
});

function parseSchemaSource(input: unknown): EmDashSchemaSource | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === 'database' || input === 'schema-json' || input === 'seed') {
    return input;
  }
  throw new Error('EmDash: unknown schema source');
}

function parseOutput(input: unknown): 'server' | 'static' | 'unknown' {
  if (input === 'server' || input === 'static' || input === 'unknown') {
    return input;
  }
  throw new Error('EmDash: unknown output mode');
}

const parseStoredField = (input: unknown): EmDashField => {
  const field = parseField(input);
  if (field === undefined) {
    throw new Error('EmDash: invalid field');
  }
  return field;
};

const parseStoredCollection = object({
  slug: text,
  label: text,
  labelSingular: parseOptionalText,
  urlPattern: parseOptionalText,
  fields: list(parseStoredField),
});

export function parseEmDashProject(input: unknown): EmDashProject {
  const value = record(input);
  if (value['kind'] === 'absent') {
    return { kind: 'absent' };
  }
  if (value['kind'] !== 'present') {
    throw new Error('EmDash: unknown project state');
  }
  const collections = list((raw: unknown): EmDashCollection => {
    const parsed = parseStoredCollection(raw);
    if (!isEmDashCollectionSlug(parsed.slug)) {
      throw new Error('EmDash: invalid collection');
    }
    return parsed;
  })(value['collections']);
  if (collections.length > EMDASH_LIMITS.collectionsMax) {
    throw new Error('EmDash: too many collections');
  }
  const problems = parseProblemList(value['problems']);
  if (problems.length > EMDASH_LIMITS.problemsMax) {
    throw new Error('EmDash: too many problems');
  }
  return {
    kind: 'present',
    configFile: parseOptionalText(value['configFile']),
    output: parseOutput(value['output']),
    databaseFile: parseOptionalText(value['databaseFile']),
    schemaSource: parseSchemaSource(value['schemaSource']),
    collections,
    problems,
  };
}

export function parseEmDashEntries(input: unknown): readonly EmDashEntrySummary[] {
  const entries = list(object({ slug: text, title: text }))(input);
  if (entries.length > EMDASH_LIMITS.entriesMax) {
    throw new Error('EmDash: too many entries');
  }
  return entries;
}

export interface EmDashTemplateRequest {
  readonly collection: string;
}

export function parseEmDashCollectionName(input: unknown): string {
  const name = text(input);
  if (!isEmDashCollectionSlug(name)) {
    throw new Error('EmDash: invalid collection name');
  }
  return name;
}

export function emDashFieldExpression(entryName: string, field: Pick<EmDashField, 'slug'>): string {
  assert(/^[A-Za-z_$][\w$]*$/.test(entryName), 'emDashFieldExpression: the entry is a name');
  assert(FIELD_SLUG.test(field.slug), 'emDashFieldExpression: a field slug is an identifier');
  return `${entryName}.data.${field.slug}`;
}

export type EmDashElementRecipe =
  | { readonly kind: 'text' }
  | { readonly kind: 'link' }
  | { readonly kind: 'component'; readonly name: 'Image' | 'PortableText'; readonly prop: 'image' | 'value' }
  | { readonly kind: 'none' };

export function recipeFor(binding: EmDashBinding): EmDashElementRecipe {
  switch (binding) {
    case 'text':
    case 'number':
    case 'date':
    case 'boolean':
      return { kind: 'text' };
    case 'link':
    case 'file':
      return { kind: 'link' };
    case 'richText':
      return { kind: 'component', name: 'PortableText', prop: 'value' };
    case 'image':
      return { kind: 'component', name: 'Image', prop: 'image' };
    case 'list':
    case 'reference':
    case 'data':
      return { kind: 'none' };
    default: {
      const exhaustive: never = binding;
      return exhaustive;
    }
  }
}

export function headingFieldOf(collection: Pick<EmDashCollection, 'fields'>): string | undefined {
  const strings = collection.fields.filter((field) => field.type === 'string');
  const named = strings.find((field) => field.slug === 'title' || field.slug === 'name' || field.slug === 'heading');
  return (named ?? strings[0])?.slug;
}
