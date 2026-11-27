
import type { CanvasTextBlocked, CanvasTextCatalog, CanvasTextTarget } from '../../shared/properties/canvasText';
import { assert } from '../../shared/core/assert';
import { ownershipOf, type Ownership } from '../../shared/properties/outlineOwnership';
import { isEditableThroughProps, textReach } from '../../shared/properties/closedComponentReach';
import { elementsWithPath, pathsOf, runsOf } from './frameRegions';
import { inlineTextRuns } from './inlineText';
import { ownClasses } from './frameMeasure';
import { elementsAt, matchCanvasText } from './frameTextMatch';

const MATCHES_MAX = 200;

interface MarkSource {
  readonly catalog: () => CanvasTextCatalog | undefined;
  readonly editing: () => string | undefined;
  readonly editingElement: () => Element | undefined;
  readonly focus: () => ReadonlySet<string>;
  readonly visible: () => boolean;
  readonly post: (message: unknown) => void;
}

interface TextMatchAt {
  readonly target: CanvasTextTarget;
  readonly element: Element;
  readonly nodes: readonly Text[];
}

export function installTextMarks(source: MarkSource): () => void {
  const layer = document.createElement('div');
  layer.setAttribute('data-avb-text-marks', '');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;contain:strict;';
  let frame = 0;
  let pointer: { readonly x: number; readonly y: number } | undefined;
  let held = false;
  let picked: string | undefined;
  let awaiting: { readonly key: string; readonly scope: string } | undefined;
  let reported = '';
  const draw = () => {
    frame = 0;
    const shown = markedNow(source);
    const editing = source.editing();
    const typing = shown.some(({ target }) => sameKey(target.key, editing));
    if (awaiting !== undefined && source.focus().has(awaiting.scope)) {
      awaiting = undefined;
    }
    picked = typing
      ? shown.find(({ target }) => sameKey(target.key, editing))?.target.key
      : shown.some(({ target }) => target.key === picked) || awaiting?.key === picked
        ? picked
        : undefined;
    const at = held ? undefined : pointer;
    const hover = at ? (shown.find((match) => holds(wordsBox(match), at) && reachable(match, at)) ?? hoverBeforeSelect(source, at)) : undefined;
    const chosen =
      shown.find(({ target }) => target.key === picked) ??
      (awaiting === undefined ? undefined : matchesWhere(source.catalog(), (target) => target.key === awaiting?.key)[0]);
    if (!layer.isConnected) {
      document.documentElement.appendChild(layer);
    }
    const refused = at && hover === undefined ? refusedAt(source, at) : undefined;
    const bound = boundBoxesNow(source).filter((box) => !sameBox(box, refused));
    layer.replaceChildren(
      ...shown.filter((match) => match !== hover && match !== chosen).map((match) => dashedMark(wordsBox(match))),
      ...bound.map(dashedMark),
    );
    const message = { type: 'avb:text-marks', hover: refused, picked: report(chosen) };
    const text = JSON.stringify(message);
    if (text !== reported) {
      reported = text;
      source.post(message);
    }
  };
  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(draw);
    }
  };
  window.addEventListener('pointermove', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    held = event.buttons !== 0;
    schedule();
  });
  window.addEventListener('pointerout', (event) => {
    if (event.relatedTarget === null) {
      pointer = undefined;
      schedule();
    }
  });
  window.addEventListener(
    'click',
    (event) => {
      const at = { x: event.clientX, y: event.clientY };
      const hit = markedNow(source).find((match) => holds(wordsBox(match), at) && reachable(match, at)) ?? hoverBeforeSelect(source, at);
      picked = hit?.target.key;
      const scope = hit?.target.scope;
      awaiting = hit !== undefined && scope !== undefined && !source.focus().has(scope) ? { key: hit.target.key, scope } : undefined;
      schedule();
    },
    true,
  );
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('avb:morphed', schedule);
  return schedule;
}

function markedNow(source: MarkSource): TextMatchAt[] {
  const focus = source.focus();
  if (!source.visible()) {
    return [];
  }
  const editing = source.editing();
  const element = source.editingElement();
  const typed = source.catalog()?.targets.find((target) => sameKey(target.key, editing));
  const typing = typed && element ? [{ target: typed, element, nodes: [] }] : [];
  const others = matchesWhere(source.catalog(), (target) => marked(target, focus) && !sameKey(target.key, editing));
  return [...typing, ...others].filter((match) => !isInstanceRoot(match.element, match.target.scope) || drawnAsRun(match));
}

function reachable(match: TextMatchAt, at: { readonly x: number; readonly y: number }): boolean {
  if (typeof document.elementsFromPoint !== 'function' && typeof document.elementFromPoint !== 'function') {
    return true;
  }
  const top = elementsAt(at.x, at.y)[0];
  if (top === undefined) {
    return false;
  }
  if (match.element.contains(top)) {
    return true;
  }
  return match.target.scope !== undefined && withinScope(top, match.target);
}

