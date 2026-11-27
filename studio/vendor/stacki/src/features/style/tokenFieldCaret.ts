
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { isHTMLElementInDocument } from './model/dom';

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

export type CaretTarget =
  | { readonly kind: 'text'; readonly node: Text; readonly offset: number }
  | { readonly kind: 'chip'; readonly chip: HTMLElement; readonly side: 'before' | 'after' };

export type PressPlacement = { readonly kind: 'browser' } | { readonly kind: 'gap'; readonly target: CaretTarget };

export const CARET_SLOT = '​';

interface FieldItem {
  readonly kind: 'text' | 'chip';
  readonly node: Text | HTMLElement;
  readonly rect: DOMRect;
}

export function caretPlacementAt(field: HTMLElement, point: ClientPoint): PressPlacement {
  assert(Number.isFinite(point.x), 'caretPlacementAt: the press has an x');
  assert(Number.isFinite(point.y), 'caretPlacementAt: the press has a y');
  const items = fieldItems(field);
  if (items.length === 0) {
    return { kind: 'browser' };
  }
  const lineDistance = Math.min(...items.map((item) => verticalDistance(item.rect, point.y)));
  const onLine = items.filter((item) => verticalDistance(item.rect, point.y) === lineDistance);
  assert(onLine.length > 0, 'caretPlacementAt: the nearest line holds an item');
  const overText = onLine.some((item) => item.kind === 'text' && item.rect.width > 0 && item.rect.left <= point.x && point.x <= item.rect.right);
  if (overText) {
    return { kind: 'browser' };
  }
  let best: { readonly target: CaretTarget; readonly distance: number } | undefined;
  for (const item of onLine) {
    const before = { target: edgeTarget(item, 'before'), distance: Math.abs(point.x - item.rect.left) };
    const after = { target: edgeTarget(item, 'after'), distance: Math.abs(point.x - item.rect.right) };
    for (const candidate of [before, after]) {
      if (best === undefined || candidate.distance < best.distance) {
        best = candidate;
      }
    }
  }
  assert(best !== undefined, 'caretPlacementAt: a line with items has an edge');
  return { kind: 'gap', target: best.target };
}

export function placeCaret(field: HTMLElement, target: CaretTarget): void {
  const position = caretPosition(target);
  assert(field.contains(position.node), 'placeCaret: the caret goes inside the field');
  const selection = field.ownerDocument.getSelection();
  if (selection === null) {
    return;
  }
  const range = field.ownerDocument.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  assert(selection.rangeCount === 1, 'placeCaret: the field holds one caret');
}

function caretPosition(target: CaretTarget): { readonly node: Text; readonly offset: number } {
  switch (target.kind) {
    case 'text':
      return { node: target.node, offset: target.offset };
    case 'chip': {
      const parent = target.chip.parentNode;
      assert(parent !== null, 'caretPosition: the chip is in the field');
      const ownerDocument = target.chip.ownerDocument;
      const slot = ownerDocument.createTextNode(CARET_SLOT);
      if (target.side === 'before') {
        parent.insertBefore(slot, target.chip);
        return { node: slot, offset: slot.length };
      }
      parent.insertBefore(slot, target.chip.nextSibling);
      return { node: slot, offset: 0 };
    }
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

function edgeTarget(item: FieldItem, side: 'before' | 'after'): CaretTarget {
  if (item.kind === 'text') {
    assert(item.node.nodeType === 3, 'edgeTarget: a text item is a text node');
    const text = textNodeOf(item.node);
    return { kind: 'text', node: text, offset: side === 'before' ? 0 : text.length };
  }
  assert(isHTMLElementInDocument(item.node, item.node.ownerDocument), 'edgeTarget: a chip item is an element');
  const chip = item.node;
  const neighbour = side === 'before' ? chip.previousSibling : chip.nextSibling;
  if (neighbour !== null && neighbour.nodeType === 3) {
    const text = textNodeOf(neighbour);
    return { kind: 'text', node: text, offset: side === 'before' ? text.length : 0 };
  }
  return { kind: 'chip', chip, side };
}

function fieldItems(field: HTMLElement): readonly FieldItem[] {
  const ownerDocument = field.ownerDocument;
  const items: FieldItem[] = [];
  const walk = (node: Node, depth: number): void => {
    if (depth > LIMITS.treeDepthMax) {
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      if (items.length >= LIMITS.treeNodesMax) {
        return;
      }
      if (child.nodeType === 3) {
        const text = textNodeOf(child);
        if (text.length > 0) {
          items.push({ kind: 'text', node: text, rect: textRect(text) });
        }
      } else if (isHTMLElementInDocument(child, ownerDocument) && child.dataset['chip'] !== undefined) {
        items.push({ kind: 'chip', node: child, rect: child.getBoundingClientRect() });
      } else {
        walk(child, depth + 1);
      }
    }
  };
  walk(field, 0);
  return items.filter((item) => item.rect.width > 0 || item.rect.height > 0);
}

function textRect(text: Text): DOMRect {
  const range = text.ownerDocument.createRange();
  range.selectNodeContents(text);
  return range.getBoundingClientRect();
}

function verticalDistance(rect: DOMRect, y: number): number {
  if (y < rect.top) {
    return rect.top - y;
  }
  if (rect.bottom < y) {
    return y - rect.bottom;
  }
  return 0;
}

function textNodeOf(node: Node): Text {
  const TextConstructor = node.ownerDocument?.defaultView?.Text;
  assert(TextConstructor !== undefined, 'textNodeOf: the node belongs to a window');
  assert(node instanceof TextConstructor, 'textNodeOf: the node is text');
  return node;
}
