
import { assert } from '../../shared/core/assert';
import type { Box, GapBand, GapRow, Rect, Spacing, ThinTarget } from './frameBasics';
import { PROBE_ATTR, isElement } from './frameBasics';
import { PATH_ATTR, addNode, elementsWithPath, inFocus, inScope, pathsOf, placesOf, regions, runsOf, toRect } from './frameRegions';
import { inlineTextRuns } from './inlineText';
import { rectsForPseudo } from './framePseudo';
import { splitPseudoPath } from '../../shared/page/pseudoPath';

const rectsFromDescendants = (nodePath: string): Rect[] | undefined => {
  const prefix = nodePath + '.';
  let best = Infinity;
  const paths: string[] = [];
  for (const key of regions.keys()) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const depth = key.split('.').length;
    if (depth < best) {
      best = depth;
      paths.length = 0;
    }
    if (depth === best) {
      paths.push(key);
    }
  }
  let acc: Box | undefined = undefined;
  for (const key of paths) {
    for (const run of runsOf(key) || []) {
      for (const node of run) {
        acc = addNode(acc, node);
      }
    }
  }
  return acc ? [toRect(acc)] : undefined;
};

const withoutHollow = (list: Rect[]): Rect[] => {
  const real = list.filter((rect) => rect.w > 0 && rect.h > 0);
  return real.length ? real : list;
};

const rectsForInlineText = (nodePath: string): Rect[] => {
  const out: Rect[] = [];
  for (const run of inlineTextRuns(nodePath)) {
    let acc: Box | undefined = undefined;
    for (const node of run) {
      acc = addNode(acc, node);
    }
    if (acc) {
      out.push(toRect(acc));
    }
  }
  return out;
};

export const boxOfRun = (nodePath: string, run: readonly Node[], runCount: number): Box | undefined => {
  let acc = run.reduce<Box | undefined>((grown, node) => addNode(grown, node), undefined);
  if (runCount === 1) {
    for (const element of elementsWithPath(nodePath)) {
      acc = addNode(acc, element);
    }
  }
  return acc;
};

const collapsedRects = (nodePath: string, tagged?: readonly Element[]): Rect[] | undefined => {
  const elements: Element[] = [];
  for (const run of runsOf(nodePath) || []) {
    for (const node of run) {
      if (isElement(node) && node.tagName !== 'TEMPLATE') {
        elements.push(node);
      }
    }
  }
  if (!elements.length) {
    elements.push(...(tagged ?? elementsWithPath(nodePath)));
  }
  const out: Rect[] = [];
  for (const element of elements) {
    if (!element.isConnected) {
      continue;
    }
    const own = element.getClientRects()[0];
    if (own) {
      out.push({ x: own.left, y: own.top, w: own.width, h: own.height });
      continue;
    }
    if (window.getComputedStyle(element).display === 'contents') {
      out.push(contentsAnchor(element));
    }
  }
  return out.length ? out : undefined;
};

const contentsAnchor = (element: Element): Rect => {
  const before = element.previousElementSibling;
  const beforeRect = before?.getBoundingClientRect();
  if (beforeRect && (beforeRect.width > 0 || beforeRect.height > 0)) {
    return { x: beforeRect.left, y: beforeRect.bottom, w: 0, h: 0 };
  }
  const parent = element.parentElement;
  if (!parent) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const parentRect = parent.getBoundingClientRect();
  const style = window.getComputedStyle(parent);
  return {
    x: parentRect.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0),
    y: parentRect.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0),
    w: 0,
    h: 0,
  };
};

const SHOWN_ELEMENTS_CHECKED_MAX = 200;
const UNPAINTED_TAGS: ReadonlySet<string> = new Set(['TEMPLATE', 'SCRIPT', 'STYLE', 'LINK', 'META']);

const paintsNothing = (nodes: readonly Node[]): boolean => {
  const pending: Element[] = [];
  const queue = (element: Element): void => {
    if (element.isConnected && !UNPAINTED_TAGS.has(element.tagName)) {
      pending.push(element);
    }
  };
  for (const node of nodes) {
    if (isElement(node)) {
      queue(node);
    }
  }
  if (pending.length === 0) {
    const parent = nodes.find((node) => node.isConnected && node.nodeType === 3)?.parentElement ?? undefined;
    return parent !== undefined && window.getComputedStyle(parent).visibility === 'hidden';
  }
  for (let index = 0; index < pending.length; index += 1) {
    const element = pending[index];
    if (element === undefined || index >= SHOWN_ELEMENTS_CHECKED_MAX) {
      return false;
    }
    if (window.getComputedStyle(element).visibility !== 'hidden') {
      return false;
    }
    for (const child of Array.from(element.children).slice(0, SHOWN_ELEMENTS_CHECKED_MAX)) {
      queue(child);
    }
  }
  return true;
};

