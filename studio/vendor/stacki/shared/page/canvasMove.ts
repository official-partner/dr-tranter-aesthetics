
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import { labelsNode } from './leadingNote';

export type CanvasMoveAnchorPlacement = 'before' | 'after';

export interface CanvasMove {
  readonly scope: string;
  readonly from: readonly number[];
  readonly count: number;
  readonly parent: readonly number[];
  readonly index: number;
  readonly anchor: { readonly path: readonly number[]; readonly placement: CanvasMoveAnchorPlacement };
}

export interface CanvasMoveNode {
  readonly id?: string | undefined;
  readonly kind: string;
  readonly children?: readonly CanvasMoveNode[] | undefined;
}

export interface CanvasMoveDrop {
  readonly parentId: string | undefined;
  readonly index: number;
}

export const CANVAS_MOVE_LIMITS = {
  scopeCharsMax: 1_000,
  countMax: 2,
} as const satisfies Record<string, number>;

const PLACED_KINDS: ReadonlySet<string> = new Set(['element', 'component']);

const NODE_PATH = /^\d+(\.\d+)*$/;

export function planCanvasMove(
  roots: readonly CanvasMoveNode[],
  nodeId: string,
  drop: CanvasMoveDrop,
  pathOf: (id: string) => string | undefined,
): CanvasMove | undefined {
  assert(Number.isSafeInteger(drop.index), 'planCanvasMove: a drop index is an integer');
  assert(drop.index >= 0, 'planCanvasMove: a drop index is not negative');
  const found = findEntry(roots, nodeId);
  if (found === undefined || !PLACED_KINDS.has(found.node.kind)) {
    return undefined;
  }
  const destination = drop.parentId === undefined ? { list: roots, node: undefined } : destinationOf(roots, drop.parentId);
  if (destination === undefined) {
    return undefined;
  }
  const destinationId = destination.node?.id;
  if (destinationId !== undefined && containsNode(found.node, destinationId)) {
    return undefined;
  }
  const previous = found.list[found.index - 1];
  const count = previous !== undefined && labelsNode(previous.kind, found.node.kind) ? 2 : 1;
  const nodePath = splitCanvasPath(pathOf(nodeId));
  const parentPath =
    destination.node === undefined
      ? { scope: nodePath?.scope ?? '', trail: [] }
      : splitCanvasPath(destinationId === undefined ? undefined : pathOf(destinationId));
  if (nodePath === undefined || parentPath === undefined || parentPath.scope !== nodePath.scope) {
    return undefined;
  }
  const lastIndex = nodePath.trail.at(-1);
  assert(lastIndex === found.index, 'planCanvasMove: a node path ends at its index in its list');
  const from = [...nodePath.trail.slice(0, -1), found.index - (count - 1)];
  const blockStart = found.index - (count - 1);
  const sameList = destination.list === found.list;
  if (sameList && drop.index >= blockStart && drop.index <= found.index + 1) {
    return undefined;
  }
  const anchor = anchorBeside(destination.list, drop.index, sameList ? { start: blockStart, end: found.index + 1 } : undefined);
  if (anchor === undefined) {
    return undefined;
  }
  const move: CanvasMove = {
    scope: nodePath.scope,
    from,
    count,
    parent: parentPath.trail,
    index: Math.min(drop.index, destination.list.length),
    anchor: { path: [...parentPath.trail, anchor.index], placement: anchor.placement },
  };
  assert(move.from.length > 0, 'planCanvasMove: a moved node has a path');
  assert(!isWithin(move.parent, movedRange(move)), 'planCanvasMove: a node never lands inside itself');
  return move;
}

export function canvasMoveNodePath(move: CanvasMove): readonly number[] {
  const last = move.from.at(-1);
  assert(last !== undefined, 'canvasMoveNodePath: a move has a path');
  return [...move.from.slice(0, -1), last + move.count - 1];
}

