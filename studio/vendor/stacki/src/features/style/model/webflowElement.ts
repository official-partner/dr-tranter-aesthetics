
import { isClassName } from '../../../lib/fuzzyRank';
import { assert } from '../../../../shared/core/assert';
import { findNode, getHost, onHostChange, propText, walkNodes, type HostNode } from './host';
import { componentMarkupOf, instanceMarkupOf, type ComponentMarkup } from './componentMarkup';
import { instanceClassesOf } from './instanceClasses';
import { templateRootNode } from './templateRoot';
import type { BreakpointId, ElementSnapshot } from './styleTypes';

export type AnyElement = unknown;


export function serializeElementId(id: unknown): string {
  if (id === undefined) {
    return '';
  }
  if (id === null) {
    return '';
  }
  if (typeof id === 'string') {
    return id;
  }
  if (typeof id === 'object' && 'id' in id && typeof id.id === 'string') {
    return id.id;
  }
  try {
    return JSON.stringify(id);
  } catch {
    return String(id);
  }
}

export function elementSelectionKey(element: unknown): string {
  const id = serializeElementId(element);
  if (id === '') {
    return '';
  }
  const key = `${getHost().openFilePath ?? ''}\u0000${id}`;
  assert(key.endsWith(id), 'elementSelectionKey: the key ends with the node id');
  return key;
}

export function webflowClassToCss(name: string): string {
  const compiled = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, '')
    .replace(/\s+/g, '-');
  return /^[0-9]/.test(compiled) ? `_${compiled}` : compiled;
}

export type Unsub = () => void;

export function webflowApi() {
  return {
    getSelectedElement: async (): Promise<AnyElement> => nodeById(getHost().selectedId),
    subscribe: (event: string, callback: (value: unknown) => void): Unsub => {
      if (event === 'selectedelement') {
        const selectionOf = () => `${getHost().openFilePath ?? ''}\u0000${getHost().selectedId ?? ''}`;
        let last = selectionOf();
        return onHostChange(() => {
          const now = selectionOf();
          if (now === last) {
            return;
          }
          last = now;
          callback(nodeById(getHost().selectedId));
        });
      }
      if (event === 'mediaquery') {
        let last = getHost().device;
        return onHostChange(() => {
          const now = getHost().device;
          if (now === last) {
            return;
          }
          last = now;
          void getCurrentBreakpoint().then(callback);
        });
      }
      return () => {};
    },
  };
}

export const nodeById = (id: string | undefined): HostNode | undefined => (id ? findNode(getHost().nodes, id) : undefined);

