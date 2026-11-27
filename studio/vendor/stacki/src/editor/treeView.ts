import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

export interface TreeView {
  readonly id: string;
  readonly kind: string;
  readonly name?: string;
  readonly value?: string;
  readonly head?: string;
  readonly test?: string;
  readonly body?: readonly string[];
  readonly bodyParts?: readonly string[];
  readonly props?: Readonly<Record<string, { readonly type: string; readonly value?: string }>>;
  readonly children?: readonly TreeView[] | undefined;
}

export function treeBudget(): (depth: number) => void {
  let visited = 0;
  return (depth) => {
    assert(depth <= LIMITS.treeDepthMax, 'Tree traversal exceeds depth limit');
    assert(++visited <= LIMITS.treeNodesMax, 'Tree traversal exceeds node limit');
  };
}
