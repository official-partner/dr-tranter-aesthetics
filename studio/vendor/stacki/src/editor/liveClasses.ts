import { assert } from '../../shared/core/assert';
import type { PageNode } from '../../shared/page/pageNode';
import { LIMITS } from '../../shared/core/limits';
import { treeBudget, type TreeView } from './treeView';

export function isFragmentNode(node: PageNode): boolean {
  return (node.kind === 'component' || node.kind === 'element') && node.name === 'Fragment';
}

export function rendersOwnElement(node: { readonly name?: string } | undefined): boolean {
  if (!node) {
    return false;
  }
  return node.name !== 'Fragment' && node.name !== 'slot';
}

export function liveClassesById(
  classesByPath: Readonly<Record<string, readonly string[]>>,
  nodes: readonly TreeView[] | undefined,
  prefix = '',
): ReadonlyMap<string, readonly string[]> {
  const byId = new Map<string, readonly string[]>();
  const visit = treeBudget();
  const walk = (list: readonly TreeView[] | undefined, trail: readonly number[]): void => {
    const depth = trail.length;
    for (const [i, node] of (list || []).entries()) {
      visit(depth);
      assert(depth <= LIMITS.treeDepthMax, 'liveClassesById: depth limit');
      const path = [...trail, i];
      const hit = classesByPath[prefix + path.join('.')];
      if (hit && hit.length && rendersOwnElement(node)) {
        byId.set(node.id, hit);
      }
      if (node.children !== undefined) {
        walk(node.children, path);
      }
    }
  };
  walk(nodes, []);
  return byId;
}

export default rendersOwnElement;
