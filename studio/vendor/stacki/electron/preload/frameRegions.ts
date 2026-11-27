
import { assert } from '../../shared/core/assert';
import type { Box, Rect, TaggedPlace } from './frameBasics';
import { PRELOAD_LIMITS, isChildNode, isComment, isElement, isText } from './frameBasics';
import { isIterationData, recordIterationMarks } from './frameIterations';
import { parentPath } from './framePaths';
import { PREVIEW_STAMP_PREFIX, parseStampData, type FrameRenderProblem } from '../../shared/page/previewToken';

export const regions = new Map<string, Node[][]>();
export let trackedPaths: string[] = [];
export let activeScope = '';
export const inScope = (nodePath: string) => (activeScope ? nodePath.startsWith(activeScope) : !nodePath.includes('|'));

export let focusPath = '';
export let focusOcc = 0;
const isLive = (run: Node[]) => {
  const content = run.filter((node) => isElement(node) || (isText(node) && node.textContent.trim() !== ''));
  if (content.length > 0) {
    return content.some((node) => node.isConnected);
  }
  return run.some((node) => node.isConnected);
};
let focusCache: { readonly roots: Node[] | undefined } | undefined;

export function resetFocusCache(): void {
  focusCache = undefined;
}

export function setTracking(next: { readonly paths: string[]; readonly scope: string; readonly focus: string; readonly occurrence: number }): void {
  trackedPaths = next.paths;
  activeScope = next.scope;
  focusPath = next.focus;
  focusOcc = next.occurrence;
}
export const focusRoots = (): Node[] | undefined => {
  if (focusCache !== undefined) {
    return focusCache.roots;
  }
  focusCache = { roots: undefined };
  if (focusPath) {
    const runs = (regions.get(focusPath) || []).filter(isLive);
    if (runs.length) {
      focusCache = { roots: runs[focusOcc] || runs[0] };
    } else {
      const places = taggedPlaces(focusPath);
      const one = places[focusOcc] || places[0];
      if (one) {
        focusCache = { roots: [one.el] };
      }
    }
  }
  return focusCache.roots;
};
export const inFocus = (node: Node): boolean => {
  const roots = focusRoots();
  if (!roots) {
    return true;
  }
  return roots.some((root) => root === node || (root.nodeType === 1 && root.contains(node)));
};
export const runsOf = (nodePath: string): Node[][] | undefined => {
  const runs = regions.get(nodePath);
  if (!runs) {
    return runs;
  }
  const live = runs.filter(isLive);
  return focusRoots() ? live.filter((run) => run.some(inFocus)) : live;
};
export let mapped = false;
export const announceMapped = () => {
  mapped = true;
  try {
    window.parent.postMessage({ type: 'avb:canvas-ready' }, '*');
  } catch {
  }
  announceRender();
};

const STAMP_PREFIX = PREVIEW_STAMP_PREFIX;
export const STAMP_ATTRIBUTE = 'data-avb-d';
export let renderToken: string | undefined = undefined;
let renderStamps: { readonly file: string; readonly checksum: string }[] | undefined;
let renderSeq = 0;
export function canvasTextSourceMatches(file: string, checksum: string): boolean {
  return renderStamps?.some((stamp) => stamp.file === file && stamp.checksum === checksum) ?? false;
}

type ManifestReading =
  | { readonly kind: 'manifest'; readonly stamps: readonly { readonly file: string; readonly checksum: string }[] }
  | { readonly kind: 'problem'; readonly problem: FrameRenderProblem };

