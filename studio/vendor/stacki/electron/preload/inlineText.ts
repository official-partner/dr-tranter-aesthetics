
import { assert } from '../../shared/core/assert';
import { isElement, isText } from './frameBasics';
import { elementsWithPath, pathsOf, runsOf } from './frameRegions';

const INLINE_LIMITS = { childrenMax: 4096, containersMax: 256, descendantsMax: 4096 } as const;

interface InlinePlace {
  readonly parent: string;
  readonly index: number;
}

export function inlinePlace(nodePath: string): InlinePlace | undefined {
  const dot = nodePath.lastIndexOf('.');
  if (dot <= 0) {
    return undefined;
  }
  const parent = nodePath.slice(0, dot);
  const digits = nodePath.slice(dot + 1);
  if (!/^\d+$/.test(digits)) {
    return undefined;
  }
  const index = Number(digits);
  if (!Number.isSafeInteger(index)) {
    return undefined;
  }
  assert(parent.length > 0, 'An inline place has a parent path');
  assert(index >= 0, 'An inline place has a non-negative index');
  return { parent, index };
}

export function inlineTextRuns(nodePath: string): Text[][] {
  const place = inlinePlace(nodePath);
  if (!place) {
    return [];
  }
  const containers = parentContainers(place.parent).slice(0, INLINE_LIMITS.containersMax);
  const out: Text[][] = [];
  for (const container of containers) {
    const run = textInContainer(container, place);
    if (run.length > 0) {
      out.push(run);
    }
  }
  return out;
}

function parentContainers(parent: string): Element[] {
  const fromRuns = (runsOf(parent) ?? []).flatMap((run) => run.filter(isElement));
  return fromRuns.length ? fromRuns : elementsWithPath(parent);
}

function siblingIndex(element: Element, parent: string): number | undefined {
  const prefix = parent + '.';
  for (const token of pathsOf(element)) {
    if (token.startsWith(prefix)) {
      const place = inlinePlace(token);
      if (place?.parent === parent) {
        return place.index;
      }
    }
  }
  return undefined;
}

function runHost(container: Element, parent: string): Element | undefined {
  const tagged = container.querySelectorAll('[data-avb-p]');
  const count = Math.min(tagged.length, INLINE_LIMITS.descendantsMax);
  for (let at = 0; at < count; at += 1) {
    const element = tagged.item(at);
    assert(element !== null, 'A tagged descendant within the count exists');
    if (siblingIndex(element, parent) !== undefined) {
      return element.parentElement ?? undefined;
    }
  }
  return container;
}

function textInContainer(container: Element, place: InlinePlace): Text[] {
  const host = runHost(container, place.parent);
  if (!host) {
    return [];
  }
  const children = Array.from(host.childNodes);
  if (children.length > INLINE_LIMITS.childrenMax) {
    return [];
  }
  let before = -1;
  let gap: Text[] = [];
  for (const child of children) {
    const index = isElement(child) ? siblingIndex(child, place.parent) : undefined;
    if (index === undefined) {
      if (before === place.index - 1) {
        if (isText(child)) {
          if (child.data.trim()) {
            gap.push(child);
          }
        }
      }
      continue;
    }
    if (before === place.index - 1) {
      return index === place.index + 1 ? gap : [];
    }
    if (index <= before) {
      return [];
    }
    before = index;
    gap = [];
  }
  return before === place.index - 1 ? gap : [];
}

export function inlineTextPathAt(parent: string, x: number, y: number): string | undefined {
  if (typeof document.caretRangeFromPoint !== 'function') {
    return undefined;
  }
  const range = document.caretRangeFromPoint(x, y);
  const text = range?.startContainer;
  if (!text || !isText(text) || !text.data.trim() || !text.parentElement) {
    return undefined;
  }
  if (!textHoldsPoint(text, x, y)) {
    return undefined;
  }
  const index = unmarkedIndex(text, parent);
  return index === undefined ? undefined : `${parent}.${index}`;
}

function textHoldsPoint(text: Text, x: number, y: number): boolean {
  const range = document.createRange();
  range.selectNodeContents(text);
  for (const box of Array.from(range.getClientRects())) {
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      return true;
    }
  }
  return false;
}

function unmarkedIndex(text: Text, parent: string): number | undefined {
  const host = text.parentElement;
  assert(host !== null, 'A text under the pointer has an element');
  const children = Array.from(host.childNodes);
  if (children.length > INLINE_LIMITS.childrenMax) {
    return undefined;
  }
  let before = -1;
  let tagged = 0;
  let index: number | undefined;
  for (const child of children) {
    const sibling = isElement(child) ? siblingIndex(child, parent) : undefined;
    if (child === text) {
      index = before + 1;
    } else if (sibling !== undefined) {
      tagged += 1;
      if (index !== undefined) {
        return tagged > 0 && sibling === index + 1 ? index : undefined;
      }
      if (sibling <= before) {
        return undefined;
      }
      before = sibling;
    }
  }
  return index !== undefined && tagged > 0 ? index : undefined;
}
