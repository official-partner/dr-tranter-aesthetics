
import { isAnchor, MORPH_LIMITS, asElement, asText, asComment } from './morphNodes';

const pinned = (node: Node): boolean => {
  if (!asElement(node)) {
    return false;
  }
  return (
    node.tagName === 'TEMPLATE' ||
    (node.tagName === 'SCRIPT' && !!node.getAttribute('src')) ||
    (node.tagName === 'STYLE' && node.hasAttribute('data-vite-dev-id'))
  );
};

const keyOf = (node: Node | undefined): string | undefined => {
  if (node !== undefined && asElement(node)) {
    const id = node.getAttribute('id');
    if (id) {
      return id;
    }
    if (node.tagName === 'STYLE') {
      return node.getAttribute('data-vite-dev-id') || undefined;
    }
    return undefined;
  }
  return undefined;
};

function keyFor(node: Node): string {
  if (asElement(node)) {
    return 'e:' + node.tagName + '#' + (keyOf(node) || '');
  }
  return asComment(node) ? 'c' : 't';
}

type DiffOp = readonly [kind: number, i: number, j: number];

const EXACT_DIFF_CELLS_MAX = 1_000_000;
const MYERS_EDITS_MAX = 1024;
const MYERS_WORK_MAX = 4_000_000;

export function diffChildren(before: readonly string[], after: readonly string[]): DiffOp[] {
  const beforeCount = before.length;
  const afterCount = after.length;
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeCount && j < afterCount && before[i] === after[j]) {
    ops.push([0, i++, j++]);
  }
  if (i < beforeCount && j < afterCount) {
    if ((beforeCount - i + 1) * (afterCount - j + 1) <= EXACT_DIFF_CELLS_MAX) {
      appendExactDiff(ops, before, after, i);
      return ops;
    }
    appendScalableDiff(ops, before, after, i);
    return ops;
  }
  while (i < beforeCount) {
    ops.push([-1, i++, -1]);
  }
  while (j < afterCount) {
    ops.push([1, -1, j++]);
  }
  return ops;
}

function appendExactDiff(ops: DiffOp[], before: readonly string[], after: readonly string[], start: number): void {
  const beforeCount = before.length;
  const afterCount = after.length;
  let i = start;
  let j = start;
  const dp: Int32Array[] = [];
  for (let row = 0; row <= beforeCount - start; row++) {
    dp.push(new Int32Array(afterCount - start + 1));
  }
  for (let row = beforeCount - start - 1; row >= 0; row--) {
    const currentRow = dp[row];
    const next = dp[row + 1];
    if (!currentRow || !next) {
      continue;
    }
    for (let col = afterCount - start - 1; col >= 0; col--) {
      currentRow[col] = before[row + start] === after[col + start] ? (next[col + 1] ?? 0) + 1 : Math.max(next[col] ?? 0, currentRow[col + 1] ?? 0);
    }
  }
  while (i < beforeCount && j < afterCount) {
    if (before[i] === after[j]) {
      ops.push([0, i++, j++]);
      continue;
    }
    if ((dp[i - start + 1]?.[j - start] ?? 0) >= (dp[i - start]?.[j - start + 1] ?? 0)) {
      ops.push([-1, i++, -1]);
    } else {
      ops.push([1, -1, j++]);
    }
  }
  while (i < beforeCount) {
    ops.push([-1, i++, -1]);
  }
  while (j < afterCount) {
    ops.push([1, -1, j++]);
  }
}