const MANIFEST_SLICE_MS = 8;
const MANIFEST_SLICE_CHECK_ELEMENTS = 512;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const readManifest = async (seq: number): Promise<ManifestReading | undefined> => {
  const byFile = new Map<string, string>();
  const record = (data: string): FrameRenderProblem | undefined => {
    const stamp = parseStampData(data);
    if (stamp === undefined) {
      return undefined;
    }
    const seen = byFile.get(stamp.file);
    if (seen !== undefined && seen !== stamp.checksum) {
      return 'conflicting-stamps';
    }
    byFile.set(stamp.file, stamp.checksum);
    return undefined;
  };
  const stack: Node[] = [document];
  let sliceStartedMs = performance.now();
  for (let visited = 1; stack.length > 0; visited++) {
    if (visited % MANIFEST_SLICE_CHECK_ELEMENTS === 0) {
      if (MANIFEST_SLICE_MS < performance.now() - sliceStartedMs) {
        await yieldToEventLoop();
        if (seq !== renderSeq) {
          return undefined;
        }
        sliceStartedMs = performance.now();
      }
    }
    const parent = stack.pop();
    if (!parent) {
      break;
    }
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (isElement(node)) {
        const carried = node.getAttribute(STAMP_ATTRIBUTE);
        if (carried !== null) {
          for (const token of carried.split('\n')) {
            if (token.length === 0) {
              continue;
            }
            const problem = record(token);
            if (problem !== undefined) {
              return { kind: 'problem', problem };
            }
          }
        }
        stack.push(node);
        continue;
      }
      if (!isComment(node) || !node.data.startsWith(STAMP_PREFIX)) {
        continue;
      }
      const problem = record(node.data);
      if (problem !== undefined) {
        return { kind: 'problem', problem };
      }
    }
  }
  const files = [...byFile.keys()].sort((left, right) => (left < right ? -1 : left === right ? 0 : 1));
  return { kind: 'manifest', stamps: files.map((file) => ({ file, checksum: byFile.get(file) ?? '' })) };
};

let renderListener: (() => void) | undefined;
export function setRenderListener(listener: () => void): void {
  renderListener = listener;
}

let renderProblem: FrameRenderProblem | undefined;
const reportRenderProblem = (problem: FrameRenderProblem): void => {
  renderProblem = problem;
  try {
    window.parent.postMessage({ type: 'avb:render-problem', problem }, '*');
  } catch {
  }
};

const announceRender = (): void => {
  renderSeq += 1;
  const seq = renderSeq;
  renderToken = undefined;
  renderStamps = undefined;
  renderProblem = undefined;
  void finishRender(seq);
};

const finishRender = async (seq: number): Promise<void> => {
  const reading = await readManifest(seq);
  if (reading === undefined || seq !== renderSeq) {
    return;
  }
  if (reading.kind === 'problem') {
    reportRenderProblem(reading.problem);
    return;
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    reportRenderProblem('no-digest');
    return;
  }
  const stamps = [...reading.stamps];
  const canonical = stamps.map((stamp) => `${stamp.checksum} ${stamp.file}\n`).join('');
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  } catch {
    if (seq === renderSeq) {
      reportRenderProblem('no-digest');
    }
    return;
  }
  if (seq !== renderSeq) {
    return;
  }
  const bytes = Array.from(new Uint8Array(digest));
  renderToken = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  renderStamps = stamps;
  reportRender();
  renderListener?.();
};

export function reportRender(): void {
  if (renderToken === undefined || renderStamps === undefined) {
    if (renderProblem !== undefined) {
      reportRenderProblem(renderProblem);
    }
    return;
  }
  try {
    window.parent.postMessage({ type: 'avb:render', token: renderToken, stamps: renderStamps }, '*');
  } catch {
  }
}

export const PATH_ATTR = 'data-avb-p';

export const pathsOf = (element: Element): string[] => (element.getAttribute(PATH_ATTR) || '').split(' ').filter(Boolean);
const ourTags = new WeakMap<Element, Set<string>>();
const nsOf = (element: Element): Map<string, string> => {
  const out = new Map<string, string>();
  for (const nodePath of pathsOf(element)) {
    const bar = nodePath.indexOf('|');
    if (bar === -1) {
      continue;
    }
    const file = nodePath.slice(0, bar + 1);
    const inner = nodePath.slice(bar + 1);
    const had = out.get(file);
    if (had === undefined || inner.length < had.length) {
      out.set(file, inner);
    }
  }
  return out;
};

