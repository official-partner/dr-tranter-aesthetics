import { assert } from '../../../shared/core/assert';
import { APP_RPC_LIMITS, type AppNodeRef, type AppOverlayItem, type AppPoint } from '../../../shared/properties/appsRpc';
import type { DragPoint } from './overlayDrag';

export interface MeasuredBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type MeasuredRects = Readonly<Record<string, readonly MeasuredBox[] | undefined>>;

export interface OverlayPlacement {
  readonly appId: string;
  readonly item: AppOverlayItem;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly nodeId: string | undefined;
  readonly copy: number;
}

const COPIES_MAX = 500;

export interface RefTargetLookup {
  readonly target: (ref: AppNodeRef) => { readonly path: string; readonly occurrence: number } | undefined;
}

export const NO_REF_TARGETS: RefTargetLookup = { target: () => undefined };

export function overlayAnchorPaths(
  overlays: ReadonlyMap<string, readonly AppOverlayItem[]>,
  measuring: readonly string[],
  refTarget: RefTargetLookup,
  pathFor: (nodeId: string) => string | undefined,
): readonly string[] {
  const paths = new Set<string>();
  assert(measuring.length <= APP_RPC_LIMITS.measureRequestsMax, 'Measure requests are bounded');
  for (const nodeId of measuring) {
    const path = pathFor(nodeId);
    if (path !== undefined) {
      paths.add(path);
    }
  }
  for (const items of overlays.values()) {
    for (const item of items) {
      const path = 'nodeId' in item.anchor ? pathFor(item.anchor.nodeId) : 'ref' in item.anchor ? refTarget.target(item.anchor.ref)?.path : undefined;
      if (path !== undefined) {
        paths.add(path);
      }
    }
  }
  assert(paths.size <= overlays.size * APP_RPC_LIMITS.overlayAnchorsMax + measuring.length, 'Anchors are bounded per app');
  return [...paths];
}

export function placeOverlays(
  overlays: ReadonlyMap<string, readonly AppOverlayItem[]>,
  rects: MeasuredRects,
  scale: number,
  refTarget: RefTargetLookup,
  pathFor: (nodeId: string) => string | undefined,
): readonly OverlayPlacement[] {
  assert(scale > 0, 'The canvas scale is positive');
  const placements: OverlayPlacement[] = [];
  for (const [appId, items] of overlays) {
    for (const item of items) {
      placements.push(...placeItem(appId, item, rects, scale, refTarget, pathFor));
    }
  }
  return placements;
}

export function anchorPoint(box: MeasuredBox, at: AppPoint): { readonly x: number; readonly y: number } {
  assert(at.x >= 0, 'A point starts at the left edge');
  assert(at.y <= 1, 'A point ends at the bottom edge');
  return { x: box.x + at.x * Math.max(0, box.w), y: box.y + at.y * Math.max(0, box.h) };
}

export function overlayPointerPoint(
  origin: { readonly left: number; readonly top: number },
  client: { readonly x: number; readonly y: number },
  scale: number,
): DragPoint {
  assert(scale > 0, 'The canvas scale is positive');
  const layerX = client.x - origin.left;
  const layerY = client.y - origin.top;
  const point = { layerX, layerY, x: layerX / scale, y: layerY / scale };
  assert(Number.isFinite(point.x), 'A pointer is finite across the canvas');
  assert(Number.isFinite(point.y), 'A pointer is finite down the canvas');
  return point;
}

export interface OverlayWheelMessage {
  readonly type: 'avb:app-wheel';
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export function overlayWheelMessage(
  origin: { readonly left: number; readonly top: number },
  wheel: Pick<WheelEvent, 'clientX' | 'clientY' | 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  scale: number,
): OverlayWheelMessage {
  const point = overlayPointerPoint(origin, { x: wheel.clientX, y: wheel.clientY }, scale);
  const message: OverlayWheelMessage = {
    type: 'avb:app-wheel',
    x: point.x,
    y: point.y,
    deltaX: wheel.deltaX,
    deltaY: wheel.deltaY,
    deltaMode: wheel.deltaMode,
    ctrlKey: wheel.ctrlKey,
    shiftKey: wheel.shiftKey,
    altKey: wheel.altKey,
    metaKey: wheel.metaKey,
  };
  assert(Number.isFinite(message.deltaX), 'A wheel moves a finite way across');
  assert(Number.isFinite(message.deltaY), 'A wheel moves a finite way down');
  return message;
}

function placeItem(
  appId: string,
  item: AppOverlayItem,
  rects: MeasuredRects,
  scale: number,
  refTarget: RefTargetLookup,
  pathFor: (nodeId: string) => string | undefined,
): readonly OverlayPlacement[] {
  const anchor = item.anchor;
  if ('rect' in anchor) {
    const { x, y, width, height } = anchor.rect;
    return [{ appId, item, left: x * scale, top: y * scale, width: width * scale, height: height * scale, nodeId: undefined, copy: 0 }];
  }
  const resolved = 'ref' in anchor ? refTarget.target(anchor.ref) : undefined;
  const path = 'ref' in anchor ? resolved?.path : pathFor(anchor.nodeId);
  const occurrence = 'ref' in anchor ? resolved?.occurrence : anchor.occurrence;
  const nodeId = 'ref' in anchor ? undefined : anchor.nodeId;
  const boxes = path === undefined ? undefined : rects[path];
  if (boxes === undefined || boxes.length === 0) {
    return [];
  }
  if ('ref' in anchor && occurrence === undefined) {
    return [];
  }
  const chosen = occurrence === undefined ? boxes.slice(0, COPIES_MAX) : boxes.slice(occurrence, occurrence + 1);
  const at = anchor.at;
  if (at !== undefined) {
    return chosen.map((box, index) => {
      const point = anchorPoint(box, at);
      return { appId, item, left: point.x * scale, top: point.y * scale, width: 0, height: 0, nodeId, copy: occurrence ?? index };
    });
  }
  return chosen.map((box, index) => ({
    appId,
    item,
    left: box.x * scale,
    top: box.y * scale,
    width: Math.max(0, box.w * scale),
    height: Math.max(0, box.h * scale),
    nodeId,
    copy: occurrence ?? index,
  }));
}
