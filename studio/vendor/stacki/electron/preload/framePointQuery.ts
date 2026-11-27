import type { Rect } from './frameBasics';
import { layersAtPoint, parseFrameChain, resolveChain } from './frameLayers';

export interface FramePointHit {
  readonly path: string;
  readonly occurrence: number;
  readonly box: Rect | undefined;
}

const COORDINATE_PX_MAX = 1_000_000;

export function receivePointQuery(data: unknown, locate: (x: number, y: number) => FramePointHit | undefined, post: (message: unknown) => void): boolean {
  if (typeof data !== 'object' || data === null || Reflect.get(data, 'type') !== 'avb:point-query') {
    return false;
  }
  const id: unknown = Reflect.get(data, 'id');
  const x = coordinateOf(Reflect.get(data, 'x'));
  const y = coordinateOf(Reflect.get(data, 'y'));
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    return true;
  }
  if (Reflect.get(data, 'chain') !== undefined) {
    const chain = parseFrameChain(Reflect.get(data, 'chain'));
    const found = chain === undefined ? undefined : resolveChain(chain);
    post({ type: 'avb:point-result', id, path: found?.path, occurrence: found?.occurrence ?? 0, box: found?.box, layers: [] });
    return true;
  }
  if (x === undefined || y === undefined) {
    post({ type: 'avb:point-result', id, path: undefined, occurrence: 0, box: undefined, layers: [] });
    return true;
  }
  const hit = locate(x, y);
  post({ type: 'avb:point-result', id, path: hit?.path, occurrence: hit?.occurrence ?? 0, box: hit?.box, layers: layersAtPoint(x, y) });
  return true;
}

function coordinateOf(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return undefined;
  }
  return Math.abs(input) <= COORDINATE_PX_MAX ? input : undefined;
}
