
import { assert } from '../../shared/core/assert';
import type { PlacementMessage } from '../../shared/page/placement';
import type { DropDecision, DropGuide, DropPoint, DropRect } from './canvasDrop';
import type { Translator } from '../../shared/properties/i18n/messageRef';
import type { InsertDragChoice } from './insertDragData';

export type CanvasDragSubject =
  | { readonly kind: 'element' | 'component' | 'loop' | 'text'; readonly id: string; readonly label: string }
  | { readonly kind: 'new'; readonly label: string; readonly path?: string; readonly choice?: InsertDragChoice };

export type CanvasDropVerdict =
  | { readonly kind: 'valid'; readonly warning: PlacementMessage | undefined }
  | { readonly kind: 'snap'; readonly to: { readonly parentId: string | undefined; readonly index: number }; readonly reason: PlacementMessage }
  | { readonly kind: 'refused'; readonly reason: CanvasDropReason }
  | { readonly kind: 'noop' }
  | { readonly kind: 'none' };

export type CanvasDropReason =
  { readonly kind: 'placement'; readonly message: PlacementMessage } | { readonly kind: 'self' } | { readonly kind: 'no-slot'; readonly name: string };

export function selfRefusal(verdict: CanvasDropVerdict): boolean {
  if (verdict.kind !== 'refused') {
    return false;
  }
  if (verdict.reason.kind === 'self') {
    return true;
  }
  return verdict.reason.kind === 'placement' && verdict.reason.message.reason === 'self-drop';
}

export type NavigatorDropMark =
  { readonly kind: 'gap'; readonly parentId: string | undefined; readonly index: number } | { readonly kind: 'into'; readonly intoId: string };

export interface CanvasDragView {
  readonly subject: CanvasDragSubject;
  readonly decision: DropDecision;
  readonly verdict: CanvasDropVerdict;
  readonly guide: DropGuide | undefined;
  readonly parent: { readonly box: DropRect; readonly path: string | undefined } | undefined;
  readonly navigator: NavigatorDropMark | undefined;
  readonly expand: ReadonlySet<string>;
  readonly revealId: string | undefined;
  readonly dragged: readonly DropRect[];
  readonly pointer: DropPoint;
}

let current: CanvasDragView | undefined;
const listeners = new Set<() => void>();
const LISTENERS_MAX = 64;

export function canvasDragView(): CanvasDragView | undefined {
  return current;
}

export function canvasDragActive(): boolean {
  return current !== undefined;
}

export type NavigatorDragView = Pick<CanvasDragView, 'subject' | 'navigator' | 'expand' | 'revealId' | 'verdict' | 'decision'>;

let navigatorSlice: NavigatorDragView | undefined;

export function navigatorDragView(): NavigatorDragView | undefined {
  return navigatorSlice;
}

function navigatorKey(view: NavigatorDragView): string {
  const mark =
    view.navigator === undefined
      ? ''
      : view.navigator.kind === 'into'
        ? `into:${view.navigator.intoId}`
        : `gap:${view.navigator.parentId ?? ''}:${view.navigator.index}`;
  const subject = view.subject.kind === 'new' ? `new:${view.subject.label}` : view.subject.id;
  const reason =
    view.verdict.kind === 'refused'
      ? JSON.stringify(view.verdict.reason)
      : view.verdict.kind === 'snap'
        ? view.verdict.reason.reason
        : view.verdict.kind === 'valid'
          ? (view.verdict.warning?.reason ?? '')
          : '';
  const loop = view.decision.kind === 'place' && view.decision.loop ? 'loop' : '';
  return [mark, [...view.expand].join(','), view.revealId ?? '', subject, view.verdict.kind, reason, loop].join('\u0000');
}

export function publishCanvasDrag(next: CanvasDragView | undefined): void {
  if (next === current) {
    return;
  }
  current = next;
  if (next === undefined) {
    navigatorSlice = undefined;
  } else if (navigatorSlice === undefined || navigatorKey(navigatorSlice) !== navigatorKey(next)) {
    navigatorSlice = {
      subject: next.subject,
      navigator: next.navigator,
      expand: next.expand,
      revealId: next.revealId,
      verdict: next.verdict,
      decision: next.decision,
    };
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

export interface NavigatorDropShown {
  readonly parentId: string | undefined;
  readonly index: number;
  readonly neighbours: readonly { readonly id: string; readonly index: number }[];
}

let navigatorDrop: NavigatorDropShown | undefined;

export function navigatorDropShown(): NavigatorDropShown | undefined {
  return navigatorDrop;
}

export function publishNavigatorDrop(next: NavigatorDropShown | undefined): void {
  if (next === navigatorDrop) {
    return;
  }
  if (next !== undefined && navigatorDrop !== undefined) {
    if (next.parentId === navigatorDrop.parentId && next.index === navigatorDrop.index) {
      return;
    }
  }
  navigatorDrop = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeCanvasDrag(listener: () => void): () => void {
  assert(listeners.size < LISTENERS_MAX, 'subscribeCanvasDrag: subscribers stay inside their bound');
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dropReasonText(view: Pick<CanvasDragView, 'decision' | 'verdict'>, translate: Translator): string | undefined {
  const verdict = view.verdict;
  switch (verdict.kind) {
    case 'refused':
      switch (verdict.reason.kind) {
        case 'placement':
          return translate(verdict.reason.message.messageKey, verdict.reason.message.params);
        case 'self':
          return translate('preview.drag.self');
        case 'no-slot':
          return translate('preview.drag.noSlot', { name: verdict.reason.name });
        default: {
          const exhaustive: never = verdict.reason;
          return exhaustive;
        }
      }
    case 'snap':
      return translate('structure.placement.snapped', { reason: translate(verdict.reason.messageKey, verdict.reason.params) });
    case 'valid':
      if (verdict.warning !== undefined) {
        return translate(verdict.warning.messageKey, verdict.warning.params);
      }
      return view.decision.kind === 'place' && view.decision.loop ? translate('preview.drag.intoLoop') : undefined;
    case 'none':
      return translate('preview.drag.outside');
    case 'noop':
      return undefined;
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}
