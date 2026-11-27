import { assert } from '../../shared/core/assert';

export type PanelKind = 'left' | 'code' | 'right';

export interface PanelWidthRequest {
  readonly widthPx: number;
  readonly onResize: (widthPx: number) => void;
}

interface HeldWidthRequest extends PanelWidthRequest {
  readonly token: symbol;
}

const PANEL_KINDS_COUNT = 3;
const REQUEST_LISTENERS_MAX = 64;
const requests = new Map<PanelKind, HeldWidthRequest>();
const listeners = new Set<() => void>();

export function requestPanelWidth(kind: PanelKind, request: PanelWidthRequest): () => void {
  assert(Number.isFinite(request.widthPx), 'A requested panel width must be finite');
  assert(request.widthPx > 0, 'A requested panel width must be positive');
  const token = Symbol(kind);
  requests.set(kind, { ...request, token });
  assert(requests.size <= PANEL_KINDS_COUNT, 'Panel width requests are one per panel');
  changed();
  return () => {
    if (requests.get(kind)?.token === token) {
      requests.delete(kind);
      changed();
    }
  };
}

export function requestedPanelWidth(kind: PanelKind): number | undefined {
  return requests.get(kind)?.widthPx;
}

export function resizeRequestedPanel(kind: PanelKind, widthPx: number): boolean {
  assert(Number.isFinite(widthPx), 'A resized panel width must be finite');
  const held = requests.get(kind);
  if (held === undefined) {
    return false;
  }
  requests.set(kind, { ...held, widthPx });
  held.onResize(widthPx);
  changed();
  return true;
}

export function subscribePanelWidthRequests(listener: () => void): () => void {
  assert(listeners.size < REQUEST_LISTENERS_MAX, 'Panel width request listeners exceed their limit');
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}