const writtenPaths = (element: Element): string[] => {
  const mine = ourTags.get(element);
  return pathsOf(element).filter((nodePath) => !mine?.has(nodePath));
};

const nsParent = (element: Element, file: string, inner: string): Element | undefined => {
  const own = writtenPaths(element).filter((nodePath) => nodePath.startsWith(file));
  let up = taggedAncestor(element);
  while (up) {
    const carried = pathsOf(up);
    if (own.some((nodePath) => carried.includes(nodePath))) {
      return undefined;
    }
    const theirs = nsOf(up).get(file);
    if (theirs !== undefined && inner.startsWith(`${theirs}.`)) {
      return up;
    }
    up = taggedAncestor(up);
  }
  return undefined;
};
export const taggedAncestor = (element: Element): Element | undefined => element.parentElement?.closest(`[${PATH_ATTR}]`) ?? undefined;

const rodeIn = (element: Element, path: string): boolean => {
  const mine = ourTags.get(element);
  const written = pathsOf(element).filter((nodePath) => !mine?.has(nodePath));
  const at = written.indexOf(path);
  return at > 0 && written.slice(0, at).some((nodePath) => nodePath.includes('|'));
};

const promoteInstanceTags = () => {
  for (const element of Array.from(document.querySelectorAll(`[${PATH_ATTR}]`))) {
    const page = pathsOf(element).filter((nodePath) => !nodePath.includes('|') && rodeIn(element, nodePath));
    if (!page.length) {
      continue;
    }
    const ns = nsOf(element);
    if (!ns.size) {
      continue;
    }
    let file: string | undefined = undefined;
    for (const [candidateFile, inner] of ns) {
      if (!nsParent(element, candidateFile, inner)) {
        file = undefined;
        break;
      }
      if (!file) {
        file = candidateFile;
      }
    }
    if (!file) {
      continue;
    }
    let at = element;
    let innerOf = nsOf(at).get(file);
    let up = innerOf === undefined ? undefined : nsParent(at, file, innerOf);
    while (up) {
      at = up;
      innerOf = nsOf(at).get(file);
      up = innerOf === undefined ? undefined : nsParent(at, file, innerOf);
    }
    if (at === element) {
      continue;
    }
    if (writtenPaths(at).some((nodePath) => !nodePath.includes('|'))) {
      continue;
    }
    for (const nodePath of page) {
      addPath(at, nodePath);
    }
  }
};

const addPath = (element: Element, nodePath: string): void => {
  const list = pathsOf(element);
  if (list.includes(nodePath)) {
    return;
  }
  list.push(nodePath);
  element.setAttribute(PATH_ATTR, list.join(' '));
  let mine = ourTags.get(element);
  if (!mine) {
    ourTags.set(element, (mine = new Set()));
  }
  mine.add(nodePath);
};
export const elementsWithPath = (nodePath: string): Element[] => {
  const all: Element[] = Array.from(elementsTaggedForPath(nodePath)).filter((element) => pathsOf(element).includes(nodePath) && inFocus(element));
  return outermostElements(all);
};

function outermostElements(all: readonly Element[]): Element[] {
  const outermost: Element[] = [];
  let container: Element | undefined;
  for (const element of all) {
    if (container !== undefined && container.contains(element)) {
      continue;
    }
    outermost.push(element);
    container = element;
  }
  assert(outermost.length <= all.length, 'The outermost elements are a subset');
  return outermost;
}

export const allElementsWithPath = (nodePath: string): Element[] => {
  const all: Element[] = [];
  const tagged = elementsTaggedForPath(nodePath);
  for (let index = 0; index < tagged.length; index += 1) {
    const element = tagged.item(index);
    if (!element) {
      continue;
    }
    if (!pathsOf(element).includes(nodePath)) {
      continue;
    }
    all.push(element);
  }
  return outermostElements(all);
};

function elementsTaggedForPath(nodePath: string): NodeListOf<Element> {
  const selector = /[^A-Za-z0-9_./:|@-]/.test(nodePath) ? `[${PATH_ATTR}]` : `[${PATH_ATTR}~="${nodePath}"]`;
  return document.querySelectorAll(selector);
}

