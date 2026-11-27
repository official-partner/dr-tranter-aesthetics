
import { assert } from '../core/assert';
import { LIMITS } from '../core/limits';
import { twinOf } from './canvasTwin';
import { HTML_VOID_TAGS } from './htmlTags';

export type CanvasInsertNode =
  | {
      readonly kind: 'element';
      readonly tag: string;
      readonly attributes: readonly (readonly [string, string])[];
      readonly text: string | undefined;
    }
  | { readonly kind: 'component'; readonly name: string }
  | { readonly kind: 'clone'; readonly from: readonly number[]; readonly twinOf?: string }
  | { readonly kind: 'wrap'; readonly tag: string; readonly from: readonly number[] };

export type CanvasInsertPlacement = 'before' | 'after' | 'inside';

export interface CanvasInsert {
  readonly scope: string;
  readonly parent: readonly number[];
  readonly index: number;
  readonly anchor: { readonly path: readonly number[]; readonly placement: CanvasInsertPlacement };
  readonly node: CanvasInsertNode;
}

export interface CanvasInsertTreeNode extends CanvasInsertSource {
  readonly id?: string | undefined;
  readonly children?: readonly CanvasInsertTreeNode[] | undefined;
}

export interface CanvasInsertSource {
  readonly kind: string;
  readonly name?: string | undefined;
  readonly value?: string | undefined;
  readonly props?: Readonly<Record<string, { readonly type: string; readonly value?: string | undefined }>> | undefined;
  readonly children?: readonly CanvasInsertSource[] | undefined;
}

export interface CanvasInsertPlace {
  readonly parentId: string | undefined;
  readonly index: number;
}

export const CANVAS_INSERT_LIMITS = {
  scopeCharsMax: 1_000,
  attributesMax: 32,
  attributeNameCharsMax: 64,
  attributeValueCharsMax: 2_048,
  textCharsMax: 1_024,
  tagCharsMax: 32,
  nameCharsMax: 128,
} as const satisfies Record<string, number>;

const PLACED_KINDS: ReadonlySet<string> = new Set(['element', 'component']);

const UNSAFE_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'title',
  'html',
  'head',
  'body',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'slot',
]);

const NODE_PATH = /^\d+(\.\d+)*$/;
const TAG_NAME = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;
const COMPONENT_NAME = /^[A-Za-z_$][\w$.-]*$/;

export function planCanvasInsert(
  roots: readonly CanvasInsertTreeNode[],
  place: CanvasInsertPlace,
  source: CanvasInsertSource,
  pathOf: (id: string) => string | undefined,
): CanvasInsert | undefined {
  assert(Number.isSafeInteger(place.index), 'planCanvasInsert: a gap is an integer');
  assert(place.index >= 0, 'planCanvasInsert: a gap is not negative');
  const standIn = standInFor(source);
  if (standIn === undefined) {
    return undefined;
  }
  const destination = destinationOf(roots, place.parentId);
  if (destination === undefined) {
    return undefined;
  }
  const gap = Math.min(place.index, destination.list.length);
  const anchor = anchorBeside(destination.list, gap);
  const scope = scopeOf(destination.list, destination.parent, pathOf);
  if (scope === undefined) {
    return undefined;
  }
  const parent =
    destination.parent === undefined ? { scope: scope.scope, trail: [] as readonly number[] } : splitCanvasPath(pathOf(destination.parent.id ?? ''));
  if (parent === undefined || parent.scope !== scope.scope) {
    return undefined;
  }
  const node = standIn.kind === 'component' ? (copyOfTwin(roots, source, parent.scope, pathOf) ?? standIn) : standIn;
  if (anchor !== undefined) {
    const sibling = destination.list[anchor.index];
    const siblingPath = sibling?.id === undefined ? undefined : splitCanvasPath(pathOf(sibling.id));
    if (siblingPath === undefined || siblingPath.scope !== parent.scope) {
      return undefined;
    }
    assert(siblingPath.trail.at(-1) === anchor.index, 'planCanvasInsert: a sibling path ends at its index in its list');
    return { scope: parent.scope, parent: parent.trail, index: gap, anchor: { path: siblingPath.trail, placement: anchor.placement }, node };
  }
  if (destination.parent?.kind !== 'element' || destination.list.some((sibling) => sibling.kind !== 'comment')) {
    return undefined;
  }
  return { scope: parent.scope, parent: parent.trail, index: gap, anchor: { path: parent.trail, placement: 'inside' }, node };
}

