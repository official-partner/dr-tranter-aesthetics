import { useTranslate } from '../../lib/i18n/useTranslate';
import { useSyncExternalStore } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import { usePointerDrag } from '../../ui/usePointerDrag';
import { setPanelDragPhase } from '../../ui/panelDragPhase';
import { requestedPanelWidth, resizeRequestedPanel, subscribePanelWidthRequests, type PanelKind } from '../../ui/panelWidthRequests';

export type { PanelKind } from '../../ui/panelWidthRequests';
export const PANEL_WIDTH_PX_MIN = { left: 260, code: 360, right: 322 } as const satisfies Record<PanelKind, number>;
export const PANEL_WIDTH_PX_MAX = 600;
const WIDTH_PX_STEP = 10;
const WIDTH_LISTENERS_MAX = 64;

export type PanelWidths = Readonly<Record<PanelKind, number>>;

interface ResizablePanelProps {
  readonly kind: PanelKind;
  readonly children: ReactNode;
}

export interface PanelResize {
  readonly width: number;
  readonly handle: ReactNode;
}

export function ResizablePanel({ kind, children }: ResizablePanelProps) {
  const { width, handle } = usePanelResize(kind);
  const side = panelSide(kind);
  return (
    <div className={`panel ${side}${kind === 'code' ? ' code-panel-shell' : ''}`} style={{ width }}>
      {children}
      {handle}
    </div>
  );
}

let committedWidths: PanelWidths | undefined;
let shownWidths: PanelWidths | undefined;
const widthListeners = new Set<() => void>();

export function usePanelWidths(): PanelWidths {
  return useSyncExternalStore(subscribeWidths, currentWidths);
}

export function usePanelResize(kind: PanelKind): PanelResize {
  const translate = useTranslate();
  const widths = usePanelWidths();
  const startDrag = usePointerDrag();
  const width = widths[kind];
  const side = panelSide(kind);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.isPrimary === false) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget;
    const panel = handle.parentElement;
    assert(panel instanceof HTMLElement, 'Resize handle must belong to a panel');
    const startWidth = panel.getBoundingClientRect().width;
    const startX = event.clientX;
    const mirror = screenDirection(handle);
    let nextWidth = startWidth;
    const showDragWidth = (shown: number): void => {
      assert(Number.isSafeInteger(shown), 'A shown panel width is a whole number of pixels');
      panel.style.width = `${shown}px`;
      handle.setAttribute('aria-valuenow', String(shown));
    };
    const cover = startPanelDrag(handle, event.pointerId);
    setPanelDragPhase('dragging');
    startDrag(event, {
      cursor: 'col-resize',
      onMove: (move) => {
        nextWidth = dragPanelWidth(kind, startWidth, (move.clientX - startX) * mirror);
        showDragWidth(nextWidth);
      },
      onEnd: () => {
        endPanelDrag(handle, cover);
        setPanelDragPhase('idle');
        const committed = clampWidth(nextWidth, kind);
        showDragWidth(committed);
        commitWidth(kind, committed);
      },
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyboardWidth(event, kind, width);
    if (next !== undefined) {
      event.preventDefault();
      commitWidth(kind, next);
    }
  };
  const handle = (
    <div
      className="panel-resize"
      role="separator"
      tabIndex={0}
      aria-label={translate(side === 'left' ? 'shell.panel.resizeLeft' : 'shell.panel.resizeRight')}
      aria-orientation="vertical"
      aria-valuemin={PANEL_WIDTH_PX_MIN[kind]}
      aria-valuemax={PANEL_WIDTH_PX_MAX}
      aria-valuenow={width}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      title={translate('shell.panel.resizeHint')}
    />
  );
  return { width, handle };
}

function startPanelDrag(handle: HTMLElement, pointerId: number): HTMLElement {
  assert(handle.isConnected, 'A panel drag starts from a mounted handle');
  handle.classList.add('on');
  if (typeof handle.setPointerCapture === 'function') {
    try {
      handle.setPointerCapture(pointerId);
    } catch {
    }
  }
  const cover = document.createElement('div');
  cover.className = 'panel-resize-cover';
  document.body.append(cover);
  assert(cover.isConnected, 'The drag cover is in the document');
  return cover;
}

function endPanelDrag(handle: HTMLElement, cover: HTMLElement): void {
  handle.classList.remove('on');
  cover.remove();
  assert(!cover.isConnected, 'The drag cover leaves with the drag');
}

