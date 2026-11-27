import { assert } from '../core/assert';

export const CANVAS_OUTLINE_MODES = ['normal', 'deep'] as const;
export type CanvasOutlineMode = (typeof CANVAS_OUTLINE_MODES)[number];

export const OUTLINE_MODE_MESSAGE = 'avb:outline-mode';

export const DEEP_COMPONENT_CHARS_MAX = 120;

export function componentNameOf(path: string): string | undefined {
  const bar = path.lastIndexOf('|');
  if (bar <= 0) {
    return undefined;
  }
  const name = (path.slice(0, bar).split('/').pop() ?? '').replace(/\.astro$/i, '');
  if (name === '' || !/^\d+(?:\.\d+)*$/.test(path.slice(bar + 1))) {
    return undefined;
  }
  assert(name.length > 0, 'componentNameOf: a name says something');
  return name.slice(0, DEEP_COMPONENT_CHARS_MAX);
}

export type DeepHoverNode =
  { readonly kind: 'component'; readonly label: string; readonly tag: undefined } | { readonly kind: 'element'; readonly label: string; readonly tag: string };

const BUILD_CLASS = /^astro-/;

export function elementHoverNode(tagName: string, classAttribute: string): DeepHoverNode {
  const tag = tagName.toLowerCase().slice(0, DEEP_COMPONENT_CHARS_MAX);
  const first = classAttribute.split(/\s+/).find((name) => name !== '' && !BUILD_CLASS.test(name));
  const label = first === undefined ? tag : `.${first.slice(0, DEEP_COMPONENT_CHARS_MAX)}`;
  assert(label.length > 0, 'elementHoverNode: a label says something');
  return { kind: 'element', label, tag };
}

export function parseDeepHoverNode(input: unknown): DeepHoverNode | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const kind: unknown = Reflect.get(input, 'kind');
  const label: unknown = Reflect.get(input, 'label');
  const tag: unknown = Reflect.get(input, 'tag');
  if (typeof label !== 'string' || label.length === 0 || label.length > DEEP_COMPONENT_CHARS_MAX + 1) {
    return undefined;
  }
  if (kind === 'component') {
    return { kind, label, tag: undefined };
  }
  if (kind === 'element' && typeof tag === 'string' && /^[a-z][a-z0-9-]{0,119}$/.test(tag)) {
    return { kind, label, tag };
  }
  return undefined;
}

export const HIGHLIGHT_MESSAGE = 'avb:highlight';

export const CANVAS_HIGHLIGHT_STYLES = ['selected', 'hover'] as const;
export type CanvasHighlightStyle = (typeof CANVAS_HIGHLIGHT_STYLES)[number];

export interface CanvasHighlight {
  readonly path: string;
  readonly occurrence: number;
  readonly node: DeepHoverNode;
  readonly style: CanvasHighlightStyle;
}

const HIGHLIGHT_PATH_CHARS_MAX = 4096;

export function parseCanvasHighlight(input: unknown): CanvasHighlight | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const path: unknown = Reflect.get(input, 'path');
  const occurrence: unknown = Reflect.get(input, 'occurrence');
  const node = parseDeepHoverNode(Reflect.get(input, 'node'));
  if (typeof path !== 'string' || path.length === 0 || path.length > HIGHLIGHT_PATH_CHARS_MAX) {
    return undefined;
  }
  if (typeof occurrence !== 'number' || !Number.isSafeInteger(occurrence) || occurrence < 0 || occurrence > 100_000) {
    return undefined;
  }
  const style = CANVAS_HIGHLIGHT_STYLES.find((candidate) => candidate === Reflect.get(input, 'style')) ?? 'selected';
  return node === undefined ? undefined : { path, occurrence, node, style };
}

export function outsideScope(path: string, scope: string): boolean {
  if (scope === '') {
    return path.includes('|');
  }
  return !path.startsWith(scope);
}

export function parseOutlineMode(input: unknown): CanvasOutlineMode | undefined {
  return CANVAS_OUTLINE_MODES.find((mode) => mode === input);
}
