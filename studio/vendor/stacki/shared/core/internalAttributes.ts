import { assert } from './assert';

export const NODE_KEY_ATTRIBUTE = 'data-stacki-key';

export const INTERNAL_ATTRIBUTES: ReadonlySet<string> = new Set([NODE_KEY_ATTRIBUTE]);

export function isInternalAttribute(name: string): boolean {
  assert(typeof name === 'string', 'isInternalAttribute: the name is a string');
  return INTERNAL_ATTRIBUTES.has(name.toLowerCase());
}

export function visibleAttributeNames(names: readonly string[]): readonly string[] {
  const visible = names.filter((name) => !isInternalAttribute(name));
  assert(visible.length <= names.length, 'visibleAttributeNames: filtering only removes');
  return visible;
}
