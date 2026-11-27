import { assert } from '../../../shared/core/assert';
import { APP_RPC_LIMITS, type AppInsert, type AppInsertPlace, type AppNodeView, type AppRect } from '../../../shared/properties/appsRpc';

export interface InsertDragHit {
  readonly node: AppNodeView;
  readonly box: AppRect;
}

export interface InsertDragTarget {
  readonly place: Exclude<AppInsertPlace, { readonly kind: 'selection' } | { readonly kind: 'replace' }>;
  readonly line: 'before' | 'after' | 'inside';
  readonly box: AppRect;
}

export interface InsertDragView {
  readonly appId: string;
  readonly preview: string;
  readonly pointer: { readonly x: number; readonly y: number } | undefined;
  readonly target: InsertDragTarget | undefined;
}

export interface InsertDragDeps {
  readonly toCanvas: (x: number, y: number) => { readonly x: number; readonly y: number } | undefined;
  readonly locate: (x: number, y: number) => Promise<InsertDragHit | undefined>;
  readonly running: (appId: string) => boolean;
}

export type InsertDragDrop =
  | { readonly kind: 'insert'; readonly item: AppInsert; readonly label: string | undefined; readonly place: InsertDragTarget['place'] }
  | { readonly kind: 'refused'; readonly reason: string };

export interface InsertDrag {
  readonly start: (appId: string, drag: { readonly item: AppInsert; readonly label: string | undefined; readonly preview: string | undefined }) => void;
  readonly move: (appId: string, x: number, y: number) => Promise<boolean>;
  readonly drop: (appId: string, x: number, y: number) => Promise<InsertDragDrop>;
  readonly cancel: () => boolean;
  readonly changed: () => void;
  readonly view: () => InsertDragView | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

interface DragState {
  readonly appId: string;
  readonly item: AppInsert;
  readonly label: string | undefined;
  readonly view: InsertDragView;
}

const VOID_TAGS: ReadonlySet<string> = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const EDGE_SHARE = 0.25;

export function createInsertDrag(deps: InsertDragDeps): InsertDrag {
  let state: DragState | undefined;
  const listeners = new Set<() => void>();
  const become = (next: DragState | undefined): void => {
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const aim = async (appId: string, x: number, y: number): Promise<DragState | undefined> => {
    const owned = state;
    if (owned?.appId !== appId) {
      return undefined;
    }
    const pointer = deps.toCanvas(x, y);
    const hit = pointer === undefined ? undefined : await deps.locate(pointer.x, pointer.y);
    const target = pointer === undefined || hit === undefined ? undefined : dropTarget(hit, pointer.y);
    if (state !== owned) {
      return undefined;
    }
    const next = { ...owned, view: { ...owned.view, pointer, target } };
    become(next);
    return next;
  };
  return {
    start: (appId, drag) => {
      assert(deps.running(appId), 'Only a running app starts a drag to insert');
      const preview = drag.preview ?? (drag.item.kind === 'element' ? `<${drag.item.tag}>` : drag.item.name);
      become({
        appId,
        item: drag.item,
        label: drag.label,
        view: { appId, preview: preview.slice(0, APP_RPC_LIMITS.labelCharsMax), pointer: undefined, target: undefined },
      });
    },
    move: async (appId, x, y) => (await aim(appId, x, y))?.view.target !== undefined,
    drop: async (appId, x, y) => {
      if (state?.appId !== appId) {
        return { kind: 'refused', reason: 'The drag was cancelled' };
      }
      const aimed = await aim(appId, x, y);
      if (aimed === undefined) {
        return { kind: 'refused', reason: 'The drag was cancelled' };
      }
      become(undefined);
      const target = aimed.view.target;
      if (target === undefined) {
        return { kind: 'refused', reason: 'Nothing on the canvas there takes the drop' };
      }
      assert(state === undefined, 'A drop ends the drag');
      return { kind: 'insert', item: aimed.item, label: aimed.label, place: target.place };
    },
    cancel: () => {
      if (state === undefined) {
        return false;
      }
      become(undefined);
      return true;
    },
    changed: () => {
      if (state !== undefined && !deps.running(state.appId)) {
        become(undefined);
      }
    },
    view: () => state?.view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function dropTarget(hit: InsertDragHit, pointerY: number): InsertDragTarget {
  const { node, box } = hit;
  const height = Math.max(0, box.height);
  const offset = Math.min(height, Math.max(0, pointerY - box.y));
  const container = node.kind === 'element' && !VOID_TAGS.has(node.name);
  if (container && offset >= height * EDGE_SHARE && offset <= height * (1 - EDGE_SHARE)) {
    return { place: { kind: 'inside', anchor: node.id, index: undefined }, line: 'inside', box };
  }
  const before = container ? offset < height * EDGE_SHARE : offset < height / 2;
  const target: InsertDragTarget = before
    ? { place: { kind: 'before', anchor: node.id }, line: 'before', box }
    : { place: { kind: 'after', anchor: node.id }, line: 'after', box };
  assert(target.place.anchor === node.id, 'A drop is placed by the element under the pointer');
  return target;
}
