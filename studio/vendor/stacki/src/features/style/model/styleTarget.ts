import { rendersOwnElement } from '../../../editor/liveClasses';
import { findNode, type HostNode } from './host';

const LOGIC_KINDS: readonly string[] = ['cond', 'branch', 'map', 'expr'];

export function styleableSelection<T extends { readonly id: string }>(
  model: { readonly nodes: readonly HostNode[] } | undefined,
  selection: T | undefined,
): T | undefined {
  if (selection === undefined) {
    return undefined;
  }
  const node = findNode(model?.nodes, selection.id);
  if (node === undefined) {
    return selection;
  }
  if (LOGIC_KINDS.includes(node.kind)) {
    return undefined;
  }
  return rendersOwnElement(node) ? selection : undefined;
}
