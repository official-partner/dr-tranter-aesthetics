import { assert } from '../core/assert';

const LABELLED_KINDS: ReadonlySet<string> = new Set(['element', 'component']);

export function labelsNode(noteKind: string, nodeKind: string): boolean {
  assert(noteKind.length > 0, 'labelsNode: a note has a kind');
  assert(nodeKind.length > 0, 'labelsNode: a node has a kind');
  if (noteKind === 'comment') {
    return LABELLED_KINDS.has(nodeKind);
  }
  return false;
}
