import { assert } from '../../shared/core/assert';
import type { EditorModel, EditorNode } from './pageView';
import type { Edit, NodeRef } from '../../shared/engine/editRequest';
import { singleDeclarationChange } from '../../shared/engine/inlineStyle';
import { LIMITS } from '../../shared/core/limits';
import type { Attr } from '../../shared/page/pageNode';
import { labelsNode } from '../../shared/page/leadingNote';
import { renamedAttr } from './attrOrder';
import { loopVarsAt, parseLoopHead, renamedLoopVar, strippedBindings } from './loopBindings';
import type { EditGesture } from './pageEdits';
import type { CodeHunk } from '../../shared/engine/codePatch';
import { planVariableRename, type FileCode, type VariableRename } from '../../shared/engine/variableRename';
import { predictedRename } from './predictedRename';
import {
  type Urgency,
  withNode,
  type InsertPlace,
  type Placement,
  withoutNodes,
  withInserted,
  withChildren,
  containsNode,
  besidePlace,
  blank,
  findNode,
} from './insertGestures';
export { withNode, type InsertPlace, insertGesture, duplicateGesture, removalGesture, withoutNodes, withInserted, withChildren } from './insertGestures';

export type PropPatch = Readonly<Record<string, Attr | undefined>>;

export function propsGesture(nodeId: string, patch: PropPatch, options: { readonly coalesceKey: string | undefined; readonly urgency: Urgency }): EditGesture {
  const names = Object.keys(patch);
  const [only] = names;
  return {
    coalesceKey: options.coalesceKey,
    urgency: options.urgency,
    stream: names.length === 1 && only !== undefined ? `attribute:${nodeId}:${only}` : undefined,
    request: (refOf) => {
      const target = refOf(nodeId);
      if (target === undefined) {
        return undefined;
      }
      const edits: Edit[] = [];
      for (const [name, value] of Object.entries(patch)) {
        const edit = attributeEdit(target, name, value);
        if (edit === undefined) {
          return undefined;
        }
        edits.push(edit);
      }
      return edits;
    },
    apply: (model) => withNode(model, nodeId, (node) => Object.assign({}, node, { props: patchedProps(node.props, patch) })),
  };
}

