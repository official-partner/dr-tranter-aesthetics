import { assert } from '../../shared/core/assert';
import { HTML_TAGS } from './elementSchemas';

export const INSERT_DRAG_TYPE = 'avb/insert';

export const INSERT_DRAG_CONSTRUCTS = ['map', 'cond', 'text', 'comment', 'expr', 'doctype', 'style', 'script'] as const;
export type InsertDragConstruct = (typeof INSERT_DRAG_CONSTRUCTS)[number];

export const INSERT_DRAG_ASSETS = ['Image', 'Picture'] as const;
export type InsertDragAsset = (typeof INSERT_DRAG_ASSETS)[number];

export const INSERT_DRAG_EXTRA_TAGS = ['svg', 'Fragment', 'Content', 'slot'] as const;

export type InsertDragChoice =
  { readonly type: 'element'; readonly tag: string } | { readonly type: 'astroAsset'; readonly name: InsertDragAsset } | { readonly type: InsertDragConstruct };

const INSERT_DRAG_CHARS_MAX = 256;

const INSERTABLE_TAGS: ReadonlySet<string> = new Set<string>([...HTML_TAGS, ...INSERT_DRAG_EXTRA_TAGS]);

export function isInsertDragTag(tag: string): boolean {
  return INSERTABLE_TAGS.has(tag);
}

export function insertDragText(choice: InsertDragChoice): string {
  if (choice.type === 'element') {
    assert(isInsertDragTag(choice.tag), 'insertDragText: the tag is one the panel inserts');
  }
  const text = JSON.stringify(choice);
  assert(text.length <= INSERT_DRAG_CHARS_MAX, 'insertDragText: a payload stays within its bound');
  return text;
}

export function parseInsertDrag(raw: string): InsertDragChoice | undefined {
  if (raw.length === 0) {
    return undefined;
  }
  if (raw.length > INSERT_DRAG_CHARS_MAX) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const choice = choiceOf(Reflect.get(parsed, 'type'), Reflect.get(parsed, 'tag'), Reflect.get(parsed, 'name'));
  assert(choice === undefined || choice.type !== 'element' || isInsertDragTag(choice.tag), 'parseInsertDrag: a parsed tag is insertable');
  return choice;
}

function choiceOf(type: unknown, tag: unknown, name: unknown): InsertDragChoice | undefined {
  if (type === 'element') {
    if (name !== undefined) {
      return undefined;
    }
    return typeof tag === 'string' && isInsertDragTag(tag) ? { type: 'element', tag } : undefined;
  }
  if (type === 'astroAsset') {
    if (tag !== undefined) {
      return undefined;
    }
    const asset = INSERT_DRAG_ASSETS.find((candidate) => candidate === name);
    return asset === undefined ? undefined : { type: 'astroAsset', name: asset };
  }
  const construct = INSERT_DRAG_CONSTRUCTS.find((candidate) => candidate === type);
  if (construct === undefined) {
    return undefined;
  }
  if (tag !== undefined) {
    return undefined;
  }
  return name === undefined ? { type: construct } : undefined;
}