const markerPath = (node: Node, kind: 's' | 'e'): string | undefined => {
  if (isComment(node)) {
    const tag = `avb-${kind}:`;
    return node.data.startsWith(tag) ? node.data.slice(tag.length) : undefined;
  }
  if (isElement(node) && node.tagName === 'TEMPLATE') {
    return node.getAttribute(`data-avb-${kind}`) ?? undefined;
  }
  return undefined;
};

const runOrders = new WeakMap<readonly Node[], number>();
let runOrderNext = 0;

export const runOrder = (run: readonly Node[]): number | undefined => runOrders.get(run);

export const collectRegions = () => {
  forgetHollowRegions();
  pruneRegions();
  const { starts, markers, iterations } = findMarkers();
  const collected = new Map<string, Set<Node>>();
  const fresh = new Map<string, Node[][]>();
  for (const start of starts) {
    const nodePath = markerPath(start, 's');
    if (nodePath === undefined) {
      continue;
    }
    const run = runAfter(start, nodePath);
    runOrders.set(run, runOrderNext);
    runOrderNext += 1;
    assert(Number.isSafeInteger(runOrderNext), 'collectRegions: run order stays a safe integer');
    let set = collected.get(nodePath);
    if (!set) {
      set = new Set();
      collected.set(nodePath, set);
    }
    for (const node of run) {
      set.add(node);
    }
    recordRun(fresh, nodePath, run);
  }
  replaceRuns(fresh, collected);
  untagStale(collected);
  recordIterationMarks(iterations);
  for (const node of [...markers, ...iterations]) {
    if (isChildNode(node)) {
      node.remove();
    }
  }
  promoteInstanceTags();
  collectHollowRegions();
  focusCache = undefined;
};

const hollowPaths = new Set<string>();

const forgetHollowRegions = () => {
  for (const nodePath of hollowPaths) {
    regions.delete(nodePath);
  }
  hollowPaths.clear();
};

const collectHollowRegions = () => {
  const elements = Array.from(document.querySelectorAll(`[${PATH_ATTR}]`));
  const carried = new Set<string>();
  for (const element of elements) {
    for (const nodePath of pathsOf(element)) {
      carried.add(nodePath);
    }
  }
  const found = new Map<string, Map<string, Node[]>>();
  const holders = new Map<Node, number>();
  const callers = new Map<Node, ReadonlySet<string>>();
  for (const element of elements) {
    const holder = element.parentNode;
    if (holder === null) {
      continue;
    }
    for (const nodePath of pathsOf(element)) {
      let child = nodePath;
      for (let level = 0; level < PRELOAD_LIMITS.domDepthMax; level++) {
        const parent = parentPath(child);
        if (parent === undefined || carried.has(parent) || regions.has(parent)) {
          break;
        }
        assert(parent.length < child.length, 'collectHollowRegions: a parent path is shorter than its child');
        const copies = found.get(parent) ?? new Map<string, Node[]>();
        found.set(parent, copies);
        const holderIndex = holders.get(holder) ?? holders.size;
        holders.set(holder, holderIndex);
        const key = hollowCopyKey(holderIndex, nodePath, pathsOf(element), callerNamespaces(holder, callers));
        const run = copies.get(key) ?? [];
        copies.set(key, run);
        if (run.at(-1) !== element) {
          run.push(element);
        }
        child = parent;
      }
    }
  }
  for (const [nodePath, copies] of found) {
    const runs = Array.from(copies.values(), hollowRunSpan);
    assert(runs.length > 0, 'collectHollowRegions: a derived path has at least one run');
    regions.set(nodePath, runs);
    hollowPaths.add(nodePath);
  }
};

