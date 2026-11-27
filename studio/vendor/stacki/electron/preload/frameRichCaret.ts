import { caretByGeometry, selectTextOffsets } from './frameTextSelection';

const CARET_LIMITS = { nodesMax: 5_000, depthMax: 64 } as const;
const STRUCTURAL_TAGS: ReadonlySet<string> = new Set(['UL', 'OL', 'HR', 'TABLE', 'TBODY', 'TR', 'FIGURE']);
const LINE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote';

interface CaretPoint {
  readonly node: Node;
  readonly offset: number;
}

type Owned = (node: Node) => boolean;

function structural(container: Element, target: unknown): boolean {
  return target === container || (target instanceof Element && container.contains(target) && STRUCTURAL_TAGS.has(target.tagName));
}

function distance(box: DOMRect, x: number, y: number) {
  return { down: Math.max(box.top - y, 0, y - box.bottom), across: Math.max(box.left - x, 0, x - box.right) };
}

function lines(container: Element, owned: Owned): { readonly node: Node; readonly box: DOMRect }[] {
  const found: { node: Node; box: DOMRect }[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  for (let step = 0; node && step < CARET_LIMITS.nodesMax; step++, node = walker.nextNode()) {
    let top: Node = node;
    for (let depth = 0; top.parentNode && top.parentNode !== container && depth < CARET_LIMITS.depthMax; depth++) {
      top = top.parentNode;
    }
    if (!owned(top)) {
      continue;
    }
    if (node instanceof Text) {
      if (node.data.trim() !== '') {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of Array.from(typeof range.getClientRects === 'function' ? range.getClientRects() : [])) {
          found.push({ node, box });
        }
      }
    } else if (node instanceof Element && node.matches(LINE_SELECTOR) && (node.textContent ?? '').trim() === '' && !node.querySelector(LINE_SELECTOR)) {
      found.push({ node, box: node.getBoundingClientRect() });
    }
  }
  return found;
}

function wordsAround(container: Element, node: Node): Text[] {
  const block = node.parentElement?.closest(LINE_SELECTOR) ?? undefined;
  const root = block !== undefined && container.contains(block) ? block : container;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const words: Text[] = [];
  let next = walker.nextNode();
  for (let step = 0; next && step < CARET_LIMITS.nodesMax; step++, next = walker.nextNode()) {
    if (next instanceof Text && next.data.trim() !== '' && (next.parentElement?.closest(LINE_SELECTOR) ?? undefined) === block) {
      words.push(next);
    }
  }
  return words;
}

function nearestCaret(container: Element, owned: Owned, x: number, y: number): CaretPoint | undefined {
  let best: { readonly node: Node; readonly down: number; readonly across: number } | undefined;
  for (const line of lines(container, owned)) {
    const { down, across } = distance(line.box, x, y);
    if (best === undefined || down < best.down || (down === best.down && across < best.across)) {
      best = { node: line.node, down, across };
    }
  }
  if (best === undefined) {
    return undefined;
  }
  if (!(best.node instanceof Text)) {
    return { node: best.node, offset: 0 };
  }
  const words = wordsAround(container, best.node);
  const offset = caretByGeometry(words, x, y)?.start;
  if (offset === undefined) {
    return undefined;
  }
  selectTextOffsets(words, { start: offset, end: offset });
  const selection = window.getSelection();
  return selection?.focusNode ? { node: selection.focusNode, offset: selection.focusOffset } : undefined;
}

function select(point: CaretPoint, anchor: CaretPoint | undefined): void {
  const from = anchor ?? point;
  window.getSelection()?.setBaseAndExtent(from.node, from.offset, point.node, point.offset);
}

export function openingCaret(container: Element, owned: Owned, at: Pick<MouseEvent, 'clientX' | 'clientY' | 'target'>): void {
  const native = document.caretRangeFromPoint(at.clientX, at.clientY) ?? undefined;
  const onWords = !structural(container, at.target) && native !== undefined && native.startContainer !== container && container.contains(native.startContainer);
  if (onWords) {
    select({ node: native.startContainer, offset: native.startOffset }, undefined);
    return;
  }
  const point = nearestCaret(container, owned, at.clientX, at.clientY);
  if (point === undefined) {
    select({ node: container, offset: container.childNodes.length }, undefined);
    return;
  }
  if (point.node instanceof Element && point.node !== container && point.node.childNodes.length === 0) {
    point.node.append(document.createElement('br'));
  }
  select(point, undefined);
}

export function installRichPointer(container: Element, owned: Owned, signal: AbortSignal): void {
  let anchor: CaretPoint | undefined;
  window.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 0 || !structural(container, event.target)) {
        return;
      }
      const selection = window.getSelection();
      const extended =
        event.shiftKey && selection?.anchorNode && container.contains(selection.anchorNode)
          ? { node: selection.anchorNode, offset: selection.anchorOffset }
          : undefined;
      const point = nearestCaret(container, owned, event.clientX, event.clientY);
      if (point !== undefined) {
        event.preventDefault();
        select(point, extended);
        anchor = extended ?? point;
      }
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'mousemove',
    (event) => {
      if (anchor === undefined) {
        return;
      }
      if ((event.buttons & 1) === 0) {
        anchor = undefined;
        return;
      }
      const from = anchor;
      const point = nearestCaret(container, owned, event.clientX, event.clientY);
      if (point !== undefined) {
        select(point, from);
      }
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'mouseup',
    () => {
      anchor = undefined;
    },
    { capture: true, signal },
  );
}