function copyOfTwin(
  roots: readonly CanvasInsertTreeNode[],
  source: CanvasInsertSource,
  scope: string,
  pathOf: (id: string) => string | undefined,
): CanvasInsertNode | undefined {
  const id = twinOf(roots, source);
  const found = id === undefined ? undefined : splitCanvasPath(pathOf(id));
  if (found === undefined || found.scope !== scope || source.name === undefined) {
    return undefined;
  }
  assert(found.trail.length > 0, 'copyOfTwin: a twin is a node of the page');
  return { kind: 'clone', from: found.trail, twinOf: source.name };
}

export function planCanvasClone(roots: readonly CanvasInsertTreeNode[], nodeId: string, pathOf: (id: string) => string | undefined): CanvasInsert | undefined {
  const pending: { readonly list: readonly CanvasInsertTreeNode[]; readonly parent: CanvasInsertTreeNode | undefined }[] = [{ list: roots, parent: undefined }];
  for (let visited = 0; visited < pending.length; visited += 1) {
    assert(visited < LIMITS.treeNodesMax, 'planCanvasClone: a tree stays inside its node bound');
    const entry = pending[visited];
    assert(entry !== undefined, 'planCanvasClone: the visit index lies inside the queue');
    for (const [index, node] of entry.list.entries()) {
      if (node.id === nodeId) {
        if (!PLACED_KINDS.has(node.kind)) {
          return undefined;
        }
        const own = splitCanvasPath(pathOf(nodeId));
        if (own === undefined || own.trail.at(-1) !== index) {
          return undefined;
        }
        const parent = own.trail.slice(0, -1);
        return { scope: own.scope, parent, index: index + 1, anchor: { path: own.trail, placement: 'after' }, node: { kind: 'clone', from: own.trail } };
      }
      if (node.children !== undefined) {
        pending.push({ list: node.children, parent: node });
      }
    }
  }
  return undefined;
}

export function planCanvasWrap(
  roots: readonly CanvasInsertTreeNode[],
  nodeId: string,
  tag: string,
  pathOf: (id: string) => string | undefined,
): CanvasInsert | undefined {
  if (!TAG_NAME.test(tag) || UNSAFE_TAGS.has(tag) || HTML_VOID_TAGS.has(tag) || tag.length > CANVAS_INSERT_LIMITS.tagCharsMax) {
    return undefined;
  }
  const clone = planCanvasClone(roots, nodeId, pathOf);
  if (clone === undefined || clone.node.kind !== 'clone') {
    return undefined;
  }
  const from = clone.node.from;
  return { scope: clone.scope, parent: clone.parent, index: clone.index - 1, anchor: { path: from, placement: 'before' }, node: { kind: 'wrap', tag, from } };
}

export function renumberedWrapPath(token: string, insert: Pick<CanvasInsert, 'scope' | 'parent' | 'index'>): string {
  if (!token.startsWith(insert.scope)) {
    return token;
  }
  const local = token.slice(insert.scope.length);
  if (!NODE_PATH.test(local)) {
    return token;
  }
  const trail = local.split('.').map(Number);
  const at = insert.parent.length;
  for (let step = 0; step < at; step += 1) {
    if (trail[step] !== insert.parent[step]) {
      return token;
    }
  }
  if (trail.length <= at || trail[at] !== insert.index) {
    return token;
  }
  return insert.scope + [...trail.slice(0, at + 1), 0, ...trail.slice(at + 1)].join('.');
}

export function renumberedInsertPath(token: string, insert: Pick<CanvasInsert, 'scope' | 'parent' | 'index'>): string {
  if (!token.startsWith(insert.scope)) {
    return token;
  }
  const local = token.slice(insert.scope.length);
  if (!NODE_PATH.test(local)) {
    return token;
  }
  const trail = local.split('.').map(Number);
  const at = insert.parent.length;
  if (trail.length <= at) {
    return token;
  }
  for (let step = 0; step < at; step += 1) {
    if (trail[step] !== insert.parent[step]) {
      return token;
    }
  }
  const index = trail[at] ?? 0;
  if (index < insert.index) {
    return token;
  }
  const renumbered = [...trail.slice(0, at), index + 1, ...trail.slice(at + 1)];
  assert(
    renumbered.every((step) => Number.isSafeInteger(step) && step >= 0),
    'renumberedInsertPath: indexes stay natural numbers',
  );
  return insert.scope + renumbered.join('.');
}

