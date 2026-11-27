
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';
import { propText, walkNodes, type HostNode } from './host';

export function parentClassPrefix(nodes: readonly HostNode[], selectedId: string | undefined): string | undefined {
  if (selectedId === undefined) {
    return undefined;
  }
  const parents = new Map<string, HostNode>();
  walkNodes(nodes, (node, parent) => {
    if (parent !== undefined) {
      parents.set(node.id, parent);
    }
  });
  let current = parents.get(selectedId);
  for (let depth = 0; current !== undefined && depth < LIMITS.treeDepthMax; depth++) {
    const classes = current.kind === 'element' ? propText(current, 'class').trim().split(/\s+/).filter(Boolean) : [];
    if (classes.length > 0) {
      return classPrefix(classes);
    }
    current = parents.get(current.id);
  }
  return undefined;
}

export function classPrefix(classes: readonly string[]): string | undefined {
  const named = classes.find((name) => /^-?[A-Za-z_][\w-]*$/.test(name) && name.includes('_'));
  if (named === undefined) {
    return undefined;
  }
  const prefix = `.${named.slice(0, named.lastIndexOf('_') + 1)}`;
  assert(prefix.endsWith('_'), 'classPrefix: the prefix ends at an underscore');
  assert(prefix.length <= named.length + 1, 'classPrefix: the prefix is part of the class');
  return prefix;
}
