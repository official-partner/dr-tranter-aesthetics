
import { assert } from '../../../../shared/core/assert';
import type { StyleTagScope } from '../../../../shared/properties/newStyleTag';

export const CREATE_STYLE_TAG_KEY = '__create-style-tag__';

export interface StyleTagFact {
  readonly key: string;
  readonly scope: StyleTagScope;
  readonly variables: 'defined' | 'none';
  readonly order: number;
}

export interface DefaultTargetInput {
  readonly tags: readonly StyleTagFact[];
  readonly preferredScope: StyleTagScope;
  readonly fileCanHoldTag: 'yes' | 'no';
  readonly chosenFileKey?: string;
}

export type DefaultTarget =
  | { readonly kind: 'tag'; readonly key: string }
  | { readonly kind: 'file'; readonly key: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'none' };

export function defaultStyleTarget(input: DefaultTargetInput): DefaultTarget {
  if (input.chosenFileKey !== undefined) {
    return { kind: 'file', key: input.chosenFileKey };
  }
  const ordered = [...input.tags].sort((left, right) => left.order - right.order);
  assert(ordered.length === input.tags.length, 'defaultStyleTarget: sorting keeps every tag');
  const first = ordered[0];
  if (first === undefined) {
    return input.fileCanHoldTag === 'yes' ? { kind: 'create' } : { kind: 'none' };
  }
  const usable = ordered.filter((tag) => tag.variables === 'none');
  const matching = usable.find((tag) => tag.scope === input.preferredScope);
  const chosen = matching ?? usable[0] ?? first;
  return { kind: 'tag', key: chosen.key };
}

export interface StyleSourceFact {
  readonly key: string;
  readonly label: string;
  readonly originKind: 'file' | 'node' | 'astro';
}

export function chosenFileSourceKey(sources: readonly StyleSourceFact[], chosenPath: string | undefined): string | undefined {
  if (chosenPath === undefined) {
    return undefined;
  }
  return sources.find((source) => source.originKind === 'file' && source.label === chosenPath)?.key;
}

export function defaultTargetKey(target: DefaultTarget): string | undefined {
  switch (target.kind) {
    case 'tag':
    case 'file':
      return target.key;
    case 'create':
      return CREATE_STYLE_TAG_KEY;
    case 'none':
      return undefined;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

export function isCreateStyleTagKey(key: string | undefined): boolean {
  return key === CREATE_STYLE_TAG_KEY;
}