const shownAs = (rect: Rect, nodes: readonly Node[]): Rect => (paintsNothing(nodes) ? { ...rect, hidden: true } : rect);

export const rectsForPath = (nodePath: string): Rect[] | undefined => {
  const pseudo = splitPseudoPath(nodePath);
  if (pseudo !== undefined) {
    const boxes = rectsForPseudo(pseudo.nodePath, pseudo.pseudo);
    return boxes.length > 0 ? boxes : undefined;
  }
  const runs = runsOf(nodePath);
  if (!runs) {
    const tagged = elementsWithPath(nodePath);
    const places = placesOf(tagged);
    if (places.length) {
      return places.map((place) => shownAs(place.rect, [place.el]));
    }
    const inline = rectsForInlineText(nodePath);
    return inline.length ? inline : (rectsFromDescendants(nodePath) ?? collapsedRects(nodePath, tagged));
  }
  const out: Rect[] = [];
  for (const run of runs) {
    let acc: Box | undefined = undefined;
    for (const node of run) {
      acc = addNode(acc, node);
    }
    if (acc) {
      out.push(shownAs(toRect(acc), run));
    }
  }
  if (runs.length === 1) {
    const acc = boxOfRun(nodePath, runs[0] || [], runs.length);
    if (acc) {
      return [shownAs(toRect(acc), [...(runs[0] ?? []), ...elementsWithPath(nodePath)])];
    }
  }
  if (out.length) {
    return out;
  }
  const tagged = elementsWithPath(nodePath);
  if (tagged.length) {
    for (const element of tagged) {
      const acc = addNode(undefined, element);
      if (acc) {
        out.push(toRect(acc));
      }
    }
    const real = withoutHollow(out);
    if (real.length) {
      return real;
    }
  }
  return rectsFromDescendants(nodePath) ?? collapsedRects(nodePath, tagged);
};

export const STACKI_CLASSES = new Set(['stacki-opened', 'stacki-designer', 'stacki-preview']);
export const ownClasses = (element: Element): string[] => Array.from(element.classList).filter((className) => !STACKI_CLASSES.has(className));

export const classesForPath = (nodePath: string): string[][] => {
  const out: string[][] = [];
  for (const run of runsOf(nodePath) || []) {
    const element = run.find((node): node is Element => isElement(node) && node.tagName !== 'TEMPLATE');
    if (element) {
      out.push(ownClasses(element));
    }
  }
  if (!out.length) {
    for (const element of elementsWithPath(nodePath)) {
      out.push(ownClasses(element));
    }
  }
  return out;
};

const SIDES = ['top', 'right', 'bottom', 'left'];

const gapChildRects = (element: Element): DOMRect[] => {
  const kids: DOMRect[] = [];
  for (const child of Array.from(element.children)) {
    if (child.tagName === 'TEMPLATE') {
      continue;
    }
    const rect = child.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      continue;
    }
    const cd = window.getComputedStyle(child).display;
    if (cd === 'none' || cd === 'contents') {
      continue;
    }
    kids.push(rect);
  }
  return kids;
};

const visualRows = (kids: DOMRect[]): GapRow[] => {
  const byTop = [...kids].sort((left, right) => left.top - right.top || left.left - right.left);
  const rows: GapRow[] = [];
  for (const rect of byTop) {
    const row = rows[rows.length - 1];
    const overlaps = row && rect.top < row.bottom - 1 && rect.bottom > row.top + 1;
    if (overlaps) {
      row.items.push(rect);
      row.top = Math.min(row.top, rect.top);
      row.bottom = Math.max(row.bottom, rect.bottom);
    } else {
      rows.push({ top: rect.top, bottom: rect.bottom, items: [rect] });
    }
  }
  return rows;
};

const columnGapBands = (rows: GapRow[], colGap: number): GapBand[] => {
  const bands: GapBand[] = [];
  for (const row of rows) {
    const across = [...row.items].sort((left, right) => left.left - right.left);
    for (let i = 1; i < across.length; i++) {
      const previous = across[i - 1];
      const next = across[i];
      if (!previous || !next) {
        continue;
      }
      const space = next.left - previous.right;
      const width = Math.min(space, colGap);
      if (width <= 0.5) {
        continue;
      }
      bands.push({
        axis: 'column',
        x: previous.right,
        y: row.top,
        w: width,
        h: row.bottom - row.top,
      });
    }
  }
  return bands;
};

