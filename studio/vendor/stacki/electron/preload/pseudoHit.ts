
import { assert } from '../../shared/core/assert';
import { type PseudoLayer } from '../../shared/page/pseudoPath';
import { type Box } from './frameBasics';

export const PSEUDO_CANDIDATES_MAX = 8;

export interface PseudoBoxes {
  readonly before: Box | undefined;
  readonly after: Box | undefined;
}

export interface PseudoHit {
  readonly index: number;
  readonly pseudo: PseudoLayer;
}

export function pseudoAt(x: number, y: number, candidates: readonly PseudoBoxes[]): PseudoHit | undefined {
  assert(Number.isFinite(x), 'pseudoAt: x is a finite number');
  assert(Number.isFinite(y), 'pseudoAt: y is a finite number');
  assert(candidates.length <= PSEUDO_CANDIDATES_MAX, 'pseudoAt: candidates are capped');
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    assert(candidate !== undefined, 'pseudoAt: the index is inside the list');
    if (candidate.after !== undefined && boxHolds(candidate.after, x, y)) {
      return { index, pseudo: 'after' };
    }
    if (candidate.before !== undefined && boxHolds(candidate.before, x, y)) {
      return { index, pseudo: 'before' };
    }
  }
  return undefined;
}

export function boxAt(offset: Box, hostLeft: number, hostTop: number): Box {
  assert(offset.left <= offset.right, 'boxAt: the offset box is not inverted horizontally');
  assert(offset.top <= offset.bottom, 'boxAt: the offset box is not inverted vertically');
  return { left: offset.left + hostLeft, top: offset.top + hostTop, right: offset.right + hostLeft, bottom: offset.bottom + hostTop };
}

export function boxHolds(box: Box, x: number, y: number): boolean {
  if (box.right <= box.left) {
    return false;
  }
  if (box.bottom <= box.top) {
    return false;
  }
  if (x < box.left) {
    return false;
  }
  if (x > box.right) {
    return false;
  }
  if (y < box.top) {
    return false;
  }
  return y <= box.bottom;
}

export function pseudoOffered(options: { readonly inComponent: boolean; readonly content: string; readonly pointerEvents: string }): boolean {
  const { inComponent, content, pointerEvents } = options;
  assert(typeof content === 'string', 'pseudoOffered: content is a string');
  if (pointerEvents === 'none') {
    return false;
  }
  return inComponent ? pseudoRendersText(content) : true;
}

export function pseudoRendersText(content: string): boolean {
  const bare = content.replace(/url\((?:[^)"']|"[^"]*"|'[^']*')*\)/g, '');
  const strings = bare.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) ?? [];
  const text = strings.map((part) => part.slice(1, -1).replace(/\\(.)/g, '$1')).join('');
  if (text.trim() !== '') {
    return true;
  }
  return /\b(?:attr|counters?)\(/.test(bare);
}
