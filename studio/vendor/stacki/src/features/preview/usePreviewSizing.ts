import { assert } from '../../../shared/core/assert';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePointerDrag } from '../../ui/usePointerDrag';
import { activeDeviceFor, deviceForShortcut, deviceWidth, type PreviewDevice } from './breakpointDevices';
import type { ResolvedBreakpoint } from '../../../shared/properties/projectBreakpoints';
import { FILL_UNBOUNDED, fluidFrameStyle, fluidFrameWidthPx, PREVIEW_WIDTH_LIMITS, previewViewport, type FillBounds } from './previewViewport';
import { panelDragPhase, setPanelDragPhase, subscribePanelDragPhase, usePanelDragPhase, type PanelDragPhase } from '../../ui/panelDragPhase';
export type CanvasWidthRequest = { readonly widthPx: number; readonly serial: number };

export interface PaneSize {
  readonly width: number;
  readonly height: number;
}

export const DESKTOP_PICK_SETTLE_MS = 400;

export const DESKTOP_PICK_JITTER_PX = 4;

export function paneResized(held: PaneSize | undefined, pane: PaneSize): boolean {
  if (held === undefined || pane.width === 0) {
    return false;
  }
  if (Math.abs(pane.width - held.width) > DESKTOP_PICK_JITTER_PX) {
    return true;
  }
  return Math.abs(pane.height - held.height) > DESKTOP_PICK_JITTER_PX;
}

export type DesktopPick = 'none' | 'asked' | 'narrow' | 'wide';

export function usePreviewDimensions() {
  const [customWidth, setCustomWidth] = useState<number | undefined>(undefined);
  const [customHeight, setCustomHeight] = useState<number | undefined>(undefined);
  const [desktopPick, setDesktopPick] = useState<DesktopPick>('none');
  const [pickPane, setPickPane] = useState<PaneSize | undefined>(undefined);
  const pickViewRef = useRef<string | undefined>(undefined);
  return { customWidth, setCustomWidth, customHeight, setCustomHeight, desktopPick, setDesktopPick, pickPane, setPickPane, pickViewRef };
}
export type PreviewDimensions = ReturnType<typeof usePreviewDimensions>;
export type PreviewSizing = ReturnType<typeof usePreviewSizing>;

export interface PreviewSizingOptions {
  readonly deviceShortcuts: boolean;
  readonly desktopFramePx: number;
  readonly viewKey?: string;
}

export function usePreviewSizing(
  device: PreviewDevice,
  dimensions: PreviewDimensions,
  breakpoints: readonly ResolvedBreakpoint[],
  options: PreviewSizingOptions,
  onDevice: (device: PreviewDevice) => void,
) {
  const startDrag = usePointerDrag();
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const { customWidth, setCustomWidth, customHeight, setCustomHeight } = dimensions;
  const [resizing, setResizing] = useState(false);
  const resized = options.deviceShortcuts && paneResized(dimensions.pickPane, available);
  const pick: DesktopPick = resized ? 'none' : dimensions.desktopPick;
  const room = { desktopFramePx: options.desktopFramePx, paneWidthPx: available.width, pick };
  const width = previewFrameWidth(device, customWidth, breakpoints, room);
  useMeasuredSize(wrapRef, { fluid: width === undefined }, setAvailable);
  const pickDevice = (next: PreviewDevice): void => {
    if (next === 'desktop') {
      dimensions.setPickPane(undefined);
      dimensions.setDesktopPick('asked');
    }
    onDevice(next);
  };
  useDeviceShortcuts(breakpoints, options, pickDevice);
  useDesktopPickOwner(device, dimensions, breakpoints, available, options);
  useEffect(() => {
    if (device !== 'custom') {
      setCustomWidth(undefined);
    }
    if (device === 'desktop' || device === 'canvas') {
      setCustomHeight(undefined);
    }
  }, [device, setCustomWidth, setCustomHeight]);
  const panelSettling = usePanelSettling(usePanelDragPhase());
  const fill = previewFillBounds(device, breakpoints, room);
  const viewport = previewViewport(width, available, customHeight, fill);
  const activeDevice = activeDeviceFor(device, width ?? fluidFrameWidthPx(available.width, fill), breakpoints);
  const setWidth = (next: number): void => {
    setCustomWidth(next);
    onDevice('custom');
  };
  const startResize = useResizeHandler({
    wrapRef,
    frameRef,
    startDrag,
    onDevice,
    setCustomWidth,
    setCustomHeight,
    setResizing,
    scale: viewport.scale,
    available,
    customHeight,
    device,
  });
  const fillStyle = fluidFrameStyle(fill);
  return {
    wrapRef,
    frameRef,
    wrapWidth: available.width,
    viewport,
    fillStyle,
    setWidth,
    pickDevice,
    customHeight,
    resizing,
    panelSettling,
    width,
    activeDevice,
    startResize,
  };
}

