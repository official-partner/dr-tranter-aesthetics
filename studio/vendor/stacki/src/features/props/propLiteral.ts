
import type { Attr } from '../../../shared/page/pageNode';
import type { FieldDefinition } from './propRules';

const PLAIN_TEMPLATE = /^`([^`$\\]*)`$/;
const QUOTED_STRING = /^(['"])((?:(?!\1)[^\\]|\\.)*)\1$/;

export function plainTextOf(source: string): string | undefined {
  const trimmed = source.trim();
  const quoted = trimmed.match(QUOTED_STRING);
  if (quoted) {
    return (quoted[2] ?? '').replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1');
  }
  const template = trimmed.match(PLAIN_TEMPLATE);
  return template ? (template[1] ?? '') : undefined;
}

export function textValue(field: FieldDefinition, text: string): Attr | undefined {
  if (field.type === 'boolean' || field.type === 'number') {
    return undefined;
  }
  if (field.type === 'enum' && !(field.options ?? []).includes(text)) {
    return undefined;
  }
  return { type: 'string', value: text };
}
