import { CANVAS_TEXT_LIMIT, type CanvasTextCatalog, type CanvasTextTarget } from '../../shared/properties/canvasText';
import { assert } from '../../shared/core/assert';
import { elementsWithPath, pathsOf, runsOf } from './frameRegions';
import { textEditorRoot } from './frameTextSelection';

export interface TextMatch {
  readonly nodes: readonly Text[];
  readonly element: Element;
}
export function elementsAt(x: number, y: number, first?: Element): Element[] {
  const found: Element[] = first === undefined ? [] : [first];
  const stack: readonly (Element | undefined)[] =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(x, y)
      : typeof document.elementFromPoint === 'function'
        ? [document.elementFromPoint(x, y) ?? undefined]
        : [];
  for (const element of stack) {
    if (element !== undefined && !found.includes(element) && found.length < 24) {
      found.push(element);
    }
  }
  return found;
}

export function matchCanvasText(target: CanvasTextTarget, clicked: Element): TextMatch | undefined {
  const parents = elementsWithPath(target.parent).filter((parent) => parent.contains(clicked));
  const parent = parents.find((outer) => parents.every((inner) => inner === outer || !outer.contains(inner)));
  if (!parent || (target.kind === 'element' && parent.localName !== target.tag)) {
    return undefined;
  }
  let ancestor: Element | undefined = clicked;
  for (let depth = 0; ancestor && ancestor !== parent && depth < 32; depth++) {
    if (pathsOf(ancestor).some((path) => target.siblings.includes(path))) {
      return undefined;
    }
    ancestor = ancestor.parentElement ?? undefined;
  }
  if (target.segment !== undefined) {
    return segmentMatch(parent, target, target.segment);
  }
  const mapped = (runsOf(target.path) ?? []).filter((run) => run.length > 0 && run.every((node) => node.isConnected && parent.contains(node)));
  const exact = mapped.filter((run) => run.every((node) => node instanceof Text));
  if (exact.length === 1) {
    const nodes = exact[0]?.filter((node): node is Text => node instanceof Text) ?? [];
    if (sameText(nodes, target.value)) {
      return { nodes, element: parent };
    }
  }
  if (target.siblings.some((path) => elementsWithPath(path).filter((element) => parent.contains(element)).length !== 1)) {
    return undefined;
  }
  let scope: Element | undefined = clicked;
  for (let depth = 0; scope && depth < 32; depth++) {
    const matches = textGroups(scope, target).filter((nodes) => sameText(nodes, target.value));
    if (matches.length === 1 && matches[0]) {
      return { nodes: matches[0], element: scope };
    }
    if (scope === parent || matches.length > 1) {
      return undefined;
    }
    if (textBoundaryOf(scope, target) === 'component') {
      return undefined;
    }
    scope = scope.parentElement ?? undefined;
  }
  return undefined;
}

function segmentMatch(parent: Element, target: CanvasTextTarget, segment: number): TextMatch | undefined {
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  for (let index = 0; node && index < segment && index < 1_000; index++) {
    node = walker.nextNode();
  }
  if (!(node instanceof Text) || !sameText([node], target.value)) {
    return undefined;
  }
  return { nodes: [node], element: parent };
}

type TextBoundary = 'authored' | 'component' | 'transparent';

function textGroups(parent: Element, target: CanvasTextTarget): Text[][] {
  const groups: Text[][] = [[]];
  const queue: (Node | 'break')[] = Array.from(parent.childNodes).reverse();
  let count = 0;
  while (queue.length > 0 && count++ < 1_000) {
    const node = queue.pop();
    if (node === 'break') {
      groups.push([]);
    } else if (node instanceof Text) {
      groups[groups.length - 1]?.push(node);
    } else if (node instanceof Element) {
      const boundary = textBoundaryOf(node, target);
      switch (boundary) {
        case 'authored':
          groups.push([]);
          break;
        case 'component':
          groups.push([]);
          queue.push('break', ...Array.from(node.childNodes).reverse());
          break;
        case 'transparent':
          queue.push(...Array.from(node.childNodes).reverse());
          break;
        default: {
          const exhaustive: never = boundary;
          return exhaustive;
        }
      }
    }
  }
  assert(count <= 1_001, 'The text run walk stays within its node bound');
  return queue.length ? [] : groups.filter((nodes) => nodes.length > 0);
}

