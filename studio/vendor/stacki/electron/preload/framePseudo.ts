
import { assert } from '../../shared/core/assert';
import { type PseudoLayer } from '../../shared/page/pseudoPath';
import { PROBE_ATTR, isElement, type Box, type Rect } from './frameBasics';
import { elementsWithPath, runsOf, toRect } from './frameRegions';

const PSEUDO_PLACES_MAX = 64;
const PSEUDO_PROPERTIES_MAX = 1024;
const SHEET_ID = 'avb-pseudo-measure';

export function rectsForPseudo(nodePath: string, pseudo: PseudoLayer): Rect[] {
  const out: Rect[] = [];
  for (const element of placesOf(nodePath)) {
    if (out.length < PSEUDO_PLACES_MAX) {
      const box = measurePseudo(element, pseudo);
      if (box !== undefined) {
        out.push(toRect(box));
      }
    }
  }
  assert(out.length <= PSEUDO_PLACES_MAX, 'rectsForPseudo: places are capped');
  return out;
}

function placesOf(nodePath: string): Element[] {
  const elements: Element[] = [];
  for (const run of runsOf(nodePath) ?? []) {
    const element = run.find((node): node is Element => isElement(node) && node.tagName !== 'TEMPLATE');
    if (element !== undefined && element.isConnected) {
      elements.push(element);
    }
  }
  return elements.length > 0 ? elements : elementsWithPath(nodePath);
}

export function measurePseudo(host: Element, pseudo: PseudoLayer): Box | undefined {
  const style = window.getComputedStyle(host, `::${pseudo}`);
  if (!drawn(style)) {
    return undefined;
  }
  ensureSheet();
  const standIn = document.createElement('span');
  standIn.setAttribute(PROBE_ATTR, pseudo);
  const count = Math.min(style.length, PSEUDO_PROPERTIES_MAX);
  for (let index = 0; index < count; index++) {
    const name = style.item(index);
    standIn.style.setProperty(name, style.getPropertyValue(name), 'important');
  }
  standIn.style.setProperty('pointer-events', 'none', 'important');
  standIn.textContent = contentText(style.content);
  if (pseudo === 'before') {
    host.insertBefore(standIn, host.firstChild);
  } else {
    host.appendChild(standIn);
  }
  const rect = standIn.getBoundingClientRect();
  standIn.remove();
  assert(!standIn.isConnected, 'measurePseudo: the stand-in is gone');
  if (rect.width === 0 && rect.height === 0) {
    return undefined;
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function drawn(style: CSSStyleDeclaration): boolean {
  if (style.display === 'none') {
    return false;
  }
  return style.content !== 'none' && style.content !== 'normal' && style.content !== '';
}

function contentText(content: string): string {
  const parts = content.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) ?? [];
  return parts.map((part) => part.slice(1, -1).replace(/\\(.)/g, '$1')).join('');
}

function ensureSheet(): void {
  if (document.getElementById(SHEET_ID) !== null) {
    return;
  }
  const sheet = document.createElement('style');
  sheet.id = SHEET_ID;
  sheet.setAttribute(PROBE_ATTR, '');
  sheet.textContent = `:has(> [${PROBE_ATTR}="before"])::before{display:none!important}` + `:has(> [${PROBE_ATTR}="after"])::after{display:none!important}`;
  (document.head ?? document.documentElement).appendChild(sheet);
  assert(document.getElementById(SHEET_ID) === sheet, 'ensureSheet: the sheet is in place');
}
