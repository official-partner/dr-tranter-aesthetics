
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { TreeView } from './treeView';

export interface DropRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DropPoint {
  readonly x: number;
  readonly y: number;
}

export const DROP_FLOWS = ['block', 'column', 'column-reverse', 'row', 'row-reverse', 'grid', 'wrap'] as const;
export type DropFlow = (typeof DROP_FLOWS)[number];

export interface DropChild {
  readonly id: string;
  readonly index: number;
  readonly box: DropRect;
}

export interface DropLevel {
  readonly id: string | undefined;
  readonly box: DropRect;
  readonly content: DropRect;
  readonly flow: DropFlow;
  readonly children: readonly DropChild[] | undefined;
}

export type DropHosting = 'children' | 'beside' | 'no-slot';

export interface DropTreeNode {
  readonly id: string;
  readonly parentId: string | undefined;
  readonly index: number;
  readonly childCount: number;
  readonly hosting: DropHosting;
  readonly loop: boolean;
}

export interface DropTree {
  readonly node: (id: string) => DropTreeNode | undefined;
  readonly rootCount: number;
}

export type DropMode = 'before' | 'after' | 'into';

export type DropGuide =
  | { readonly kind: 'line'; readonly orientation: 'horizontal' | 'vertical'; readonly x: number; readonly y: number; readonly length: number }
  | { readonly kind: 'empty'; readonly box: DropRect };

export type DropDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'self'; readonly box: DropRect }
  | { readonly kind: 'refused'; readonly reason: 'no-slot'; readonly targetId: string; readonly box: DropRect }
  | {
      readonly kind: 'place';
      readonly parentId: string | undefined;
      readonly index: number;
      readonly mode: DropMode;
      readonly anchorId: string | undefined;
      readonly noop: boolean;
      readonly loop: boolean;
      readonly guide: DropGuide;
      readonly parentBox: DropRect;
    };

export interface DropQuery {
  readonly tree: DropTree;
  readonly draggedId: string | undefined;
  readonly point: DropPoint;
  readonly levels: readonly DropLevel[];
  readonly beside?: ReadonlySet<string> | undefined;
}

export const DROP_EDGE = { fraction: 0.25, pxMin: 4, pxMax: 16 } as const satisfies Record<string, number>;

export function indexDropTree(nodes: readonly TreeView[], hosting: (node: TreeView) => DropHosting): DropTree {
  const byId = new Map<string, DropTreeNode>();
  const stack: { readonly node: TreeView; readonly parentId: string | undefined; readonly index: number; readonly depth: number; readonly loop: boolean }[] =
    nodes.map((node, index) => ({ node, parentId: undefined, index, depth: 0, loop: false }));
  for (let visited = 0; visited < stack.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'indexDropTree: the tree stays inside the node bound');
    const entry = stack[visited];
    assert(entry !== undefined, 'indexDropTree: the visit index lies inside the stack');
    assert(entry.depth <= LIMITS.treeDepthMax, 'indexDropTree: the tree stays inside the depth bound');
    const children = entry.node.children ?? [];
    const loop = entry.loop || entry.node.kind === 'map';
    if (!byId.has(entry.node.id)) {
      byId.set(entry.node.id, {
        id: entry.node.id,
        parentId: entry.parentId,
        index: entry.index,
        childCount: children.length,
        hosting: hosting(entry.node),
        loop,
      });
    }
    for (const [index, child] of children.entries()) {
      stack.push({ node: child, parentId: entry.node.id, index, depth: entry.depth + 1, loop });
    }
  }
  return { node: (id) => byId.get(id), rootCount: nodes.length };
}

export function dropWithin(tree: DropTree, id: string | undefined, ancestorId: string): boolean {
  let current = id;
  for (let depth = 0; depth <= LIMITS.treeDepthMax && current !== undefined; depth++) {
    if (current === ancestorId) {
      return true;
    }
    current = tree.node(current)?.parentId;
  }
  return false;
}

