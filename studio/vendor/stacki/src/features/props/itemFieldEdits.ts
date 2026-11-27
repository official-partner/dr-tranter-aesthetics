
import { assert } from '../../../shared/core/assert';
import {
  fieldNameProblem,
  fieldsOf,
  ITEM_FIELD_LIMITS,
  retypedField,
  withNestedFields,
  type ItemFieldDeclaration,
  type ItemFieldKind,
} from '../../editor/itemFields';
import { arrayItems, arrayText, nestedItems, type Item } from './arrayValue';
import { blankItemOf, renamedItemField } from './listItemShape';

export interface ListShape {
  readonly fields: readonly ItemFieldDeclaration[];
  readonly itemsText: string;
}

export type FieldPath = readonly number[];

export function fieldAtPath(fields: readonly ItemFieldDeclaration[], path: FieldPath): ItemFieldDeclaration | undefined {
  assert(path.length <= ITEM_FIELD_LIMITS.depthMax, 'fieldAtPath: a path is as deep as the fields nest');
  let level = fields;
  let found: ItemFieldDeclaration | undefined;
  for (const index of path) {
    found = level[index];
    if (found === undefined) {
      return undefined;
    }
    level = fieldsOf(found);
  }
  return found;
}

export function freeFieldName(siblings: readonly ItemFieldDeclaration[]): string {
  for (let suffix = 1; suffix <= ITEM_FIELD_LIMITS.fieldsPerLevelMax + 1; suffix++) {
    const name = suffix === 1 ? 'field' : `field${suffix}`;
    if (!siblings.some((field) => field.name === name)) {
      return name;
    }
  }
  assert(false, 'freeFieldName: a free name is found within the field bound');
  return 'field';
}

export function addedField(shape: ListShape, parent: FieldPath): ListShape {
  const fields = withSiblings(shape.fields, parent, 1, (siblings) => [...siblings, { name: freeFieldName(siblings), kind: 'text' }]);
  return { fields, itemsText: shape.itemsText };
}

export function renamedFieldAt(shape: ListShape, path: FieldPath, name: string, key: string): ListShape {
  return editedAt(shape, path, {
    field: (field) => ({ ...field, name }),
    items: (items) => (fieldNameProblem(name) === undefined ? renamedItemField(items, key, name) : items),
  });
}

export function retypedFieldAt(shape: ListShape, path: FieldPath, kind: ItemFieldKind): ListShape {
  const field = fieldAtPath(shape.fields, path);
  assert(field !== undefined, 'retypedFieldAt: the retyped field exists');
  const next = retypedField(field, kind);
  return editedAt(shape, path, {
    field: () => next,
    items: (items) => items.map((item) => withBlankField(item, next)),
  });
}

export function removedFieldAt(shape: ListShape, path: FieldPath): ListShape {
  const field = fieldAtPath(shape.fields, path);
  assert(field !== undefined, 'removedFieldAt: the removed field exists');
  const index = path.at(-1);
  assert(index !== undefined, 'removedFieldAt: a path names a row');
  return editedAt(shape, path, {
    field: undefined,
    items: (items) => items.map((item) => (item.fields === undefined ? item : { fields: item.fields.filter((own) => own.key !== field.name) })),
  });
}

export function optionsAtPath(shape: ListShape, path: FieldPath, options: readonly string[]): ListShape {
  const field = fieldAtPath(shape.fields, path);
  assert(field !== undefined, 'optionsAtPath: the field exists');
  assert(field.kind === 'option', 'optionsAtPath: only an Option has choices');
  const first = options[0];
  return editedAt(shape, path, {
    field: () => ({ ...field, options }),
    items: (items) =>
      items.map((item) =>
        item.fields === undefined
          ? item
          : {
              fields: item.fields.map((own) => (own.key === field.name && first !== undefined && !options.includes(own.text) ? { ...own, text: first } : own)),
            },
      ),
  });
}

interface Edit {
  readonly field: ((field: ItemFieldDeclaration) => ItemFieldDeclaration) | undefined;
  readonly items: (items: readonly Item[]) => readonly Item[];
}

function editedAt(shape: ListShape, path: FieldPath, edit: Edit): ListShape {
  const index = path.at(-1);
  assert(index !== undefined, 'editedAt: a path names a row');
  const parent = path.slice(0, -1);
  const ancestors = ancestorNames(shape.fields, parent);
  const fields = withSiblings(shape.fields, parent, 1, (siblings) => {
    const { field } = edit;
    return field === undefined ? siblings.filter((_, at) => at !== index) : siblings.map((sibling, at) => (at === index ? field(sibling) : sibling));
  });
  return { fields, itemsText: itemsEditedAt(shape.itemsText, ancestors, edit.items) };
}

function withSiblings(
  fields: readonly ItemFieldDeclaration[],
  parent: FieldPath,
  depth: number,
  edit: (siblings: readonly ItemFieldDeclaration[]) => readonly ItemFieldDeclaration[],
): readonly ItemFieldDeclaration[] {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'withSiblings: the fields nest within their bound');
  const [head, ...rest] = parent;
  if (head === undefined) {
    return edit(fields);
  }
  return fields.map((field, at) => (at === head ? withNestedFields(field, withSiblings(fieldsOf(field), rest, depth + 1, edit)) : field));
}

function ancestorNames(fields: readonly ItemFieldDeclaration[], parent: FieldPath): readonly string[] {
  const names: string[] = [];
  let level = fields;
  for (const index of parent) {
    const field = level[index];
    assert(field !== undefined, 'ancestorNames: every ancestor exists');
    names.push(field.name);
    level = fieldsOf(field);
  }
  return names;
}

function itemsEditedAt(itemsText: string, ancestors: readonly string[], edit: (items: readonly Item[]) => readonly Item[]): string {
  const items = arrayItems(itemsText);
  if (items === undefined) {
    return itemsText;
  }
  const edited = editedItems(items, ancestors, 1, edit);
  return edited === items ? itemsText : arrayText(edited);
}

function editedItems(items: readonly Item[], ancestors: readonly string[], depth: number, edit: (items: readonly Item[]) => readonly Item[]): readonly Item[] {
  assert(depth <= ITEM_FIELD_LIMITS.walkDepthMax, 'editedItems: the items nest within their bound');
  const [name, ...rest] = ancestors;
  if (name === undefined) {
    return edit(items);
  }
  return items.map((item) => {
    if (item.fields === undefined) {
      return item;
    }
    return {
      fields: item.fields.map((field) => {
        const nested = field.key === name && field.quote === undefined ? nestedItems(field.text) : undefined;
        if (nested === undefined) {
          return field;
        }
        const inner = arrayText(editedItems(nested, rest, depth + 1, edit));
        return { ...field, text: field.text.trim().startsWith('[') ? inner : inner.slice(1, -1) };
      }),
    };
  });
}

function withBlankField(item: Item, field: ItemFieldDeclaration): Item {
  if (item.fields === undefined) {
    return item;
  }
  const blank = blankItemOf([field], '"').fields?.[0];
  assert(blank !== undefined, 'withBlankField: a blank item has the field');
  return { fields: item.fields.map((own) => (own.key === field.name ? { ...blank, keyQuote: own.keyQuote } : own)) };
}
