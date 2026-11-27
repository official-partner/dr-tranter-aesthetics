
import type { Attr } from '../../../shared/page/pageNode';
import type { FieldDefinition } from './propRules';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { objectFields } from './arrayValue';
import { isLinkName } from '../../editor/fieldNames';
import { readPropDocumentation } from '../../editor/propDocumentation';

export type CodeRowKind = 'action' | 'code' | undefined;

export function codeRowKind(field: Pick<FieldDefinition, 'codeKind' | 'name'>, value: Attr | undefined): CodeRowKind {
  if (field.codeKind === 'function') {
    return 'action';
  }
  if (field.codeKind === 'opaque') {
    if (field.name === CLASS_NAME) {
      return undefined;
    }
    return value === undefined ? 'code' : undefined;
  }
  return undefined;
}

const CLASS_NAME = 'class';

export function codeRowValue(field: Pick<FieldDefinition, 'default'>, value: Attr | undefined): string | undefined {
  if (value !== undefined) {
    return value.type === 'bare' ? 'true' : value.type === 'string' ? JSON.stringify(value.value) : value.value;
  }
  if (field.default === undefined) {
    return undefined;
  }
  return typeof field.default === 'string' ? field.default : String(field.default);
}

const BLANK_MEMBER: Readonly<Record<string, string>> = { string: '""', number: '0', boolean: 'false' };

export function objectSeed(field: Pick<FieldDefinition, 'default' | 'shape' | 'shapeIsList'>, valueText: string | undefined): string | undefined {
  if (valueText !== undefined && valueText !== '') {
    return objectFields(valueText) ? valueText : undefined;
  }
  if (typeof field.default === 'string') {
    return objectFields(field.default) ? field.default : undefined;
  }
  const members = field.shapeIsList === true ? undefined : field.shape;
  if (members === undefined || members.length === 0 || members.length > LIMITS.propSchemaFieldsMax) {
    return undefined;
  }
  const entries: string[] = [];
  for (const member of members) {
    const blank = BLANK_MEMBER[member.type];
    if (blank === undefined || !/^[A-Za-z_$][\w$]*$/.test(member.name)) {
      return undefined;
    }
    entries.push(`${member.name}: ${blank}`);
  }
  const seed = `{ ${entries.join(', ')} }`;
  assert(objectFields(seed)?.length === members.length, 'objectSeed: every member becomes a field');
  return seed;
}

interface ChoiceWriting {
  readonly numeric?: boolean | undefined;
  readonly expressionOptions?: readonly string[] | undefined;
}

export function optionAttr(field: ChoiceWriting, option: string): Attr {
  assert(option !== '', 'optionAttr: an option is never empty');
  const expression = field.numeric === true || (field.expressionOptions?.includes(option) ?? false);
  return { type: expression ? 'expr' : 'string', value: option };
}

export function optionValue(field: ChoiceWriting, option: string): string | number | undefined {
  const expression = field.numeric === true || (field.expressionOptions?.includes(option) ?? false);
  if (!expression) {
    return option;
  }
  const number = Number(option);
  return Number.isFinite(number) ? number : undefined;
}

export function previewsOptions(field: ChoiceWriting): boolean {
  return !(field.expressionOptions ?? []).some((option) => option === 'true' || option === 'false');
}

export function isLinkProp(field: Pick<FieldDefinition, 'name' | 'type' | 'doc'>): boolean {
  if (field.type !== 'string' && field.type !== 'other') {
    return false;
  }
  const format = readPropDocumentation(field.doc).format;
  return format === undefined ? isLinkName(field.name) : format === 'link';
}
