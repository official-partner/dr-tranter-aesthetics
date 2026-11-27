import { assert } from '../../shared/core/assert';
import { PRELOAD_LIMITS, isElement, type Rect } from './frameBasics';
import { rectsForPath } from './frameMeasure';
import { PATH_ATTR, pathsOf, regions, runOrder, runsOf, taggedAncestor, taggedPlaces } from './frameRegions';

export const FRAME_LAYER_LIMITS = {
  layersMax: 32,
  hitsMax: 4096,
  pathCharsMax: 4096,
  copyMax: 100_000,
} as const;

export interface FrameLayer {
  readonly path: string;
  readonly occurrence: number;
  readonly copy: number;
}

export interface FrameChainStep {
  readonly path: string;
  readonly copy: number;
}

export interface FrameChainHit {
  readonly path: string;
  readonly occurrence: number;
  readonly box: Rect | undefined;
}

interface Hit {
  readonly path: string;
  readonly anchor: Element;
  readonly nodes: readonly Node[];
  readonly order: number | undefined;
  readonly occurrence: number;
}

export function layersAtPoint(x: number, y: number): readonly FrameLayer[] {
  if (typeof document === 'undefined') {
    return [];
  }
  const target = document.elementFromPoint(x, y);
  return target === null ? [] : layersAt(target);
}

export function layersAt(target: Element): readonly FrameLayer[] {
  const hits = hitsAt(target);
  const chosen: Hit[] = [];
  const used = new Set<string>();
  let space: string | undefined = hits.some((hit) => namespaceOf(hit.path) === '') ? '' : outermost(hits.filter((hit) => segmentsOf(hit.path) === 1));
  let outer: Hit | undefined = undefined;
  for (let step = 0; space !== undefined && step < FRAME_LAYER_LIMITS.layersMax; step += 1) {
    const inSpace = space;
    const pick = deepest(hits.filter((hit) => namespaceOf(hit.path) === inSpace && (outer === undefined || inside(hit, outer))));
    if (pick === undefined) {
      break;
    }
    chosen.push(pick);
    used.add(inSpace);
    const roots = hits.filter((hit) => !used.has(namespaceOf(hit.path)) && segmentsOf(hit.path) === 1 && inside(hit, pick));
    space = outermost(roots);
    outer = pick;
  }
  assert(chosen.length <= FRAME_LAYER_LIMITS.layersMax, 'layersAt: the layers are bounded');
  const layers = chosen.map((hit, index) => ({ path: hit.path, occurrence: hit.occurrence, copy: copyWithin(hit, chosen[index - 1]) }));
  assert(new Set(layers.map((layer) => namespaceOf(layer.path))).size === layers.length, 'layersAt: one layer per file');
  return layers.reverse();
}

export function resolveChain(chain: readonly FrameChainStep[]): FrameChainHit | undefined {
  assert(chain.length <= FRAME_LAYER_LIMITS.layersMax, 'resolveChain: the chain is bounded');
  let outerNodes: readonly Node[] | undefined = undefined;
  let found: { readonly path: string; readonly occurrence: number } | undefined = undefined;
  for (const step of chain) {
    const copies = copiesOf(step.path);
    if (copies.length === 0) {
      found = undefined;
      continue;
    }
    const within: number[] = [];
    for (const [index, copy] of copies.entries()) {
      if (outerNodes === undefined || copyIn(copy, outerNodes)) {
        within.push(index);
      }
    }
    const index = within[step.copy];
    if (index === undefined) {
      return undefined;
    }
    outerNodes = copies[index];
    found = { path: step.path, occurrence: index };
  }
  if (found === undefined) {
    return undefined;
  }
  assert(found.path === chain.at(-1)?.path, 'resolveChain: the answer is the innermost step');
  return { ...found, box: rectsForPath(found.path)?.[found.occurrence] };
}