export function insertedNodeToken(insert: Pick<CanvasInsert, 'scope' | 'parent' | 'index'>): string {
  return insert.scope + [...insert.parent, insert.index].join('.');
}

export function parseCanvasInsert(input: unknown): CanvasInsert | undefined {
  const record = recordOf(input);
  if (record === undefined) {
    return undefined;
  }
  const scope = record['scope'];
  const index = record['index'];
  const parent = trailOf(record['parent']);
  const anchor = anchorOf(record['anchor']);
  const node = nodeOf(record['node']);
  if (typeof scope !== 'string' || scope.length > CANVAS_INSERT_LIMITS.scopeCharsMax || (scope !== '' && !scope.endsWith('|'))) {
    return undefined;
  }
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > LIMITS.treeNodesMax) {
    return undefined;
  }
  if (parent === undefined || anchor === undefined || node === undefined) {
    return undefined;
  }
  return { scope, parent, index, anchor, node };
}


function isComponentName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= CANVAS_INSERT_LIMITS.nameCharsMax && COMPONENT_NAME.test(name);
}

function standInFor(source: CanvasInsertSource): CanvasInsertNode | undefined {
  const name = source.name;
  if (name === undefined) {
    return undefined;
  }
  if (source.kind === 'component') {
    return isComponentName(name) ? { kind: 'component', name } : undefined;
  }
  if (source.kind !== 'element') {
    return undefined;
  }
  if (!TAG_NAME.test(name) || name.length > CANVAS_INSERT_LIMITS.tagCharsMax || UNSAFE_TAGS.has(name)) {
    return undefined;
  }
  const attributes: (readonly [string, string])[] = [];
  for (const [attribute, value] of Object.entries(source.props ?? {})) {
    if (value.type !== 'string' || value.value === undefined) {
      continue;
    }
    if (!isSafeAttribute(attribute, value.value)) {
      return undefined;
    }
    attributes.push([attribute, value.value]);
  }
  if (attributes.length > CANVAS_INSERT_LIMITS.attributesMax) {
    return undefined;
  }
  const first = source.children?.[0];
  const text = first?.kind === 'text' && source.children?.length === 1 ? first.value : undefined;
  if (source.children !== undefined && source.children.length > 0 && text === undefined) {
    return undefined;
  }
  if (text !== undefined && (HTML_VOID_TAGS.has(name) || text.length > CANVAS_INSERT_LIMITS.textCharsMax)) {
    return undefined;
  }
  return { kind: 'element', tag: name, attributes, text };
}

export function isSafeAttribute(name: string, value: string): boolean {
  if (!ATTRIBUTE_NAME.test(name) || name.length > CANVAS_INSERT_LIMITS.attributeNameCharsMax) {
    return false;
  }
  if (name.toLowerCase().startsWith('on')) {
    return false;
  }
  if (name.toLowerCase().startsWith('data-avb')) {
    return false;
  }
  return value.length <= CANVAS_INSERT_LIMITS.attributeValueCharsMax;
}

interface Destination {
  readonly list: readonly CanvasInsertTreeNode[];
  readonly parent: CanvasInsertTreeNode | undefined;
}

function destinationOf(roots: readonly CanvasInsertTreeNode[], parentId: string | undefined): Destination | undefined {
  if (parentId === undefined) {
    return { list: roots, parent: undefined };
  }
  const pending: (readonly CanvasInsertTreeNode[])[] = [roots];
  for (let visited = 0; visited < pending.length; visited += 1) {
    assert(visited < LIMITS.treeNodesMax, 'destinationOf: a tree stays inside its node bound');
    const list = pending[visited];
    assert(list !== undefined, 'destinationOf: the visit index lies inside the queue');
    for (const node of list) {
      if (node.id === parentId) {
        return PLACED_KINDS.has(node.kind) ? { list: node.children ?? [], parent: node } : undefined;
      }
      if (node.children !== undefined) {
        pending.push(node.children);
      }
    }
  }
  return undefined;
}