export const literalClasses = (node: HostNode | undefined, name: string): string[] => {
  const prop = node?.props?.[name];
  if (!prop || prop.type !== 'expr') {
    return [];
  }
  const out: string[] = [];
  for (const [, quote, body] of String(prop.value ?? '').matchAll(/(['"`])([^'"`]*)\1/g)) {
    const literalBody = body ?? '';
    if (quote === '`' && literalBody.includes('${')) {
      continue;
    }
    for (const tok of literalBody.split(/\s+/)) {
      if (isClassName(tok)) {
        out.push(tok);
      }
    }
  }
  return out;
};

export const authoredClassTokens = (node: HostNode | undefined): string[] => [
  ...new Set([
    ...propText(node, 'class').split(/\s+/).filter(Boolean),
    ...literalClasses(node, 'class:list'),
    ...literalClasses(node, 'class'),
  ]),
];

export const classTokens = (node: HostNode | undefined): string[] => {
  const authored = authoredClassTokens(node);
  const host = getHost();
  if (!node || node.id !== host.selectedId) {
    return authored;
  }
  const out = [...authored];
  for (const cls of host.renderedClasses || []) {
    if (cls && !out.includes(cls)) {
      out.push(cls);
    }
  }
  return out;
};

export function selectedInstanceClasses(classList: readonly string[]): string[] {
  const host = getHost();
  if (host.openFileKind !== 'component') {
    return [];
  }
  if (host.contextPagePath === undefined || host.contextPagePath === host.openFilePath) {
    return [];
  }
  return instanceClassesOf({ authored: authoredClassTokens(nodeById(host.selectedId)), rendered: classList });
}

export function selectedComponentMarkup(): ComponentMarkup | undefined {
  const host = getHost();
  if (host.openFileKind !== 'component') {
    return undefined;
  }
  const node = nodeById(host.selectedId);
  if (node === undefined) {
    return undefined;
  }
  const path = pathTo(host.nodes, node.id);
  assert(path === undefined || path[path.length - 1] === node, 'selectedComponentMarkup: the path ends at the selection');
  return markupInTree(path ?? [node], host.nodes);
}

const rendersElement = (node: HostNode): boolean => node.kind === 'element' || node.kind === 'component';

function pathTo(nodes: readonly HostNode[], id: string): HostNode[] | undefined {
  const parents = new Map<HostNode, HostNode | undefined>();
  let target: HostNode | undefined;
  walkNodes(nodes, (node, parent) => {
    parents.set(node, parent);
    if (node.id === id) {
      target = node;
    }
  });
  if (target === undefined) {
    return undefined;
  }
  const path: HostNode[] = [];
  for (let at: HostNode | undefined = target; at !== undefined && path.length <= parents.size; at = parents.get(at)) {
    path.unshift(at);
  }
  assert(path.length <= parents.size, 'pathTo: a path is never longer than the tree');
  return path;
}

function markupInTree(path: readonly HostNode[], top: readonly HostNode[]): ComponentMarkup {
  let parent: ComponentMarkup | undefined;
  let siblings: readonly HostNode[] = top;
  let markup: ComponentMarkup | undefined;
  const selected = path[path.length - 1];
  for (const node of path) {
    if (rendersElement(node) || node === selected) {
      let previous: ComponentMarkup | undefined;
      for (const sibling of siblings) {
        if (sibling === node) {
          break;
        }
        if (rendersElement(sibling)) {
          previous = componentMarkupOf({ classes: authoredClassTokens(sibling), props: sibling.props, parent, previous });
        }
      }
      markup = componentMarkupOf({ classes: authoredClassTokens(node), props: node.props, parent, previous });
      parent = markup;
    }
    siblings = node.children ?? [];
  }
  assert(markup !== undefined, 'markupInTree: the selection is read');
  assert(markup.parent === undefined || path.length > 1, 'markupInTree: only a nested node has a parent');
  return markup;
}

export type ComponentSourceText = {
  readonly source: { readonly origin: { readonly kind: string; readonly path?: string } };
  readonly code: string;
};

export function selectedInstanceMarkup(
  documents: Iterable<ComponentSourceText>,
  readSource: (path: string) => string | undefined,
): ComponentMarkup | undefined {
  const host = getHost();
  if (host.openFileKind === 'component') {
    return undefined;
  }
  const node = nodeById(host.selectedId);
  if (node === undefined || node.kind !== 'component' || node.name === undefined || node.name.length === 0) {
    return undefined;
  }
  const loaded = [...documents].filter((document) => document.source.origin.kind === 'astro' && document.source.origin.path !== undefined);
  const code = host.selectedComponentPath === undefined ? namedSource(loaded, node.name) : importedSource(loaded, host.selectedComponentPath, readSource);
  const root = code === undefined ? undefined : templateRootNode(code);
  return instanceMarkupOf({
    props: node.props,
    passed: authoredClassTokens(node),
    rendered: host.renderedClasses,
    root: root === undefined ? undefined : { classes: authoredClassTokens(root), props: root.props },
  });
}

export function selectedInstanceScope(): string | undefined {
  const host = getHost();
  if (host.openFileKind === 'component') {
    return undefined;
  }
  const node = nodeById(host.selectedId);
  if (node === undefined || node.kind !== 'component') {
    return undefined;
  }
  const scope = host.selectedComponentPath ?? node.name;
  return scope === undefined || scope.length === 0 ? undefined : scope.replaceAll('\\', '/');
}

export function selectedInstanceMarkupPending(documents: Iterable<ComponentSourceText>, pending: (path: string) => boolean): boolean {
  const host = getHost();
  if (host.openFileKind === 'component') {
    return false;
  }
  const node = nodeById(host.selectedId);
  if (node === undefined || node.kind !== 'component') {
    return false;
  }
  if (!host.renderedClassesKnown) {
    return true;
  }
  const path = host.selectedComponentPath;
  if (path === undefined) {
    return false;
  }
  const wanted = path.replaceAll('\\', '/');
  const held = [...documents].some((document) => document.source.origin.kind === 'astro' && document.source.origin.path?.replaceAll('\\', '/') === wanted);
  return held ? false : pending(path);
}

function importedSource(loaded: readonly ComponentSourceText[], path: string, readSource: (path: string) => string | undefined): string | undefined {
  const wanted = path.replaceAll('\\', '/');
  const held = loaded.find((document) => document.source.origin.path?.replaceAll('\\', '/') === wanted);
  return held === undefined ? readSource(path) : held.code;
}

function namedSource(loaded: readonly ComponentSourceText[], name: string): string | undefined {
  const fileName = `${name}.astro`;
  const matches = loaded.filter((document) => document.source.origin.path?.split(/[\\/]/).pop() === fileName);
  return matches.length === 1 ? matches[0]?.code : undefined;
}

export function isHostNode(value: unknown): value is HostNode {
  if (typeof value === 'object' && value !== null) {
    if ('id' in value && 'kind' in value) {
      return typeof value.id === 'string' && typeof value.kind === 'string';
    }
  }
  return false;
}

export async function buildSnapshot(element: AnyElement): Promise<ElementSnapshot> {
  const node = typeof element === 'string' ? nodeById(element) : isHostNode(element) ? element : undefined;
  const classes = classTokens(node);
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(node?.props || {})) {
    if (value && value.type === 'string') {
      attributes[key] = String(value.value ?? '');
    } else if (value && value.type === 'bare') {
      attributes[key] = '';
    }
  }
  const id = propText(node, 'id');
  if (id) {
    attributes['id'] = id;
  }
  if (classes.length) {
    attributes['class'] = classes.join(' ');
  }
  return {
    tag: node?.kind === 'element' ? String(node.name || '').toLowerCase() : undefined,
    webflowType: node?.kind === 'component' ? 'Component' : node?.kind || 'Element',
    id: id || undefined,
    classes,
    classList: classes,
    attributes,
  };
}

export async function resolveIdentityElement(selected: AnyElement): Promise<AnyElement> {
  return selected;
}


export async function getCurrentBreakpoint(): Promise<BreakpointId> {
  const device = getHost().device;
  if (device === 'tablet') {
    return 'medium';
  }
  if (device === 'phone') {
    return 'small';
  }
  return 'main';
}
