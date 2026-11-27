import { assert } from '../../shared/core/assert';

export const POPUP_LAYER_ATTRIBUTE = 'data-popup-layer';

export function popupLayer(): HTMLElement {
  const layer = document.querySelector<HTMLElement>(`[${POPUP_LAYER_ATTRIBUTE}]`) ?? document.body;
  assert(layer.isConnected, 'The popup layer is in the document');
  return layer;
}
