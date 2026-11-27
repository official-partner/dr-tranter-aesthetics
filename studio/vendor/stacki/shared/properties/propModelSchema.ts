
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import type { CodeKind, PropDefault, PropItemKind, PropShapeField, PropUnion } from './propSchema';
import type { ComponentPropModel, PropControl, PropMember, PropModel, PropUsage } from './propModel';

export type SchemaFieldType = 'enum' | 'attrs' | 'code' | 'string' | 'number' | 'boolean' | 'other';

export interface ModelSchemaField {
  readonly name: string;
  readonly type: SchemaFieldType;
  readonly optional: boolean;
  readonly default: PropDefault | undefined;
  readonly defaultExpr?: boolean;
  readonly hint?: string;
  readonly options?: readonly string[] | undefined;
  readonly numeric?: boolean | undefined;
  readonly expressionOptions?: readonly string[];
  readonly codeKind?: CodeKind;
  readonly typeText?: string;
  readonly doc?: string | undefined;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
  readonly shape?: readonly PropShapeField[];
  readonly shapeIsList?: boolean;
  readonly itemKind?: PropItemKind;
  readonly unions?: readonly PropUnion[] | undefined;
  readonly deprecated?: string;
  readonly usage?: PropUsage;
}

export function schemaFieldsOf(model: ComponentPropModel): ModelSchemaField[] {
  const fields = model.props.map((prop) => schemaFieldOf(prop, model.unions));
  assert(fields.length === model.props.length, 'schemaFieldsOf: one field per prop');
  assert(new Set(fields.map((field) => field.name)).size === fields.length, 'schemaFieldsOf: field names stay unique');
  return fields;
}

export function schemaTypeOf(control: PropControl): { readonly type: SchemaFieldType; readonly codeKind: CodeKind | undefined } {
  switch (control.kind) {
    case 'text':
      return { type: 'string', codeKind: undefined };
    case 'number':
      return { type: 'number', codeKind: undefined };
    case 'switch':
      return { type: 'boolean', codeKind: undefined };
    case 'choice':
      return { type: 'enum', codeKind: undefined };
    case 'attributes':
      return { type: 'attrs', codeKind: undefined };
    case 'list':
      return { type: 'code', codeKind: undefined };
    case 'group':
      return { type: 'code', codeKind: 'object' };
    case 'callback':
      return { type: 'other', codeKind: 'function' };
    case 'code':
      switch (control.reason) {
        case 'opaque':
          return { type: 'other', codeKind: 'opaque' };
        case 'tuple':
          return { type: 'code', codeKind: undefined };
        case 'nestingDepth':
          return { type: 'code', codeKind: 'object' };
        case 'untyped':
        case 'unrecognized':
          return { type: 'other', codeKind: undefined };
        default: {
          const exhaustive: never = control.reason;
          return exhaustive;
        }
      }
    default: {
      const exhaustive: never = control;
      return exhaustive;
    }
  }
}

const TYPE_TEXT_CHARS_MAX = 512;

export function shownTypeText(typeText: string): string {
  const flat = typeText.replace(/\s+/g, ' ').trim();
  const shown = flat.length <= TYPE_TEXT_CHARS_MAX ? flat : `${flat.slice(0, TYPE_TEXT_CHARS_MAX - 1)}…`;
  assert(shown.length <= TYPE_TEXT_CHARS_MAX, 'shownTypeText: bounded');
  return shown;
}

function schemaFieldOf(prop: PropModel, unions: readonly PropUnion[]): ModelSchemaField {
  const { type, codeKind } = schemaTypeOf(prop.control);
  const base = prop.declared ? declaredField(prop, type, codeKind, unions) : undeclaredField(prop, type, codeKind);
  const fallback = prop.fallback;
  const withFallback: ModelSchemaField = (() => {
    switch (fallback.kind) {
      case 'none':
        return base;
      case 'literal':
        return fallback.source === 'destructure' ? { ...base, optional: true, default: fallback.value } : { ...base, default: fallback.value };
      case 'expression':
        return { ...base, optional: true, default: fallback.code, defaultExpr: true };
      case 'hint':
        return { ...base, hint: fallback.hint };
      default: {
        const exhaustive: never = fallback;
        return exhaustive;
      }
    }
  })();
  const deprecated = prop.deprecated === undefined ? withFallback : { ...withFallback, deprecated: prop.deprecated };
  const field = prop.usage === 'unread' ? { ...deprecated, usage: prop.usage } : deprecated;
  assert(field.name === prop.name, 'schemaFieldOf: the field is the prop');
  return field;
}

