import { assert } from '../../shared/core/assert';
import { tellCanvas } from '../editor/canvasQuery';
import { canvasClickBox, coordinateOf, type CanvasClickReport } from './canvasClickSlot';

export const CANVAS_POINT_LIMITS = {
  layersMax: 32,
  copyMax: 100_000,
  pendingMax: 8,
  timeoutMs: 250,
  pathCharsMax: 4096,
  occurrenceMax: 100_000,
} as const;

export interface CanvasLayer {
  readonly path: string;
  readonly occurrence: number;
  readonly copy: number;
}

export interface CanvasPointReport extends CanvasClickReport {
  readonly layers: readonly CanvasLayer[];
}

export interface CanvasChainStep {
  readonly path: string;
  readonly copy: number;
}

interface PendingPoint {
  readonly resolve: (hit: CanvasPointReport | undefined) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly x: number | undefined;
  readonly y: number | undefined;
}

const pending = new Map<number, PendingPoint>();
let nextId = 1;

export function queryCanvasPoint(x: number, y: number): Promise<CanvasPointReport | undefined> {
  assert(Number.isFinite(x), 'A canvas point is finite across');
  assert(Number.isFinite(y), 'A canvas point is finite down');
  return ask({ x, y }, { type: 'avb:point-query', x, y });
}

export function queryCanvasChain(chain: readonly CanvasChainStep[]): Promise<CanvasPointReport | undefined> {
  assert(chain.length > 0, 'A chain has a step');
  assert(chain.length <= CANVAS_POINT_LIMITS.layersMax, 'A chain is within the layer bound');
  return ask({ x: undefined, y: undefined }, { type: 'avb:point-query', chain });
}

function ask(
  asked: { readonly x: number | undefined; readonly y: number | undefined },
  message: Readonly<Record<string, unknown>>,
): Promise<CanvasPointReport | undefined> {
  if (pending.size >= CANVAS_POINT_LIMITS.pendingMax) {
    return Promise.resolve(undefined);
  }
  assert(Number.isSafeInteger(nextId), 'Canvas point ids stay safe integers');
  const id = nextId;
  nextId += 1;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(undefined);
    }, CANVAS_POINT_LIMITS.timeoutMs);
    pending.set(id, { resolve, timer, x: asked.x, y: asked.y });
    if (!tellCanvas({ ...message, id })) {
      clearTimeout(timer);
      pending.delete(id);
      resolve(undefined);
    }
  });
}

export function receiveCanvasPoint(input: unknown): void {
  if (typeof input !== 'object' || input === null) {
    return;
  }
  const id: unknown = Reflect.get(input, 'id');
  const entry = typeof id === 'number' ? pending.get(id) : undefined;
  if (typeof id !== 'number' || entry === undefined) {
    return;
  }
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(parsePointReply(input, entry));
}

export function parsePointReply(input: object, asked: { readonly x: number | undefined; readonly y: number | undefined }): CanvasPointReport {
  const path: unknown = Reflect.get(input, 'path');
  const occurrence: unknown = Reflect.get(input, 'occurrence');
  const named = typeof path === 'string' && path.length > 0 && path.length <= CANVAS_POINT_LIMITS.pathCharsMax ? path : undefined;
  const copy =
    typeof occurrence === 'number' && Number.isSafeInteger(occurrence) && occurrence >= 0 && occurrence <= CANVAS_POINT_LIMITS.occurrenceMax ? occurrence : 0;
  const report: CanvasPointReport = {
    path: named,
    occurrence: copy,
    x: asked.x === undefined ? undefined : coordinateOf(asked.x),
    y: asked.y === undefined ? undefined : coordinateOf(asked.y),
    box: named === undefined ? undefined : canvasClickBox(Reflect.get(input, 'box')),
    layers: parseCanvasLayers(Reflect.get(input, 'layers')),
  };
  assert(report.occurrence >= 0, 'A point names a copy from the first');
  assert(report.box === undefined || report.path !== undefined, 'A box belongs to the element the point is on');
  return report;
}

export function parseCanvasLayers(input: unknown): readonly CanvasLayer[] {
  if (!Array.isArray(input) || input.length > CANVAS_POINT_LIMITS.layersMax) {
    return [];
  }
  const layers: CanvasLayer[] = [];
  for (const item of input) {
    const layer = parseCanvasLayer(item);
    if (layer === undefined) {
      return [];
    }
    layers.push(layer);
  }
  assert(layers.length <= CANVAS_POINT_LIMITS.layersMax, 'Layers are within their bound');
  return layers;
}

function parseCanvasLayer(input: unknown): CanvasLayer | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const path: unknown = Reflect.get(input, 'path');
  const occurrence: unknown = Reflect.get(input, 'occurrence');
  const copy: unknown = Reflect.get(input, 'copy');
  if (typeof path !== 'string' || path.length === 0 || path.length > CANVAS_POINT_LIMITS.pathCharsMax) {
    return undefined;
  }
  if (!wholeIn(occurrence, CANVAS_POINT_LIMITS.occurrenceMax)) {
    return undefined;
  }
  if (!wholeIn(copy, CANVAS_POINT_LIMITS.copyMax)) {
    return undefined;
  }
  return { path, occurrence, copy };
}

function wholeIn(input: unknown, maximum: number): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && input <= maximum;
}
