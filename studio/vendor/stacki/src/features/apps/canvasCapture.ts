import { assert } from '../../../shared/core/assert';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import {
  APP_RPC_LIMITS,
  type AppCanvasClick,
  type AppCanvasCursor,
  type AppCaptureMode,
  type AppEditOutcome,
  type AppEventData,
  type AppEventName,
  type AppNodeLayer,
  type AppPoint,
} from '../../../shared/properties/appsRpc';
import type { CanvasClickBox } from '../../ui/canvasClickSlot';

export interface CanvasCaptureOwner {
  readonly appId: string;
  readonly appName: string;
  readonly cursor: AppCanvasCursor;
  readonly mode: AppCaptureMode;
  readonly reason: string | undefined;
}

export interface CanvasCaptureDeps {
  readonly emit: <E extends AppEventName>(appId: string, event: E, data: AppEventData[E]) => number;
  readonly running: (appId: string) => boolean;
}

export interface CanvasCapture {
  readonly set: (
    app: { readonly id: string; readonly name: string },
    on: boolean,
    capture: { readonly cursor: AppCanvasCursor; readonly mode: AppCaptureMode; readonly reason: string | undefined },
  ) => AppEditOutcome;
  readonly owner: () => CanvasCaptureOwner | undefined;
  readonly cancel: () => boolean;
  readonly click: (click: AppCanvasClick) => boolean;
  readonly changed: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createCanvasCapture(deps: CanvasCaptureDeps): CanvasCapture {
  let owner: CanvasCaptureOwner | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: CanvasCaptureOwner | undefined): void => {
    owner = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    set: (app, on, { cursor, mode, reason }) => {
      if (on) {
        if (!deps.running(app.id)) {
          return { applied: false, reason: 'Only a running app captures the canvas' };
        }
        const previous = owner;
        publish({ appId: app.id, appName: app.name, cursor, mode, reason });
        if (previous !== undefined && previous.appId !== app.id) {
          deps.emit(previous.appId, 'canvas.capture', { on: false, reason: 'replaced' });
        }
        deps.emit(app.id, 'canvas.capture', { on: true, reason: 'app' });
        assert(owner?.appId === app.id, 'The latest capture owns the canvas');
        return { applied: true };
      }
      if (owner?.appId === app.id) {
        publish(undefined);
        deps.emit(app.id, 'canvas.capture', { on: false, reason: 'app' });
      }
      assert(owner?.appId !== app.id, 'An app that ends its capture no longer owns the canvas');
      return { applied: true };
    },
    owner: () => owner,
    cancel: () => {
      const previous = owner;
      if (previous === undefined) {
        return false;
      }
      publish(undefined);
      deps.emit(previous.appId, 'canvas.capture', { on: false, reason: 'escape' });
      return true;
    },
    click: (click) => {
      if (owner === undefined) {
        return false;
      }
      deps.emit(owner.appId, 'canvas.click', click);
      return true;
    },
    changed: () => {
      if (owner !== undefined && !deps.running(owner.appId)) {
        publish(undefined);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function captureChipText(owner: Pick<CanvasCaptureOwner, 'appName' | 'mode' | 'reason'>, translate: Translator): string {
  if (owner.mode === 'observe') {
    return owner.reason === undefined
      ? translate('apps.capture.listening', { name: owner.appName })
      : translate('apps.capture.reason', { name: owner.appName, reason: owner.reason });
  }
  return translate('apps.capture.cancelable', { name: owner.appName, reason: owner.reason ?? translate('apps.capture.clickToPlace') });
}

export function canvasClickPayload(input: {
  readonly nodeId: string | undefined;
  readonly x: number;
  readonly y: number;
  readonly box: CanvasClickBox | undefined;
  readonly layers: readonly AppNodeLayer[];
}): AppCanvasClick {
  const at = input.nodeId === undefined || input.box === undefined ? undefined : pointWithin(input.box, input.x, input.y);
  const payload: AppCanvasClick = { nodeId: input.nodeId, at, x: input.x, y: input.y, layers: input.layers.slice(0, APP_RPC_LIMITS.nodeLayersMax) };
  assert(payload.at === undefined || payload.nodeId !== undefined, 'A point within an element names the element');
  assert(payload.layers.length <= APP_RPC_LIMITS.nodeLayersMax, 'A click names a bounded number of layers');
  return payload;
}

function pointWithin(box: CanvasClickBox, x: number, y: number): AppPoint | undefined {
  if (box.w > 0 && box.h > 0) {
    const point = { x: clampUnit((x - box.x) / box.w), y: clampUnit((y - box.y) / box.h) };
    assert(point.x >= 0, 'A point starts at the left edge');
    assert(point.y <= 1, 'A point ends at the bottom edge');
    return point;
  }
  return undefined;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
