import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { assert } from '../../../shared/core/assert';
import type { AppSummary } from '../../../shared/properties/apps';
import { APP_RPC_LIMITS, type AppOverlayItem } from '../../../shared/properties/appsRpc';
import { tellCanvas } from '../../editor/canvasQuery';
import { AppFrame } from './AppFrame';
import { canvasCapture, emitToApp, insertDrag, noteOverlayHover, overlayDrag, setCanvasClientMapper, useAppsRuntime, useRefTargetLookup } from './appsRuntime';
import type { InsertDragView } from './insertDrag';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { captureChipText, type CanvasCaptureOwner } from './canvasCapture';
import type { DragPoint, OverlayDragHeld } from './overlayDrag';
import { clusterOverlays, type OverlayCluster } from './overlayClusters';
import { overlayMeasure } from './overlayMeasure';
import {
  NO_REF_TARGETS,
  overlayPointerPoint,
  overlayWheelMessage,
  placeOverlays,
  type MeasuredRects,
  type OverlayPlacement,
  type RefTargetLookup,
} from './overlayPlacement';
import './appCanvasTools.css';

const CLUSTER_LIST_MAX = 20;

const DEFAULT_COLOR = '#a855f7';

export function AppOverlayLayer({
  rects,
  scale,
  pathFor,
}: {
  readonly rects: MeasuredRects;
  readonly scale: number;
  readonly pathFor: (nodeId: string) => string | undefined;
}) {
  const runtime = useAppsRuntime();
  const capture = useSyncExternalStore(canvasCapture.subscribe, canvasCapture.owner);
  const held = useSyncExternalStore(overlayDrag.subscribe, overlayDrag.held);
  const refTarget = useRefTargetLookup();
  useEffect(() => {
    overlayMeasure.note({ rects, pathFor });
  });
  const apps = new Map(runtime.running.map((running) => [running.app.manifest.id, running.app]));
  return (
    <AppOverlayView
      overlays={runtime.overlays}
      apps={apps}
      capture={capture}
      held={held}
      rects={rects}
      scale={scale}
      pathFor={pathFor}
      refTarget={refTarget}
      clickItem={clickOverlayItem}
    />
  );
}

export interface AppOverlayViewProps {
  readonly overlays: ReadonlyMap<string, readonly AppOverlayItem[]>;
  readonly apps: ReadonlyMap<string, AppSummary>;
  readonly capture: CanvasCaptureOwner | undefined;
  readonly held: OverlayDragHeld | undefined;
  readonly rects: MeasuredRects;
  readonly scale: number;
  readonly pathFor: (nodeId: string) => string | undefined;
  readonly refTarget?: RefTargetLookup | undefined;
  readonly clickItem: (appId: string, itemId: string, nodeId: string | undefined) => void;
}

