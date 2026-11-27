import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AppCanvasCursor } from '../../../shared/properties/appsRpc';
import { setCanvasClickHandler } from '../../ui/canvasClickSlot';
import { queryCanvasPoint, type CanvasLayer } from '../../ui/canvasPointQuery';
import type { AppNodeLayer } from '../../../shared/properties/appsRpc';
import { appHostNode, appNodeRefHost, canvasCapture, setCanvasPageReader, setCanvasPointLocator, setInsertDropLocator } from './appsRuntime';
import { canvasClickPayload } from './canvasCapture';
import { nodeLayers } from './nodeRefs';

export interface CanvasCaptureHost {
  readonly nodeIdForPath: (path: string) => string | undefined;
  readonly sendCursor: (cursor: AppCanvasCursor | undefined) => void;
  readonly canvasPage: () => string | undefined;
}

async function layersOf(frameLayers: readonly CanvasLayer[]): Promise<readonly AppNodeLayer[]> {
  const host = appNodeRefHost();
  return host === undefined || frameLayers.length === 0 ? [] : nodeLayers(host, frameLayers);
}

export function useCanvasCapture(host: CanvasCaptureHost): void {
  const latest = useRef(host);
  latest.current = host;
  const owner = useSyncExternalStore(canvasCapture.subscribe, canvasCapture.owner);
  useEffect(() => {
    setCanvasClickHandler({
      capturing: () => canvasCapture.owner()?.mode === 'capture',
      observing: () => canvasCapture.owner()?.mode === 'observe',
      take: (click) => {
        const nodeId = click.path === undefined ? undefined : latest.current.nodeIdForPath(click.path);
        const x = click.x ?? 0;
        const y = click.y ?? 0;
        const box = click.x === undefined || click.y === undefined ? undefined : click.box;
        const point = click.x === undefined || click.y === undefined ? Promise.resolve(undefined) : queryCanvasPoint(x, y);
        void point
          .then((hit) => layersOf(hit?.layers ?? []))
          .catch(() => [])
          .then((layers) => canvasCapture.click(canvasClickPayload({ nodeId, x, y, box, layers })));
      },
    });
    setCanvasPointLocator(async (x, y) => {
      const hit = await queryCanvasPoint(x, y);
      const nodeId = hit?.path === undefined ? undefined : latest.current.nodeIdForPath(hit.path);
      const layers = await layersOf(hit?.layers ?? []).catch(() => []);
      return canvasClickPayload({ nodeId, x, y, box: hit?.box, layers });
    });
    setCanvasPageReader(() => latest.current.canvasPage());
    setInsertDropLocator(async (x, y) => {
      const hit = await queryCanvasPoint(x, y);
      const nodeId = hit?.path === undefined ? undefined : latest.current.nodeIdForPath(hit.path);
      const node = nodeId === undefined ? undefined : appHostNode(nodeId);
      const box = hit?.box;
      return node === undefined || box === undefined ? undefined : { node, box: { x: box.x, y: box.y, width: box.w, height: box.h } };
    });
    return () => {
      setCanvasClickHandler(undefined);
      setCanvasPointLocator(undefined);
      setCanvasPageReader(undefined);
      setInsertDropLocator(undefined);
    };
  }, []);
  const cursor = owner?.cursor;
  useEffect(() => {
    latest.current.sendCursor(cursor);
  }, [cursor]);
  const capturing = owner?.mode === 'capture';
  useEffect(() => {
    if (!capturing) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && canvasCapture.cancel()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);
}