const rowGapBands = (rows: GapRow[], rowGap: number): GapBand[] => {
  const bands: GapBand[] = [];
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1];
    const next = rows[i];
    if (!previous || !next) {
      continue;
    }
    const space = next.top - previous.bottom;
    const height = Math.min(space, rowGap);
    if (height <= 0.5) {
      continue;
    }
    const span = [...previous.items, ...next.items];
    const left = Math.min(...span.map((rect) => rect.left));
    const right = Math.max(...span.map((rect) => rect.right));
    bands.push({ axis: 'row', x: left, y: previous.bottom, w: right - left, h: height });
  }
  return bands;
};

const PX_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?px$/i;
const gapPx = (cs: CSSStyleDeclaration, axis: GapBand['axis']): number => {
  const value = (axis === 'column' ? cs.columnGap : cs.rowGap).trim();
  if (value === '' || value === 'normal') {
    return 0;
  }
  if (PX_LENGTH.test(value)) {
    return Math.max(0, parseFloat(value));
  }
  const basisPx = contentBoxPx(cs, axis);
  const resolved = probeLengthPx(value, basisPx, axis);
  assert(Number.isFinite(resolved), 'gapPx: a probed gap is a finite number');
  return Math.max(0, resolved);
};

const contentBoxPx = (cs: CSSStyleDeclaration, axis: GapBand['axis']): number => {
  const sides = axis === 'column' ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
  const size = parseFloat(axis === 'column' ? cs.width : cs.height) || 0;
  if (cs.boxSizing !== 'border-box') {
    return Math.max(0, size);
  }
  let edges = 0;
  for (const side of sides) {
    edges += (parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0) + (parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0);
  }
  return Math.max(0, size - edges);
};

const probeLengthPx = (value: string, basisPx: number, axis: GapBand['axis']): number => {
  assert(basisPx >= 0, 'probeLengthPx: a percentage basis is never negative');
  const body = document.body;
  if (!body) {
    return 0;
  }
  const reset = 'margin:0;padding:0;border:0;box-sizing:content-box;';
  const outer = document.createElement('div');
  outer.setAttribute(PROBE_ATTR, '');
  outer.setAttribute(
    'style',
    `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;overflow:hidden;${reset}width:${basisPx}px;height:${basisPx}px`,
  );
  const inner = document.createElement('div');
  inner.setAttribute(PROBE_ATTR, '');
  inner.setAttribute('style', `display:block;${reset}width:0;height:0`);
  inner.style.setProperty(axis === 'column' ? 'width' : 'height', value);
  outer.appendChild(inner);
  body.appendChild(outer);
  try {
    const rect = inner.getBoundingClientRect();
    const size = axis === 'column' ? rect.width : rect.height;
    return Number.isFinite(size) ? size : 0;
  } finally {
    outer.remove();
  }
};

export const gapBandsFor = (element: Element, cs: CSSStyleDeclaration): GapBand[] => {
  const display = cs.display;
  if (!/(^|\s)(flex|grid|inline-flex|inline-grid)$/.test(display)) {
    return [];
  }
  const colGap = gapPx(cs, 'column');
  const rowGap = gapPx(cs, 'row');
  assert(colGap >= 0, 'gapBandsFor: a column gap is never negative');
  assert(rowGap >= 0, 'gapBandsFor: a row gap is never negative');
  if (colGap <= 0 && rowGap <= 0) {
    return [];
  }
  const kids = gapChildRects(element);
  if (kids.length < 2) {
    return [];
  }
  const rows = visualRows(kids);
  return [...(colGap > 0 ? columnGapBands(rows, colGap) : []), ...(rowGap > 0 ? rowGapBands(rows, rowGap) : [])];
};

const COLLAPSING_DISPLAYS = new Set(['block', 'list-item', 'flow-root']);
const ADJOINING_SLACK_PX = 0.5;

const floated = (cs: CSSStyleDeclaration): boolean => cs.float !== 'none' && cs.float !== '';

const inNormalFlow = (cs: CSSStyleDeclaration): boolean =>
  COLLAPSING_DISPLAYS.has(cs.display) && !floated(cs) && (cs.position === 'static' || cs.position === 'relative' || cs.position === 'sticky');

const flowSibling = (element: Element, direction: 'previous' | 'next'): Element | 'text' | undefined => {
  let node: Node | undefined = (direction === 'previous' ? element.previousSibling : element.nextSibling) ?? undefined;
  for (let steps = 0; node && steps < 1000; steps++) {
    if (isElement(node)) {
      const cs = window.getComputedStyle(node);
      if (cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed' && !floated(cs)) {
        return node;
      }
    } else if (node.nodeType === 3 && (node.textContent || '').trim() !== '') {
      return 'text';
    }
    node = (direction === 'previous' ? node.previousSibling : node.nextSibling) ?? undefined;
  }
  return undefined;
};

