import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import { toArray, toRecord } from '../core/record';
import { definedFields } from '../core/boundary';

export type PropDefault = string | number | boolean;
export interface DefaultRule {
  readonly prop: string;
  readonly is: string;
  readonly then: string;
  readonly otherwise: string;
}
export interface UnionBranch {
  readonly forbids: readonly string[];
  readonly pins: Readonly<Record<string, readonly string[]>>;
  readonly defaults: Readonly<Record<string, string | number>>;
  readonly rules: Readonly<Record<string, DefaultRule>>;
  readonly docs: Readonly<Record<string, string>>;
}
export interface PropUnion {
  readonly names: readonly string[];
  readonly branches: readonly UnionBranch[];
}
export interface PropShapeField {
  readonly name: string;
  readonly type: string;
  readonly format?: string;
  readonly options?: readonly string[];
  readonly shape?: readonly PropShapeField[];
  readonly shapeIsList?: boolean;
}
export const CODE_KINDS = ['object', 'function', 'opaque'] as const;
export type CodeKind = (typeof CODE_KINDS)[number];
export const PROP_ITEM_KINDS = ['text', 'number', 'switch', 'choice'] as const;
export type PropItemKind = (typeof PROP_ITEM_KINDS)[number];
export interface ComputedDefault {
  readonly code: string;
  readonly locals: Readonly<Record<string, string>>;
  readonly tables: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
export interface PropField {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly options?: readonly string[];
  readonly numeric?: boolean;
  readonly expressionOptions?: readonly string[];
  readonly codeKind?: CodeKind;
  readonly typeText?: string;
  readonly default?: PropDefault | undefined;
  readonly defaultExpr?: boolean;
  readonly computedDefault?: ComputedDefault;
  readonly defaultAsset?: string;
  readonly hint?: string;
  readonly doc?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
  readonly shape?: readonly PropShapeField[];
  readonly shapeIsList?: boolean;
  readonly itemKind?: PropItemKind;
  readonly unions?: readonly PropUnion[];
  readonly deprecated?: string;
  readonly usage?: PropFieldUsage;
}
export const PROP_FIELD_USAGES = ['read', 'unread', 'unknown'] as const;
export type PropFieldUsage = (typeof PROP_FIELD_USAGES)[number];
export type PropSchema = ReadonlyMap<string, PropField>;

export function parseField(input: unknown, where: string): PropField {
  const value = schemaRecord(input, where);
  const name = schemaText(value['name'], `${where}.name`);
  if (!name.length) {
    fail(where, 'name: expected non-empty string');
  }
  const field = {
    name,
    type: schemaText(value['type'], `${where}.type`),
    optional: schemaBoolean(value['optional'], `${where}.optional`),
    ...schemaOptionalMetadata(value, where),
    ...definedFields({
      options: schemaOptional(value, 'options', where, (input, at) => schemaStrings(input, at, LIMITS.propOptionsMax)),
      expressionOptions: schemaOptional(value, 'expressionOptions', where, (input, at) => schemaStrings(input, at, LIMITS.propOptionsMax)),
      codeKind: schemaOptional(value, 'codeKind', where, schemaCodeKind),
      itemKind: schemaOptional(value, 'itemKind', where, schemaItemKind),
      usage: schemaOptional(value, 'usage', where, schemaUsage),
      computedDefault: schemaOptional(value, 'computedDefault', where, schemaComputedDefault),
      shape: schemaOptional(value, 'shape', where, (input, at) => schemaShape(input, at, 1, shapeBudget())),
      unions: schemaOptional(value, 'unions', where, (input, at) => schemaArray(input, at, LIMITS.propOptionsMax).map((union) => schemaUnion(union, at))),
    }),
  };
  return 'default' in value
    ? {
        ...field,
        default: value['default'] === undefined ? undefined : schemaDefault(value['default'], `${where}.default`),
      }
    : field;
}

export function parsePropSchema(input: unknown): PropSchema {
  if (!(input instanceof Map)) {
    fail('root', 'expected Map');
  }
  if (input.size > LIMITS.propSchemaFieldsMax) {
    fail('root', `exceeds ${LIMITS.propSchemaFieldsMax} fields`);
  }
  const entries: ReadonlyMap<unknown, unknown> = input;
  const out = new Map<string, PropField>();
  for (const [key, value] of entries) {
    if (typeof key !== 'string') {
      fail('root', 'expected string keys');
    }
    const field = parseField(value, key);
    if (field.name !== key) {
      fail(key, `field name ${JSON.stringify(field.name)} does not match its key`);
    }
    out.set(key, field);
  }
  assert(out.size === entries.size, 'parsePropSchema: every key becomes one field');
  return out;
}

function fail(where: string, what: string): never {
  throw new Error(`PropSchema.${where}: ${what}`);
}
function schemaRecord(input: unknown, where: string): Record<string, unknown> {
  const value = toRecord(input);
  if (!value) {
    fail(where, 'expected object');
  }
  if (Object.keys(value).length > LIMITS.propSchemaFieldsMax) {
    fail(where, 'too many fields');
  }
  return value;
}
function schemaText(input: unknown, where: string): string {
  if (typeof input !== 'string') {
    if (where.endsWith('.name')) {
      fail(where, 'expected non-empty string');
    }
    fail(where, 'expected string');
  }
  if (input.length > LIMITS.attrCharsMax) {
    fail(where, 'string exceeds limit');
  }
  return input;
}
function schemaBoolean(input: unknown, where: string): boolean {
  if (typeof input !== 'boolean') {
    fail(where, 'expected boolean');
  }
  return input;
}
function schemaNumber(input: unknown, where: string): number {
  if (typeof input !== 'number') {
    fail(where, 'expected number');
  }
  if (!Number.isFinite(input)) {
    fail(where, 'expected finite number');
  }
  return input;
}
function schemaDefault(input: unknown, where: string): PropDefault {
  if (typeof input === 'string') {
    return schemaText(input, where);
  }
  if (typeof input === 'boolean') {
    return input;
  }
  return schemaNumber(input, where);
}
function schemaArray(input: unknown, where: string, maximum: number): readonly unknown[] {
  const value = toArray(input);
  if (!value) {
    fail(where, 'expected array');
  }
  if (value.length > maximum) {
    if (where.endsWith('.options')) {
      fail(where, `options exceed ${maximum}`);
    }
    fail(where, `array exceeds ${maximum}`);
  }
  return value;
}
function schemaStrings(input: unknown, where: string, maximum: number): readonly string[] {
  const values = schemaArray(input, where, maximum);
  if (values.some((value) => typeof value !== 'string')) {
    fail(where, 'expected string array');
  }
  const strings = values.map((value) => schemaText(value, where));
  assert(strings.length === values.length, 'schemaStrings: every value is kept');
  return strings;
}

function schemaOptional<T>(record: Readonly<Record<string, unknown>>, key: string, where: string, parse: (input: unknown, where: string) => T): T | undefined {
  return record[key] === undefined ? undefined : parse(record[key], `${where}.${key}`);
}
function schemaOptionalMetadata(value: Readonly<Record<string, unknown>>, where: string) {
  return definedFields({
    numeric: schemaOptional(value, 'numeric', where, schemaBoolean),
    defaultExpr: schemaOptional(value, 'defaultExpr', where, schemaBoolean),
    shapeIsList: schemaOptional(value, 'shapeIsList', where, schemaBoolean),
    minExclusive: schemaOptional(value, 'minExclusive', where, schemaBoolean),
    maxExclusive: schemaOptional(value, 'maxExclusive', where, schemaBoolean),
    min: schemaOptional(value, 'min', where, schemaNumber),
    max: schemaOptional(value, 'max', where, schemaNumber),
    step: schemaOptional(value, 'step', where, schemaNumber),
    doc: schemaOptional(value, 'doc', where, schemaText),
    defaultAsset: schemaOptional(value, 'defaultAsset', where, schemaText),
    hint: schemaOptional(value, 'hint', where, schemaText),
    typeText: schemaOptional(value, 'typeText', where, schemaText),
    deprecated: schemaOptional(value, 'deprecated', where, schemaText),
  });
}
function schemaCodeKind(input: unknown, where: string): CodeKind {
  const kind = CODE_KINDS.find((candidate) => candidate === input);
  if (kind === undefined) {
    fail(where, `expected one of ${CODE_KINDS.join(', ')}`);
  }
  return kind;
}
function schemaItemKind(input: unknown, where: string): PropItemKind {
  const kind = PROP_ITEM_KINDS.find((candidate) => candidate === input);
  if (kind === undefined) {
    fail(where, `expected one of ${PROP_ITEM_KINDS.join(', ')}`);
  }
  return kind;
}
function schemaUsage(input: unknown, where: string): PropFieldUsage {
  const usage = PROP_FIELD_USAGES.find((candidate) => candidate === input);
  if (usage === undefined) {
    fail(where, `expected one of ${PROP_FIELD_USAGES.join(', ')}`);
  }
  return usage;
}
function schemaComputedDefault(input: unknown, where: string): ComputedDefault {
  const value = schemaRecord(input, where);
  const code = schemaText(value['code'], `${where}.code`).trim();
  if (code.length === 0) {
    fail(`${where}.code`, 'expected non-empty string');
  }
  const locals = schemaDictionary(value['locals'], `${where}.locals`, schemaText);
  const tablesRecord = schemaRecord(value['tables'] ?? {}, `${where}.tables`);
  if (Object.keys(tablesRecord).length > LIMITS.propOptionsMax) {
    fail(`${where}.tables`, `exceeds ${LIMITS.propOptionsMax} tables`);
  }
  const tables = schemaDictionary(tablesRecord, `${where}.tables`, (entries, at) => {
    const record = schemaRecord(entries, at);
    if (Object.keys(record).length > LIMITS.propOptionsMax) {
      fail(at, `exceeds ${LIMITS.propOptionsMax} entries`);
    }
    return schemaDictionary(record, at, schemaText);
  });
  assert(Object.keys(locals).length <= LIMITS.propSchemaFieldsMax, 'schemaComputedDefault: locals are bounded');
  return { code, locals, tables };
}
interface ShapeBudget {
  readonly take: () => boolean;
}
function shapeBudget(): ShapeBudget {
  let remaining = LIMITS.propSchemaFieldsMax;
  return {
    take: () => {
      remaining -= 1;
      return remaining >= 0;
    },
  };
}
function schemaShape(input: unknown, where: string, depth: number, budget: ShapeBudget): readonly PropShapeField[] {
  if (depth > LIMITS.listFieldDepthMax) {
    fail(where, `shape nesting exceeds ${LIMITS.listFieldDepthMax}`);
  }
  return schemaArray(input, where, LIMITS.propSchemaFieldsMax).map((item) => {
    if (!budget.take()) {
      fail(where, `shape exceeds ${LIMITS.propSchemaFieldsMax} members`);
    }
    const value = schemaRecord(item, where);
    const nested = schemaOptional(value, 'shape', where, (input, at) => schemaShape(input, at, depth + 1, budget));
    const options = schemaOptional(value, 'options', where, (input, at) => schemaStrings(input, at, LIMITS.propOptionsMax));
    const format = schemaOptional(value, 'format', where, schemaText);
    const isList = schemaOptional(value, 'shapeIsList', where, schemaBoolean);
    return {
      name: schemaText(value['name'], `${where}.name`),
      type: schemaText(value['type'], `${where}.type`),
      ...definedFields({ format, options, shape: nested, shapeIsList: isList }),
    };
  });
}
function schemaDictionary<T>(input: unknown, where: string, parse: (value: unknown, where: string) => T): Readonly<Record<string, T>> {
  const record = schemaRecord(input === undefined ? {} : input, where);
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [schemaText(key, where), parse(value, `${where}.${key}`)]));
}
function schemaUnion(input: unknown, where: string): PropUnion {
  const value = schemaRecord(input, where);
  return {
    names: schemaStrings(value['names'], `${where}.names`, LIMITS.propSchemaFieldsMax),
    branches: schemaArray(value['branches'], `${where}.branches`, LIMITS.propOptionsMax).map((branch) => schemaBranch(branch, where)),
  };
}
function schemaBranch(input: unknown, where: string): UnionBranch {
  const value = schemaRecord(input, where);
  return {
    forbids: schemaStrings(value['forbids'], `${where}.forbids`, LIMITS.propSchemaFieldsMax),
    pins: schemaDictionary(value['pins'], `${where}.pins`, (input, at) => schemaStrings(input, at, LIMITS.propOptionsMax)),
    defaults: schemaDictionary(value['defaults'], `${where}.defaults`, (input, at) =>
      typeof input === 'string' ? schemaText(input, at) : schemaNumber(input, at),
    ),
    rules: schemaDictionary(value['rules'], `${where}.rules`, schemaRule),
    docs: schemaDictionary(value['docs'], `${where}.docs`, schemaText),
  };
}
function schemaRule(input: unknown, where: string): DefaultRule {
  const value = schemaRecord(input, where);
  return {
    prop: schemaText(value['prop'], `${where}.prop`),
    is: schemaText(value['is'], `${where}.is`),
    then: schemaText(value['then'], `${where}.then`),
    otherwise: schemaText(value['otherwise'], `${where}.otherwise`),
  };
}
