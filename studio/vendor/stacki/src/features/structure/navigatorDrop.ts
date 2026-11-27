import { LIMITS } from '../../../shared/core/limits';
import { thenBranch } from '../../editor/branches';
import { findNavigatorNode, type DropTarget, type NavigatorNode } from './structureModel';
import { assert } from '../../../shared/core/assert';
import type { NavigatorDropShown } from '../../editor/canvasDragSession';
import { INSERT_DRAG_TYPE, parseInsertDrag, type InsertDragChoice } from '../../editor/insertDragData';

export type NavigatorDrop =
  | { readonly kind: 'component'; readonly name: string; readonly path?: string }
  | { readonly kind: 'insert'; readonly choice: InsertDragChoice }
  | { readonly kind: 'node'; readonly id: string };

export function parseNavigatorDrop(read: (type: string) => string): NavigatorDrop | undefined {
  const name = read('avb/component');
  if (name !== '') {
    const path = read('avb/component-path');
    if (name.length > LIMITS.tagNameCharsMax || path.length > LIMITS.ipcPathCharsMax || path.includes('\0')) {
      return undefined;
    }
    return { kind: 'component', name, ...(path === '' ? {} : { path }) };
  }
  const insert = read(INSERT_DRAG_TYPE);
  if (insert !== '') {
    const choice = parseInsertDrag(insert);
    return choice === undefined ? undefined : { kind: 'insert', choice };
  }
  const id = read('avb/node');
  if (id !== '') {
    return id.length <= LIMITS.tagNameCharsMax ? { kind: 'node', id } : undefined;
  }
  return undefined;
}

export function navigatorHostsDrop(node: NavigatorNode): boolean {
  switch (node.kind) {
    case 'component':
    case 'element':
    case 'chunk-group':
    case 'branch':
      return true;
    case 'map':
      return node.bodyParts === undefined;
    case 'cond':
      return thenBranch(node) !== undefined;
    case 'text':
    case 'expr':
    case 'raw':
    case 'raw-line':
    case 'comment':
      return false;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export function navigatorDropOf(nodes: readonly NavigatorNode[], target: DropTarget): NavigatorDropShown | undefined {
  const parentId = target.kind === 'gap' ? target.parentId : target.intoId;
  const parent = parentId === undefined ? undefined : findNavigatorNode(nodes, parentId);
  const siblings: readonly NavigatorNode[] | undefined =
    parentId === undefined ? nodes : parent !== undefined && 'children' in parent ? (parent.children ?? []) : undefined;
  if (siblings === undefined) {
    return undefined;
  }
  const index = target.kind === 'gap' ? target.index : siblings.length;
  assert(index >= 0, 'navigatorDropOf: a drop index is not negative');
  const neighbours = [index - 1, index].flatMap((at) => {
    const sibling = siblings[at];
    return sibling === undefined ? [] : [{ id: sibling.id, index: at }];
  });
  return { parentId, index, neighbours };
}