export function decideCanvasDrop(query: DropQuery): DropDecision {
  const { tree, draggedId, point, levels } = query;
  assert(levels.length <= LIMITS.treeDepthMax + 1, 'decideCanvasDrop: the levels stay inside the depth bound');
  assert(Number.isFinite(point.x), 'decideCanvasDrop: the pointer has a finite x');
  assert(Number.isFinite(point.y), 'decideCanvasDrop: the pointer has a finite y');
  let first = 0;
  let selfBox: DropRect | undefined = undefined;
  if (draggedId !== undefined) {
    while (first < levels.length) {
      const level = levels[first];
      assert(level !== undefined, 'decideCanvasDrop: the level index lies inside the levels');
      if (level.id === undefined || !dropWithin(tree, level.id, draggedId)) {
        break;
      }
      selfBox = level.box;
      first += 1;
    }
  }
  if (selfBox !== undefined) {
    return { kind: 'self', box: selfBox };
  }
  const hit = levels[first];
  if (hit === undefined) {
    return { kind: 'none' };
  }
  const parent = levels[first + 1];
  if (hit.id === undefined) {
    return intoLevel(tree, draggedId, hit, point);
  }
  const node = tree.node(hit.id);
  if (node === undefined) {
    return { kind: 'none' };
  }
  const band = parent === undefined ? 0 : edgeBand(hit.box, parent.flow);
  const inMiddle = parent === undefined || withinMiddle(hit.box, point, parent.flow, band);
  const hosting = query.beside?.has(node.id) === true || holdsOnlyText(hit, node) ? 'beside' : node.hosting;
  if (inMiddle) {
    switch (hosting) {
      case 'children':
        return intoLevel(tree, draggedId, hit, point);
      case 'no-slot':
        return { kind: 'refused', reason: 'no-slot', targetId: node.id, box: hit.box };
      case 'beside':
        break;
      default: {
        const exhaustive: never = hosting;
        return exhaustive;
      }
    }
  }
  if (parent === undefined) {
    return { kind: 'none' };
  }
  return besideLevel(tree, draggedId, { id: node.id, index: node.index, box: hit.box }, parent, point);
}

export function guideForPlace(levels: readonly DropLevel[], place: { readonly parentId: string | undefined; readonly index: number }): DropGuide | undefined {
  const level = levels.find((candidate) => candidate.id === place.parentId && candidate.children !== undefined);
  if (level === undefined) {
    return undefined;
  }
  const children = level.children ?? [];
  if (children.length === 0) {
    return { kind: 'empty', box: level.content };
  }
  const after = [...children].reverse().find((child) => child.index < place.index);
  const before = children.find((child) => child.index >= place.index);
  if (before !== undefined) {
    return lineFor(level, before, 'before', children);
  }
  assert(after !== undefined, 'guideForPlace: a level with children has one before or after any index');
  return lineFor(level, after, 'after', children);
}

function holdsOnlyText(level: DropLevel, node: DropTreeNode): boolean {
  if (node.childCount === 0) {
    return false;
  }
  return level.children !== undefined && level.children.length === 0;
}

function intoLevel(tree: DropTree, draggedId: string | undefined, level: DropLevel, point: DropPoint): DropDecision {
  const children = (level.children ?? []).filter((child) => draggedId === undefined || child.id !== draggedId);
  const childCount = level.id === undefined ? tree.rootCount : (tree.node(level.id)?.childCount ?? 0);
  const loop = level.id !== undefined && (tree.node(level.id)?.loop ?? false);
  if (children.length === 0) {
    const index = childCount;
    return {
      kind: 'place',
      parentId: level.id,
      index,
      mode: 'into',
      anchorId: undefined,
      noop: isNoop(tree, draggedId, level.id, index),
      loop,
      guide: { kind: 'empty', box: level.content },
      parentBox: level.box,
    };
  }
  const nearest = nearestGap(children, point, level.flow);
  const index = nearest.mode === 'before' ? nearest.child.index : nearest.child.index + 1;
  assert(index <= childCount, 'intoLevel: a measured child index lies inside its parent');
  return {
    kind: 'place',
    parentId: level.id,
    index,
    mode: 'into',
    anchorId: nearest.child.id,
    noop: isNoop(tree, draggedId, level.id, index),
    loop,
    guide: lineFor(level, nearest.child, nearest.mode, children),
    parentBox: level.box,
  };
}

function besideLevel(tree: DropTree, draggedId: string | undefined, hit: DropChild, parent: DropLevel, point: DropPoint): DropDecision {
  const mode = leadingHalf(hit.box, point, parent.flow) ? 'before' : 'after';
  const index = mode === 'before' ? hit.index : hit.index + 1;
  const siblings = (parent.children ?? [hit]).filter((child) => draggedId === undefined || child.id !== draggedId);
  const loop = parent.id !== undefined && (tree.node(parent.id)?.loop ?? false);
  return {
    kind: 'place',
    parentId: parent.id,
    index,
    mode,
    anchorId: hit.id,
    noop: isNoop(tree, draggedId, parent.id, index),
    loop,
    guide: lineFor(parent, hit, mode, siblings.some((sibling) => sibling.id === hit.id) ? siblings : [...siblings, hit]),
    parentBox: parent.box,
  };
}

function isNoop(tree: DropTree, draggedId: string | undefined, parentId: string | undefined, index: number): boolean {
  if (draggedId === undefined) {
    return false;
  }
  const dragged = tree.node(draggedId);
  if (dragged === undefined) {
    return false;
  }
  if (dragged.parentId !== parentId) {
    return false;
  }
  return index === dragged.index || index === dragged.index + 1;
}

