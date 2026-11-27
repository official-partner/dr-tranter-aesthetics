
import { assert } from '../../../../shared/core/assert';
import type { StyleContext } from './resolved';

export type ContextAfterDevice = { readonly kind: 'keep' } | { readonly kind: 'base' };

export type DeviceTarget = { readonly kind: 'desktop' } | { readonly kind: 'other'; readonly device: string };

export function deviceTargetOf(device: string): DeviceTarget {
  return device === 'desktop' ? { kind: 'desktop' } : { kind: 'other', device };
}

export type ContextQuery = { readonly kind: 'base' } | { readonly kind: 'media' } | { readonly kind: 'other' };

export function contextQueryOf(context: Pick<StyleContext, 'key' | 'breakpoint' | 'embedAtContext'>): ContextQuery {
  if (context.key === '') {
    return { kind: 'base' };
  }
  const atContext = context.embedAtContext;
  if (atContext === undefined || atContext === '') {
    if (context.breakpoint !== undefined && context.breakpoint !== 'main') {
      return { kind: 'media' };
    }
    return { kind: 'other' };
  }
  const innermost = (atContext.split(' › ').pop() ?? '').trim().toLowerCase();
  assert(innermost.length > 0, 'contextQueryOf: an at-context names a query');
  return /^@media\b/.test(innermost) ? { kind: 'media' } : { kind: 'other' };
}

export function contextAfterDevice(context: Pick<StyleContext, 'key' | 'breakpoint' | 'embedAtContext'>, target: DeviceTarget): ContextAfterDevice {
  const query = contextQueryOf(context);
  switch (target.kind) {
    case 'other':
      return { kind: 'keep' };
    case 'desktop':
      switch (query.kind) {
        case 'media':
          return { kind: 'base' };
        case 'base':
        case 'other':
          return { kind: 'keep' };
        default: {
          const exhaustive: never = query;
          return exhaustive;
        }
      }
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}