function appendScalableDiff(ops: DiffOp[], before: readonly string[], after: readonly string[], start: number): void {
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (start < beforeEnd && start < afterEnd && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  const middle = myersDiff(before, after, start, beforeEnd, afterEnd) ?? greedyDiff(before, after, start, beforeEnd, afterEnd);
  for (const op of middle) {
    ops.push(op);
  }
  for (let offset = 0; beforeEnd + offset < before.length; offset++) {
    ops.push([0, beforeEnd + offset, afterEnd + offset]);
  }
}

function myersDiff(before: readonly string[], after: readonly string[], start: number, beforeEnd: number, afterEnd: number): DiffOp[] | undefined {
  const beforeCount = beforeEnd - start;
  const afterCount = afterEnd - start;
  if (beforeCount === 0 || afterCount === 0) {
    return trivialDiff(start, beforeEnd, afterEnd);
  }
  const editsLimit = Math.min(beforeCount + afterCount, MYERS_EDITS_MAX);
  const furthest = new Int32Array(2 * editsLimit + 3);
  const middle = editsLimit + 1;
  const trace: Int32Array[] = [];
  let work = 0;
  for (let edits = 0; edits <= editsLimit; edits++) {
    trace.push(furthest.slice(middle - edits, middle + edits + 1));
    for (let diagonal = -edits; diagonal <= edits; diagonal += 2) {
      let x: number;
      if (diagonal === -edits || (diagonal !== edits && (furthest[middle + diagonal - 1] ?? 0) < (furthest[middle + diagonal + 1] ?? 0))) {
        x = furthest[middle + diagonal + 1] ?? 0;
      } else {
        x = (furthest[middle + diagonal - 1] ?? 0) + 1;
      }
      let y = x - diagonal;
      while (x < beforeCount && y < afterCount && before[start + x] === after[start + y]) {
        x++;
        y++;
        work++;
      }
      furthest[middle + diagonal] = x;
      work++;
      if (x >= beforeCount && y >= afterCount) {
        return myersBacktrack(trace, start, beforeCount, afterCount, edits);
      }
    }
    if (MYERS_WORK_MAX < work) {
      return undefined;
    }
  }
  return undefined;
}

function myersBacktrack(trace: readonly Int32Array[], start: number, beforeCount: number, afterCount: number, edits: number): DiffOp[] {
  const reversed: DiffOp[] = [];
  let x = beforeCount;
  let y = afterCount;
  for (let step = edits; step > 0; step--) {
    const frontier = trace[step];
    if (frontier === undefined) {
      throw Ambiguous('trace gap in diff');
    }
    const at = (diagonal: number): number => frontier[diagonal + step] ?? 0;
    const diagonal = x - y;
    const previousDiagonal = diagonal === -step || (diagonal !== step && at(diagonal - 1) < at(diagonal + 1)) ? diagonal + 1 : diagonal - 1;
    const previousX = at(previousDiagonal);
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      reversed.push([0, start + x, start + y]);
    }
    if (x === previousX) {
      reversed.push([1, -1, start + previousY]);
    } else {
      reversed.push([-1, start + previousX, -1]);
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    reversed.push([0, start + x, start + y]);
  }
  if (x !== 0 || y !== 0) {
    throw Ambiguous('trace end in diff');
  }
  return reversed.reverse();
}

function greedyDiff(before: readonly string[], after: readonly string[], start: number, beforeEnd: number, afterEnd: number): DiffOp[] {
  const positions = new Map<string, number[]>();
  for (let j = start; j < afterEnd; j++) {
    const key = after[j];
    if (key === undefined) {
      continue;
    }
    const list = positions.get(key);
    if (list === undefined) {
      positions.set(key, [j]);
    } else {
      list.push(j);
    }
  }
  const cursors = new Map<string, number>();
  const ops: DiffOp[] = [];
  let j = start;
  for (let i = start; i < beforeEnd; i++) {
    const key = before[i];
    const list = key === undefined ? undefined : positions.get(key);
    let cursor = key === undefined ? 0 : (cursors.get(key) ?? 0);
    while (list !== undefined && cursor < list.length && (list[cursor] ?? 0) < j) {
      cursor++;
    }
    const matched = list === undefined ? undefined : list[cursor];
    if (key !== undefined) {
      cursors.set(key, cursor + 1);
    }
    if (matched === undefined) {
      ops.push([-1, i, -1]);
      continue;
    }
    while (j < matched) {
      ops.push([1, -1, j++]);
    }
    ops.push([0, i, j++]);
  }
  while (j < afterEnd) {
    ops.push([1, -1, j++]);
  }
  return ops;
}

function trivialDiff(start: number, beforeEnd: number, afterEnd: number): DiffOp[] {
  const ops: DiffOp[] = [];
  for (let i = start; i < beforeEnd; i++) {
    ops.push([-1, i, -1]);
  }
  for (let j = start; j < afterEnd; j++) {
    ops.push([1, -1, j]);
  }
  return ops;
}

function Ambiguous(what: string): Error {
  return new Error('cannot line up ' + what + ' with the live page');
}

const classesOf = (node: Element): string[] => (node.getAttribute('class') || '').split(/\s+/).filter(Boolean);

function keepsClassesOf(live: Element, serverNode: Element): boolean {
  const want = classesOf(serverNode);
  if (!want.length) {
    return live.classList.length === 0;
  }
  for (const className of want) {
    if (!live.classList.contains(className)) {
      return false;
    }
  }
  return true;
}

export function findLive(from: Node | undefined, serverNode: Node): Node | undefined {
  let loose: Element | undefined = undefined;
  if (!asElement(serverNode)) {
    for (let node = from; node; node = node.nextSibling ?? undefined) {
      if (isAnchor(node)) {
        continue;
      }
      if (node.nodeType === serverNode.nodeType) {
        return node;
      }
    }
    return undefined;
  }
  const key = keyOf(serverNode);
  for (let node = from; node; node = node.nextSibling ?? undefined) {
    if (isAnchor(node)) {
      continue;
    }
    if (!asElement(node)) {
      continue;
    }
    if (node.tagName !== serverNode.tagName) {
      continue;
    }
    if (key !== undefined) {
      if (keyOf(node) === key) {
        return node;
      }
      continue;
    }
    if (keepsClassesOf(node, serverNode)) {
      return node;
    }
    if (!loose) {
      loose = node;
    }
  }
  return loose;
}

function patchClass(live: Element, previous: Element, next: Element): void {
  const before = (previous.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  const after = (next.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  for (const className of before) {
    if (after.indexOf(className) === -1) {
      live.classList.remove(className);
    }
  }
  for (const className of after) {
    if (before.indexOf(className) === -1) {
      live.classList.add(className);
    }
  }
}

export function patchAttrs(live: Element, previous: Element, next: Element): void {
  const want = next.attributes;
  for (let i = 0; i < want.length; i++) {
    const attribute = want[i];
    if (!attribute) {
      continue;
    }
    if (previous.getAttribute(attribute.name) === attribute.value) {
      continue;
    }
    if (attribute.name === 'class') {
      patchClass(live, previous, next);
    } else {
      live.setAttribute(attribute.name, attribute.value);
    }
  }
  const had = previous.attributes;
  for (let i = had.length - 1; i >= 0; i--) {
    const attribute = had[i];
    if (!attribute) {
      continue;
    }
    if (next.hasAttribute(attribute.name)) {
      continue;
    }
    if (attribute.name === 'class') {
      patchClass(live, previous, next);
    } else {
      live.removeAttribute(attribute.name);
    }
  }
}

function patchNode(live: Node, previous: Node, next: Node): void {
  if (previous.isEqualNode(next)) {
    return;
  }
  if (live.nodeType === 3 || live.nodeType === 8) {
    const liveText = asText(live) ? live : asComment(live) ? live : undefined;
    const previousData = (asText(previous) ? previous : asComment(previous) ? previous : undefined)?.data;
    const nextData = (asText(next) ? next : asComment(next) ? next : undefined)?.data;
    if (liveText && previousData !== undefined && nextData !== undefined && previousData !== nextData && liveText.data === previousData) {
      liveText.data = nextData;
    }
    return;
  }
  if (!asElement(live) || pinned(live)) {
    return;
  }
  if (!asElement(previous) || !asElement(next)) {
    return;
  }
  refuseStaleMeasurement(live, previous, next);
  patchAttrs(live, previous, next);
  if (sameChildren(previous, next)) {
    return;
  }
  patchChildren(live, previous, next);
}

const MEASURED_PROPERTIES: ReadonlySet<string> = new Set([
  'block-size',
  'font-size',
  'height',
  'inline-size',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'width',
]);
const STYLE_DECLARATIONS_MAX = 256;

function refuseStaleMeasurement(live: Element, previous: Element, next: Element): void {
  if ((previous.getAttribute('class') || '') === (next.getAttribute('class') || '')) {
    return;
  }
  if (sameChildren(previous, next)) {
    return;
  }
  const measured = pageMeasured(live, previous);
  if (measured === undefined) {
    return;
  }
  throw new Error('the page sized ' + describe(live) + ' (' + measured + ') from markup this edit replaces');
}

export function pageMeasured(live: Element, previous: Element): string | undefined {
  const served = inlineSizing(previous);
  for (const [name, value] of inlineSizing(live)) {
    if (served.get(name) !== value) {
      return name;
    }
  }
  return undefined;
}

function inlineSizing(element: Element): Map<string, string> {
  const sizing = new Map<string, string>();
  const declarations = (element.getAttribute('style') || '').split(';').slice(0, STYLE_DECLARATIONS_MAX);
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':');
    if (colon > 0) {
      const name = declaration.slice(0, colon).trim().toLowerCase();
      if (MEASURED_PROPERTIES.has(name)) {
        sizing.set(name, declaration.slice(colon + 1).trim());
      }
    }
  }
  return sizing;
}

function sameChildren(previous: Element, next: Element): boolean {
  if (previous.childNodes.length !== next.childNodes.length) {
    return false;
  }
  for (let index = 0; index < previous.childNodes.length; index++) {
    const before = previous.childNodes[index];
    const after = next.childNodes[index];
    if (before === undefined || after === undefined || !before.isEqualNode(after)) {
      return false;
    }
  }
  return true;
}

export function patchChildren(liveParent: Element, previousParent: Element, nextParent: Element): void {
  const before: Node[] = [];
  for (let node = previousParent.firstChild; node; node = node.nextSibling) {
    before.push(node);
  }
  const after: Node[] = [];
  for (let node = nextParent.firstChild; node; node = node.nextSibling) {
    after.push(node);
  }

  let live = liveParent.firstChild;
  const locate = (serverNode: Node): Node | undefined => {
    const target = findLive(live ?? undefined, serverNode);
    if (!target && asElement(serverNode) && relocated(serverNode) === undefined && !hasMarker(serverNode)) {
      throw Ambiguous(describe(serverNode) + ' (in ' + describe(liveParent) + ')');
    }
    return target;
  };

  for (const [kind, i, j] of diffChildren(before.map(keyFor), after.map(keyFor))) {
    if (kind === 0) {
      const previousNode = before[i];
      const nextNode = after[j];
      if (previousNode === undefined || nextNode === undefined) {
        throw Ambiguous('index gap in diff');
      }
      const target = locate(previousNode);
      if (target === undefined) {
        patchAway(previousNode, nextNode, 0);
        continue;
      }
      patchNode(target, previousNode, nextNode);
      live = target.nextSibling;
    } else if (kind === -1) {
      const previousNode = before[i];
      if (previousNode === undefined) {
        throw Ambiguous('index gap in diff');
      }
      const target = locate(previousNode);
      if (target === undefined) {
        if (asElement(previousNode)) {
          const moved = relocated(previousNode);
          if (moved === undefined) {
            throw Ambiguous(describe(previousNode) + ' (in ' + describe(liveParent) + ')');
          }
          moved.remove();
        }
        continue;
      }
      if (live === target) {
        live = target.nextSibling;
      }
      const removal = asElement(target) ? target : asText(target) ? target : asComment(target) ? target : undefined;
      removal?.remove();
    } else {
      const nextNode = after[j];
      if (nextNode !== undefined) {
        liveParent.insertBefore(document.importNode(nextNode, true), live);
      }
    }
  }
}

const MARKER_CHARS_MAX = 2048;
const elementOf = (node: Node): Element | undefined => (asElement(node) ? node : undefined);
function markerOf(node: Node): string | undefined {
  const marker = elementOf(node)?.getAttribute('data-avb-p');
  return marker !== null && marker !== undefined && marker.length > 0 && marker.length <= MARKER_CHARS_MAX ? marker : undefined;
}
function hasMarker(node: Node): boolean {
  return markerOf(node) !== undefined;
}
function relocated(serverNode: Node): Element | undefined {
  const marker = markerOf(serverNode);
  if (marker === undefined) {
    return undefined;
  }
  const found = document.querySelectorAll('[data-avb-p="' + marker.replace(/["\\]/g, '\\$&') + '"]');
  const only = found.length === 1 ? found[0] : undefined;
  return only !== undefined && only.tagName === elementOf(serverNode)?.tagName ? only : undefined;
}

function patchAway(previous: Node, next: Node, depth: number): void {
  if (depth > MORPH_LIMITS.domDepthMax) {
    throw Ambiguous('a subtree nested deeper than the patch walks');
  }
  const previousElement = elementOf(previous);
  const nextElement = elementOf(next);
  if (previousElement === undefined || nextElement === undefined) {
    return;
  }
  const moved = relocated(previousElement);
  if (moved !== undefined) {
    patchNode(moved, previousElement, nextElement);
    return;
  }
  if (previousElement.isEqualNode(nextElement)) {
    return;
  }
  const before = Array.from(previousElement.childNodes);
  const after = Array.from(nextElement.childNodes);
  for (const [kind, i, j] of diffChildren(before.map(keyFor), after.map(keyFor))) {
    const previousChild = i >= 0 ? before[i] : undefined;
    const nextChild = j >= 0 ? after[j] : undefined;
    if (kind === 0 && previousChild !== undefined && nextChild !== undefined) {
      patchAway(previousChild, nextChild, depth + 1);
    } else if ((previousChild !== undefined && asElement(previousChild)) || (nextChild !== undefined && asElement(nextChild))) {
      throw Ambiguous(describe(previousElement) + ' children (' + describe(previousElement) + ' is not on the live page)');
    }
  }
}

const describe = (node: Node): string => {
  if (asElement(node)) {
    const className = node.getAttribute('class');
    return '<' + node.tagName.toLowerCase() + (className ? '.' + className.trim().split(/\s+/).slice(0, 3).join('.') : '') + '>';
  }
  if (asComment(node)) {
    return 'marker ' + node.data;
  }
  return 'text';
};