const sideMargin = (cs: CSSStyleDeclaration, side: 'top' | 'bottom'): number => parseFloat(cs.getPropertyValue(`margin-${side}`)) || 0;

const collapseOnSide = (element: Element, cs: CSSStyleDeclaration, side: 'top' | 'bottom') => {
  const parent = element.parentElement;
  if (!parent || !inNormalFlow(cs)) {
    return undefined;
  }
  const parentStyle = window.getComputedStyle(parent);
  if (parentStyle.display !== 'block' && parentStyle.display !== 'flow-root' && parentStyle.display !== 'list-item') {
    return undefined;
  }
  const sibling = flowSibling(element, side === 'top' ? 'previous' : 'next');
  if (sibling === 'text') {
    return undefined;
  }
  if (sibling) {
    const siblingStyle = window.getComputedStyle(sibling);
    if (!inNormalFlow(siblingStyle)) {
      return undefined;
    }
    return { partner: side === 'top' ? ('previous' as const) : ('next' as const), margin: sideMargin(siblingStyle, side === 'top' ? 'bottom' : 'top') };
  }
  const box = element.getBoundingClientRect();
  const parentBox = parent.getBoundingClientRect();
  const edge = side === 'top' ? box.top - parentBox.top : parentBox.bottom - box.bottom;
  const inset =
    side === 'top'
      ? (parseFloat(parentStyle.borderTopWidth) || 0) + (parseFloat(parentStyle.paddingTop) || 0)
      : (parseFloat(parentStyle.borderBottomWidth) || 0) + (parseFloat(parentStyle.paddingBottom) || 0);
  if (Math.abs(edge - inset) > ADJOINING_SLACK_PX) {
    return undefined;
  }
  return { partner: 'parent' as const, margin: sideMargin(parentStyle, side) };
};

export const marginCollapses = (element: Element, cs: CSSStyleDeclaration): Spacing['collapse'] => {
  const top = collapseOnSide(element, cs, 'top');
  const bottom = collapseOnSide(element, cs, 'bottom');
  if (!top && !bottom) {
    return undefined;
  }
  return { ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) };
};

export const spacingForPath = (nodePath: string): (Spacing | undefined)[] => {
  const out: Element[] = [];
  for (const run of runsOf(nodePath) || []) {
    const element = run.find((node): node is Element => isElement(node) && node.tagName !== 'TEMPLATE');
    if (element) {
      out.push(element);
    }
  }
  if (!out.length) {
    out.push(...elementsWithPath(nodePath));
  }
  return out.map((element) => {
    try {
      const cs = window.getComputedStyle(element);
      const box = (kind: string) => Object.fromEntries(SIDES.map((side): [string, number] => [side, parseFloat(cs.getPropertyValue(`${kind}-${side}`)) || 0]));
      const rootFont = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const units = {
        em: parseFloat(cs.fontSize) || rootFont,
        rem: rootFont,
        vw: window.innerWidth / 100,
        vh: window.innerHeight / 100,
      };
      const gaps = gapBandsFor(element, cs);
      const collapse = marginCollapses(element, cs);
      return { padding: box('padding'), margin: box('margin'), ...(collapse ? { collapse } : {}), gaps, units };
    } catch {
      return undefined;
    }
  });
};

const THIN = 3;
const THIN_SLACK = 5;
let thinCache: ThinTarget[] | undefined = undefined;

export function resetThinCache(): void {
  thinCache = undefined;
}
const thinTargets = (): ThinTarget[] => {
  if (thinCache) {
    return thinCache;
  }
  thinCache = [];
  for (const element of Array.from(document.querySelectorAll(`[${PATH_ATTR}]`))) {
    if (!inFocus(element)) {
      continue;
    }
    const nodePath = pathsOf(element).find(inScope);
    if (!nodePath) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) {
      continue;
    }
    if (rect.height > THIN && rect.width > THIN) {
      continue;
    }
    thinCache.push({ path: nodePath, el: element, box: rect });
  }
  return thinCache;
};

export const thinAt = (x: number, y: number, best: string | undefined): ThinTarget | undefined => {
  let hit: ThinTarget | undefined = undefined;
  let hitDepth = best ? best.split('.').length : 0;
  for (const target of thinTargets()) {
    if (best && !target.path.startsWith(best + '.')) {
      continue;
    }
    const depth = target.path.split('.').length;
    if (depth <= hitDepth) {
      continue;
    }
    const box = target.box;
    if (x < box.left - THIN_SLACK || x > box.right + THIN_SLACK) {
      continue;
    }
    if (y < box.top - THIN_SLACK || y > box.bottom + THIN_SLACK) {
      continue;
    }
    hit = target;
    hitDepth = depth;
  }
  return hit;
};