export function dragPanelWidth(kind: PanelKind, startWidth: number, deltaPx: number): number {
  assert(Number.isFinite(startWidth), 'Drag start width must be finite');
  assert(Number.isFinite(deltaPx), 'Drag delta must be finite');
  const direction = panelSide(kind) === 'right' ? -1 : 1;
  return clampWidth(startWidth + deltaPx * direction, kind);
}

export function parsePanelWidth(input: unknown, kind: PanelKind): number | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  if (input.length === 0 || input.length > 3) {
    return undefined;
  }
  const width = Number(input);
  if (!Number.isSafeInteger(width)) {
    return undefined;
  }
  if (width < PANEL_WIDTH_PX_MIN[kind] || width > PANEL_WIDTH_PX_MAX) {
    return undefined;
  }
  return width;
}

function panelSide(kind: PanelKind): 'left' | 'right' {
  return kind === 'right' ? 'right' : 'left';
}

function clampWidth(width: number, kind: PanelKind): number {
  assert(Number.isFinite(width), 'Panel width must be finite');
  const next = Math.min(PANEL_WIDTH_PX_MAX, Math.max(PANEL_WIDTH_PX_MIN[kind], Math.round(width)));
  assert(Number.isSafeInteger(next), 'Panel width must be an integer');
  return next;
}

function screenDirection(handle: HTMLElement): 1 | -1 {
  const direction = handle.closest('[dir]')?.getAttribute('dir') ?? 'ltr';
  return direction === 'rtl' ? -1 : 1;
}

function keyboardWidth(event: KeyboardEvent<HTMLDivElement>, kind: PanelKind, width: number): number | undefined {
  switch (event.key) {
    case 'Home':
      return PANEL_WIDTH_PX_MIN[kind];
    case 'End':
      return PANEL_WIDTH_PX_MAX;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      return dragPanelWidth(kind, width, direction * screenDirection(event.currentTarget) * WIDTH_PX_STEP);
    }
    default:
      return undefined;
  }
}

export function currentWidths(): PanelWidths {
  shownWidths ??= requestedWidths(committedPanelWidths());
  return shownWidths;
}

function committedPanelWidths(): PanelWidths {
  committedWidths ??= { left: readWidth('left'), code: readWidth('code'), right: readWidth('right') };
  return committedWidths;
}

function requestedWidths(committed: PanelWidths): PanelWidths {
  const shown = {
    left: shownWidth('left', committed.left),
    code: shownWidth('code', committed.code),
    right: shownWidth('right', committed.right),
  };
  assert(shown.left === clampWidth(shown.left, 'left'), 'A shown left panel width is within bounds');
  return shown;
}

function shownWidth(kind: PanelKind, committed: number): number {
  const requested = requestedPanelWidth(kind);
  return requested === undefined ? committed : clampWidth(requested, kind);
}

function widthsChanged(): void {
  shownWidths = undefined;
  for (const changed of widthListeners) {
    changed();
  }
}

function subscribeWidths(changed: () => void): () => void {
  assert(widthListeners.size < WIDTH_LISTENERS_MAX, 'Panel width listeners exceed their limit');
  widthListeners.add(changed);
  const stopRequests = subscribePanelWidthRequests(() => {
    shownWidths = undefined;
    changed();
  });
  return () => {
    stopRequests();
    widthListeners.delete(changed);
    if (widthListeners.size === 0) {
      committedWidths = undefined;
      shownWidths = undefined;
    }
  };
}

function commitWidth(kind: PanelKind, width: number): void {
  assert(width === clampWidth(width, kind), 'Committed panel width must be within bounds');
  if (!resizeRequestedPanel(kind, width)) {
    committedWidths = { ...committedPanelWidths(), [kind]: width };
    storeWidth(kind, width);
    assert(committedWidths[kind] === width, 'Committed panel width must be readable');
  }
  widthsChanged();
  assert(currentWidths()[kind] === width, 'A committed width is the shown width');
}

function readWidth(kind: PanelKind): number {
  const fallback = kind === 'code' ? clampWidth(window.innerWidth * 0.34, kind) : PANEL_WIDTH_PX_MIN[kind];
  try {
    return parsePanelWidth(localStorage.getItem(`stacki.panel.width.${kind}`), kind) ?? fallback;
  } catch {
    return fallback;
  }
}

function storeWidth(kind: PanelKind, width: number): void {
  assert(width === clampWidth(width, kind), 'Stored panel width must be within bounds');
  try {
    localStorage.setItem(`stacki.panel.width.${kind}`, String(width));
  } catch {
  }
}
