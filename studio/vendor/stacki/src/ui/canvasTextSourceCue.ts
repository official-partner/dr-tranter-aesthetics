
import { createLiveValue } from './liveValue';

export interface CanvasSourceTarget {
  readonly expression: string;
  readonly file: string;
  readonly uses: number;
}

export interface CanvasSourceCueState extends CanvasSourceTarget {
  readonly session: string;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export const canvasSourceCue = createLiveValue<CanvasSourceCueState | undefined>(undefined);

export function clearCanvasSourceCue(session: string): void {
  if (canvasSourceCue.get()?.session === session) {
    canvasSourceCue.set(undefined);
  }
}

export interface CanvasSourceBlocked {
  readonly expression: string;
  readonly file: string;
  readonly reason:
    'call' | 'computed' | 'concatenation' | 'template' | 'mutable' | 'prop' | 'missing' | 'ambiguous' | 'unsupported' | 'unreadable' | 'not-text';
}
