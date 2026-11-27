import { createLiveValue, useLiveValue } from './liveValue';
import { projectRelativePath } from '../lib/projectPath';
import type { Attr } from '../../shared/page/pageNode';
import { textValueCanonical } from '../../shared/page/htmlText';
import { assert } from '../../shared/core/assert';

export type CanvasTextDraft =
  | (CanvasDraftScope & { readonly kind: 'text'; readonly sourceValue: string })
  | (CanvasDraftScope & {
      readonly kind: 'prop';
      readonly prop: string;
      readonly typed: string;
    });

interface CanvasDraftScope {
  readonly session: string;
  readonly projectPath: string;
  readonly file: string;
  readonly nodeID: string;
  readonly value: string;
}

export const canvasTextDraft = createLiveValue<CanvasTextDraft | undefined>(undefined);

export function clearCanvasTextDraft(session: string): void {
  if (canvasTextDraft.get()?.session === session) {
    canvasTextDraft.set(undefined);
  }
}

export function useCanvasTextDraft(scope: { readonly projectPath?: string | undefined; readonly filePath?: string | undefined }): CanvasTextDraft | undefined {
  const draft = useLiveValue(canvasTextDraft);
  if (!draft || !scope.projectPath || !scope.filePath) {
    return undefined;
  }
  const file = projectRelativePath(scope.projectPath, scope.filePath, window.avb?.platform ?? 'linux');
  return draft.projectPath === scope.projectPath && draft.file === file ? draft : undefined;
}

export function canvasDraftValue(node: { readonly id?: string; readonly value: string }, draft: CanvasTextDraft | undefined): string {
  if (draft?.kind !== 'text') {
    return node.value;
  }
  if (node.id !== draft.nodeID || node.value !== draft.sourceValue) {
    return node.value;
  }
  return textValueCanonical(canvasTypedText(node.value, draft.value));
}

const EDGE_START = /^[ \t\n\r\f]+/;
const EDGE_END = /[ \t\n\r\f]+$/;

export function canvasTypedText(source: string, typed: string): string {
  const words = typed.replace(EDGE_START, '').replace(EDGE_END, '');
  if (words === '') {
    return '';
  }
  const start = EDGE_START.test(source) ? ' ' : '';
  const end = EDGE_END.test(source) ? ' ' : '';
  const text = start + words + end;
  assert(text.length <= typed.length + 2, 'Typed text gains at most its two edges');
  return text;
}

export function canvasDraftProp(nodeID: string | undefined, prop: string, draft: CanvasTextDraft | undefined): Attr | undefined {
  if (draft?.kind !== 'prop' || draft.nodeID !== nodeID || draft.prop !== prop) {
    return undefined;
  }
  return { type: 'string', value: draft.value };
}