export interface DesktopRoom {
  readonly desktopFramePx: number;
  readonly paneWidthPx: number;
  readonly pick: DesktopPick;
}

export function previewFrameWidth(
  device: PreviewDevice,
  customWidth: number | undefined,
  breakpoints: readonly ResolvedBreakpoint[],
  room: DesktopRoom,
): number | undefined {
  if (device === 'custom') {
    return customWidth ?? deviceWidth(device, breakpoints);
  }
  if (device === 'desktop') {
    assert(Number.isSafeInteger(room.desktopFramePx), 'The Desktop width is whole pixels');
    assert(room.desktopFramePx > 0, 'The Desktop width is positive');
    return resolveDesktopPick(room.pick, room.paneWidthPx, desktopRange(breakpoints)) === 'narrow' ? room.desktopFramePx : undefined;
  }
  return deviceWidth(device, breakpoints);
}

export function desktopRange(breakpoints: readonly ResolvedBreakpoint[]): FillBounds {
  const downs = breakpoints.filter((breakpoint) => breakpoint.direction === 'down').map((breakpoint) => breakpoint.widthPx);
  const ups = breakpoints.filter((breakpoint) => breakpoint.direction === 'up').map((breakpoint) => breakpoint.widthPx);
  return {
    widthPxMin: downs.length === 0 ? 0 : Math.max(...downs) + 1,
    widthPxMax: ups.length === 0 ? undefined : Math.min(...ups) - 1,
  };
}

export function resolveDesktopPick(pick: DesktopPick, paneWidthPx: number, range: FillBounds): DesktopPick {
  if (paneWidthPx === 0) {
    return pick;
  }
  const narrow = paneWidthPx < range.widthPxMin;
  const wide = range.widthPxMax !== undefined && fluidFrameWidthPx(paneWidthPx, FILL_UNBOUNDED) > range.widthPxMax;
  switch (pick) {
    case 'none':
      return 'none';
    case 'asked':
      return narrow ? 'narrow' : wide ? 'wide' : 'none';
    case 'narrow':
      return narrow ? 'narrow' : 'none';
    case 'wide':
      return wide ? 'wide' : 'none';
    default: {
      const exhaustive: never = pick;
      return exhaustive;
    }
  }
}

export function previewFillBounds(device: PreviewDevice, breakpoints: readonly ResolvedBreakpoint[], room: DesktopRoom): FillBounds {
  if (device !== 'desktop') {
    return FILL_UNBOUNDED;
  }
  const range = desktopRange(breakpoints);
  return {
    widthPxMin: room.paneWidthPx >= range.widthPxMin ? range.widthPxMin : 0,
    widthPxMax: resolveDesktopPick(room.pick, room.paneWidthPx, range) === 'wide' ? range.widthPxMax : undefined,
  };
}