function anchorBeside(list: readonly CanvasInsertTreeNode[], gap: number): { readonly index: number; readonly placement: 'before' | 'after' } | undefined {
  for (let index = gap; index < list.length; index += 1) {
    const kind = list[index]?.kind ?? '';
    if (kind !== 'comment') {
      if (PLACED_KINDS.has(kind)) {
        return { index, placement: 'before' };
      }
      break;
    }
  }
  for (let index = gap - 1; index >= 0; index -= 1) {
    const kind = list[index]?.kind ?? '';
    if (kind !== 'comment') {
      return PLACED_KINDS.has(kind) ? { index, placement: 'after' } : undefined;
    }
  }
  return undefined;
}

function scopeOf(
  list: readonly CanvasInsertTreeNode[],
  parent: CanvasInsertTreeNode | undefined,
  pathOf: (id: string) => string | undefined,
): { readonly scope: string } | undefined {
  const holder = parent ?? list.find((sibling) => sibling.id !== undefined);
  if (holder?.id === undefined) {
    return undefined;
  }
  const split = splitCanvasPath(pathOf(holder.id));
  return split === undefined ? undefined : { scope: split.scope };
}

function splitCanvasPath(path: string | undefined): { readonly scope: string; readonly trail: readonly number[] } | undefined {
  if (path === undefined) {
    return undefined;
  }
  const bar = path.lastIndexOf('|');
  const scope = bar < 0 ? '' : path.slice(0, bar + 1);
  const local = path.slice(bar + 1);
  if (!NODE_PATH.test(local)) {
    return undefined;
  }
  return { scope, trail: local.split('.').map(Number) };
}

function recordOf(input: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(input));
}

function trailOf(input: unknown): readonly number[] | undefined {
  if (!Array.isArray(input) || input.length > LIMITS.treeDepthMax + 1) {
    return undefined;
  }
  const trail: number[] = [];
  for (const step of input) {
    if (typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0 || step > LIMITS.treeNodesMax) {
      return undefined;
    }
    trail.push(step);
  }
  return trail;
}

function anchorOf(input: unknown): CanvasInsert['anchor'] | undefined {
  const record = recordOf(input);
  if (record === undefined) {
    return undefined;
  }
  const placement = record['placement'];
  const path = trailOf(record['path']);
  if (path === undefined || (placement !== 'before' && placement !== 'after' && placement !== 'inside')) {
    return undefined;
  }
  if (placement !== 'inside' && path.length === 0) {
    return undefined;
  }
  return { path, placement };
}

function nodeOf(input: unknown): CanvasInsertNode | undefined {
  const record = recordOf(input);
  if (record === undefined) {
    return undefined;
  }
  if (record['kind'] === 'wrap') {
    const from = trailOf(record['from']);
    const tag = record['tag'];
    if (from === undefined || from.length === 0 || typeof tag !== 'string' || !TAG_NAME.test(tag) || UNSAFE_TAGS.has(tag) || HTML_VOID_TAGS.has(tag)) {
      return undefined;
    }
    return { kind: 'wrap', tag, from };
  }
  if (record['kind'] === 'clone') {
    const from = trailOf(record['from']);
    const twin = record['twinOf'];
    if (from === undefined || from.length === 0 || (twin !== undefined && !isComponentName(twin))) {
      return undefined;
    }
    return twin === undefined ? { kind: 'clone', from } : { kind: 'clone', from, twinOf: twin };
  }
  if (record['kind'] === 'component') {
    const name = record['name'];
    return isComponentName(name) ? { kind: 'component', name } : undefined;
  }
  if (record['kind'] !== 'element') {
    return undefined;
  }
  const tag = record['tag'];
  const text = record['text'];
  const list = record['attributes'];
  if (typeof tag !== 'string' || !TAG_NAME.test(tag) || tag.length > CANVAS_INSERT_LIMITS.tagCharsMax || UNSAFE_TAGS.has(tag)) {
    return undefined;
  }
  if (text !== undefined && (typeof text !== 'string' || text.length > CANVAS_INSERT_LIMITS.textCharsMax || HTML_VOID_TAGS.has(tag))) {
    return undefined;
  }
  if (!Array.isArray(list) || list.length > CANVAS_INSERT_LIMITS.attributesMax) {
    return undefined;
  }
  const attributes: (readonly [string, string])[] = [];
  for (const entry of list) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return undefined;
    }
    const name: unknown = entry[0];
    const value: unknown = entry[1];
    if (typeof name !== 'string' || typeof value !== 'string' || !isSafeAttribute(name, value)) {
      return undefined;
    }
    attributes.push([name, value]);
  }
  return { kind: 'element', tag, attributes, text };
}
