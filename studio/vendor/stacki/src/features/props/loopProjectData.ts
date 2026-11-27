
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { TreeNode } from '../../editor/dataSample';
import { listsOnly } from '../../editor/dataSuggest';
import { ITEM_FIELD, isFieldPath, type LoopFieldKind } from '../../editor/loopQuery';
import type { PickerNode } from './DataPicker';
import { dataFileOfSection, PROJECT_DATA_SECTION } from './dataPickerModel';

export const COMPUTED_LIST_NOTE = 'Set in code';

const PROJECT_FIELDS_MAX = 64;

export interface ProjectListField {
  readonly path: string;
  readonly kind: LoopFieldKind;
}

export function projectDataRows(tree: readonly TreeNode[], modules: Readonly<Record<string, string>>): readonly PickerNode[] {
  assert(tree.length <= LIMITS.treeNodesMax, 'projectDataRows: the tree is bounded');
  const found: { readonly file: string; readonly row: PickerNode }[] = [];
  for (const root of tree) {
    const file = fileOf(root, modules);
    const row = file === undefined ? undefined : rowOf(root);
    if (file !== undefined && row !== undefined) {
      found.push({ file, row });
    }
  }
  const ordered = found
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => (left.file === right.file ? left.index - right.index : left.file < right.file ? -1 : 1));
  const several = new Set(ordered.map((entry) => entry.file)).size > 1;
  const rows = ordered.map((entry) => ({ ...entry.row, section: PROJECT_DATA_SECTION, ...(several ? { detail: entry.file } : {}) }));
  assert(rows.length <= tree.length, 'projectDataRows: a row is a root');
  return rows;
}

export function projectDataNames(tree: readonly TreeNode[], modules: Readonly<Record<string, string>>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const root of tree) {
    if (fileOf(root, modules) !== undefined) {
      names.add(root.path);
    }
  }
  return names;
}

export function nodeAt(tree: readonly TreeNode[] | undefined, name: string): TreeNode | undefined {
  const pending: TreeNode[] = [...(tree ?? [])];
  for (let visited = 0; pending.length > 0 && visited < LIMITS.treeNodesMax; visited++) {
    const node = pending.shift();
    if (node?.path === name) {
      return node;
    }
    if (node?.children !== undefined && name.startsWith(`${node.path}.`)) {
      pending.push(...node.children);
    }
  }
  return undefined;
}

export function treeListFields(tree: readonly TreeNode[] | undefined, name: string): readonly ProjectListField[] | undefined {
  const root = nodeAt(tree, name);
  const first = root?.children?.[0];
  if (first === undefined) {
    return undefined;
  }
  if (first.children === undefined) {
    const kind = fieldKindOf(first.kind);
    return kind === 'other' ? [] : [{ path: ITEM_FIELD, kind }];
  }
  const fields: ProjectListField[] = [];
  for (const child of first.children.slice(0, PROJECT_FIELDS_MAX)) {
    if (isFieldPath(child.key) && !child.key.includes('.') && child.key !== ITEM_FIELD) {
      fields.push({ path: child.key, kind: fieldKindOf(child.kind) });
    }
  }
  assert(fields.length <= PROJECT_FIELDS_MAX, 'treeListFields: the fields are bounded');
  return fields;
}

function fileOf(root: TreeNode, modules: Readonly<Record<string, string>>): string | undefined {
  if (root.importNeed !== undefined) {
    return dataFileOfSection(root.section);
  }
  return Object.prototype.hasOwnProperty.call(modules, root.path) ? modules[root.path] : undefined;
}

function rowOf(root: TreeNode): PickerNode | undefined {
  if (root.kind === 'list' || root.kind === 'imported') {
    return { ...withoutPager(root), children: itemFields(root), pickable: true };
  }
  if (root.kind === 'value' && root.computedList === true) {
    return {
      path: root.path,
      key: root.key,
      kind: 'list',
      preview: '',
      note: COMPUTED_LIST_NOTE,
      unbindable: 'A list computed in code: write it in the loop’s Code field',
      children: undefined,
      pickable: false,
    };
  }
  if (root.kind === 'object') {
    const inside = listsOnly(root.children).filter((node) => node.children !== undefined || node.pickable);
    return inside.length === 0 ? undefined : { ...root, children: inside.map((node) => asPicker(node, 1)), pickable: false };
  }
  return undefined;
}

function withoutPager(root: TreeNode): TreeNode {
  const copy = { ...root };
  delete copy.entryCount;
  return copy;
}

function itemFields(root: TreeNode): readonly PickerNode[] | undefined {
  const first = root.children?.[0];
  if (first?.children === undefined) {
    return undefined;
  }
  return first.children.slice(0, PROJECT_FIELDS_MAX).map((child) => asReadOnly(child, 1));
}

function asReadOnly(node: TreeNode, depth: number): PickerNode {
  assert(depth <= LIMITS.treeDepthMax, 'asReadOnly: depth limit exceeded');
  const { children, ...rest } = node;
  return { ...rest, children: children?.slice(0, PROJECT_FIELDS_MAX).map((child) => asReadOnly(child, depth + 1)), pickable: false };
}

function asPicker(node: TreeNode & { readonly pickable?: boolean }, depth: number): PickerNode {
  assert(depth <= LIMITS.treeDepthMax, 'asPicker: depth limit exceeded');
  const { children, ...rest } = node;
  return { ...rest, children: children?.map((child) => asPicker(child, depth + 1)), pickable: node.pickable === true };
}

function fieldKindOf(kind: string): LoopFieldKind {
  switch (kind) {
    case 'text':
      return 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'list':
      return 'list';
    default:
      return 'other';
  }
}
