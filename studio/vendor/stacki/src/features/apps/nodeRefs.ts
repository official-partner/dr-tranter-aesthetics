import { assert } from '../../../shared/core/assert';
import {
  APP_RPC_LIMITS,
  nodeRefKey,
  type AppNodeLayer,
  type AppNodeRef,
  type AppNodeRefStep,
  type AppNodeView,
  type AppPageView,
  type AppRect,
} from '../../../shared/properties/appsRpc';
import type { CanvasChainStep, CanvasLayer, CanvasPointReport } from '../../ui/canvasPointQuery';
import { ownKey } from './nodeKeys';
import { elementHoverNode, type CanvasHighlight, type CanvasHighlightStyle, type DeepHoverNode } from '../../../shared/properties/deepOutline';

export interface NodeRefHost {
  readonly open: () => AppPageView | undefined;
  readonly canvasPage: () => string | undefined;
  readonly tree: (file: string) => Promise<readonly AppNodeView[] | undefined>;
  readonly locate: (chain: readonly CanvasChainStep[]) => Promise<CanvasPointReport | undefined>;
}

export interface NodeRefTarget {
  readonly path: string;
  readonly occurrence: number;
  readonly box: AppRect | undefined;
}

export type NodeRefSteps =
  | {
      readonly found: true;
      readonly ref: AppNodeRef;
      readonly chain: readonly CanvasChainStep[];
      readonly openNodeId: string | undefined;
      readonly inner: AppNodeView;
    }
  | { readonly found: false; readonly reason: string };

export async function nodeLayers(host: NodeRefHost, frameLayers: readonly CanvasLayer[]): Promise<readonly AppNodeLayer[]> {
  assert(frameLayers.length <= APP_RPC_LIMITS.nodeLayersMax, 'nodeLayers: the frame names a bounded number of layers');
  const trees = treeReader(host);
  const steps: AppNodeRefStep[] = [];
  const layers: AppNodeLayer[] = [];
  for (const frameLayer of [...frameLayers].reverse()) {
    const place = splitCanvasPath(frameLayer.path, host.canvasPage());
    const tree = place === undefined ? undefined : await trees(place.file);
    const view = place === undefined || tree === undefined ? undefined : viewAtTrail(tree, place.trail);
    if (place === undefined || view === undefined) {
      continue;
    }
    const step: AppNodeRefStep = { file: place.file, nodeId: view.id, key: ownKey(view), copy: frameLayer.copy };
    layers.push({
      file: place.file,
      nodeId: view.id,
      key: step.key,
      component: view.kind === 'component' ? view.name : undefined,
      instancePath: [...steps],
      ref: { steps: [...steps, step] },
    });
    steps.push(step);
  }
  assert(layers.length <= frameLayers.length, 'nodeLayers: no layer is invented');
  return layers.reverse();
}

export async function resolveNodeRefSteps(host: NodeRefHost, ref: AppNodeRef): Promise<NodeRefSteps> {
  assert(ref.steps.length > 0, 'resolveNodeRefSteps: a ref has a step');
  assert(ref.steps.length <= APP_RPC_LIMITS.nodeLayersMax, 'resolveNodeRefSteps: a ref is bounded');
  const trees = treeReader(host);
  const openPath = host.open()?.path;
  const canvasPage = host.canvasPage();
  const chain: CanvasChainStep[] = [];
  const steps: AppNodeRefStep[] = [];
  let openNodeId: string | undefined = undefined;
  let inner: AppNodeView | undefined = undefined;
  for (const step of ref.steps) {
    const tree = await trees(step.file);
    if (tree === undefined) {
      return { found: false, reason: `Stacki cannot read ${step.file}` };
    }
    const found = findView(tree, (view) => (step.key === undefined ? view.id === step.nodeId : ownKey(view) === step.key));
    if (found === undefined) {
      return { found: false, reason: `${step.file} has no element ${step.key ?? step.nodeId ?? ''} any more` };
    }
    const space = step.file === canvasPage ? '' : `${step.file}|`;
    chain.push({ path: `${space}${found.trail.join('.')}`, copy: step.copy });
    steps.push({ file: step.file, nodeId: found.view.id, key: ownKey(found.view), copy: step.copy });
    if (step.file === openPath) {
      openNodeId = found.view.id;
    }
    inner = found.view;
  }
  assert(inner !== undefined, 'resolveNodeRefSteps: a ref with a step names an element');
  assert(chain.length === ref.steps.length, 'resolveNodeRefSteps: one canvas path per step');
  return { found: true, ref: { steps }, chain, openNodeId, inner };
}

export async function resolveNodeRef(host: NodeRefHost, ref: AppNodeRef): Promise<NodeRefTarget | { readonly reason: string }> {
  const steps = await resolveNodeRefSteps(host, ref);
  if (!steps.found) {
    return { reason: steps.reason };
  }
  const report = await host.locate(steps.chain);
  if (report?.path === undefined) {
    return { reason: 'That element is not drawn on the canvas' };
  }
  assert(report.path === steps.chain.at(-1)?.path, 'resolveNodeRef: the canvas answers for the innermost step');
  const box = report.box === undefined ? undefined : { x: report.box.x, y: report.box.y, width: Math.max(0, report.box.w), height: Math.max(0, report.box.h) };
  return { path: report.path, occurrence: report.occurrence, box };
}