export function AppOverlayView({ overlays, apps, capture, held, rects, scale, pathFor, refTarget, clickItem }: AppOverlayViewProps) {
  const translate = useTranslate();
  const root = useRef<HTMLDivElement>(null);
  const latestScale = useRef(scale);
  latestScale.current = scale;
  const [opened, setOpened] = useState<string | undefined>(undefined);
  useEffect(() => {
    const element = root.current ?? undefined;
    assert(element !== undefined, 'The overlay root is mounted before its effects run');
    const onWheel = (event: WheelEvent): void => {
      forwardOverlayWheel(element, event, latestScale.current);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const element = root.current ?? undefined;
    assert(element !== undefined, 'The overlay root is mounted before its effects run');
    setCanvasClientMapper((x, y) => {
      const origin = element.getBoundingClientRect();
      if (x < origin.left || x > origin.right || y < origin.top || y > origin.bottom) {
        return undefined;
      }
      const point = overlayPointerPoint({ left: origin.left, top: origin.top }, { x, y }, latestScale.current);
      return { x: point.x, y: point.y };
    });
    return () => setCanvasClientMapper(undefined);
  }, []);
  const inserting = useSyncExternalStore(insertDrag.subscribe, insertDrag.view);
  const insertActive = inserting !== undefined;
  useEffect(() => {
    if (!insertActive) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && insertDrag.cancel()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [insertActive]);
  const chip = capture === undefined ? undefined : <span className="app-capture-chip">{captureChipText(capture, translate)}</span>;
  const { singles, clusters } =
    overlays.size === 0
      ? { singles: [], clusters: [] }
      : clusterOverlays(placeOverlays(overlays, rects, scale, refTarget ?? NO_REF_TARGETS, pathFor), APP_RPC_LIMITS.clusterRadiusPx, held);
  const dragging = held?.phase === 'dragging' ? held : undefined;
  return (
    <div ref={root} className={`app-overlay-root${capture === undefined ? '' : ' capturing'}`}>
      {singles.map((placement) => (
        <OverlayItem
          key={`${placement.appId}:${placement.item.id}:${placement.copy}`}
          placement={placement}
          app={apps.get(placement.appId)}
          scale={scale}
          grabbed={dragging !== undefined && dragging.appId === placement.appId && dragging.itemId === placement.item.id}
          clickItem={clickItem}
        />
      ))}
      {clusters.map((cluster) => (
        <ClusterBubble
          key={cluster.key}
          cluster={cluster}
          opened={opened === cluster.key}
          toggle={() => setOpened((current) => (current === cluster.key ? undefined : cluster.key))}
          clickItem={clickItem}
        />
      ))}
      {held !== undefined && <DragSurface phase={held.phase} />}
      {inserting !== undefined && <InsertDropIndicator drag={inserting} scale={scale} />}
      {chip}
    </div>
  );
}

function InsertDropIndicator({ drag, scale }: { readonly drag: InsertDragView; readonly scale: number }) {
  assert(scale > 0, 'The canvas scale is positive');
  const target = drag.target;
  const box = target?.box;
  const line =
    target === undefined || box === undefined ? undefined : (
      <div
        className={`app-insert-drop ${target.line}`}
        style={{
          left: box.x * scale,
          top: (target.line === 'after' ? box.y + box.height : box.y) * scale,
          width: Math.max(0, box.width * scale),
          height: target.line === 'inside' ? Math.max(0, box.height * scale) : 0,
        }}
      />
    );
  const pointer = drag.pointer;
  return (
    <>
      {line}
      {pointer !== undefined && (
        <span className={`app-insert-chip${target === undefined ? ' refused' : ''}`} style={{ left: pointer.x * scale + 12, top: pointer.y * scale + 12 }}>
          {drag.preview}
        </span>
      )}
    </>
  );
}

function clickOverlayItem(appId: string, itemId: string, nodeId: string | undefined): void {
  emitToApp(appId, 'overlay.click', { itemId, nodeId });
}

function forwardOverlayWheel(root: HTMLElement, event: WheelEvent, scale: number): void {
  assert(scale > 0, 'The canvas scale is positive');
  event.preventDefault();
  const origin = root.getBoundingClientRect();
  tellCanvas(overlayWheelMessage({ left: origin.left, top: origin.top }, event, scale));
}

let following: { readonly pointerId: number; readonly pointAt: (event: PointerEvent) => DragPoint; readonly stop: () => void } | undefined;

function DragSurface({ phase }: { readonly phase: 'pressed' | 'dragging' }) {
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = surface.current ?? undefined;
    const pointer = following;
    if (element === undefined || pointer === undefined) {
      return;
    }
    try {
      element.setPointerCapture(pointer.pointerId);
    } catch {
      if (following?.pointerId === pointer.pointerId) {
        pointer.stop();
        overlayDrag.cancel();
      }
    }
  }, []);
  return <div ref={surface} className={`app-overlay-drag-surface${phase === 'dragging' ? ' dragging' : ''}`} />;
}

function pressItem(event: React.PointerEvent<HTMLDivElement>, placement: OverlayPlacement, scale: number): void {
  const { item } = placement;
  if (event.button !== 0 || !event.isPrimary || following !== undefined) {
    return;
  }
  if (item.kind !== 'box' && item.kind !== 'label' && item.kind !== 'pin') {
    return;
  }
  const layer = event.currentTarget.offsetParent;
  if (!(layer instanceof HTMLElement)) {
    return;
  }
  const pointAt = (pointer: { readonly clientX: number; readonly clientY: number }): DragPoint => {
    const origin = layer.getBoundingClientRect();
    return overlayPointerPoint({ left: origin.left, top: origin.top }, { x: pointer.clientX, y: pointer.clientY }, scale);
  };
  const pressed = overlayDrag.press({
    appId: placement.appId,
    itemId: item.id,
    nodeId: placement.nodeId,
    interactive: item.interactive,
    point: pointAt(event),
  });
  if (!pressed) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  followPointer(event.pointerId, pointAt);
}

