
import { assert } from '../core/assert';

export type PseudoLayer = 'before' | 'after';

export function pseudoPath(nodePath: string, pseudo: PseudoLayer): string {
  assert(nodePath.length > 0, 'pseudoPath: a pseudo-element belongs to a node');
  assert(!nodePath.includes('::'), 'pseudoPath: the node path is not already a pseudo path');
  const path = `${nodePath}::${pseudo}`;
  assert(splitPseudoPath(path)?.nodePath === nodePath, 'pseudoPath: the path reads back');
  return path;
}

export function splitPseudoPath(path: string): { readonly nodePath: string; readonly pseudo: PseudoLayer } | undefined {
  const match = /^(.+)::(before|after)$/.exec(path);
  if (match === null) {
    return undefined;
  }
  const nodePath = match[1] ?? '';
  const pseudo = match[2] === 'before' ? 'before' : 'after';
  assert(nodePath.length > 0, 'splitPseudoPath: the node path is not empty');
  return { nodePath, pseudo };
}
