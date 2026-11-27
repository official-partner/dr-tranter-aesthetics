import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly hidden?: boolean;
}
interface Occurrence {
  readonly path?: string | undefined;
  readonly occ?: number | undefined;
}


const SLACK = 1;

const covers = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x - SLACK && inner.y >= outer.y - SLACK && inner.x + inner.w <= outer.x + outer.w + SLACK && inner.y + inner.h <= outer.y + outer.h + SLACK;

export function onePerPlace<T extends Box>(boxes: readonly T[] | undefined): readonly T[] {
  assert((boxes?.length ?? 0) <= LIMITS.treeNodesMax, 'Outline box count exceeds limit');
  const present = (boxes || []).filter((box) => box && box.hidden !== true);
  const sized = present.filter((box) => box.w > 0 && box.h > 0);
  const list = sized.length > 0 ? sized : present;
  const order = [...list].sort((left, right) => right.w * right.h - left.w * left.h);
  const index = createKeeperIndex(list);
  const kept = new Set<T>();
  for (const box of order) {
    if (!index.candidates(box).some((keeper) => covers(keeper, box))) {
      kept.add(box);
      index.add(box);
    }
  }
  const drawn = list.filter((box) => kept.has(box));
  assert(drawn.length <= list.length, 'onePerPlace: never draws more boxes than were reported');
  return drawn;
}

const KEEPER_CELLS_MAX = 16;

function createKeeperIndex<T extends Box>(boxes: readonly T[]): { readonly add: (box: T) => void; readonly candidates: (box: T) => readonly T[] } {
  const sizes = boxes.map((box) => Math.max(box.w, box.h)).sort((left, right) => left - right);
  const cellPx = Math.max(sizes[Math.floor(sizes.length / 2)] ?? 1, 1);
  assert(Number.isFinite(cellPx), 'onePerPlace: a grid cell has a finite size');
  const cells = new Map<string, T[]>();
  const wide: T[] = [];
  const cellOf = (value: number): number => Math.floor(value / cellPx);
  return {
    add(box) {
      const left = cellOf(box.x - SLACK);
      const right = cellOf(box.x + box.w + SLACK);
      const top = cellOf(box.y - SLACK);
      const bottom = cellOf(box.y + box.h + SLACK);
      if ((right - left + 1) * (bottom - top + 1) > KEEPER_CELLS_MAX) {
        wide.push(box);
        return;
      }
      for (let column = left; column <= right; column++) {
        for (let row = top; row <= bottom; row++) {
          const key = `${column}:${row}`;
          const cell = cells.get(key);
          if (cell === undefined) {
            cells.set(key, [box]);
          } else {
            cell.push(box);
          }
        }
      }
    },
    candidates(box) {
      const near = cells.get(`${cellOf(box.x)}:${cellOf(box.y)}`) ?? [];
      return wide.length === 0 ? near : [...near, ...wide];
    },
  };
}

const COLLAPSED_PX = 1;

export type CollapseKind = 'none' | 'flat' | 'point';

export function collapseKind(box: Box): CollapseKind {
  assert(Number.isFinite(box.w), 'collapseKind: a box has a finite width');
  assert(Number.isFinite(box.h), 'collapseKind: a box has a finite height');
  const flatWide = box.w < COLLAPSED_PX;
  const flatTall = box.h < COLLAPSED_PX;
  if (flatWide) {
    return flatTall ? 'point' : 'flat';
  }
  return flatTall ? 'flat' : 'none';
}

export function copiesToDraw<T extends Box>(all: readonly T[], occurrence: number | undefined): readonly T[] {
  assert(all.length <= LIMITS.treeNodesMax, 'copiesToDraw: box count exceeds limit');
  if (occurrence === undefined) {
    return onePerPlace(all);
  }
  assert(Number.isSafeInteger(occurrence), 'copiesToDraw: an occurrence is a whole number');
  assert(occurrence >= 0, 'copiesToDraw: an occurrence is not negative');
  const selected = all[occurrence] ?? all[0];
  return selected === undefined || selected.hidden === true ? [] : [selected];
}

export function outlineBoxPath(path: string, nodeKind: string | undefined): string {
  assert(path.length > 0, 'outlineBoxPath: path must not be empty');
  if (nodeKind !== 'map') {
    return path;
  }
  const childPath = `${path}.0`;
  assert(childPath.startsWith(path), 'outlineBoxPath: child path must extend its map');
  return childPath;
}

export function loopChildPaths(path: string, childCount: number): readonly string[] {
  assert(path.length > 0, 'loopChildPaths: path must not be empty');
  assert(Number.isSafeInteger(childCount), 'loopChildPaths: a child count is a whole number');
  assert(childCount >= 0, 'loopChildPaths: a child count is not negative');
  assert(childCount <= LIMITS.treeNodesMax, 'loopChildPaths: child count exceeds limit');
  return Array.from({ length: Math.max(childCount, 1) }, (_, index) => `${path}.${index}`);
}

export function unionBox(boxes: readonly Box[]): Box | undefined {
  assert(boxes.length <= LIMITS.treeNodesMax, 'unionBox: box count exceeds limit');
  const sized = boxes.filter((box) => box.w > 0 && box.h > 0 && box.hidden !== true);
  const [first] = sized;
  if (first === undefined) {
    return undefined;
  }
  let left = first.x;
  let top = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;
  for (const box of sized) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  assert(right >= left, 'unionBox: a union has width');
  assert(bottom >= top, 'unionBox: a union has height');
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function hoverIsSelection(hover: Occurrence | undefined, selection: Occurrence | undefined): boolean {
  if (!hover?.path || !selection?.path) {
    return false;
  }
  if (hover.path !== selection.path) {
    return false;
  }
  if (hover.occ === undefined) {
    return true;
  }
  if (selection.occ === undefined) {
    return true;
  }
  return hover.occ === selection.occ;
}

export function sameCopy(from: string | undefined, to: string | undefined): boolean {
  if (!from || !to || from === to) {
    return false;
  }
  const split = (path: string) => {
    const text = String(path);
    const bar = text.lastIndexOf('|');
    return {
      file: bar === -1 ? '' : text.slice(0, bar),
      trail: text.slice(bar + 1).split('.'),
    };
  };
  const source = split(from);
  const target = split(to);
  if (source.file !== target.file) {
    return false;
  }
  const shorter = Math.min(source.trail.length, target.trail.length);
  const common = source.trail.length === target.trail.length ? shorter - 1 : shorter;
  for (let i = 0; i < common; i++) {
    if (source.trail[i] !== target.trail[i]) {
      return false;
    }
  }
  return true;
}

export default onePerPlace;
