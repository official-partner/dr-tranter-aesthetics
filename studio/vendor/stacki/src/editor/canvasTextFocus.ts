
let editing = false;

export function noteCanvasTextEditing(state: 'active' | 'inactive'): void {
  editing = state === 'active';
}

export function canvasTextHasFocus(): boolean {
  if (!editing) {
    return false;
  }
  const active = typeof document === 'undefined' ? undefined : document.activeElement;
  return active instanceof HTMLIFrameElement;
}

export type RichHistoryStep = 'undo' | 'redo';

export const RICH_HISTORY_EVENT = 'stacki:rich-history';

let canvasStep: ((step: RichHistoryStep) => void) | undefined;

export function noteCanvasRichHistory(step: ((step: RichHistoryStep) => void) | undefined): void {
  canvasStep = step;
}

export function stepRichHistory(step: RichHistoryStep): boolean {
  if (canvasStep !== undefined && canvasTextHasFocus()) {
    canvasStep(step);
    return true;
  }
  const field = typeof document === 'undefined' ? undefined : (document.activeElement?.closest('.html-content') ?? undefined);
  return field !== undefined && !field.dispatchEvent(new CustomEvent(RICH_HISTORY_EVENT, { cancelable: true, detail: step }));
}
