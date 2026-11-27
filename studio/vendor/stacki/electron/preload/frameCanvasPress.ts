const BOX_SELECTOR = 'stacki-frame, stacki-group';
const PANNING_ATTRIBUTE = 'data-stacki-panning';

interface Pressed {
  readonly closest?: (selector: string) => unknown;
  readonly parentElement?: unknown;
}

export function pressedCanvasBox(target: unknown): boolean {
  const pressed = asPressed(target);
  const from = typeof pressed?.closest === 'function' ? pressed : asPressed(pressed?.parentElement);
  const box = from?.closest?.(BOX_SELECTOR) ?? undefined;
  return box !== undefined;
}

function asPressed(value: unknown): Pressed | undefined {
  return typeof value === 'object' ? (value ?? undefined) : undefined;
}

export function canvasPressStaysClick(pressed: { readonly onBox: boolean }, root: { readonly hasAttribute: (name: string) => boolean }): boolean {
  return pressed.onBox && !root.hasAttribute(PANNING_ATTRIBUTE);
}
