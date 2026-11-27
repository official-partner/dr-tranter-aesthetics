import { assert } from '../../../shared/core/assert';
import { APP_RPC_LIMITS, type AppCanvasClick, type AppDragPhase, type AppEventData, type AppEventName } from '../../../shared/properties/appsRpc';

export interface DragPoint {
  readonly layerX: number;
  readonly layerY: number;
  readonly x: number;
  readonly y: number;
}

export interface OverlayDragPress {
  readonly appId: string;
  readonly itemId: string;
  readonly nodeId: string | undefined;
  readonly interactive: boolean;
  readonly point: DragPoint;
}

export interface OverlayDragHeld {
  readonly appId: string;
  readonly itemId: string;
  readonly phase: 'pressed' | 'dragging';
}

export interface OverlayDragDeps {
  readonly emit: <E extends AppEventName>(appId: string, event: E, data: AppEventData[E]) => number;
  readonly running: (appId: string) => boolean;
  readonly holds: (appId: string, itemId: string) => boolean;
  readonly locate: (x: number, y: number) => Promise<AppCanvasClick>;
  readonly frame: (step: () => void) => () => void;
}

export interface OverlayDrag {
  readonly press: (press: OverlayDragPress) => boolean;
  readonly move: (point: DragPoint) => void;
  readonly release: (point: DragPoint) => void;
  readonly cancel: () => boolean;
  readonly changed: () => void;
  readonly held: () => OverlayDragHeld | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

interface ActiveDrag {
  readonly kind: 'dragging';
  readonly appId: string;
  readonly itemId: string;
  latest: DragPoint;
  release: DragPoint | undefined;
  started: boolean;
  last: AppCanvasClick | undefined;
  asking: boolean;
  cancelFrame: (() => void) | undefined;
}

type DragState = { readonly kind: 'idle' } | { readonly kind: 'pressed'; readonly press: OverlayDragPress } | ActiveDrag;

const IDLE: DragState = { kind: 'idle' };

export function createOverlayDrag(deps: OverlayDragDeps): OverlayDrag {
  let state: DragState = IDLE;
  let heldView: OverlayDragHeld | undefined;
  const listeners = new Set<() => void>();
  const become = (next: DragState): void => {
    state = next;
    heldView = heldOf(next);
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const send = (drag: ActiveDrag, phase: AppDragPhase, where: AppCanvasClick, outcome: { readonly cancelled: boolean }): void => {
    assert(phase === 'start' || drag.started, 'A drag starts before it moves or ends');
    assert(!outcome.cancelled || phase === 'end', 'Only an end is cancelled');
    deps.emit(drag.appId, 'overlay.drag', {
      itemId: drag.itemId,
      phase,
      nodeId: where.nodeId,
      at: where.at,
      x: where.x,
      y: where.y,
      layers: where.layers,
      cancelled: outcome.cancelled,
    });
  };
  const finish = (point: DragPoint): void => {
    const drag = state;
    assert(drag.kind === 'dragging', 'Only a drag drops');
    assert(!drag.asking, 'A drop asks the canvas only when nothing else is asking');
    drag.cancelFrame?.();
    drag.cancelFrame = undefined;
    drag.asking = true;
    void deps.locate(point.x, point.y).then((where) => {
      drag.asking = false;
      if (state !== drag) {
        return;
      }
      if (!drag.started) {
        send(drag, 'start', where, { cancelled: false });
        drag.started = true;
      }
      send(drag, 'end', where, { cancelled: false });
      become(IDLE);
    });
  };
  const schedule = (): void => {
    const drag = state;
    assert(drag.kind === 'dragging', 'Only a drag asks the canvas');
    if (drag.asking || drag.cancelFrame !== undefined) {
      return;
    }
    drag.cancelFrame = deps.frame(() => {
      drag.cancelFrame = undefined;
      if (state === drag) {
        ask();
      }
    });
  };
  const ask = (): void => {
    const drag = state;
    assert(drag.kind === 'dragging', 'Only a drag asks the canvas');
    assert(drag.release === undefined, 'A drop is asked about by finish');
    const point = drag.latest;
    drag.asking = true;
    void deps.locate(point.x, point.y).then((where) => {
      drag.asking = false;
      if (state !== drag) {
        return;
      }
      send(drag, drag.started ? 'move' : 'start', where, { cancelled: false });
      drag.started = true;
      drag.last = where;
      if (drag.release !== undefined) {
        finish(drag.release);
      } else if (drag.latest !== point) {
        schedule();
      }
    });
  };
  const end = (): boolean => {
    const current = state;
    switch (current.kind) {
      case 'idle':
        return false;
      case 'pressed':
        become(IDLE);
        return true;
      case 'dragging':
        if (current.release !== undefined) {
          return false;
        }
        current.cancelFrame?.();
        current.cancelFrame = undefined;
        become(IDLE);
        if (current.started && current.last !== undefined) {
          send(current, 'end', current.last, { cancelled: true });
        }
        return true;
      default: {
        const exhaustive: never = current;
        return exhaustive;
      }
    }
  };
  return {
    press: (press) => {
      if (state.kind !== 'idle') {
        return false;
      }
      if (!deps.running(press.appId) || !deps.holds(press.appId, press.itemId)) {
        return false;
      }
      become({ kind: 'pressed', press });
      assert(heldView?.itemId === press.itemId, 'A press holds its item');
      return true;
    },
    move: (point) => {
      const current = state;
      if (current.kind === 'pressed') {
        const { layerX, layerY } = current.press.point;
        if (Math.hypot(point.layerX - layerX, point.layerY - layerY) < APP_RPC_LIMITS.dragThresholdPx) {
          return;
        }
        const drag: ActiveDrag = {
          kind: 'dragging',
          appId: current.press.appId,
          itemId: current.press.itemId,
          latest: point,
          release: undefined,
          started: false,
          last: undefined,
          asking: false,
          cancelFrame: undefined,
        };
        become(drag);
        schedule();
        return;
      }
      if (current.kind === 'dragging' && current.release === undefined) {
        current.latest = point;
        schedule();
      }
    },
    release: (point) => {
      const current = state;
      if (current.kind === 'pressed') {
        become(IDLE);
        const { press } = current;
        if (press.interactive) {
          deps.emit(press.appId, 'overlay.click', { itemId: press.itemId, nodeId: press.nodeId });
        }
        return;
      }
      if (current.kind === 'dragging' && current.release === undefined) {
        current.latest = point;
        current.release = point;
        if (!current.asking) {
          finish(point);
        }
      }
    },
    cancel: end,
    changed: () => {
      const current = state;
      if (current.kind === 'idle') {
        return;
      }
      const owner = current.kind === 'pressed' ? current.press : current;
      if (!deps.running(owner.appId) || !deps.holds(owner.appId, owner.itemId)) {
        end();
      }
    },
    held: () => heldView,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function heldOf(state: DragState): OverlayDragHeld | undefined {
  switch (state.kind) {
    case 'idle':
      return undefined;
    case 'pressed':
      return { appId: state.press.appId, itemId: state.press.itemId, phase: 'pressed' };
    case 'dragging':
      return { appId: state.appId, itemId: state.itemId, phase: 'dragging' };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
