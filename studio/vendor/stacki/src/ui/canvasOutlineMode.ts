import { assert } from '../../shared/core/assert';
import { HIGHLIGHT_MESSAGE, OUTLINE_MODE_MESSAGE, type CanvasHighlight, type CanvasOutlineMode, type DeepHoverNode } from '../../shared/properties/deepOutline';
import { tellCanvas } from '../editor/canvasQuery';

let mode: CanvasOutlineMode = 'normal';
let highlight: CanvasHighlight | undefined;
const highlightListeners = new Set<() => void>();
const listeners = new Set<() => void>();

export function setCanvasOutlineMode(next: CanvasOutlineMode): void {
  if (next === mode) {
    return;
  }
  mode = next;
  resendCanvasOutlineMode();
  for (const listener of [...listeners]) {
    listener();
  }
  assert(mode === next, 'setCanvasOutlineMode: the mode is the one set');
}

export function canvasOutlineMode(): CanvasOutlineMode {
  return mode;
}

export function resendCanvasOutlineMode(): void {
  tellCanvas({ type: OUTLINE_MODE_MESSAGE, mode });
  tellCanvas({ type: HIGHLIGHT_MESSAGE, highlight });
}

export function subscribeCanvasOutlineMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let deepHover: { readonly path: string; readonly node: DeepHoverNode } | undefined;

export function noteDeepHover(path: string | undefined, node: DeepHoverNode | undefined): void {
  deepHover = path === undefined || node === undefined ? undefined : { path, node };
  assert(deepHover === undefined || deepHover.node.label.length > 0, 'noteDeepHover: a deep hover labels its node');
}

export function deepHoverNode(path: string): DeepHoverNode | undefined {
  if (highlight?.path === path) {
    return highlight.node;
  }
  return deepHover?.path === path ? deepHover.node : undefined;
}

export function setCanvasHighlight(next: CanvasHighlight | undefined): void {
  if (next === highlight) {
    return;
  }
  highlight = next;
  tellCanvas({ type: HIGHLIGHT_MESSAGE, highlight: next });
  for (const listener of [...highlightListeners]) {
    listener();
  }
  assert(highlight === next, 'setCanvasHighlight: the highlight is the one set');
}

export function canvasHighlight(): CanvasHighlight | undefined {
  return highlight;
}

export function subscribeCanvasHighlight(listener: () => void): () => void {
  highlightListeners.add(listener);
  return () => {
    highlightListeners.delete(listener);
  };
}