function hollowRunSpan(elements: readonly Node[]): Node[] {
  const first = elements[0];
  const last = elements.at(-1);
  assert(first !== undefined, 'hollowRunSpan: a derived copy has an element');
  assert(last !== undefined, 'hollowRunSpan: a derived copy has a last element');
  const span: Node[] = [];
  for (let node: Node | undefined = first; node !== undefined; node = node.nextSibling ?? undefined) {
    span.push(node);
    if (node === last) {
      return span;
    }
  }
  return [...elements];
}

function callerNamespaces(holder: Node, memo: Map<Node, ReadonlySet<string>>): ReadonlySet<string> {
  const known = memo.get(holder);
  if (known !== undefined) {
    return known;
  }
  const namespaces = new Set<string>(['']);
  let up: Element | undefined = isElement(holder) ? (holder.closest(`[${PATH_ATTR}]`) ?? undefined) : undefined;
  for (let depth = 0; up !== undefined && depth < PRELOAD_LIMITS.domDepthMax; depth++) {
    for (const nodePath of pathsOf(up)) {
      namespaces.add(namespaceOf(nodePath));
    }
    up = taggedAncestor(up);
  }
  assert(namespaces.has(''), 'callerNamespaces: the page is always a caller');
  memo.set(holder, namespaces);
  return namespaces;
}

const namespaceOf = (nodePath: string): string => nodePath.slice(0, nodePath.lastIndexOf('|') + 1);

function hollowCopyKey(holderIndex: number, nodePath: string, paths: readonly string[], callers: ReadonlySet<string>): string {
  const namespace = namespaceOf(nodePath);
  assert(callers.has(''), 'hollowCopyKey: the page is a caller');
  const others = paths
    .filter((other) => namespaceOf(other) !== namespace)
    .filter((other) => callers.has(namespaceOf(other)))
    .sort();
  return `${holderIndex} ${others.join(' ')}`;
}

export { parentPath } from './framePaths';

const pruneRegions = () => {
  for (const [nodePath, runs] of regions) {
    const live = runs.filter(isLive);
    if (live.length) {
      regions.set(nodePath, live);
    } else {
      regions.delete(nodePath);
    }
  }
};

const findMarkers = (): { starts: Node[]; markers: Node[]; iterations: Comment[] } => {
  const starts: Node[] = [];
  const markers: Node[] = [];
  const iterations: Comment[] = [];
  const visit = (parent: Node, depth: number) => {
    if (depth > PRELOAD_LIMITS.domDepthMax) {
      return;
    }
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      const isStart = markerPath(node, 's') !== undefined;
      if (isStart) {
        starts.push(node);
      }
      if (isStart || markerPath(node, 'e') !== undefined) {
        markers.push(node);
      }
      if (isComment(node) && isIterationData(node.data)) {
        iterations.push(node);
      }
      if (isElement(node)) {
        visit(node, depth + 1);
      }
    }
  };
  visit(document, 0);
  return { starts, markers, iterations };
};

const runAfter = (start: Node, nodePath: string): Node[] => {
  let end: Node | undefined = undefined;
  for (let node = start.nextSibling; node; node = node.nextSibling) {
    if (markerPath(node, 'e') === nodePath) {
      end = node;
      break;
    }
  }
  const run: Node[] = [];
  for (let node = start.nextSibling; node && node !== end; node = node.nextSibling) {
    if (!end) {
      break;
    }
    run.push(node);
    if (isElement(node) && node.tagName !== 'TEMPLATE') {
      addPath(node, nodePath);
    }
  }
  return run;
};

const runOwners = new WeakMap<Node[][], Map<Node, number>>();

const recordRun = (fresh: Map<string, Node[][]>, nodePath: string, run: Node[]) => {
  const runs = fresh.get(nodePath) ?? [];
  if (!fresh.has(nodePath)) {
    fresh.set(nodePath, runs);
  }
  let owners = runOwners.get(runs);
  if (owners === undefined) {
    owners = new Map<Node, number>();
    runOwners.set(runs, owners);
  }
  let again = -1;
  for (const node of run) {
    const owner = owners.get(node);
    if (owner !== undefined && (again < 0 || owner < again)) {
      again = owner;
    }
  }
  let index = again;
  if (again >= 0) {
    for (const node of runs[again] ?? []) {
      if (owners.get(node) === again) {
        owners.delete(node);
      }
    }
    runs[again] = run;
  } else {
    index = runs.length;
    runs.push(run);
  }
  for (const node of run) {
    owners.set(node, index);
  }
  if (run.length > 0) {
    assert(runs[index] === run, 'recordRun: a collected run is recorded for its path');
  }
};

