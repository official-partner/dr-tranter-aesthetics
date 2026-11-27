
import { assert } from '../../../../shared/core/assert';
import { LIMITS } from '../../../../shared/core/limits';
import { PX_LENGTHS, type LengthUnit } from '../../../../shared/properties/lengthUnit';
import type { ClassPlacement } from '../../../editor/classAttr';
import type { TypedMessageRef } from '../../../../shared/properties/i18n/messageRef';
import type { StyleTagAttribute } from '../../../../shared/properties/newStyleTag';

type HostAttr = { readonly type: string; readonly value?: string };

export type HostNode = {
  readonly id: string;
  readonly kind: string;
  readonly name?: string;
  readonly value?: string;
  readonly props?: Readonly<Record<string, HostAttr>>;
  readonly children?: readonly HostNode[] | undefined;
  readonly inner?: string;
};

export type SpacingHover = {
  kind: 'padding' | 'margin' | 'gap';
  sides: Array<'top' | 'right' | 'bottom' | 'left' | 'row' | 'column'>;
  labels: Record<string, string>;
  live?: Record<string, string>;
};

export type StyleNodeTarget = {
  readonly nodeId: string;
  readonly filePath: string | undefined;
};

export type InlineStyleAttr = { readonly type: 'string' | 'expr'; readonly value: string };

export type StyleBlockRequest = {
  readonly css: string;
  readonly attributes: readonly StyleTagAttribute[];
  readonly className: string | undefined;
  readonly placement: ClassPlacement;
};

export type ClassOutcome = { readonly tag: 'applied' } | { readonly tag: 'refused'; readonly message: string };

export type HostState = {
  projectPath: string | undefined;
  nodes: readonly HostNode[];
  selectedId: string | undefined;
  device: string;
  canvasWidthPx: number | undefined;
  files: Array<{ rel: string; name: string; path: string; size: number }>;
  astroFiles: Array<{ rel: string; name: string; path: string; size: number }>;
  openFilePath: string | undefined;
  openFileKind: 'page' | 'component' | undefined;
  contextPagePath: string | undefined;
  selectedComponentPath: string | undefined;
  historyTick: number;
  renderedClasses: string[];
  projectClasses: string[];
  writeStyleNode: ((target: StyleNodeTarget, css: string, immediate?: boolean) => boolean | void) | undefined;
  selectNode: ((nodeId: string) => void) | undefined;
  setCanvasWidth: ((widthPx: number) => void) | undefined;
  showDesktopCanvas: (() => void) | undefined;
  addClass: ((className: string, placement: ClassPlacement) => Promise<ClassOutcome>) | undefined;
  addStyleBlock: ((request: StyleBlockRequest) => Promise<ClassOutcome>) | undefined;
  openStyleTagSettings: (() => void) | undefined;
  removeClass: ((className: string) => Promise<ClassOutcome>) | undefined;
  removeAttribute: ((attributeName: string) => Promise<ClassOutcome>) | undefined;
  setInlineStyle: ((nodeId: string, style: InlineStyleAttr | undefined) => void) | undefined;
  pageComponentPaths: readonly string[];
  renderedClassesKnown: boolean;
  onSpacingHover: ((hover: SpacingHover | undefined) => void) | undefined;
  pathOf: ((nodeId: string) => string | undefined) | undefined;
  recordUndo: ((command: UndoCommand) => void) | undefined;
  pseudoRequest: PseudoRequest | undefined;
  pseudoRows: boolean;
  lengthUnit: LengthUnit;
};

export type PseudoRequest = { readonly nodeId: string; readonly pseudo: 'before' | 'after'; readonly serial: number };

export type UndoCommand = {
  label?: string;
  labelRef?: TypedMessageRef | undefined;
  coalesceKey?: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

const state: HostState = {
  projectPath: undefined,
  nodes: [],
  selectedId: undefined,
  pathOf: undefined,
  historyTick: 0,
  device: 'desktop',
  canvasWidthPx: undefined,
  files: [],
  astroFiles: [],
  openFilePath: undefined,
  openFileKind: undefined,
  contextPagePath: undefined,
  selectedComponentPath: undefined,
  renderedClasses: [],
  projectClasses: [],
  writeStyleNode: undefined,
  selectNode: undefined,
  setCanvasWidth: undefined,
  showDesktopCanvas: undefined,
  recordUndo: undefined,
  addClass: undefined,
  addStyleBlock: undefined,
  openStyleTagSettings: undefined,
  removeClass: undefined,
  removeAttribute: undefined,
  setInlineStyle: undefined,
  pageComponentPaths: [],
  renderedClassesKnown: true,
  pseudoRequest: undefined,
  pseudoRows: false,
  lengthUnit: PX_LENGTHS,
  onSpacingHover: undefined,
};

const listeners = new Set<() => void>();

let notifying = false;
function notifyHost() {
  if (notifying) {
    return;
  }
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    for (const listener of listeners) {
      listener();
    }
  });
}

export function setHost(next: Readonly<HostState>) {
  if (hostChanged(next)) {
    Object.assign(state, next);
    notifyHost();
  }
}

function hostChanged(next: Readonly<HostState>): boolean {
  let key: keyof HostState;
  for (key in next) {
    if (state[key] !== next[key]) {
      return true;
    }
  }
  return false;
}

export function getHost(): HostState {
  return state;
}

export function onHostChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function walkNodes(nodes: readonly HostNode[] | undefined, visit: (node: HostNode, parent: HostNode | undefined) => void) {
  walkNodesFrom(nodes, undefined, 0, visit);
}

function walkNodesFrom(
  nodes: readonly HostNode[] | undefined,
  parent: HostNode | undefined,
  depth: number,
  visit: (node: HostNode, parent: HostNode | undefined) => void,
) {
  assert(depth <= LIMITS.treeDepthMax, 'walkNodes: depth limit');
  for (const node of nodes || []) {
    visit(node, parent);
    if (Array.isArray(node.children)) {
      walkNodesFrom(node.children, node, depth + 1, visit);
    }
  }
}

export function findNode(nodes: readonly HostNode[] | undefined, id: string, depth = 0): HostNode | undefined {
  assert(depth <= LIMITS.treeDepthMax, 'findNode: depth limit');
  for (const node of nodes || []) {
    if (node.id === id) {
      return node;
    }
    const found = node.children && findNode(node.children, id, depth + 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function propText(node: HostNode | undefined, name: string): string {
  const attribute = node?.props?.[name];
  if (!attribute || attribute.type !== 'string') {
    return '';
  }
  return String(attribute.value ?? '');
}