function declaredField(prop: PropModel, type: SchemaFieldType, codeKind: CodeKind | undefined, unions: readonly PropUnion[]): ModelSchemaField {
  const control = prop.control;
  const items = control.kind === 'list' ? control.item : undefined;
  const choice = control.kind === 'choice' ? control : items?.kind === 'choice' ? items : undefined;
  const itemKind = items === undefined ? undefined : itemKindOf(items);
  const written =
    choice === undefined || choice.numeric ? [] : choice.options.filter((option) => option.written === 'expression').map((option) => option.value);
  const shape = shapeOf(control, 1);
  const typed = prop.recognition.source === 'type' && codeKind !== undefined;
  return {
    name: prop.name,
    type,
    options: choice?.options.map((option) => option.value),
    numeric: choice?.numeric === true ? true : undefined,
    ...(written.length > 0 ? { expressionOptions: written } : {}),
    ...(codeKind === undefined ? {} : typed ? { codeKind, typeText: shownTypeText(prop.typeText) } : { codeKind }),
    optional: prop.presence === 'optional',
    ...(shape === undefined ? {} : { shape: shape.fields, shapeIsList: shape.list }),
    ...(itemKind === undefined ? {} : { itemKind }),
    default: undefined,
    doc: prop.documentation === '' ? undefined : prop.documentation,
    ...(control.kind === 'number' ? numberKeys(control) : items?.kind === 'number' ? numberKeys(items) : {}),
    unions: unions.length > 0 ? unions : undefined,
  };
}

function itemKindOf(item: PropControl): PropItemKind | undefined {
  switch (item.kind) {
    case 'text':
      return 'text';
    case 'number':
      return 'number';
    case 'switch':
      return 'switch';
    case 'choice':
      return 'choice';
    case 'attributes':
    case 'list':
    case 'group':
    case 'callback':
    case 'code':
      return undefined;
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

function undeclaredField(prop: PropModel, type: SchemaFieldType, codeKind: CodeKind | undefined): ModelSchemaField {
  assert(prop.presence === 'optional', 'undeclaredField: nothing declares an undeclared prop required');
  const field: ModelSchemaField = { name: prop.name, type, optional: true, default: undefined };
  return codeKind === undefined ? field : { ...field, codeKind };
}

function numberKeys(control: Extract<PropControl, { kind: 'number' }>): Pick<ModelSchemaField, 'min' | 'max' | 'step' | 'minExclusive' | 'maxExclusive'> {
  return {
    ...(control.min === undefined ? {} : { min: control.min }),
    ...(control.max === undefined ? {} : { max: control.max }),
    ...(control.step === undefined ? {} : { step: control.step }),
    ...(control.minExclusive ? { minExclusive: true } : {}),
    ...(control.maxExclusive ? { maxExclusive: true } : {}),
  };
}

function shapeOf(control: PropControl, depth: number): { readonly fields: readonly PropShapeField[]; readonly list: boolean } | undefined {
  assert(depth <= LIMITS.listFieldDepthMax, 'shapeOf: the shape nests within its bound');
  const group = control.kind === 'group' ? control : control.kind === 'list' && control.item.kind === 'group' ? control.item : undefined;
  if (group === undefined || group.fields.length === 0) {
    return undefined;
  }
  return { fields: group.fields.map((field) => shapeFieldOf(field, depth)), list: control.kind === 'list' };
}

function shapeFieldOf(field: PropMember, depth: number): PropShapeField {
  const control = field.control;
  const nested = depth < LIMITS.listFieldDepthMax ? shapeOf(control, depth + 1) : undefined;
  const options =
    control.kind === 'choice' && !control.numeric && control.options.every((option) => option.written === 'string')
      ? control.options.map((option) => option.value)
      : undefined;
  return {
    name: field.name,
    type: schemaTypeOf(control).type,
    ...(control.kind === 'text' && control.format !== undefined ? { format: control.format } : {}),
    ...(options === undefined ? {} : { options }),
    ...(nested === undefined ? {} : { shape: nested.fields, shapeIsList: nested.list }),
  };
}
