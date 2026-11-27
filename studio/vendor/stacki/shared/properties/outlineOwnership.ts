import { assert } from '../core/assert';

export type OutlineKind = 'component' | 'map' | 'element';

export interface OutlineSubject {
  readonly insideComponent: boolean;
  readonly insideSlot: boolean;
  readonly nodeKind: OutlineKind;
}

export type Ownership = 'slot' | 'component';

export function ownershipOf(paths: readonly string[]): Ownership {
  assert(paths.length <= 64, 'ownershipOf: an element carries a bounded number of paths');
  return paths.length > 0 && paths.every((path) => !path.includes('|')) ? 'slot' : 'component';
}

export function outlineKind(subject: OutlineSubject): OutlineKind {
  const owned = subject.insideComponent && !subject.insideSlot;
  const kind: OutlineKind = owned ? 'component' : subject.nodeKind;
  assert(!owned || kind === 'component', "outlineKind: an element inside a component with no slot ancestor is the component's, never plain");
  assert(subject.insideComponent || !subject.insideSlot, 'outlineKind: a slot ancestor needs a component around it');
  return kind;
}
