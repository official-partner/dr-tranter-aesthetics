
export type StyleHome = { readonly kind: 'page' } | { readonly kind: 'stylesheet'; readonly rel: string };

export type ClassReach = { readonly kind: 'onlyHere' } | { readonly kind: 'page' } | { readonly kind: 'files'; readonly files: readonly string[] };

export interface MoveStyleCandidate {
  readonly name: string;
  readonly homes: readonly StyleHome[];
  readonly reach: ClassReach;
}