function stacksVertically(flow: DropFlow): boolean {
  return flow === 'block' || flow === 'column' || flow === 'column-reverse';
}

function reversed(flow: DropFlow): boolean {
  return flow === 'column-reverse' || flow === 'row-reverse';
}

export function edgeBand(box: DropRect, flow: DropFlow): number {
  const size = stacksVertically(flow) ? box.h : box.w;
  return Math.min(DROP_EDGE.pxMax, Math.max(DROP_EDGE.pxMin, size * DROP_EDGE.fraction));
}

function withinMiddle(box: DropRect, point: DropPoint, flow: DropFlow, band: number): boolean {
  if (stacksVertically(flow)) {
    return point.y > box.y + band && point.y < box.y + box.h - band;
  }
  return point.x > box.x + band && point.x < box.x + box.w - band;
}

function leadingHalf(box: DropRect, point: DropPoint, flow: DropFlow): boolean {
  let leading: boolean;
  if (stacksVertically(flow)) {
    leading = point.y < box.y + box.h / 2;
  } else if (flow === 'grid' || flow === 'wrap') {
    if (point.y < box.y) {
      leading = true;
    } else if (point.y > box.y + box.h) {
      leading = false;
    } else {
      leading = point.x < box.x + box.w / 2;
    }
  } else {
    leading = point.x < box.x + box.w / 2;
  }
  return reversed(flow) ? !leading : leading;
}

function nearestGap(children: readonly DropChild[], point: DropPoint, flow: DropFlow): { readonly child: DropChild; readonly mode: 'before' | 'after' } {
  assert(children.length > 0, 'nearestGap: there is a child to stand beside');
  if (flow === 'grid' || flow === 'wrap') {
    let best = children[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const child of children) {
      const distance = distanceTo(child.box, point);
      if (distance < bestDistance) {
        best = child;
        bestDistance = distance;
      }
    }
    assert(best !== undefined, 'nearestGap: a nearest child was found');
    return { child: best, mode: leadingHalf(best.box, point, flow) ? 'before' : 'after' };
  }
  const ordered = [...children].sort((left, right) => left.index - right.index);
  for (const child of ordered) {
    if (leadingHalf(child.box, point, flow)) {
      return { child, mode: 'before' };
    }
  }
  const last = ordered.at(-1);
  assert(last !== undefined, 'nearestGap: a list with children has a last one');
  return { child: last, mode: 'after' };
}

function distanceTo(box: DropRect, point: DropPoint): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h));
  return Math.hypot(dx, dy);
}

export function lineFor(level: DropLevel, anchor: DropChild, mode: 'before' | 'after', siblings: readonly DropChild[]): DropGuide {
  const ordered = [...siblings].sort((left, right) => left.index - right.index);
  const at = ordered.findIndex((sibling) => sibling.id === anchor.id);
  assert(at >= 0, 'lineFor: the anchor is among its siblings');
  const neighbour = mode === 'before' ? ordered[at - 1] : ordered[at + 1];
  const box = anchor.box;
  const content = level.content.w > 0 && level.content.h > 0 ? level.content : level.box;
  const leadingEdge = (mode === 'before') !== reversed(level.flow);
  if (stacksVertically(level.flow)) {
    const edge = leadingEdge ? box.y : box.y + box.h;
    const other = neighbour === undefined ? undefined : leadingEdge ? neighbour.box.y + neighbour.box.h : neighbour.box.y;
    const y = other !== undefined && sameSide(edge, other, leadingEdge ? 'leading' : 'trailing') ? (edge + other) / 2 : edge;
    return { kind: 'line', orientation: 'horizontal', x: content.x, y, length: content.w };
  }
  const edge = leadingEdge ? box.x : box.x + box.w;
  const sameRow = neighbour !== undefined && overlapsVertically(neighbour.box, box);
  const other = neighbour === undefined || !sameRow ? undefined : leadingEdge ? neighbour.box.x + neighbour.box.w : neighbour.box.x;
  const x = other !== undefined && sameSide(edge, other, leadingEdge ? 'leading' : 'trailing') ? (edge + other) / 2 : edge;
  if (level.flow === 'grid' || level.flow === 'wrap') {
    return { kind: 'line', orientation: 'vertical', x, y: box.y, length: box.h };
  }
  return { kind: 'line', orientation: 'vertical', x, y: content.y, length: content.h };
}

function sameSide(edge: number, other: number, side: 'leading' | 'trailing'): boolean {
  return side === 'leading' ? other <= edge : other >= edge;
}

function overlapsVertically(left: DropRect, right: DropRect): boolean {
  return left.y < right.y + right.h && right.y < left.y + left.h;
}