function hoverBeforeSelect(source: MarkSource, at: { readonly x: number; readonly y: number }): TextMatchAt | undefined {
  const catalog = source.catalog();
  if (!catalog || !source.visible()) {
    return undefined;
  }
  const ancestors = ancestorPaths(at);
  if (ancestors.size === 0) {
    return undefined;
  }
  let best: TextMatchAt | undefined;
  for (const target of catalog.targets) {
    if (target.from === undefined || target.scope === undefined || !ancestors.has(target.scope) || !ancestors.has(target.parent)) {
      continue;
    }
    if (!isEditableThroughProps(textReach({ loaded: true, covering: target }))) {
      continue;
    }
    for (const match of matchesWhere(catalog, (candidate) => candidate === target)) {
      if (pathsOf(match.element).includes(target.scope) && !drawnAsRun(match)) {
        continue;
      }
      if (!holds(wordsBox(match), at) || !reachable(match, at)) {
        continue;
      }
      if (best === undefined || best.element.contains(match.element)) {
        best = match;
      }
    }
  }
  return best;
}

function refusedAt(source: MarkSource, at: { readonly x: number; readonly y: number }) {
  const catalog = source.catalog();
  if (!catalog?.blocked || !source.visible()) {
    return undefined;
  }
  assert(isEditableThroughProps(textReach({ loaded: true, covering: { from: 'prop' } })), 'Text a prop prints is the instance’s to change');
  for (const entry of catalog.blocked.filter(isPropBlocked)) {
    for (const element of blockedElements(entry)) {
      const box = element.getBoundingClientRect();
      if (holds(box, at)) {
        return { x: box.left, y: box.top, w: box.width, h: box.height, label: labelOf(element).label, kind: 'refused' };
      }
    }
  }
  return undefined;
}

function isPropBlocked(entry: CanvasTextBlocked): boolean {
  return /(^|:)prop:/.test(entry.key);
}

function blockedElements(entry: CanvasTextBlocked): Element[] {
  const found: Element[] = [];
  const runs = [...(runsOf(entry.path) ?? []), ...inlineTextRuns(entry.path)];
  for (const run of runs.slice(0, MATCHES_MAX)) {
    const element = run[0]?.parentElement;
    if (
      element &&
      element.getBoundingClientRect().width > 0 &&
      run.every((node) => node.parentElement === element) &&
      (entry.scope === undefined || insideScope(element, entry.scope)) &&
      !found.includes(element)
    ) {
      found.push(element);
    }
  }
  assert(found.length <= MATCHES_MAX, 'Blocked marks stay within their bound');
  return found;
}

function boundBoxesNow(source: MarkSource): DOMRect[] {
  const catalog = source.catalog();
  if (!catalog?.blocked || !source.visible()) {
    return [];
  }
  const focus = source.focus();
  const boxes: DOMRect[] = [];
  for (const entry of catalog.blocked.filter(isPropBlocked)) {
    if (entry.scope === undefined || !focus.has(entry.scope)) {
      continue;
    }
    for (const element of blockedElements(entry)) {
      if (boxes.length < MATCHES_MAX) {
        boxes.push(element.getBoundingClientRect());
      }
    }
  }
  return boxes;
}

function sameBox(box: DOMRect, reported: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined): boolean {
  return reported !== undefined && box.left === reported.x && box.top === reported.y && box.width === reported.w && box.height === reported.h;
}

function ancestorPaths(at: { readonly x: number; readonly y: number }): Set<string> {
  const paths = new Set<string>();
  for (const start of elementsAt(at.x, at.y)) {
    let element: Element | undefined = start;
    for (let depth = 0; element && depth < 64; depth++) {
      for (const path of pathsOf(element)) {
        paths.add(path);
      }
      element = element.parentElement ?? undefined;
    }
  }
  return paths;
}

function sameKey(left: string, right: string | undefined): boolean {
  const bare = (key: string) => key.replace(/^cms:\d+:/, '');
  return right !== undefined && bare(left) === bare(right);
}

function isInstanceRoot(element: Element, scope: string | undefined): boolean {
  if (scope === undefined || !pathsOf(element).includes(scope)) {
    return false;
  }
  let ancestor = element.parentElement;
  for (let depth = 0; ancestor && depth < 64; depth++) {
    if (pathsOf(ancestor).includes(scope)) {
      return false;
    }
    ancestor = ancestor.parentElement;
  }
  return true;
}

function dashedMark(box: DOMRect): HTMLElement {
  const mark = document.createElement('div');
  mark.style.cssText =
    `position:absolute;left:${box.left}px;top:${box.top}px;` +
    `width:${box.width}px;height:${box.height}px;` +
    'border:1px dashed #30c158;border-radius:2px;box-sizing:border-box;';
  return mark;
}

