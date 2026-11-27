import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { labelsNode } from '../../shared/page/leadingNote';
import { treeBudget, type TreeView } from './treeView';

export function isContentOnlyChild(child: TreeView): boolean {
  return child.kind === 'text' || (child.kind === 'expr' && /^\{[^{}]*\}$/.test(child.value ?? '') && !(child.value ?? '').includes('<'));
}

export function hidesChildRows(node: TreeView | undefined, kids: readonly TreeView[]): boolean {
  const covered = node?.kind === 'element' || node?.kind === 'component';
  return covered && kids.length > 0 && kids.every(isContentOnlyChild);
}

const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'sup', 'sub', 'code', 'a', 'span', 'br', 'small', 'mark', 'u', 's']);

export function isInlineRun(nodes: readonly TreeView[] | undefined): boolean {
  return isInlineRunWalk(nodes, 0, treeBudget());
}

function isInlineRunWalk(nodes: readonly TreeView[] | undefined, depth: number, visit: (depth: number) => void): boolean {
  assert(depth <= LIMITS.treeDepthMax, 'Tree traversal exceeds depth limit');
  if (!nodes?.length) {
    return false;
  }
  return nodes.every((node) => {
    visit(depth);
    if (isContentOnlyChild(node)) {
      return true;
    }
    if (node.kind !== 'element') {
      return false;
    }
    if (!INLINE_TAGS.has(String(node.name).toLowerCase())) {
      return false;
    }
    if (!node.children?.length) {
      return true;
    }
    return isInlineRunWalk(node.children, depth + 1, visit);
  });
}

export function noteIndexAbove(list: readonly TreeView[], index: number): number {
  const previous = index > 0 ? list[index - 1] : undefined;
  const node = list[index];
  if (previous === undefined || node === undefined) {
    return -1;
  }
  return labelsNode(previous.kind, node.kind) ? index - 1 : -1;
}

export function findWithParent(nodes: readonly TreeView[], id: string, parent?: TreeView): FoundNode | undefined {
  return findWithParentWalk(nodes, id, parent, 0, treeBudget());
}

interface FoundNode {
  readonly node: TreeView;
  readonly parent: TreeView | undefined;
  readonly siblings: readonly TreeView[];
  readonly index: number;
}
function findWithParentWalk(
  nodes: readonly TreeView[],
  id: string,
  parent: TreeView | undefined,
  depth: number,
  visit: (depth: number) => void,
): FoundNode | undefined {
  assert(depth <= LIMITS.treeDepthMax, 'Tree traversal exceeds depth limit');
  for (const [i, node] of nodes.entries()) {
    visit(depth);
    if (node.id === id) {
      return { node, parent, siblings: nodes, index: i };
    }
    if (node.children !== undefined) {
      const found = findWithParentWalk(node.children, id, node, depth + 1, visit);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

export function selectionAfterDelete(model: { readonly nodes: readonly TreeView[] }, nodeId: string): string | undefined {
  const found = findWithParent(model.nodes, nodeId);
  if (!found) {
    return undefined;
  }
  const { parent, siblings, index } = found;
  const gone = new Set([index]);
  const noteAt = noteIndexAbove(siblings, index);
  if (noteAt !== -1) {
    gone.add(noteAt);
  }
  const rest = siblings.filter((_, i) => !gone.has(i));
  if (!rest.length) {
    return parent ? parent.id : undefined;
  }
  if (rest.every(isContentOnlyChild)) {
    return parent ? parent.id : undefined;
  }
  const at = siblings.slice(0, index).filter((_, i) => !gone.has(i)).length;
  const folded = (i: number): boolean => {
    const node = rest[i];
    assert(node !== undefined, 'Selection index must name a surviving node');
    const next = rest[i + 1];
    return isContentOnlyChild(node) || (next !== undefined && labelsNode(node.kind, next.kind));
  };
  for (let i = at; i < rest.length; i++) {
    if (!folded(i)) {
      return rest[i]?.id ?? undefined;
    }
  }
  for (let i = at - 1; i >= 0; i--) {
    if (!folded(i)) {
      return rest[i]?.id ?? undefined;
    }
  }
  return parent ? parent.id : undefined;
}

const RULE = /^\s*([-=*_])\1{2,}\s*/;
const RULE_END = /\s*([-=*_])\1{2,}\s*$/;

export function noteText(raw: unknown): string {
  const full = String(raw ?? '').trim();
  const label = full.replace(RULE, '').replace(RULE_END, '').trim();
  return label || full;
}

export function noteValue(previous: unknown, text: unknown): string | undefined {
  const body = String(text ?? '').trim();
  if (!body) {
    return undefined;
  }
  const full = String(previous ?? '').trim();
  const lead = full.match(RULE);
  if (!lead) {
    return ` ${body} `;
  }
  const rule = lead[1];
  assert(rule !== undefined, 'Divider pattern must capture its character');
  const width = Math.max(3, full.length - body.length - 1);
  return ` ${rule.repeat(width)} ${body} `;
}