export function parseFrameChain(input: unknown): readonly FrameChainStep[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > FRAME_LAYER_LIMITS.layersMax) {
    return undefined;
  }
  const steps: FrameChainStep[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) {
      return undefined;
    }
    const path: unknown = Reflect.get(item, 'path');
    const copy: unknown = Reflect.get(item, 'copy');
    if (typeof path !== 'string' || path.length === 0 || path.length > FRAME_LAYER_LIMITS.pathCharsMax) {
      return undefined;
    }
    if (typeof copy !== 'number' || !Number.isSafeInteger(copy) || copy < 0 || copy > FRAME_LAYER_LIMITS.copyMax) {
      return undefined;
    }
    steps.push({ path, copy });
  }
  return steps;
}

function hitsAt(target: Element): readonly Hit[] {
  const hits: Hit[] = [];
  for (const path of regions.keys()) {
    if (hits.length >= FRAME_LAYER_LIMITS.hitsMax) {
      break;
    }
    const runs = runsOf(path) ?? [];
    for (const [index, run] of runs.entries()) {
      const anchor = run.find((node): node is Element => isElement(node) && node.isConnected && (node === target || node.contains(target)));
      if (anchor !== undefined) {
        hits.push({ path, anchor, nodes: run, order: runOrder(run), occurrence: index });
        break;
      }
    }
  }
  const seen = new Set<string>();
  let element: Element | undefined = target.closest(`[${PATH_ATTR}]`) ?? undefined;
  for (let depth = 0; element !== undefined && depth < PRELOAD_LIMITS.domDepthMax; depth += 1) {
    const holder: Element = element;
    for (const path of pathsOf(holder)) {
      if (regions.has(path) || seen.has(path) || hits.length >= FRAME_LAYER_LIMITS.hitsMax) {
        continue;
      }
      seen.add(path);
      const places = taggedPlaces(path);
      const index = places.findIndex((place) => place.el === holder || place.el.contains(holder));
      hits.push({ path, anchor: holder, nodes: [holder], order: undefined, occurrence: Math.max(0, index) });
    }
    element = taggedAncestor(holder);
  }
  return hits;
}

function inside(inner: Hit, outer: Hit): boolean {
  if (inner.anchor === outer.anchor) {
    if (inner.order !== undefined && outer.order !== undefined) {
      return inner.order > outer.order;
    }
    return inner.path !== outer.path;
  }
  return outer.anchor.contains(inner.anchor);
}

function deepest(hits: readonly Hit[]): Hit | undefined {
  let best: Hit | undefined = undefined;
  for (const hit of hits) {
    if (best === undefined) {
      best = hit;
    } else if (segmentsOf(hit.path) > segmentsOf(best.path)) {
      best = hit;
    } else if (segmentsOf(hit.path) === segmentsOf(best.path) && inside(hit, best) && !inside(best, hit)) {
      best = hit;
    }
  }
  return best;
}

function outermost(hits: readonly Hit[]): string | undefined {
  const outer = hits.find((hit) => !hits.some((other) => other !== hit && inside(hit, other) && !inside(other, hit)));
  return outer === undefined ? undefined : namespaceOf(outer.path);
}

function copyWithin(hit: Hit, outer: Hit | undefined): number {
  if (outer === undefined) {
    return hit.occurrence;
  }
  const copies = copiesOf(hit.path);
  let copy = 0;
  for (let index = 0; index < hit.occurrence && index < copies.length; index += 1) {
    const candidate = copies[index];
    if (candidate !== undefined && copyIn(candidate, outer.nodes)) {
      copy += 1;
    }
  }
  assert(copy <= hit.occurrence, 'copyWithin: a copy inside a layer counts no more than on the page');
  return copy;
}

function copiesOf(path: string): readonly (readonly Node[])[] {
  const runs = runsOf(path);
  if (runs !== undefined && runs.length > 0) {
    return runs;
  }
  return taggedPlaces(path).map((place) => [place.el]);
}

function copyIn(copy: readonly Node[], outerNodes: readonly Node[]): boolean {
  const first = copy.find(isElement);
  if (first === undefined) {
    return false;
  }
  return outerNodes.some((node) => node === first || node.contains(first));
}

function namespaceOf(path: string): string {
  const bar = path.lastIndexOf('|');
  return bar === -1 ? '' : path.slice(0, bar + 1);
}

function segmentsOf(path: string): number {
  return path.slice(path.lastIndexOf('|') + 1).split('.').length;
}
