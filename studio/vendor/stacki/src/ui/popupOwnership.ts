import { assert } from '../../shared/core/assert';

interface Layer {
  readonly element: HTMLElement;
  readonly anchor: HTMLElement | undefined;
  readonly root: string;
  readonly depth: number;
}

const layers: Layer[] = [];
const POPUP_LAYERS_MAX = 64;

export function registerPopupLayer(
  element: HTMLElement | undefined,
  anchor: HTMLElement | undefined,
  scope: { readonly root: string; readonly depth: number },
): () => void {
  if (!element) {
    return () => {};
  }
  assert(layers.length < POPUP_LAYERS_MAX, 'Popup nesting exceeds the supported limit');
  const layer: Layer = { element, anchor, ...scope };
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) {
      layers.splice(i, 1);
    }
  };
}

export function hasOwnedPopup(root: HTMLElement | undefined): boolean {
  return !!root && layers.some((layer) => layer.anchor && root.contains(layer.anchor));
}

export function inOwnedPopup(target: Node | undefined, root: HTMLElement | undefined): boolean {
  if (!target || !root) {
    return false;
  }
  const seen = new Set<Layer>();
  let layer = layers.find((layer) => layer.element.contains(target));
  while (layer && !seen.has(layer) && seen.size < POPUP_LAYERS_MAX) {
    seen.add(layer);
    const anchor = layer.anchor;
    if (!anchor) {
      return false;
    }
    if (root.contains(anchor)) {
      return true;
    }
    layer = layers.find((other) => other !== layer && other.element.contains(anchor));
  }
  return false;
}

export function isTopPopupLayer(element: HTMLElement | undefined): boolean {
  const root = layers.at(-1)?.root;
  let top: Layer | undefined;
  for (const layer of layers) {
    if (layer.root === root && (!top || layer.depth >= top.depth)) {
      top = layer;
    }
  }
  return top !== undefined && top.element === element;
}

export function ownsTopPopupLayer(element: HTMLElement | undefined): boolean {
  if (!element) {
    return false;
  }
  const root = layers.at(-1)?.root;
  let top: Layer | undefined;
  for (const layer of layers) {
    if (layer.root === root && (!top || layer.depth >= top.depth)) {
      top = layer;
    }
  }
  if (top === undefined || top.element === element) {
    return false;
  }
  return inOwnedPopup(top.element, element);
}
