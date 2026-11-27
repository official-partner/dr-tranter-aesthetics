
import { createLiveValue } from '../../ui/liveValue';
import type { RichBlockChoice } from '../../../shared/properties/canvasText';

export type CanvasFormatCommand = 'bold' | 'italic' | 'superscript' | 'subscript';
export type CanvasFormatWrap = 'code' | 'span';

export type CanvasFormatAction =
  | { readonly kind: 'exec'; readonly command: CanvasFormatCommand }
  | { readonly kind: 'wrap'; readonly tag: CanvasFormatWrap }
  | { readonly kind: 'link'; readonly url: string };

export interface CanvasFormatState {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly superscript?: boolean;
  readonly subscript?: boolean;
  readonly code?: boolean;
  readonly span?: boolean;
  readonly link?: boolean;
}

export interface CanvasTextSelectionState {
  readonly session: string;
  readonly bubble: { readonly x: number; readonly top: number; readonly bottom: number };
  readonly states: CanvasFormatState;
  readonly press: (action: Exclude<CanvasFormatAction, { readonly kind: 'link' }>) => void;
  readonly beginLink: () => void;
  readonly endLink: (url: string | undefined) => void;
}

export interface CanvasRichPlusState {
  readonly session: string;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly leftMin: number;
  readonly choose: (choice: RichBlockChoice) => void;
  readonly hold: () => void;
  readonly resume: () => void;
}

export const canvasRichPlus = createLiveValue<CanvasRichPlusState | undefined>(undefined);

export function clearCanvasRichPlus(session: string): void {
  if (canvasRichPlus.get()?.session === session) {
    canvasRichPlus.set(undefined);
  }
}

export const canvasTextSelection = createLiveValue<CanvasTextSelectionState | undefined>(undefined);

export function clearCanvasTextSelection(session: string): void {
  if (canvasTextSelection.get()?.session === session) {
    canvasTextSelection.set(undefined);
  }
}