function attributeEdit(target: NodeRef, name: string, value: Attr | undefined): Edit | undefined {
  if (value === undefined) {
    return { tag: 'remove-attribute', target, name };
  }
  switch (value.type) {
    case 'string':
    case 'expr':
      return { tag: 'set-attribute', target, name, value };
    case 'bare':
      return { tag: 'set-attribute', target, name, value: { type: 'bare' } };
    case 'spread':
      return undefined;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function patchedProps(props: Readonly<Record<string, Attr>> | undefined, patch: PropPatch): Record<string, Attr> {
  const next: Record<string, Attr> = {};
  for (const [name, value] of Object.entries(props ?? {})) {
    if (Object.hasOwn(patch, name)) {
      const patched = patch[name];
      if (patched !== undefined) {
        Object.defineProperty(next, name, {
          value: patched,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    } else {
      Object.defineProperty(next, name, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  for (const [name, value] of Object.entries(patch)) {
    if (value !== undefined && !Object.hasOwn(next, name)) {
      Object.defineProperty(next, name, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return next;
}


export function inlineStyleGesture(
  nodeId: string,
  styles: { readonly before: string; readonly after: string },
  options: { readonly coalesceKey: string | undefined; readonly urgency: Urgency },
): EditGesture {
  const whole = propsGesture(nodeId, { style: { type: 'string', value: styles.after } }, options);
  const change = singleDeclarationChange(styles.before, styles.after);
  const single = change !== undefined && !/["']/.test(styles.after);
  return {
    ...whole,
    stream: single ? `style:${nodeId}:${change.property}` : whole.stream,
    request: (refOf, origin) => {
      if (!single) {
        return whole.request(refOf, origin);
      }
      const target = refOf(nodeId);
      if (target === undefined) {
        return undefined;
      }
      const { property, declaration } = change;
      return [{ tag: 'set-inline-style', target, property, declaration }];
    },
  };
}


export interface MoveRules {
  readonly keepsSlot: (model: EditorModel, nodeId: string) => boolean;
}

export function moveGesture(
  model: EditorModel,
  nodeId: string,
  place: InsertPlace | undefined,
  rules: MoveRules,
  options: { readonly urgency: Urgency },
): EditGesture | undefined {
  const found = findWithList(model.nodes, nodeId);
  if (found === undefined) {
    return undefined;
  }
  if (place?.parentId === nodeId || (place?.parentId !== undefined && containsNode(found.node.children ?? [], place.parentId))) {
    return undefined;
  }
  const previous = found.list[found.index - 1];
  const note = previous !== undefined && labelsNode(previous.kind, found.node.kind) ? previous : undefined;
  const moving = note === undefined ? [nodeId] : [note.id, nodeId];
  const landing = relocated(model, found, moving, place);
  const slot = found.node.props?.['slot'];
  const dropSlot = slot?.type === 'string' ? !rules.keepsSlot(landing.model, nodeId) : false;
  const beside = besidePlace(model, place, new Set(moving));
  const lost = lostVariables(model, landing.model, nodeId);
  return {
    coalesceKey: undefined,
    urgency: options.urgency,
    stream: undefined,
    request: (refOf) => moveRequest({ nodeId, beside, dropSlot }, refOf),
    apply: (current) => {
      const again = findWithList(current.nodes, nodeId);
      if (again === undefined) {
        return current;
      }
      const moved = relocated(current, again, moving, place, (node) => {
        const props = dropSlot ? patchedProps(node.props, { slot: undefined }) : node.props;
        return strippedBindings(props === undefined ? node : { ...node, props }, lost).node;
      });
      return moved.model;
    },
  };
}

function moveRequest(
  move: {
    readonly nodeId: string;
    readonly beside: { readonly anchorId: string; readonly placement: Placement } | undefined;
    readonly dropSlot: boolean;
  },
  refOf: (nodeId: string) => NodeRef | undefined,
): readonly Edit[] | undefined {
  const { beside } = move;
  const target = refOf(move.nodeId);
  const destination = beside === undefined ? undefined : refOf(beside.anchorId);
  if (target === undefined || beside === undefined || destination === undefined) {
    return undefined;
  }
  const edits: Edit[] = [];
  if (move.dropSlot) {
    edits.push({ tag: 'remove-attribute', target, name: 'slot' });
  }
  edits.push({ tag: 'move-node', target, destination, placement: beside.placement });
  assert(edits.length > 0, 'A move states at least one edit');
  assert(edits.at(-1)?.tag === 'move-node', 'A move ends with the relocation');
  return edits;
}

function lostVariables(before: EditorModel, after: EditorModel, nodeId: string): readonly string[] {
  const now = loopVarsAt(after.nodes, nodeId);
  return loopVarsAt(before.nodes, nodeId).filter((name) => !now.includes(name));
}

function relocated(
  model: EditorModel,
  found: {
    readonly list: readonly EditorNode[];
    readonly index: number;
    readonly node: EditorNode;
  },
  moving: readonly string[],
  place: InsertPlace | undefined,
  reshape: (node: EditorNode) => EditorNode = (node) => node,
): { readonly model: EditorModel } {
  const removeAt = found.index - (moving.length - 1);
  const without = withoutNodes(model, moving);
  const parentId = place?.parentId;
  const sameList = parentId === undefined ? found.list === model.nodes : findNode(model.nodes, parentId)?.children === found.list;
  let index = place?.index ?? Number.MAX_SAFE_INTEGER;
  if (sameList && index > removeAt) {
    index = Math.max(removeAt, index - moving.length);
  }
  const node = reshape(found.node);
  const landed = withInserted(without, node, place === undefined ? undefined : { parentId, index });
  if (moving.length === 1) {
    return { model: landed };
  }
  const noteNode = found.list[found.index - 1];
  assert(noteNode !== undefined, 'A moved note sits above its node');
  const at = findWithList(landed.nodes, node.id);
  assert(at !== undefined, 'The moved node landed');
  const noteParent = at.parentId;
  return { model: withInserted(landed, noteNode, { parentId: noteParent, index: at.index }) };
}

function findWithList(
  list: readonly EditorNode[],
  nodeId: string,
):
  | {
      readonly list: readonly EditorNode[];
      readonly index: number;
      readonly node: EditorNode;
      readonly parentId: string | undefined;
    }
  | undefined {
  const pending: { readonly list: readonly EditorNode[]; readonly parentId: string | undefined }[] = [{ list, parentId: undefined }];
  for (let visited = 0; visited < pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'A model stays inside its node bound');
    const entry = pending[visited];
    assert(entry !== undefined, 'The visit index lies inside the list');
    for (const [index, node] of entry.list.entries()) {
      if (node.id === nodeId) {
        return { list: entry.list, index, node, parentId: entry.parentId };
      }
      if (Array.isArray(node.children)) {
        pending.push({ list: node.children, parentId: node.id });
      }
    }
  }
  return undefined;
}


export function frontmatterGesture(
  model: EditorModel,
  options: { readonly coalesceKey: string | undefined; readonly urgency: Urgency },
  change: (model: EditorModel) => EditorModel,
): EditGesture {
  const after = change(model);
  return {
    coalesceKey: options.coalesceKey,
    urgency: options.urgency,
    stream: 'frontmatter',
    request: () => {
      const edit: Edit = { tag: 'set-frontmatter', model: { ...after, nodes: [] } };
      return [edit];
    },
    apply: change,
  };
}

function restatement(restates: string | undefined): { readonly restates?: string } {
  return restates === undefined ? {} : { restates };
}

export function sequence(first: EditGesture, second: EditGesture): EditGesture {
  return {
    coalesceKey: first.coalesceKey,
    urgency: first.urgency,
    stream: undefined,
    ...restatement(second.restates ?? first.restates),
    request: (refOf, origin) => {
      const before = first.request(refOf, origin);
      const after = second.request(refOf, origin);
      if (before === undefined || after === undefined) {
        return undefined;
      }
      return [...before, ...after];
    },
    apply: (model) => second.apply(first.apply(model)),
  };
}


export interface LoopRename {
  readonly from: string;
  readonly to: string;
}

export function loopRenameGesture(
  model: EditorModel,
  nodeId: string,
  change: { readonly head: string; readonly renames: readonly LoopRename[] },
  options: { readonly urgency: Urgency },
): EditGesture | undefined {
  const node = findNode(model.nodes, nodeId);
  if (node?.kind !== 'map' || node.head === undefined) {
    return undefined;
  }
  const renames = change.renames.filter((rename) => rename.from !== rename.to);
  if (!onlyRenames(node.head, change.head, renames)) {
    return undefined;
  }
  return {
    coalesceKey: undefined,
    urgency: options.urgency,
    stream: undefined,
    request: (refOf) => {
      const target = refOf(nodeId);
      if (target === undefined) {
        return undefined;
      }
      return renames.map(({ from, to }): Edit => ({ tag: 'rename-binding', target, from, to }));
    },
    apply: (current) =>
      withNode(current, nodeId, (loop) => {
        const children = renames.reduce((list, { from, to }) => renamedLoopVar(list, from, to), loop.children ?? []);
        return withChildren({ ...loop, head: change.head }, children);
      }),
  };
}

function onlyRenames(before: string, after: string, renames: readonly LoopRename[]): boolean {
  if (renames.length === 0) {
    return false;
  }
  const old = parseLoopHead(before);
  const next = parseLoopHead(after);
  if (old === undefined) {
    return false;
  }
  if (next === undefined) {
    return false;
  }
  const renamed = (name: string) => renames.find((rename) => rename.from === name)?.to ?? name;
  if (old.data !== next.data) {
    return false;
  }
  return renamed(old.item) === next.item && renamed(old.index) === next.index;
}


export function variableRenameGesture(file: FileCode, rename: VariableRename, hunks: readonly CodeHunk[]): EditGesture {
  assert(rename.from !== rename.to, 'A rename changes the name');
  assert(hunks.length > 0, 'A rename changes the file');
  return {
    coalesceKey: undefined,
    urgency: true,
    stream: undefined,
    request: (_refOf, origin) => {
      const plan = origin.source === file.source ? undefined : planVariableRename(origin, rename);
      const edit: Edit = { tag: 'code-patch', hunks: plan?.ok === true ? plan.hunks : hunks };
      return [edit];
    },
    apply: (model) => predictedRename(model, rename),
  };
}


export function nodeGesture(nodeId: string, next: EditorNode, options: { readonly coalesceKey: string | undefined; readonly urgency: Urgency }): EditGesture {
  assert(next.id === nodeId, 'A restated node keeps its id');
  return {
    coalesceKey: options.coalesceKey,
    urgency: options.urgency,
    stream: `node:${nodeId}`,
    restates: nodeId,
    request: (refOf) => {
      const target = refOf(nodeId);
      if (target === undefined) {
        return undefined;
      }
      const edit: Edit = { tag: 'replace-node', target, node: next };
      return [edit];
    },
    apply: (model) => withNode(model, nodeId, () => next),
  };
}

export function attributeRenameGesture(model: EditorModel, nodeId: string, names: { readonly from: string; readonly to: string }): EditGesture | undefined {
  const node = findNode(model.nodes, nodeId);
  const renamed = node === undefined ? undefined : renamedAttr(node, names.from, names.to);
  if (node === undefined || renamed === undefined) {
    return undefined;
  }
  const taken = Object.hasOwn(node.props ?? {}, names.to);
  return {
    coalesceKey: undefined,
    urgency: true,
    stream: undefined,
    request: (refOf) => {
      const target = refOf(nodeId);
      if (target === undefined) {
        return undefined;
      }
      const rename: Edit = { tag: 'rename-attribute', target, ...names };
      if (!taken) {
        return [rename];
      }
      const removal: Edit = { tag: 'remove-attribute', target, name: names.to };
      return [removal, rename];
    },
    apply: (current) =>
      withNode(current, nodeId, (found) => ({
        ...found,
        ...renamedAttr(found, names.from, names.to),
      })),
  };
}

export function tagRenameGesture(node: EditorNode, next: EditorNode, options: { readonly urgency: Urgency }): EditGesture {
  const nodeId = node.id;
  assert(next.id === nodeId, 'A renamed node keeps its id');
  const name = next.name;
  assert(name !== undefined, 'A renamed tag has a name');
  if (!Array.isArray(node.children) || !Array.isArray(next.children)) {
    return nodeGesture(nodeId, next, { coalesceKey: undefined, urgency: options.urgency });
  }
  return {
    coalesceKey: undefined,
    urgency: options.urgency,
    stream: undefined,
    request: (refOf) => {
      const target = refOf(nodeId);
      if (target === undefined) {
        return undefined;
      }
      return [{ tag: 'rename-tag', target, to: name }];
    },
    apply: (model) => withNode(model, nodeId, () => next),
  };
}

export function wrapGesture(model: EditorModel, wrapper: EditorNode): EditGesture {
  const name = wrapper.name;
  assert(name !== undefined, 'A wrapper is a named tag');
  const standing = model.nodes.filter((node) => !blank(node));
  const first = standing[0];
  const last = standing[standing.length - 1];
  return {
    coalesceKey: undefined,
    urgency: true,
    stream: undefined,
    request: (refOf) => {
      const target = first === undefined ? undefined : refOf(first.id);
      const end = last === undefined ? undefined : refOf(last.id);
      if (target === undefined || end === undefined) {
        return undefined;
      }
      return [{ tag: 'wrap-nodes', target, last: end, name }];
    },
    apply: (current) => ({ ...current, nodes: [withChildren(wrapper, current.nodes)] }),
  };
}

export function unwrapGesture(nodeId: string): EditGesture {
  return {
    coalesceKey: undefined,
    urgency: true,
    stream: undefined,
    request: (refOf) => {
      const target = refOf(nodeId);
      if (target === undefined) {
        return undefined;
      }
      return [{ tag: 'unwrap-node', target }];
    },
    apply: (model) => {
      const nodes = unwrappedIn(model.nodes, nodeId, 0);
      return nodes === model.nodes ? model : { ...model, nodes };
    },
  };
}

function unwrappedIn(list: readonly EditorNode[], nodeId: string, depth: number): readonly EditorNode[] {
  assert(depth <= LIMITS.treeDepthMax, 'A model is no deeper than its bound');
  for (const [index, node] of list.entries()) {
    const children = node.children ?? [];
    if (node.id === nodeId) {
      return [...list.slice(0, index), ...children, ...list.slice(index + 1)];
    }
    const inner = unwrappedIn(children, nodeId, depth + 1);
    if (inner !== children) {
      return list.map((item, at) => (at === index ? withChildren(node, inner) : item));
    }
  }
  return list;
}
