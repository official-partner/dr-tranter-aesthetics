import {
  OUTLINE_MODE_MESSAGE,
  componentNameOf,
  elementHoverNode,
  parseOutlineMode,
  type CanvasOutlineMode,
  type DeepHoverNode,
} from '../../shared/properties/deepOutline';
import { PRELOAD_LIMITS, isElement } from './frameBasics';
import { pathsOf, runsOf } from './frameRegions';
import { layersAt } from './frameLayers';

let mode: CanvasOutlineMode = 'normal';

export function receiveOutlineMode(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Reflect.get(data, 'type') !== OUTLINE_MODE_MESSAGE) {
    return false;
  }
  mode = parseOutlineMode(Reflect.get(data, 'mode')) ?? 'normal';
  return true;
}

export function outlineMode(): CanvasOutlineMode {
  return mode;
}

export interface DeepHover {
  readonly path: string;
  readonly occurrence: number;
  readonly node: DeepHoverNode;
}

export function deepHoverAt(target: Element | undefined, path: string | undefined): DeepHover | undefined {
  if (mode !== 'deep' || target === undefined) {
    return undefined;
  }
  const outerFirst = [...layersAt(target)].reverse();
  const outermost = outerFirst[0];
  const start = outermost !== undefined && outerFirst.length > 1 && rendersDocument(target, outermost.path) ? 1 : 0;
  const shown = outerFirst[start + 1];
  if (shown === undefined) {
    return undefined;
  }
  if (path !== undefined && namespaceOf(shown.path) === namespaceOf(path)) {
    return undefined;
  }
  const rendered = outerFirst[start + 2];
  const node = rendered === undefined ? elementNode(target, shown.path) : componentNode(rendered.path);
  return node === undefined ? undefined : { path: shown.path, occurrence: shown.occurrence, node };
}

function componentNode(renderedPath: string): DeepHoverNode | undefined {
  const name = componentNameOf(renderedPath);
  return name === undefined ? undefined : { kind: 'component', label: name, tag: undefined };
}

function elementNode(target: Element, path: string): DeepHoverNode | undefined {
  const element = elementOf(target, path);
  if (element === undefined) {
    return undefined;
  }
  return elementHoverNode(element.tagName, element.getAttribute('class') ?? '');
}

function rendersDocument(target: Element, path: string): boolean {
  return elementOf(target, path) === target.ownerDocument.documentElement;
}

function elementOf(target: Element, path: string): Element | undefined {
  for (const run of runsOf(path) ?? []) {
    const holder = run.find((node): node is Element => isElement(node) && node.isConnected && node.contains(target));
    if (holder !== undefined) {
      return holder;
    }
  }
  let element: Element | undefined = target;
  for (let depth = 0; element !== undefined && depth < PRELOAD_LIMITS.domDepthMax; depth += 1) {
    if (pathsOf(element).includes(path)) {
      return element;
    }
    element = element.parentElement ?? undefined;
  }
  return undefined;
}

function namespaceOf(path: string): string {
  const bar = path.lastIndexOf('|');
  return bar === -1 ? '' : path.slice(0, bar + 1);
}
