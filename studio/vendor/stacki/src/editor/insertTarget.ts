import { assert } from '../../shared/core/assert';
import { findWithParent } from './treeSelection';
import type { TreeView } from './treeView';
import { LIMITS } from '../../shared/core/limits';
import { thenBranch } from './branches';
interface Insertable {
  readonly name: string;
  readonly slots?: readonly string[];
  readonly renderTag?: { readonly tag?: string | undefined; readonly prop?: string | undefined } | undefined;
}
interface InsertItem {
  readonly type: string;
  readonly tag?: string;
  readonly name?: string;
}
export interface InsertTarget {
  readonly parentId: string | undefined;
  readonly index: number;
}
import { canContainTag, VOID_TAGS } from './elementSchemas';


export function tagOfComponent(component: Insertable | undefined, node?: TreeView | undefined): string | undefined {
  const renderTag = component?.renderTag;
  if (!renderTag) {
    return undefined;
  }
  if (renderTag.prop && node) {
    const set = node.props?.[renderTag.prop];
    const value = set && set.type !== 'expr' ? String(set.value || '') : '';
    if (value) {
      return value.toLowerCase();
    }
  }
  return renderTag.tag || undefined;
}

const findNode = (nodes: readonly TreeView[], id: string): TreeView | undefined => findWithParent(nodes, id)?.node;
const findParentOf = (nodes: readonly TreeView[], id: string): InsertTarget | undefined => {
  const found = findWithParent(nodes, id);
  return found ? { parentId: found.parent?.id, index: found.index } : undefined;
};

export function acceptsChildren(node: TreeView, childTag: string | undefined, insertables: readonly Insertable[] | undefined): boolean {
  if (node.id === 'layout') {
    return true;
  }
  if (node.kind === 'element') {
    const tag = String(node.name).toLowerCase();
    if (VOID_TAGS.has(tag)) {
      return false;
    }
    return childTag ? canContainTag(tag, childTag) : true;
  }
  if (node.kind === 'map' || node.kind === 'chunk-group' || node.kind === 'branch') {
    return node.bodyParts === undefined;
  }
  if (node.kind === 'component') {
    const component = (insertables || []).find((candidate) => candidate.name === node.name);
    if (!(component?.slots || []).includes('default')) {
      return false;
    }
    const tag = tagOfComponent(component, node);
    return tag && childTag ? canContainTag(tag, childTag) : true;
  }
  return false;
}

export function insertTargetFor(
  model: { readonly nodes: readonly TreeView[] },
  selectedId: string | undefined,
  item: InsertItem | undefined,
  insertables: readonly Insertable[] | undefined,
): InsertTarget {
  const childTag =
    item && item.type === 'element'
      ? item.tag
      : item && item.type === 'component'
        ? tagOfComponent((insertables || []).find((candidate) => candidate.name === item.name))
        : undefined;
  const accepts = (node: TreeView) => acceptsChildren(node, childTag, insertables);
  if (selectedId && selectedId !== 'frontmatter') {
    const selected = findNode(model.nodes, selectedId);
    const host = selected?.kind === 'cond' ? thenBranch(selected) : selected;
    if (host && accepts(host)) {
      return { parentId: host.id, index: host.children?.length ?? 0 };
    }
    let childId = selectedId;
    for (let depth = 0; depth < LIMITS.treeDepthMax; depth++) {
      const place = findParentOf(model.nodes, childId);
      if (!place) {
        break;
      }
      if (place.parentId === undefined) {
        return { parentId: undefined, index: place.index + 1 };
      }
      const parent = findNode(model.nodes, place.parentId);
      if (!parent || accepts(parent)) {
        return { parentId: place.parentId, index: place.index + 1 };
      }
      childId = place.parentId;
    }
  }
  return { parentId: undefined, index: model.nodes.length };
}

export interface AnchoredInsert {
  readonly position: 'before' | 'after' | 'inside' | 'replace';
  readonly anchorId: string;
  readonly index: number | undefined;
}

export function anchoredInsertTarget(
  model: { readonly nodes: readonly TreeView[] },
  insert: AnchoredInsert,
  item: InsertItem,
  insertables: readonly Insertable[] | undefined,
): { readonly kind: 'placed'; readonly target: InsertTarget } | { readonly kind: 'refused'; readonly reason: string } {
  assert(insert.index === undefined || insert.position === 'inside', 'Only an insert inside its anchor takes an index');
  const childTag = item.type === 'element' ? item.tag : tagOfComponent((insertables ?? []).find((candidate) => candidate.name === item.name));
  const found = insert.anchorId === 'frontmatter' ? undefined : findWithParent(model.nodes, insert.anchorId);
  if (found === undefined) {
    return { kind: 'refused', reason: 'No element has that id on the open page' };
  }
  if (insert.position === 'inside') {
    if (!acceptsChildren(found.node, childTag, insertables)) {
      return { kind: 'refused', reason: `That ${found.node.kind} cannot hold ${childTag === undefined ? 'this node' : `a <${childTag}>`}` };
    }
    const count = found.node.children?.length ?? 0;
    const index = insert.index ?? count;
    if (index <= count) {
      return { kind: 'placed', target: { parentId: found.node.id, index } };
    }
    return { kind: 'refused', reason: `index is past the anchor's ${count} children` };
  }
  if (found.node.id === 'layout' || found.node.kind === 'branch' || found.node.kind === 'chunk-group') {
    return { kind: 'refused', reason: `A new node cannot go ${insert.position === 'replace' ? 'in place of' : insert.position} that ${found.node.kind}` };
  }
  if (found.parent !== undefined) {
    if (!acceptsChildren(found.parent, childTag, insertables)) {
      return { kind: 'refused', reason: `The anchor's parent cannot hold ${childTag === undefined ? 'this node' : `a <${childTag}>`}` };
    }
  }
  const index = insert.position === 'after' ? found.index + 1 : found.index;
  assert(index <= found.siblings.length, 'A place beside the anchor is within its list');
  return { kind: 'placed', target: { parentId: found.parent?.id, index } };
}