function followPointer(pointerId: number, pointAt: (event: PointerEvent) => DragPoint): void {
  const onMove = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) {
      overlayDrag.move(pointAt(event));
    }
  };
  const onUp = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) {
      stop();
      overlayDrag.release(pointAt(event));
    }
  };
  const onLost = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) {
      stop();
      overlayDrag.cancel();
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && overlayDrag.cancel()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stop();
    }
  };
  const unsubscribe = overlayDrag.subscribe(() => {
    if (overlayDrag.held() === undefined) {
      stop();
    }
  });
  const stop = (): void => {
    if (following?.pointerId !== pointerId) {
      return;
    }
    following = undefined;
    unsubscribe();
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onLost, true);
    window.removeEventListener('lostpointercapture', onLost, true);
    window.removeEventListener('keydown', onKey, true);
  };
  following = { pointerId, pointAt, stop };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onLost, true);
  window.addEventListener('lostpointercapture', onLost, true);
  window.addEventListener('keydown', onKey, true);
}

function ClusterBubble({
  cluster,
  opened,
  toggle,
  clickItem,
}: {
  readonly cluster: OverlayCluster;
  readonly opened: boolean;
  readonly toggle: () => void;
  readonly clickItem: AppOverlayViewProps['clickItem'];
}) {
  const [first] = cluster.members;
  const shown = cluster.members.slice(0, CLUSTER_LIST_MAX);
  const tone = first?.item.kind === 'pin' ? ` tone-${first.item.tone}` : '';
  const style =
    first?.item.kind === 'pin' ? undefined : { background: first?.item.kind === 'label' ? (first.item.background ?? DEFAULT_COLOR) : DEFAULT_COLOR };
  return (
    <div className="app-overlay-item interactive app-overlay-cluster" style={{ left: cluster.left, top: cluster.top }}>
      <button type="button" className={`app-overlay-cluster-count${tone}`} style={style} onClick={toggle} aria-expanded={opened}>
        {cluster.members.length}
      </button>
      {opened && (
        <div className="app-overlay-cluster-list">
          {shown.map((member) => (
            <ClusterMember key={`${member.item.id}:${member.copy}`} member={member} clickItem={clickItem} />
          ))}
          {cluster.members.length > shown.length && <span className="app-overlay-cluster-more">{`${cluster.members.length - shown.length} more`}</span>}
        </div>
      )}
    </div>
  );
}

function ClusterMember({ member, clickItem }: { readonly member: OverlayPlacement; readonly clickItem: AppOverlayViewProps['clickItem'] }) {
  const { item } = member;
  if (item.kind !== 'label' && item.kind !== 'pin') {
    return undefined;
  }
  const style = item.kind === 'pin' ? undefined : { background: item.background ?? DEFAULT_COLOR, color: item.color ?? '#fff' };
  const className = item.kind === 'pin' ? `app-overlay-cluster-member tone-${item.tone}` : 'app-overlay-cluster-member';
  const text = item.kind === 'pin' ? (item.label ?? '•') : item.text;
  if (item.interactive) {
    const click = () => clickItem(member.appId, item.id, member.nodeId);
    return (
      <button
        type="button"
        className={className}
        style={style}
        onClick={click}
        onPointerEnter={() => noteOverlayHover(member.appId, item.id)}
        onPointerLeave={() => noteOverlayHover(member.appId, undefined)}
      >
        {text}
      </button>
    );
  }
  return (
    <span className={className} style={style}>
      {text}
    </span>
  );
}

