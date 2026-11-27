
import { assert } from '../../../../shared/core/assert';

export const LAYERS_MAX = 1024;

export type LayerPosition = readonly number[];

type LayerNode = { readonly index: number; readonly children: Map<string, LayerNode> };

export class LayerRegistry {
  readonly #roots = new Map<string, LayerNode>();
  #count = 0;

  positionOf(path: readonly string[]): LayerPosition {
    assert(path.length > 0, 'LayerRegistry.positionOf: a layer has at least one name');
    const position: number[] = [];
    let level = this.#roots;
    for (const name of path) {
      let node = level.get(name);
      if (node === undefined) {
        assert(this.#count < LAYERS_MAX, 'LayerRegistry: the layer count is bounded');
        node = { index: level.size, children: new Map() };
        level.set(name, node);
        this.#count += 1;
      }
      position.push(node.index);
      level = node.children;
    }
    return position;
  }
}

export function layerNamesOf(params: string): ReadonlyArray<readonly string[]> {
  return params
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => name.split('.').map((part) => part.trim()));
}

export function compareLayerPositions(left: LayerPosition, right: LayerPosition): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return right.length - left.length;
}
