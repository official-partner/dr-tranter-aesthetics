
import { assert } from '../../../../shared/core/assert';
import { queryWidthMatch } from './queryWidth';

export const FOLLOW_CONTEXTS_MAX = 512;

export interface FollowContext {
  readonly key: string;
  readonly embedAtContext?: string | undefined;
}

export function followedContextKey(contexts: readonly FollowContext[], widthPx: number, rootFontSizePx: number): string {
  assert(contexts.length <= FOLLOW_CONTEXTS_MAX, 'followedContextKey: the context list is within its bound');
  assert(Number.isFinite(widthPx), 'followedContextKey: a canvas width is a number');
  let best: { readonly key: string; readonly lowerPx: number; readonly upperPx: number } | undefined;
  for (const context of contexts) {
    const atContext = context.embedAtContext ?? '';
    if (context.key === '' || atContext === '') {
      continue;
    }
    const match = queryWidthMatch(atContext, widthPx, rootFontSizePx);
    if (match.kind !== 'match') {
      continue;
    }
    if (best === undefined || moreSpecific(match, best)) {
      best = { key: context.key, lowerPx: match.lowerPx, upperPx: match.upperPx };
    }
  }
  return best === undefined ? '' : best.key;
}

function moreSpecific(
  candidate: { readonly lowerPx: number; readonly upperPx: number },
  held: { readonly lowerPx: number; readonly upperPx: number },
): boolean {
  const candidateSpan = candidate.upperPx - candidate.lowerPx;
  const heldSpan = held.upperPx - held.lowerPx;
  if (candidateSpan !== heldSpan) {
    return candidateSpan < heldSpan;
  }
  if (candidate.lowerPx !== held.lowerPx) {
    return candidate.lowerPx > held.lowerPx;
  }
  return candidate.upperPx < held.upperPx;
}