export function renumberedTrail(path: readonly number[], move: CanvasMove): readonly number[] {
  const range = movedRange(move);
  const sourceParent = move.from.slice(0, -1);
  const landingParent = removalShifted(move.parent, range);
  const landingIndex = landingIndexOf(move);
  if (isWithinRange(path, range)) {
    const offset = (path[sourceParent.length] ?? 0) - range.start;
    assert(offset >= 0, 'renumberedTrail: a moved path sits inside the block');
    assert(offset < move.count, 'renumberedTrail: a moved path sits inside the block');
    return [...landingParent, landingIndex + offset, ...path.slice(sourceParent.length + 1)];
  }
  const removed = removalShifted(path, range);
  if (hasChildPrefix(removed, landingParent)) {
    const at = landingParent.length;
    const index = removed[at] ?? 0;
    if (index >= landingIndex) {
      return [...removed.slice(0, at), index + move.count, ...removed.slice(at + 1)];
    }
  }
  return removed;
}

export function renumberedCanvasPath(token: string, move: CanvasMove): string {
  if (!token.startsWith(move.scope)) {
    return token;
  }
  const local = token.slice(move.scope.length);
  if (!NODE_PATH.test(local)) {
    return token;
  }
  const trail = local.split('.').map(Number);
  const renumbered = renumberedTrail(trail, move);
  assert(renumbered.length > 0, 'renumberedCanvasPath: a path still names a node');
  assert(
    renumbered.every((index) => Number.isSafeInteger(index) && index >= 0),
    'renumberedCanvasPath: indexes stay natural numbers',
  );
  return move.scope + renumbered.join('.');
}

export function movedTree<Node extends { readonly children?: readonly Node[] | undefined }>(
  roots: readonly Node[],
  move: Pick<CanvasMove, 'from' | 'count' | 'parent' | 'index'>,
  withChildren: (node: Node, children: readonly Node[]) => Node,
): readonly Node[] | undefined {
  const sourceParent = move.from.slice(0, -1);
  const start = move.from.at(-1);
  assert(start !== undefined, 'movedTree: a move has a path');
  const sourceList = listAt(roots, sourceParent);
  const block = sourceList?.slice(start, start + move.count);
  if (sourceList === undefined || block === undefined || block.length !== move.count) {
    return undefined;
  }
  const removedRoots = replacedList(roots, sourceParent, [...sourceList.slice(0, start), ...sourceList.slice(start + move.count)], withChildren);
  const landingParent = removalShifted(move.parent, { parent: sourceParent, start, end: start + move.count });
  const landingList = removedRoots === undefined ? undefined : listAt(removedRoots, landingParent);
  if (removedRoots === undefined || landingList === undefined) {
    return undefined;
  }
  const at = Math.min(landingIndexOf(move), landingList.length);
  const moved = replacedList(removedRoots, landingParent, [...landingList.slice(0, at), ...block, ...landingList.slice(at)], withChildren);
  assert(moved === undefined || countNodes(moved) === countNodes(roots), 'movedTree: a move neither adds nor drops a node');
  return moved;
}

export function parseCanvasMove(input: unknown): CanvasMove | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(input));
  const scope = record['scope'];
  const count = record['count'];
  const index = record['index'];
  const from = trailOf(record['from']);
  const parent = trailOf(record['parent']);
  const anchor = anchorOf(record['anchor']);
  if (typeof scope !== 'string' || scope.length > CANVAS_MOVE_LIMITS.scopeCharsMax || (scope !== '' && !scope.endsWith('|'))) {
    return undefined;
  }
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > CANVAS_MOVE_LIMITS.countMax) {
    return undefined;
  }
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > LIMITS.treeNodesMax) {
    return undefined;
  }
  if (from === undefined || from.length === 0 || parent === undefined || anchor === undefined) {
    return undefined;
  }
  const move: CanvasMove = { scope, from, count, parent, index, anchor };
  if (isWithin(move.parent, movedRange(move))) {
    return undefined;
  }
  return move;
}


interface Range {
  readonly parent: readonly number[];
  readonly start: number;
  readonly end: number;
}

function movedRange(move: Pick<CanvasMove, 'from' | 'count'>): Range {
  const start = move.from.at(-1);
  assert(start !== undefined, 'movedRange: a move has a path');
  return { parent: move.from.slice(0, -1), start, end: start + move.count };
}

