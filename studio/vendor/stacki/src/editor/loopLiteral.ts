
import { assert } from '../../shared/core/assert';
import { isFieldPath, ITEM_FIELD, type LoopFieldKind } from './loopQuery';
import { parseExpression, parseFrontmatter, type Js } from './loopSyntax';

export const LOOP_LITERAL_LIMITS = {
  itemsMax: 200,
  itemCharsMax: 500,
  fieldsMax: 64,
} as const satisfies Record<string, number>;

export interface WrittenField {
  readonly path: string;
  readonly kind: LoopFieldKind;
}

export function writtenListFields(frontmatter: string, name: string): readonly WrittenField[] | undefined {
  const init = parseFrontmatter(frontmatter).declarations.get(name)?.init;
  return fieldsOfList(init?.kind === 'await' ? init.value : init);
}

export function literalListFields(code: string): readonly WrittenField[] | undefined {
  return fieldsOfList(parseExpression(code.trim())?.expression);
}

function fieldsOfList(list: Js | undefined): readonly WrittenField[] | undefined {
  if (list?.kind !== 'array') {
    return undefined;
  }
  const kinds = new Map<string, LoopFieldKind>();
  const note = (path: string, kind: LoopFieldKind): void => {
    const known = kinds.get(path);
    if (known === undefined && kinds.size < LOOP_LITERAL_LIMITS.fieldsMax) {
      kinds.set(path, kind);
    } else if (known !== undefined && known !== kind) {
      kinds.set(path, 'other');
    }
  };
  for (const item of list.items.slice(0, LOOP_LITERAL_LIMITS.itemsMax)) {
    if (item.kind === 'object') {
      for (const entry of item.entries) {
        if (entry.key !== undefined && isFieldPath(entry.key) && !entry.key.includes('.') && entry.key !== ITEM_FIELD) {
          note(entry.key, writtenKind(entry.value));
        }
      }
    } else if (item.kind === 'string' || item.kind === 'number' || item.kind === 'boolean') {
      note(ITEM_FIELD, writtenKind(item));
    }
  }
  const fields = [...kinds].map(([path, kind]) => ({ path, kind }));
  assert(fields.length <= LOOP_LITERAL_LIMITS.fieldsMax, 'A written-out list’s fields are bounded');
  assert(
    fields.every((field) => isFieldPath(field.path)),
    'A written-out list’s fields are paths a filter can name',
  );
  return fields;
}

function writtenKind(value: Js): LoopFieldKind {
  switch (value.kind) {
    case 'string':
      return 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'list';
    case 'object':
    case 'function':
    case 'name':
    case 'member':
    case 'index':
    case 'call':
    case 'new':
    case 'await':
    case 'null':
    case 'unary':
    case 'binary':
    case 'conditional':
    case 'other':
      return 'other';
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export const STARTER_ITEMS: readonly string[] = ['Item 1', 'Item 2', 'Item 3'];

export function isArrayLiteral(data: string): boolean {
  const parsed = parseExpression(data.trim());
  return parsed !== undefined && parsed.expression.kind === 'array';
}

export function literalItems(data: string): readonly string[] | undefined {
  const parsed = parseExpression(data.trim());
  if (parsed === undefined) {
    return undefined;
  }
  const node = parsed.expression;
  if (node.kind !== 'array') {
    return undefined;
  }
  if (node.items.length > LOOP_LITERAL_LIMITS.itemsMax) {
    return undefined;
  }
  const items: string[] = [];
  for (const item of node.items) {
    if (item.kind !== 'string') {
      return undefined;
    }
    items.push(item.value);
  }
  assert(items.length === node.items.length, 'Every item of a typed list is read');
  return items;
}

export function literalCode(items: readonly string[]): string {
  assert(items.length <= LOOP_LITERAL_LIMITS.itemsMax, 'A typed list is bounded');
  for (const item of items) {
    assert(item.length <= LOOP_LITERAL_LIMITS.itemCharsMax, 'A typed item is bounded');
  }
  const code = `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
  assert(literalItems(code)?.length === items.length, 'A typed list reads back as written');
  return code;
}
