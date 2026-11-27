
import { assert } from '../../shared/core/assert';

export interface LoopCopy {
  readonly occurrence: number;
  readonly copies: number | undefined;
}

const COPIES_MAX = 20_000;

export function loopIndexesOfCopy(copy: LoopCopy, counts: readonly (number | undefined)[]): readonly number[] | undefined {
  assert(counts.length <= 64, 'loopIndexesOfCopy: loop nesting is bounded');
  if (!Number.isSafeInteger(copy.occurrence) || copy.occurrence < 0) {
    return undefined;
  }
  let total = 1;
  const sizes: number[] = [];
  for (const count of counts) {
    if (count === undefined || !Number.isSafeInteger(count) || count < 1) {
      return undefined;
    }
    sizes.push(count);
    total *= count;
    if (total > COPIES_MAX) {
      return undefined;
    }
  }
  if (copy.copies !== undefined && copy.copies !== total) {
    return undefined;
  }
  if (copy.occurrence >= total) {
    return undefined;
  }
  const indexes: number[] = [];
  let stride = total;
  for (const size of sizes) {
    stride = Math.floor(stride / size);
    indexes.push(Math.floor(copy.occurrence / stride) % size);
  }
  assert(indexes.length === sizes.length, 'loopIndexesOfCopy: one index per loop');
  assert(
    indexes.every((index, place) => index < (sizes[place] ?? 0)),
    'loopIndexesOfCopy: each index is inside its loop',
  );
  return indexes;
}

export function steppedLoopIndex(index: number, step: -1 | 1, count: number): number {
  assert(count >= 1, 'steppedLoopIndex: a loop has an item');
  assert(Number.isSafeInteger(index), 'steppedLoopIndex: the index is an integer');
  const at = Math.min(Math.max(index, 0), count - 1);
  return (((at + step) % count) + count) % count;
}

export interface ClickedCopy {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly copies: number | undefined;
  readonly iterations: readonly { readonly path: string; readonly index: number }[] | undefined;
}

export interface LoopSelectionInput {
  readonly selectedId: string | undefined;
  readonly clicked: ClickedCopy | undefined;
  readonly loopIds: readonly string[];
  readonly pathFor: (id: string) => string | undefined;
}

export interface LoopSelection {
  readonly key: string;
  readonly copy: LoopCopy | undefined;
  readonly items: readonly (number | undefined)[] | undefined;
}

export function loopSelectionOf(input: LoopSelectionInput): LoopSelection {
  assert(input.loopIds.length <= 64, 'loopSelectionOf: loop nesting is bounded');
  const clicked = input.clicked !== undefined && input.clicked.nodeId === input.selectedId ? input.clicked : undefined;
  const passes = clicked?.iterations ?? [];
  const items = input.loopIds.map((id): number | undefined => {
    const path = input.pathFor(id);
    const pass = path === undefined ? undefined : passes.find((candidate) => candidate.path === path);
    return pass !== undefined && pass.index >= 0 ? pass.index : undefined;
  });
  const known = items.some((item) => item !== undefined);
  const key = `${input.selectedId ?? ''}|${clicked?.occurrence ?? ''}|${passes.map((pass) => `${pass.path}=${pass.index}`).join(',')}`;
  return {
    key,
    copy: clicked === undefined ? undefined : { occurrence: clicked.occurrence, copies: clicked.copies },
    items: known ? items : undefined,
  };
}