function landingIndexOf(move: Pick<CanvasMove, 'from' | 'count' | 'parent' | 'index'>): number {
  const range = movedRange(move);
  const sameList = samePath(range.parent, move.parent);
  if (sameList && move.index > range.start) {
    return Math.max(range.start, move.index - move.count);
  }
  return move.index;
}

function removalShifted(path: readonly number[], range: Range): readonly number[] {
  if (!hasChildPrefix(path, range.parent)) {
    return path;
  }
  const at = range.parent.length;
  const index = path[at] ?? 0;
  if (index < range.end) {
    return path;
  }
  return [...path.slice(0, at), index - (range.end - range.start), ...path.slice(at + 1)];
}

function isWithinRange(path: readonly number[], range: Range): boolean {
  if (!hasChildPrefix(path, range.parent)) {
    return false;
  }
  const index = path[range.parent.length] ?? -1;
  return index >= range.start && index < range.end;
}

const isWithin = (path: readonly number[], range: Range): boolean => isWithinRange(path, range);

function hasChildPrefix(path: readonly number[], prefix: readonly number[]): boolean {
  if (path.length <= prefix.length) {
    return false;
  }
  for (let index = 0; index < prefix.length; index++) {
    if (path[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

function samePath(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function anchorBeside(
  list: readonly CanvasMoveNode[],
  gap: number,
  block: { readonly start: number; readonly end: number } | undefined,
): { readonly index: number; readonly placement: CanvasMoveAnchorPlacement } | undefined {
  const skipped = (index: number): boolean => {
    if (block !== undefined) {
      if (index >= block.start) {
        if (index < block.end) {
          return true;
        }
      }
    }
    return list[index]?.kind === 'comment';
  };
  for (let index = Math.min(gap, list.length); index < list.length; index++) {
    if (!skipped(index)) {
      return PLACED_KINDS.has(list[index]?.kind ?? '') ? { index, placement: 'before' } : beforeGap(list, gap, skipped);
    }
  }
  return beforeGap(list, gap, skipped);
}

function beforeGap(
  list: readonly CanvasMoveNode[],
  gap: number,
  skipped: (index: number) => boolean,
): { readonly index: number; readonly placement: CanvasMoveAnchorPlacement } | undefined {
  for (let index = Math.min(gap, list.length) - 1; index >= 0; index--) {
    if (!skipped(index)) {
      return PLACED_KINDS.has(list[index]?.kind ?? '') ? { index, placement: 'after' } : undefined;
    }
  }
  return undefined;
}

export function renumberedDeletePath(token: string, deleted: string): string {
  const target = splitCanvasPath(deleted);
  assert(target !== undefined, 'renumberedDeletePath: the deleted node has a path');
  assert(target.trail.length > 0, 'renumberedDeletePath: the deleted node has a place in a list');
  if (!token.startsWith(target.scope)) {
    return token;
  }
  const local = token.slice(target.scope.length);
  if (!NODE_PATH.test(local)) {
    return token;
  }
  const trail = local.split('.').map(Number);
  const at = target.trail.length - 1;
  if (trail.length <= at) {
    return token;
  }
  for (let step = 0; step < at; step++) {
    if (trail[step] !== target.trail[step]) {
      return token;
    }
  }
  const index = trail[at] ?? 0;
  const deletedIndex = target.trail[at] ?? 0;
  if (index <= deletedIndex) {
    return token;
  }
  const renumbered = [...trail.slice(0, at), index - 1, ...trail.slice(at + 1)];
  assert(
    renumbered.every((step) => Number.isSafeInteger(step) && step >= 0),
    'renumberedDeletePath: indexes stay natural numbers',
  );
  return target.scope + renumbered.join('.');
}

function splitCanvasPath(path: string | undefined): { readonly scope: string; readonly trail: readonly number[] } | undefined {
  if (path === undefined) {
    return undefined;
  }
  const bar = path.lastIndexOf('|');
  const scope = bar < 0 ? '' : path.slice(0, bar + 1);
  const local = path.slice(bar + 1);
  if (!NODE_PATH.test(local)) {
    return undefined;
  }
  return { scope, trail: local.split('.').map(Number) };
}

function findEntry(
  roots: readonly CanvasMoveNode[],
  nodeId: string,
): { readonly list: readonly CanvasMoveNode[]; readonly index: number; readonly node: CanvasMoveNode } | undefined {
  const pending: (readonly CanvasMoveNode[])[] = [roots];
  for (let visited = 0; visited < pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'findEntry: a tree stays inside its node bound');
    const list = pending[visited];
    assert(list !== undefined, 'findEntry: the visit index lies inside the queue');
    for (const [index, node] of list.entries()) {
      if (node.id === nodeId) {
        return { list, index, node };
      }
      if (node.children !== undefined) {
        pending.push(node.children);
      }
    }
  }
  return undefined;
}

function destinationOf(
  roots: readonly CanvasMoveNode[],
  parentId: string,
): { readonly list: readonly CanvasMoveNode[]; readonly node: CanvasMoveNode } | undefined {
  const found = findEntry(roots, parentId);
  if (found === undefined) {
    return undefined;
  }
  return { list: found.node.children ?? [], node: found.node };
}

function containsNode(node: CanvasMoveNode, id: string): boolean {
  if (node.id === id) {
    return true;
  }
  const pending: CanvasMoveNode[] = [...(node.children ?? [])];
  for (let visited = 0; visited < pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'containsNode: a tree stays inside its node bound');
    const current = pending[visited];
    if (current?.id === id) {
      return true;
    }
    pending.push(...(current?.children ?? []));
  }
  return false;
}

function listAt<Node extends { readonly children?: readonly Node[] | undefined }>(
  roots: readonly Node[],
  parent: readonly number[],
): readonly Node[] | undefined {
  assert(parent.length <= LIMITS.treeDepthMax, 'listAt: a path stays inside the depth bound');
  let list: readonly Node[] | undefined = roots;
  for (const index of parent) {
    list = list?.[index]?.children;
  }
  return list;
}

function replacedList<Node extends { readonly children?: readonly Node[] | undefined }>(
  roots: readonly Node[],
  parent: readonly number[],
  list: readonly Node[],
  withChildren: (node: Node, children: readonly Node[]) => Node,
): readonly Node[] | undefined {
  assert(parent.length <= LIMITS.treeDepthMax, 'replacedList: a path stays inside the depth bound');
  const chain: { readonly list: readonly Node[]; readonly index: number }[] = [];
  let current: readonly Node[] = roots;
  for (const index of parent) {
    const node = current[index];
    if (node?.children === undefined) {
      return undefined;
    }
    chain.push({ list: current, index });
    current = node.children;
  }
  let replaced = list;
  for (let level = chain.length - 1; level >= 0; level--) {
    const step = chain[level];
    assert(step !== undefined, 'replacedList: every level of the chain was recorded');
    const owner = step.list[step.index];
    assert(owner !== undefined, 'replacedList: the chain names existing nodes');
    replaced = step.list.map((node, index) => (index === step.index ? withChildren(owner, replaced) : node));
  }
  return replaced;
}

function countNodes<Node extends { readonly children?: readonly Node[] | undefined }>(roots: readonly Node[]): number {
  const pending: Node[] = [...roots];
  for (let visited = 0; visited < pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'countNodes: a tree stays inside its node bound');
    pending.push(...(pending[visited]?.children ?? []));
  }
  return pending.length;
}

function trailOf(input: unknown): readonly number[] | undefined {
  if (!Array.isArray(input) || input.length > LIMITS.treeDepthMax) {
    return undefined;
  }
  const trail: number[] = [];
  for (const value of input) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > LIMITS.treeNodesMax) {
      return undefined;
    }
    trail.push(value);
  }
  return trail;
}

function anchorOf(input: unknown): CanvasMove['anchor'] | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(input));
  const path = trailOf(record['path']);
  const placement = record['placement'];
  if (path === undefined || path.length === 0) {
    return undefined;
  }
  if (placement === 'before' || placement === 'after') {
    return { path, placement };
  }
  return undefined;
}
