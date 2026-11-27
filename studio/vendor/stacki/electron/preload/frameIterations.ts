
import { assert } from '../../shared/core/assert';
import { ITERATION_LIMITS, parseIterationMarker, type PreviewIteration } from '../../shared/page/previewIteration';
import { isComment, isElement, isText } from './frameBasics';
import { parentPath } from './framePaths';

interface Mark extends PreviewIteration {
  readonly anchor: Node;
}

let marks: Mark[] = [];

export const isIterationData = (data: string): boolean => parseIterationMarker(data) !== undefined;

function anchorAfter(comment: Comment): Node | undefined {
  for (let node = comment.nextSibling; node; node = node.nextSibling) {
    if (isComment(node) && node.data.startsWith('avb-')) {
      continue;
    }
    if (isElement(node) && node.tagName === 'TEMPLATE' && node.getAttribute('data-avb-s') !== null) {
      continue;
    }
    if (isElement(node) && node.tagName === 'TEMPLATE' && node.getAttribute('data-avb-e') !== null) {
      continue;
    }
    if (isText(node) && node.textContent.trim() === '') {
      continue;
    }
    return node;
  }
  return undefined;
}

export function recordIterationMarks(comments: readonly Comment[]): void {
  assert(comments.length <= ITERATION_LIMITS.marksMax * 2, 'recordIterationMarks: a page holds a bounded number of passes');
  marks = marks.filter((mark) => mark.anchor.isConnected);
  for (const comment of comments) {
    const read = parseIterationMarker(comment.data);
    const anchor = anchorAfter(comment);
    if (read !== undefined && anchor !== undefined) {
      marks.push({ ...read, anchor });
    }
  }
  if (marks.length > ITERATION_LIMITS.marksMax) {
    marks = marks.slice(marks.length - ITERATION_LIMITS.marksMax);
  }
  assert(marks.length <= ITERATION_LIMITS.marksMax, 'recordIterationMarks: the kept marks are bounded');
}

function holds(anchor: Node, node: Node): boolean {
  if (anchor === node || anchor.contains(node)) {
    return true;
  }
  return (anchor.compareDocumentPosition(node) & 4) !== 0;
}

export function iterationsOf(node: Node, loopPaths: readonly string[]): PreviewIteration[] {
  assert(loopPaths.length <= ITERATION_LIMITS.loopsMax * 4, 'iterationsOf: a node sits in a bounded number of ancestors');
  const found: PreviewIteration[] = [];
  for (const path of loopPaths) {
    let latest: Mark | undefined = undefined;
    for (const mark of marks) {
      if (mark.path !== path || !mark.anchor.isConnected || !holds(mark.anchor, node)) {
        continue;
      }
      if (latest === undefined || (latest.anchor !== mark.anchor && latest.anchor.compareDocumentPosition(mark.anchor) & 4)) {
        latest = mark;
      }
    }
    if (latest !== undefined) {
      found.push({ path, index: latest.index });
    }
  }
  assert(found.length <= loopPaths.length, 'iterationsOf: at most one pass per loop');
  return found.slice(0, ITERATION_LIMITS.loopsMax);
}

export function forgetIterationMarks(): void {
  marks = [];
}

export function iterationsForRun(nodePath: string, run: readonly Node[] | undefined): PreviewIteration[] {
  const node = run?.find(isElement) ?? run?.[0];
  if (node === undefined) {
    return [];
  }
  const loopPaths: string[] = [];
  for (let path = parentPath(nodePath); path !== undefined && loopPaths.length < ITERATION_LIMITS.loopsMax * 4; path = parentPath(path)) {
    loopPaths.push(path);
  }
  return iterationsOf(node, loopPaths);
}
