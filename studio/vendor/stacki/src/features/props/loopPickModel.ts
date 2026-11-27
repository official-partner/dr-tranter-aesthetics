
import { assert } from '../../../shared/core/assert';
import type { TreeNode } from '../../editor/dataSample';
import { emptyQuery, isItemId, LOOP_QUERY_LIMITS, type LoopQuery } from '../../editor/loopQuery';
import { parseExpression, parseFrontmatter, type Js } from '../../editor/loopSyntax';
import { nodeAt } from './loopProjectData';
import type { ItemPicture, PickableItem } from './loopSettingsData';

export const PICK_KEY_FIELDS = ['id', 'slug', 'key', 'uid', 'handle'] as const;

const TITLE_FIELDS = ['title', 'name', 'label', 'heading', 'headline', 'text', 'caption'] as const;
const PICTURE_FIELDS = ['image', 'img', 'photo', 'picture', 'thumbnail', 'avatar', 'logo', 'src'] as const;
const PICK_ITEMS_MAX = 500;

export interface ListPicks {
  readonly items: readonly PickableItem[];
  readonly field: string | undefined;
}

export type PickRefusal = 'unknown' | 'custom' | 'traced';

export type PickOffer = { readonly kind: 'available'; readonly picks: ListPicks } | { readonly kind: 'unavailable'; readonly reason: PickRefusal };

interface ItemText {
  readonly fields: ReadonlyMap<string, string>;
  readonly plain: string | undefined;
}

export function listPicks(input: {
  readonly frontmatter: string;
  readonly expression: string;
  readonly tree: readonly TreeNode[] | undefined;
}): ListPicks | undefined {
  const texts = writtenItems(input.frontmatter, input.expression) ?? sampledItems(input.tree, input.expression);
  if (texts === undefined || texts.length === 0) {
    return undefined;
  }
  assert(texts.length <= PICK_ITEMS_MAX, 'The items to pick from are bounded');
  const field = keyFieldOf(texts);
  const items = texts.map((text, index) => pickable(text, index, field));
  assert(items.length === texts.length, 'Every item can be picked');
  assert(new Set(items.map((item) => item.id)).size === items.length, 'Every item is picked by a distinct id');
  return { items, field };
}

export function listItemsModeQuery(query: LoopQuery, mode: 'dynamic' | 'selected', picks: ListPicks | undefined): LoopQuery | undefined {
  const base: LoopQuery = { ...emptyQuery(query.source), parameter: query.parameter };
  if (mode === 'selected') {
    if (query.selection !== undefined || picks === undefined) {
      return undefined;
    }
    return { ...base, selection: [], selectionField: picks.field };
  }
  return query.selection === undefined ? undefined : base;
}

function writtenItems(frontmatter: string, expression: string): readonly ItemText[] | undefined {
  const parsed = parseExpression(expression.trim());
  let list: Js | undefined = parsed?.expression;
  if (list?.kind === 'name') {
    const init = parseFrontmatter(frontmatter).declarations.get(list.name)?.init;
    list = init?.kind === 'await' ? init.value : init;
  }
  if (list?.kind !== 'array') {
    return undefined;
  }
  return list.items.slice(0, PICK_ITEMS_MAX).map(writtenText);
}

function writtenText(item: Js): ItemText {
  if (item.kind === 'object') {
    const fields = new Map<string, string>();
    for (const entry of item.entries) {
      if (entry.key !== undefined && entry.value.kind === 'string' && !fields.has(entry.key)) {
        fields.set(entry.key, entry.value.value);
      }
    }
    return { fields, plain: undefined };
  }
  return { fields: new Map(), plain: item.kind === 'string' ? item.value : item.kind === 'number' ? String(item.value) : undefined };
}

function sampledItems(tree: readonly TreeNode[] | undefined, expression: string): readonly ItemText[] | undefined {
  const list = nodeAt(tree, expression.trim());
  if (list?.children === undefined) {
    return undefined;
  }
  return list.children.slice(0, PICK_ITEMS_MAX).map((item) => {
    if (item.children === undefined) {
      return { fields: new Map(), plain: item.preview === '' ? undefined : item.preview };
    }
    const fields = new Map<string, string>();
    for (const field of item.children) {
      if (field.children === undefined && field.preview !== '') {
        fields.set(field.key, field.preview);
      }
    }
    return { fields, plain: undefined };
  });
}

function keyFieldOf(texts: readonly ItemText[]): string | undefined {
  for (const field of PICK_KEY_FIELDS) {
    const values = texts.map((text) => text.fields.get(field));
    const named = values.flatMap((value) => (value !== undefined && isItemId(value) ? [value] : []));
    if (named.length === texts.length && new Set(named).size === named.length) {
      return field;
    }
  }
  return undefined;
}

function pickable(text: ItemText, index: number, field: string | undefined): PickableItem {
  const key = field === undefined ? undefined : text.fields.get(field);
  const id = key ?? String(index);
  assert(id.length <= LOOP_QUERY_LIMITS.itemIdCharsMax, 'An item id is bounded');
  const title = titleOf(text) ?? `#${index + 1}`;
  const picture = pictureOf(text);
  return picture === undefined ? { id, title } : { id, title, picture };
}

function titleOf(text: ItemText): string | undefined {
  if (text.plain !== undefined) {
    return text.plain;
  }
  for (const name of TITLE_FIELDS) {
    const value = text.fields.get(name);
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return [...text.fields.values()].find((value) => value !== '');
}

function pictureOf(text: ItemText): ItemPicture | undefined {
  for (const name of PICTURE_FIELDS) {
    const value = text.fields.get(name);
    if (value === undefined || value === '') {
      continue;
    }
    if (/^https?:\/\//.test(value)) {
      return { kind: 'url', url: value };
    }
    return { kind: 'file', file: value.startsWith('/') ? `public${value}` : value.replace(/^\.\//, '') };
  }
  return undefined;
}