function textBoundaryOf(element: Element, target: CanvasTextTarget): TextBoundary {
  const paths = pathsOf(element);
  const namespace = target.parent.slice(0, target.parent.lastIndexOf('|') + 1);
  const authored = paths.some((path) => {
    if (path === target.parent || path === target.path) {
      return false;
    }
    if (target.kind === 'element' || target.siblings.includes(path)) {
      return true;
    }
    return path.slice(0, path.lastIndexOf('|') + 1) === namespace;
  });
  if (authored) {
    return 'authored';
  }
  if (target.kind === 'element') {
    return ['SPAN', 'DIV'].includes(element.tagName) ? 'transparent' : 'authored';
  }
  if (['SCRIPT', 'STYLE', 'TEXTAREA', 'SELECT', 'SVG'].includes(element.tagName)) {
    return 'authored';
  }
  if (paths.includes(target.parent) || paths.includes(target.path)) {
    return 'transparent';
  }
  return paths.length > 0 ? 'component' : 'transparent';
}

function sameText(nodes: readonly Text[], expected: string): boolean {
  const actual = nodes.map((node) => node.data).join('');
  const normalize = (value: string) => value.replace(/[\t\r\n ]+/g, ' ').trim();
  return normalize(actual) === normalize(expected);
}

export function canvasTextRect(match: TextMatch): DOMRect | undefined {
  const first = match.nodes[0];
  const last = match.nodes.at(-1);
  if (!first || !last) {
    return undefined;
  }
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  return range.getBoundingClientRect();
}

export interface TextRun {
  readonly target: CanvasTextTarget;
  readonly match: TextMatch;
}

const RUN_NODES_MAX = 1_000;
const ANCESTORS_MAX = 32;

export function textRunsAround(catalog: CanvasTextCatalog, opened: TextRun): readonly TextRun[] {
  const root = textEditorRoot(opened.match);
  if (!root || opened.target.literal !== true) {
    return [opened];
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const claimed = new Set<Node>();
  let runs: TextRun[] = [];
  let found = false;
  let node = walker.nextNode();
  for (let count = 0; node; count++) {
    if (count >= RUN_NODES_MAX) {
      return [opened];
    }
    if (!claimed.has(node)) {
      const run = node instanceof Text && opened.match.nodes.includes(node) ? opened : neighbourRun(catalog, opened, node);
      if (run) {
        found ||= run === opened;
        runs.push(run);
        run.match.nodes.forEach((text) => claimed.add(text));
      } else if (node.textContent?.trim()) {
        if (found) {
          break;
        }
        runs = [];
      }
    }
    node = walker.nextNode();
  }
  assert(runs.includes(opened), 'The opened run is among its neighbours');
  return runs.flatMap((run) => run.match.nodes).reduce((total, text) => total + text.length, 0) <= CANVAS_TEXT_LIMIT ? runs : [opened];
}

function neighbourRun(catalog: CanvasTextCatalog, opened: TextRun, node: Node): TextRun | undefined {
  const element = node.parentElement;
  if (!element || !(node instanceof Text)) {
    return undefined;
  }
  const around = pathsAround(element);
  for (const target of catalog.targets) {
    if (target.literal === true && target.key !== opened.target.key && target.parent === opened.target.parent) {
      if (target.scope === undefined || around.has(target.scope)) {
        const match = matchCanvasText(target, element);
        if (match?.nodes.includes(node)) {
          return { target, match };
        }
      }
    }
  }
  return undefined;
}

function pathsAround(element: Element): ReadonlySet<string> {
  const paths = new Set<string>();
  let current: Element | undefined = element;
  for (let depth = 0; current && depth < ANCESTORS_MAX; depth++) {
    pathsOf(current).forEach((path) => paths.add(path));
    current = current.parentElement ?? undefined;
  }
  return paths;
}
