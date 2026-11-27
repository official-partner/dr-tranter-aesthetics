import type { CSSProperties, ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import type { PreviewSizing } from './usePreviewSizing';
import { CanvasScrollbar } from './CanvasScrollbar';
import './previewViewport.css';

export interface SizedFrameProps {
  readonly sizing: PreviewSizing;
  readonly children: ReactNode;
}

export function SizedFrame({ sizing, children }: SizedFrameProps) {
  const scale = sizing.viewport.scale;
  assert(scale > 0, 'The canvas scale is positive');
  assert(scale <= 1, 'The canvas never scales a page up');
  const moving = sizing.resizing || sizing.panelSettling;
  const flush = sizing.width === undefined;
  return (
    <div
      ref={sizing.frameRef}
      className={`frame-sized ${flush ? 'full' : ''} ${moving ? 'resizing' : ''} ${sizing.resizing ? 'dragging' : ''}`}
      style={
        sizing.width === undefined
          ? { ...sizing.fillStyle, height: '100%', bottom: 'auto', transform: 'translateX(-50%)' }
          : { width: sizing.viewport.width, height: sizing.viewport.height, bottom: 'auto', transform: `translateX(-50%) scale(${scale})` }
      }
    >
      <div className="frame-clip">{children}</div>
      <CanvasScrollbar frameRef={sizing.frameRef} scale={scale} />
      <ResizeHandles sizing={sizing} />
    </div>
  );
}

export function PreviewModeStage({ sizing, children }: SizedFrameProps) {
  return (
    <div className="preview-mode preview-mode-stage" dir="ltr" ref={sizing.wrapRef}>
      <SizedFrame sizing={sizing}>{children}</SizedFrame>
    </div>
  );
}

function ResizeHandles({ sizing }: { readonly sizing: PreviewSizing }) {
  const edges = ['w', 'e', 's'] as const;
  assert(edges.length === 3, 'Two width handles and one height handle');
  const scale = sizing.viewport.scale;
  return (
    <>
      {edges.map((edge) => (
        <div
          key={edge}
          className={`rz-handle rz-${edge}`}
          style={handleOffset(edge, { fluid: sizing.width === undefined, scale })}
          onPointerDown={sizing.startResize(edge)}
        />
      ))}
      {sizing.resizing && (
        <div className="rz-readout">
          {Math.round(sizing.viewport.width)} × {Math.round(sizing.viewport.height)}
        </div>
      )}
    </>
  );
}

export const HANDLE_SCREEN_PX = { side: 12 } as const satisfies Record<string, number>;

function handleOffset(edge: 'w' | 'e' | 's', frame: { readonly fluid: boolean; readonly scale: number }): CSSProperties | undefined {
  assert(frame.scale > 0, 'handleOffset: the frame has a scale');
  if (frame.fluid) {
    return undefined;
  }
  const offsetPx = -HANDLE_SCREEN_PX.side / frame.scale;
  assert(offsetPx <= -HANDLE_SCREEN_PX.side, 'handleOffset: never closer in than at scale 1');
  switch (edge) {
    case 'w':
      return { left: offsetPx };
    case 'e':
      return { right: offsetPx };
    case 's':
      return undefined;
    default: {
      const exhaustive: never = edge;
      return exhaustive;
    }
  }
}