function useDesktopPickOwner(
  device: PreviewDevice,
  dimensions: PreviewDimensions,
  breakpoints: readonly ResolvedBreakpoint[],
  pane: PaneSize,
  options: PreviewSizingOptions,
): void {
  const { desktopPick, setDesktopPick, pickPane, setPickPane, pickViewRef } = dimensions;
  const owns = options.deviceShortcuts;
  const viewKey = options.viewKey;
  useLayoutEffect(() => {
    if (!owns || viewKey === undefined) {
      return;
    }
    if (pickViewRef.current !== undefined && pickViewRef.current !== viewKey) {
      setDesktopPick('none');
    }
    pickViewRef.current = viewKey;
  }, [owns, viewKey, pickViewRef, setDesktopPick]);
  const stands = device === 'desktop' ? resolveDesktopPick(desktopPick, pane.width, desktopRange(breakpoints)) : 'none';
  const resolved: DesktopPick = paneResized(pickPane, pane) ? 'none' : stands;
  const held = resolved === 'narrow' || resolved === 'wide';
  useLayoutEffect(() => {
    if (!owns) {
      return;
    }
    if (resolved !== desktopPick) {
      setDesktopPick(resolved);
    }
    if (!held && resolved !== 'asked' && pickPane !== undefined) {
      setPickPane(undefined);
    }
  }, [owns, resolved, held, desktopPick, setDesktopPick, pickPane, setPickPane]);
  const latest = useRef(pane);
  latest.current = pane;
  const settling = owns && held && pickPane === undefined;
  useEffect(() => {
    if (!settling) {
      return undefined;
    }
    const timer = setTimeout(() => setPickPane(latest.current), DESKTOP_PICK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling, setPickPane]);
}

function useMeasuredSize(
  ref: React.RefObject<HTMLDivElement>,
  options: { readonly fluid: boolean },
  setSize: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>,
): void {
  const { fluid } = options;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    let pending = false;
    const measure = (): void => {
      pending = false;
      const next = { width: element.clientWidth, height: element.clientHeight };
      assert(Number.isFinite(next.width), 'The canvas width is finite');
      setSize((previous) => (previous.width === next.width && previous.height === next.height ? previous : next));
    };
    const observed = (): void => {
      if (fluid && panelDragPhase() === 'dragging') {
        pending = true;
      } else {
        measure();
      }
    };
    measure();
    const observer = new ResizeObserver(observed);
    observer.observe(element);
    const stopPhase = subscribePanelDragPhase(() => {
      if (pending && panelDragPhase() === 'idle') {
        measure();
      }
    });
    return () => {
      stopPhase();
      observer.disconnect();
    };
  }, [ref, fluid, setSize]);
}

type PanelSettling = 'live' | 'dragging' | 'releasing';

function usePanelSettling(phase: PanelDragPhase): boolean {
  const [settling, setSettling] = useState<PanelSettling>('live');
  useLayoutEffect(() => {
    if (phase === 'dragging') {
      setSettling('dragging');
    } else {
      setSettling((current) => (current === 'dragging' ? 'releasing' : current));
    }
  }, [phase]);
  useEffect(() => {
    if (settling !== 'releasing') {
      return undefined;
    }
    const frame = requestAnimationFrame(() => setSettling('live'));
    return () => cancelAnimationFrame(frame);
  }, [settling]);
  return phase === 'dragging' || settling !== 'live';
}

function useDeviceShortcuts(breakpoints: readonly ResolvedBreakpoint[], options: PreviewSizingOptions, onDevice: (device: PreviewDevice) => void): void {
  const onDeviceRef = useRef(onDevice);
  onDeviceRef.current = onDevice;
  const breakpointsRef = useRef(breakpoints);
  breakpointsRef.current = breakpoints;
  const listening = options.deviceShortcuts;
  useEffect(() => {
    if (!listening) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target ?? undefined)) {
        return;
      }
      const device = deviceForShortcut(event.key, breakpointsRef.current);
      if (device) {
        onDeviceRef.current(device);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening]);
}

function isTypingTarget(target: EventTarget | undefined): boolean {
  return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
}

interface ResizeContext {
  readonly scale: number;
  readonly wrapRef: React.RefObject<HTMLDivElement>;
  readonly frameRef: React.RefObject<HTMLDivElement>;
  readonly startDrag: ReturnType<typeof usePointerDrag>;
  readonly onDevice: (device: PreviewDevice) => void;
  readonly setCustomWidth: React.Dispatch<React.SetStateAction<number | undefined>>;
  readonly setCustomHeight: React.Dispatch<React.SetStateAction<number | undefined>>;
  readonly setResizing: React.Dispatch<React.SetStateAction<boolean>>;
  readonly available: { readonly width: number; readonly height: number };
  readonly customHeight: number | undefined;
  readonly device: PreviewDevice;
}

type ResizeEdge = 'w' | 'e' | 's';