export async function resolveHighlight(
  host: NodeRefHost,
  ref: AppNodeRef,
  style: CanvasHighlightStyle,
): Promise<CanvasHighlight | { readonly reason: string }> {
  const steps = await resolveNodeRefSteps(host, ref);
  if (!steps.found) {
    return { reason: steps.reason };
  }
  const report = await host.locate(steps.chain);
  if (report?.path === undefined) {
    return { reason: 'That element is not drawn on the canvas' };
  }
  const inner = steps.inner;
  const node: DeepHoverNode =
    inner.kind === 'component' ? { kind: 'component', label: inner.name, tag: undefined } : elementHoverNode(inner.name || inner.kind, inner.classes.join(' '));
  return { path: report.path, occurrence: report.occurrence, node, style };
}

export function splitCanvasPath(path: string, canvasPage: string | undefined): { readonly file: string; readonly trail: readonly number[] } | undefined {
  const bar = path.lastIndexOf('|');
  const file = bar === -1 ? canvasPage : path.slice(0, bar);
  const local = path.slice(bar + 1);
  if (file === undefined || file === '' || !/^\d+(?:\.\d+)*$/.test(local)) {
    return undefined;
  }
  const trail = local.split('.').map(Number);
  assert(
    trail.every((index) => Number.isSafeInteger(index)),
    'splitCanvasPath: a trail is whole indexes',
  );
  return { file, trail };
}

export function viewAtTrail(roots: readonly AppNodeView[], trail: readonly number[]): AppNodeView | undefined {
  assert(trail.length <= APP_RPC_LIMITS.treeDepthMax + 1, 'viewAtTrail: a trail is within the tree depth');
  let list = roots;
  let view: AppNodeView | undefined = undefined;
  for (const index of trail) {
    view = list[index];
    if (view === undefined) {
      return undefined;
    }
    list = view.children;
  }
  return view;
}

function findView(
  roots: readonly AppNodeView[],
  matches: (view: AppNodeView) => boolean,
): { readonly view: AppNodeView; readonly trail: readonly number[] } | undefined {
  const stack: { readonly view: AppNodeView; readonly trail: readonly number[] }[] = roots.map((view, index) => ({ view, trail: [index] })).reverse();
  for (let visited = 0; stack.length > 0; visited += 1) {
    assert(visited < APP_RPC_LIMITS.treeNodesMax * 2, 'findView: the search is bounded by the reply bound');
    const entry = stack.pop();
    if (entry === undefined) {
      break;
    }
    if (matches(entry.view)) {
      return entry;
    }
    for (let index = entry.view.children.length - 1; index >= 0; index -= 1) {
      const child = entry.view.children[index];
      if (child !== undefined) {
        stack.push({ view: child, trail: [...entry.trail, index] });
      }
    }
  }
  return undefined;
}

function treeReader(host: NodeRefHost): (file: string) => Promise<readonly AppNodeView[] | undefined> {
  const read = new Map<string, Promise<readonly AppNodeView[] | undefined>>();
  const open = host.open();
  return (file) => {
    if (open !== undefined && file === open.path) {
      return Promise.resolve(open.nodes);
    }
    const known = read.get(file);
    if (known !== undefined) {
      return known;
    }
    const reading = host.tree(file);
    read.set(file, reading);
    assert(read.size <= APP_RPC_LIMITS.nodeLayersMax, 'treeReader: one resolution reads a bounded number of files');
    return reading;
  };
}


export interface NodeRefTargets {
  readonly target: (ref: AppNodeRef) => { readonly path: string; readonly occurrence: number } | undefined;
  readonly want: (refs: readonly AppNodeRef[]) => void;
  readonly refresh: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly version: () => number;
}

interface TargetEntry {
  readonly ref: AppNodeRef;
  readonly target: { readonly path: string; readonly occurrence: number } | undefined;
  readonly round: number;
}

export function createNodeRefTargets(deps: { readonly host: () => NodeRefHost | undefined; readonly refsMax: number }): NodeRefTargets {
  const entries = new Map<string, TargetEntry>();
  const listeners = new Set<() => void>();
  let version = 0;
  let round = 0;
  const publish = (): void => {
    version += 1;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const resolve = (key: string, ref: AppNodeRef): void => {
    const host = deps.host();
    round += 1;
    const mine = round;
    entries.set(key, { ref, target: entries.get(key)?.target, round: mine });
    if (host === undefined) {
      return;
    }
    void resolveNodeRef(host, ref).then((resolved) => {
      const entry = entries.get(key);
      if (entry === undefined || entry.round !== mine) {
        return;
      }
      const target = 'reason' in resolved ? undefined : { path: resolved.path, occurrence: resolved.occurrence };
      if (target?.path === entry.target?.path && target?.occurrence === entry.target?.occurrence) {
        return;
      }
      entries.set(key, { ...entry, target });
      publish();
    });
  };
  return {
    target: (ref) => entries.get(nodeRefKey(ref))?.target,
    want: (refs) => {
      const wanted = new Map(refs.slice(0, deps.refsMax).map((ref) => [nodeRefKey(ref), ref] as const));
      let dropped = false;
      for (const key of [...entries.keys()]) {
        if (!wanted.has(key)) {
          entries.delete(key);
          dropped = true;
        }
      }
      for (const [key, ref] of wanted) {
        if (!entries.has(key)) {
          resolve(key, ref);
        }
      }
      assert(entries.size <= deps.refsMax, 'NodeRefTargets: wanted refs are bounded');
      if (dropped) {
        publish();
      }
    },
    refresh: () => {
      for (const [key, entry] of [...entries]) {
        resolve(key, entry.ref);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
  };
}