function OverlayItem({
  placement,
  app,
  scale,
  grabbed,
  clickItem,
}: {
  readonly placement: OverlayPlacement;
  readonly app: AppSummary | undefined;
  readonly scale: number;
  readonly grabbed: boolean;
  readonly clickItem: AppOverlayViewProps['clickItem'];
}) {
  const { item } = placement;
  const style: React.CSSProperties = { left: placement.left, top: placement.top, width: placement.width, height: placement.height };
  const click = () => clickItem(placement.appId, item.id, placement.nodeId);
  const hover = (handles: { readonly interactive: boolean }) =>
    handles.interactive
      ? { onPointerEnter: () => noteOverlayHover(placement.appId, item.id), onPointerLeave: () => noteOverlayHover(placement.appId, undefined) }
      : {};
  const pointer = (handles: { readonly interactive: boolean; readonly draggable: boolean }) =>
    handles.draggable
      ? { onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => pressItem(event, placement, scale), ...hover(handles) }
      : { onClick: handles.interactive ? click : undefined, ...hover(handles) };
  const classes = (kind: 'box' | 'text' | 'pin', handles: { readonly interactive: boolean; readonly draggable: boolean }) =>
    `app-overlay-item app-overlay-${kind}${handles.interactive ? ' interactive' : ''}${handles.draggable ? ' draggable' : ''}${grabbed ? ' dragging' : ''}`;
  switch (item.kind) {
    case 'box':
      return (
        <div
          className={classes('box', item)}
          style={{
            ...style,
            outline: `1.5px ${item.dashed ? 'dashed' : 'solid'} ${item.color ?? DEFAULT_COLOR}`,
            outlineOffset: -1,
            background: item.fill,
          }}
          {...pointer(item)}
        >
          {item.label !== undefined && (
            <span className="app-overlay-label" style={{ top: -17, left: 0, background: item.color ?? DEFAULT_COLOR, color: '#fff' }}>
              {item.label}
            </span>
          )}
        </div>
      );
    case 'label':
      return (
        <div className={classes('text', item)} style={style} {...pointer(item)}>
          <span
            className="app-overlay-label"
            style={{ ...labelPosition(item.placement), background: item.background ?? DEFAULT_COLOR, color: item.color ?? '#fff' }}
          >
            {item.text}
          </span>
        </div>
      );
    case 'pin':
      return (
        <div className={classes('pin', item)} style={{ left: placement.left, top: placement.top }} {...pointer(item)}>
          <span className={`app-overlay-pin-badge tone-${item.tone}${item.active ? ' active' : ''}`}>
            {item.avatarURL !== undefined && (
              <img className="app-overlay-pin-avatar" src={item.avatarURL} alt="" referrerPolicy="no-referrer" draggable={false} />
            )}
            {item.label !== undefined && <span className="app-overlay-pin-text">{item.label}</span>}
          </span>
        </div>
      );
    case 'heat':
      return <HeatMap style={style} item={item} />;
    case 'frame':
      if (app === undefined) {
        return undefined;
      }
      return (
        <div className="app-overlay-item" style={{ ...style, pointerEvents: item.interactive ? 'auto' : 'none' }}>
          <AppFrame
            app={app}
            path={item.path}
            title={`${app.manifest.name} overlay`}
            className="app-overlay-frame"
            interactive={item.interactive}
            overlayItem={item.id}
          />
        </div>
      );
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

function labelPosition(placement: 'top' | 'bottom' | 'center'): React.CSSProperties {
  switch (placement) {
    case 'top':
      return { top: -17, left: 0 };
    case 'bottom':
      return { bottom: -17, left: 0 };
    case 'center':
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    default: {
      const exhaustive: never = placement;
      return exhaustive;
    }
  }
}

function HeatMap({ style, item }: { readonly style: React.CSSProperties; readonly item: Extract<AppOverlayItem, { readonly kind: 'heat' }> }) {
  const color = item.color ?? '#ef4444';
  return (
    <div
      className="app-overlay-item app-overlay-heat"
      style={{ ...style, gridTemplateColumns: `repeat(${item.columns}, 1fr)`, gridTemplateRows: `repeat(${item.rows}, 1fr)` }}
    >
      {item.values.map((value, index) => (
        <span key={index} style={{ background: color, opacity: Math.round(value * 70) / 100 }} />
      ))}
    </div>
  );
}