function report(match: TextMatchAt | undefined) {
  if (!match) {
    return undefined;
  }
  const box = wordsBox(match);
  return {
    x: box.left,
    y: box.top,
    w: box.width,
    h: box.height,
    ...labelOf(match.element),
    ...(match.target.scope === undefined ? {} : { scope: match.target.scope }),
    owner: ownerOfWords(match),
  };
}

function labelOf(element: Element): { readonly label: string; readonly kind: string } {
  const paths = pathsOf(element).filter((path) => path.lastIndexOf('|') > 0);
  const files = new Set(paths.map((path) => path.slice(0, path.lastIndexOf('|'))));
  const rootPath = paths.find((path) => /^\d+$/.test(path.slice(path.lastIndexOf('|') + 1)));
  if (rootPath !== undefined && files.size > 1) {
    const owner = rootPath.slice(0, rootPath.lastIndexOf('|'));
    return { label: owner.slice(owner.lastIndexOf('/') + 1).replace(/\.astro$/, ''), kind: 'component' };
  }
  const firstClass = ownClasses(element).find((name) => !name.startsWith('astro-'));
  return { label: firstClass === undefined ? element.localName : `.${firstClass}`, kind: 'text' };
}

function matchesWhere(catalog: CanvasTextCatalog | undefined, accept: (target: CanvasTextTarget) => boolean): TextMatchAt[] {
  const found: TextMatchAt[] = [];
  const seen = new Set<Element>();
  for (const target of catalog?.targets ?? []) {
    if (!accept(target)) {
      continue;
    }
    for (const parent of elementsWithPath(target.parent)) {
      if (found.length >= MATCHES_MAX) {
        return found;
      }
      if (!withinScope(parent, target)) {
        continue;
      }
      const match = matchCanvasText(target, wordsIn(parent, target) ?? parent);
      const element = match?.element;
      if (!element || seen.has(element) || !hasBox(element)) {
        continue;
      }
      seen.add(element);
      found.push({ target, element, nodes: match.nodes });
    }
  }
  assert(found.length <= MATCHES_MAX, 'Marked text stays within its bound');
  return found;
}

function wordsIn(parent: Element, target: CanvasTextTarget): Element | undefined {
  const words = folded(target.value);
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  for (let count = 0; node && count < 2_000; count++) {
    if (folded(node.textContent ?? '') === words) {
      return node.parentElement ?? undefined;
    }
    node = walker.nextNode();
  }
  return undefined;
}

function folded(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function framesWords(match: TextMatchAt): boolean {
  if (match.nodes.length === 0 || !isInstanceRoot(match.element, match.target.scope)) {
    return false;
  }
  assert(
    match.nodes.every((node) => match.element.contains(node)),
    'The words of a match lie inside its element',
  );
  const view = match.element.ownerDocument.defaultView;
  if (view === null) {
    return false;
  }
  const style = view.getComputedStyle(match.element);
  return FRAME_SIDES.some((side) => cssLength(style.getPropertyValue(`padding-${side}`)) > 0 || cssLength(style.getPropertyValue(`border-${side}-width`)) > 0);
}

function drawnAsRun(match: TextMatchAt): boolean {
  return match.nodes.length > 0 && (pageWrote(match) || framesWords(match));
}

function pageWrote(match: TextMatchAt): boolean {
  const first = match.nodes[0];
  if (match.target.from !== 'slot' || first === undefined) {
    return false;
  }
  return (runsOf(match.target.path) ?? []).some((run) => run.includes(first));
}

function ownerOfWords(match: TextMatchAt): Ownership {
  return pageWrote(match) ? 'slot' : ownershipOf(pathsOf(match.element));
}

const FRAME_SIDES = ['top', 'right', 'bottom', 'left'] as const;

function cssLength(value: string): number {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

function wordsBox(match: TextMatchAt): DOMRect {
  const first = match.nodes[0];
  const last = match.nodes.at(-1);
  if (first === undefined || last === undefined || !drawnAsRun(match)) {
    return match.element.getBoundingClientRect();
  }
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  const box = range.getBoundingClientRect();
  assert(Number.isFinite(box.width), 'The words have a measurable box');
  return box;
}

function hasBox(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

function holds(box: DOMRect, point: { readonly x: number; readonly y: number }): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

export function marked(target: CanvasTextTarget, focus: ReadonlySet<string>): boolean {
  if (target.from === undefined || target.scope === undefined) {
    return false;
  }
  return focus.has(target.scope);
}

export function withinScope(element: Element, target: CanvasTextTarget): boolean {
  return target.scope === undefined || insideScope(element, target.scope);
}

function insideScope(element: Element, scope: string): boolean {
  let ancestor: Element | undefined = element;
  for (let depth = 0; ancestor && depth < 64; depth++) {
    if (pathsOf(ancestor).includes(scope)) {
      return true;
    }
    ancestor = ancestor.parentElement ?? undefined;
  }
  return false;
}
