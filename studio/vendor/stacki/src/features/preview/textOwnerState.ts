import { assert } from '../../../shared/core/assert';
import type { TextMarks } from './previewMessages';

export type OwnerState = 'none' | 'field' | 'selected' | 'resting' | 'body-hover';

export interface OwnerOutline {
  readonly ownable: boolean;
  readonly path: string;
  readonly slot: 'hover' | 'sel' | 'highlight';
  readonly pointedAt: boolean;
}

export function ownerState(marks: TextMarks | undefined, outline: OwnerOutline): OwnerState {
  if (outline.slot === 'highlight' || marks === undefined || !outline.ownable) {
    return 'none';
  }
  assert(
    new Set([marks.hover?.scope, marks.picked?.scope].filter((scope) => scope !== undefined)).size <= 2,
    'Words hovered and picked name at most two owners',
  );
  const { hover, picked } = marks;
  if (hover?.scope === outline.path) {
    if (picked?.scope === outline.path) {
      return 'resting';
    }
    return outline.slot === 'sel' ? 'selected' : 'field';
  }
  if (picked?.scope === outline.path) {
    return outline.pointedAt && hover === undefined ? 'body-hover' : 'resting';
  }
  return 'none';
}

export function ownerClasses(marks: TextMarks | undefined, outline: OwnerOutline): string {
  const state = ownerState(marks, outline);
  const own = state === 'field' ? ' text-owner' : state === 'resting' ? ' text-owner owner-tag' : '';
  if (outline.slot !== 'sel') {
    return own;
  }
  return `${own}${state !== 'none' && marks?.picked?.scope === outline.path ? ' parent' : ''}${state === 'body-hover' ? ' tinted' : ''}`;
}