const replaceRuns = (fresh: ReadonlyMap<string, Node[][]>, collected: Map<string, Set<Node>>) => {
  const claimed = new Set<Node>();
  for (const nodes of collected.values()) {
    for (const node of nodes) {
      claimed.add(node);
    }
  }
  for (const [nodePath, runs] of regions) {
    if (fresh.has(nodePath)) {
      continue;
    }
    const kept = runs.filter((run) => !run.some((node) => claimed.has(node)));
    if (kept.length === runs.length) {
      continue;
    }
    if (kept.length > 0) {
      regions.set(nodePath, kept);
    } else {
      regions.delete(nodePath);
    }
    collected.set(nodePath, new Set(kept.flat()));
  }
  for (const [nodePath, runs] of fresh) {
    regions.set(nodePath, runs);
  }
  for (const [nodePath, runs] of fresh) {
    assert(regions.get(nodePath) === runs, 'replaceRuns: a path collected this pass holds only this pass runs');
  }
  for (const runs of regions.values()) {
    assert(runs.length > 0, 'replaceRuns: a recorded path has at least one run');
  }
};

const untagStale = (collected: Map<string, Set<Node>>) => {
  for (const element of Array.from(document.querySelectorAll(`[${PATH_ATTR}]`))) {
    const mine = ourTags.get(element);
    const kept = pathsOf(element).filter((nodePath) => !mine?.has(nodePath) || !collected.has(nodePath) || (collected.get(nodePath)?.has(element) ?? false));
    if (kept.length === pathsOf(element).length) {
      continue;
    }
    for (const nodePath of pathsOf(element)) {
      if (!kept.includes(nodePath)) {
        mine?.delete(nodePath);
      }
    }
    if (kept.length) {
      element.setAttribute(PATH_ATTR, kept.join(' '));
    } else {
      element.removeAttribute(PATH_ATTR);
    }
  }
};

export const addNode = (acc: Box | undefined, node: Node, depth = 0): Box | undefined => {
  if (!node.isConnected) {
    return acc;
  }
  if (depth > PRELOAD_LIMITS.domDepthMax) {
    return acc;
  }
  let rect: DOMRect | undefined = undefined;
  if (isElement(node)) {
    if (node.tagName === 'TEMPLATE') {
      return acc;
    }
    rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      let grown = acc;
      for (const child of Array.from(node.childNodes)) {
        grown = addNode(grown, child, depth + 1);
      }
      return grown;
    }
  } else if (isComment(node)) {
    return acc;
  } else if (isText(node) && node.textContent.trim()) {
    const range = document.createRange();
    range.selectNode(node);
    rect = range.getBoundingClientRect();
  }
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return acc;
  }
  if (!acc) {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }
  return {
    left: Math.min(acc.left, rect.left),
    top: Math.min(acc.top, rect.top),
    right: Math.max(acc.right, rect.right),
    bottom: Math.max(acc.bottom, rect.bottom),
  };
};

export const toRect = (box: Box): Rect => ({
  x: box.left,
  y: box.top,
  w: box.right - box.left,
  h: box.bottom - box.top,
});

export const taggedPlaces = (nodePath: string): TaggedPlace[] => placesOf(elementsWithPath(nodePath));

export const placesOf = (elements: readonly Element[]): TaggedPlace[] => {
  const out: TaggedPlace[] = [];
  for (const element of elements) {
    const acc = addNode(undefined, element);
    if (acc) {
      out.push({ el: element, rect: toRect(acc) });
    }
  }
  const real = out.filter((place) => place.rect.w > 0 && place.rect.h > 0);
  return real.length ? real : out;
};