function useResizeHandler(context: ResizeContext) {
  return useCallback(
    (edge: ResizeEdge) =>
      (event: React.PointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        const frame = context.frameRef.current;
        const wrap = context.wrapRef.current;
        if (!frame || !wrap) {
          return;
        }
        const start = {
          x: event.clientX,
          y: event.clientY,
          width: frame.offsetWidth,
          height: frame.offsetHeight,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
        }
        const live = new LiveResize();
        context.setResizing(true);
        setPanelDragPhase('dragging');
        context.startDrag(event, {
          cursor: edge === 's' ? 'row-resize' : 'col-resize',
          onMove: (next) => resizeFrame(edge, start, next, wrap, context, live),
          onEnd: () => {
            commitResize(context, live);
            context.setResizing(false);
            setPanelDragPhase('idle');
          },
        });
      },
    [context],
  );
}

class LiveResize {
  private leftDesktopOnce = false;
  private widthNow: number | undefined = undefined;
  private heightNow: number | undefined = undefined;

  get widthPx(): number | undefined {
    return this.widthNow;
  }

  get heightPx(): number | undefined {
    return this.heightNow;
  }

  setWidth(widthPx: number): void {
    this.widthNow = widthPx;
  }

  setHeight(heightPx: number): void {
    this.heightNow = heightPx;
  }

  takeLeftDesktop(): boolean {
    const first = !this.leftDesktopOnce;
    this.leftDesktopOnce = true;
    return first;
  }
}

function drawFrame(context: ResizeContext, live: LiveResize): void {
  const frame = context.frameRef.current;
  if (!frame) {
    return;
  }
  const readout = frame.querySelector('.rz-readout');
  if (live.widthPx === undefined) {
    assert(live.heightPx !== undefined, 'A drag with no width is a height drag');
    frame.style.height = `${live.heightPx}px`;
    if (readout) {
      readout.textContent = `${Math.round(frame.offsetWidth)} × ${Math.round(live.heightPx)}`;
    }
    return;
  }
  const viewport = previewViewport(live.widthPx, context.available, live.heightPx ?? context.customHeight);
  frame.style.width = `${viewport.width}px`;
  frame.style.height = `${viewport.height}px`;
  frame.style.transform = `translateX(-50%) scale(${viewport.scale})`;
  if (readout) {
    readout.textContent = `${Math.round(viewport.width)} × ${Math.round(viewport.height)}`;
  }
}

function commitResize(context: ResizeContext, live: LiveResize): void {
  if (live.heightPx !== undefined) {
    context.setCustomHeight(live.heightPx);
  }
  if (live.widthPx !== undefined) {
    context.setCustomWidth(live.widthPx);
    context.onDevice('custom');
  }
}

function resizeFrame(
  edge: ResizeEdge,
  start: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  event: PointerEvent,
  wrap: HTMLDivElement,
  context: ResizeContext,
  live: LiveResize,
): void {
  if (edge === 's') {
    const height = Math.round(start.height + (event.clientY - start.y) / context.scale);
    const maximum = Math.max(160, (wrap.clientHeight - 32) / context.scale);
    live.setHeight(clamp(height, 160, maximum));
    drawFrame(context, live);
    return;
  }
  const direction = edge === 'e' ? 2 : -2;
  const width = Math.round(start.width + (direction * (event.clientX - start.x)) / context.scale);
  live.setWidth(clamp(width, PREVIEW_WIDTH_LIMITS.minimum, PREVIEW_WIDTH_LIMITS.maximum));
  drawFrame(context, live);
  if (context.device === 'desktop' && live.takeLeftDesktop()) {
    context.setCustomWidth(live.widthPx ?? width);
    context.onDevice('custom');
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function useCanvasWidthRequest(request: CanvasWidthRequest | undefined, setCustomWidth: (width: number | undefined) => void): void {
  const [appliedSerial, setAppliedSerial] = useState<number | undefined>(undefined);
  if (request !== undefined && request.serial !== appliedSerial) {
    const clamped = Math.min(PREVIEW_WIDTH_LIMITS.maximum, Math.max(PREVIEW_WIDTH_LIMITS.minimum, Math.round(request.widthPx)));
    setAppliedSerial(request.serial);
    setCustomWidth(clamped);
  }
}
