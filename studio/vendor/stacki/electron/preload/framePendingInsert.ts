
import { assert } from '../../shared/core/assert';
import { insertedNodeToken, renumberedInsertPath, renumberedWrapPath, type CanvasInsert } from '../../shared/page/canvasInsert';
import { canvasMovesPending, pendingKeptFrom, putBackPaths, renumberPaths, runOf, sourceStamps, type Undo } from './frameMove';
import { isChildNode, isComment, isElement } from './frameBasics';
import { revealWhenDrawn } from './frameReveal';

export const FRAME_INSERT_LIMITS = {
  pendingMax: 16,
  holdMs: 20_000,
  waitingMs: 600,
} as const satisfies Record<string, number>;

export const PENDING_INSERT_ATTRIBUTE = 'data-avb-pending-insert';
const PATH_ATTRIBUTE = 'data-avb-p';

interface Shown {
  readonly insert: CanvasInsert;
  readonly nodes: readonly ChildNode[];
  readonly paths: Pick<Undo, 'attributes' | 'comments'>;
  readonly release?: () => void;
  readonly base?: string | undefined;
  readonly wait: Wait;
}

let shown: Shown[] = [];
let shownFrom: string | undefined;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let waitingTimers: readonly ReturnType<typeof setTimeout>[] = [];
let stylesheet: CSSStyleSheet | undefined;

export function showCanvasInsert(insert: CanvasInsert, base?: string): boolean {
  assert(insert.anchor.placement === 'inside' || insert.anchor.path.length > 0, 'showCanvasInsert: a sibling anchor has a path');
  if (shown.length >= FRAME_INSERT_LIMITS.pendingMax || canvasMovesPending()) {
    return false;
  }
  const stamps = shown.length === 0 ? sourceStamps(document) : shownFrom;
  const entry = applyInsert(insert, 'quiet');
  if (entry === undefined) {
    return false;
  }
  installPendingStyle();
  shown = [...shown, { ...entry, base, wait: 'quiet' }];
  shownFrom = stamps;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(revertCanvasInserts, FRAME_INSERT_LIMITS.holdMs);
  const timer = setTimeout(() => markSlow(insert), FRAME_INSERT_LIMITS.waitingMs);
  waitingTimers = [...waitingTimers.slice(1 - FRAME_INSERT_LIMITS.pendingMax), timer];
  announceInserted();
  assert(shown.length <= FRAME_INSERT_LIMITS.pendingMax, 'showCanvasInsert: pending inserts stay inside their bound');
  return true;
}

export function revertCanvasInserts(): void {
  const had = shown.length > 0;
  takeBack();
  forget();
  if (had) {
    announceInserted();
  }
}

export function canvasInsertsPending(): boolean {
  return shown.length > 0;
}

export function listenForCanvasInserts(): void {
  let replay: readonly Replayed[] = [];
  let confirmed = false;
  document.addEventListener('avb:before-morph', (event) => {
    if (shown.length === 0) {
      replay = [];
      return;
    }
    const incoming = event instanceof CustomEvent && event.detail instanceof Document ? sourceStamps(event.detail) : undefined;
    const from = pendingKeptFrom(
      shown.map((entry) => entry.base),
      incoming,
      shownFrom,
    );
    replay = shown.slice(from);
    confirmed = from > 0 || replay.length === 0;
    takeBack();
    if (replay.length === 0) {
      forget();
    } else if (from > 0) {
      shownFrom = incoming;
    }
  });
  document.addEventListener('avb:after-patch', () => {
    const inserts = replay;
    replay = [];
    if (confirmed) {
      confirmed = false;
      setTimeout(revealWhenDrawn, 0);
    }
    if (inserts.length === 0) {
      return;
    }
    drawAgain(inserts);
  });
}


type Replayed = Pick<Shown, 'insert' | 'base' | 'wait'>;

function drawAgain(inserts: readonly Replayed[]): void {
  const kept: Shown[] = [];
  for (const { insert, base, wait } of inserts) {
    const entry = applyInsert(insert, wait);
    if (entry !== undefined) {
      kept.push({ ...entry, base, wait });
    }
  }
  shown = kept;
  if (kept.length === 0) {
    forget();
  }
}

function markSlow(insert: CanvasInsert): void {
  if (!shown.some((entry) => entry.insert === insert)) {
    return;
  }
  const inserts = shown.map((entry): Shown => (entry.insert === insert ? { ...entry, wait: 'marked' } : entry));
  takeBack();
  drawAgain(inserts);
  announceInserted();
  revealWhenDrawn();
}

function forget(): void {
  for (const timer of waitingTimers) {
    clearTimeout(timer);
  }
  waitingTimers = [];
  clearTimeout(holdTimer);
  holdTimer = undefined;
  shown = [];
  shownFrom = undefined;
}

function takeBack(): void {
  for (let index = shown.length - 1; index >= 0; index -= 1) {
    const entry = shown[index];
    assert(entry !== undefined, 'takeBack: the index lies inside the shown inserts');
    entry.release?.();
    for (const node of entry.nodes) {
      node.parentNode?.removeChild(node);
    }
    putBackPaths(entry.paths);
  }
  shown = [];
}

function announceInserted(): void {
  document.dispatchEvent(new CustomEvent('avb:morphed', { detail: undefined }));
}

type Wait = 'quiet' | 'marked';

type Applied = Omit<Shown, 'base' | 'wait'>;

function applyInsert(insert: CanvasInsert, wait: Wait): Applied | undefined {
  if (insert.node.kind === 'wrap') {
    return applyWrap(insert, insert.node);
  }
  const place = placeOf(insert);
  if (place === undefined) {
    return undefined;
  }
  const paths = renumberPaths((token) => renumberedInsertPath(token, insert));
  const token = insertedNodeToken(insert);
  const nodes = standInNodes(insert, token, place, wait);
  if (nodes === undefined) {
    putBackPaths(paths);
    return undefined;
  }
  for (const node of nodes) {
    if (place.reference === undefined) {
      place.parent.append(node);
    } else {
      place.reference.before(node);
    }
  }
  const made = nodes.find(isElement);
  assert(made !== undefined, 'applyInsert: a stand-in has an element');
  assert(made.parentNode === place.parent, 'applyInsert: the stand-in sits where the page will put the node');
  return { insert, nodes, paths };
}

function placeOf(insert: CanvasInsert): { readonly parent: ParentNode; readonly reference: ChildNode | undefined; readonly marked: boolean } | undefined {
  const token = insert.scope + insert.anchor.path.join('.');
  const run = runOf(token);
  const first = run?.[0];
  const last = run?.at(-1);
  if (run === undefined || first === undefined || last === undefined) {
    return undefined;
  }
  const marked = isComment(first) && first.data.startsWith('avb-s:');
  if (insert.anchor.placement === 'inside') {
    const element = run.find(isElement);
    if (element === undefined || run.filter(isElement).length !== 1) {
      return undefined;
    }
    return { parent: element, reference: undefined, marked };
  }
  const parent = first.parentNode;
  if (parent === null) {
    return undefined;
  }
  return { parent, reference: insert.anchor.placement === 'before' ? first : (last.nextSibling ?? undefined), marked };
}

function standInNodes(insert: CanvasInsert, token: string, place: { readonly marked: boolean }, wait: Wait): ChildNode[] | undefined {
  let drawn = insert.node;
  if (drawn.kind === 'clone') {
    const copy = cloneOf(renumberedInsertPath(insert.scope + drawn.from.join('.'), insert), token);
    if (drawn.twinOf === undefined) {
      return copy;
    }
    if (copy !== undefined && !hasLiveState(copy)) {
      return copy;
    }
    drawn = { kind: 'component', name: drawn.twinOf };
  }
  const made = standIn(drawn, token, wait);
  return place.marked ? [document.createComment(`avb-s:${token}`), made, document.createComment(`avb-e:${token}`)] : [made];
}

function cloneOf(sourceToken: string, token: string): ChildNode[] | undefined {
  const run = runOf(sourceToken);
  if (run === undefined) {
    return undefined;
  }
  const rename = (value: string): string =>
    value === sourceToken ? token : value.startsWith(sourceToken + '.') ? token + value.slice(sourceToken.length) : value;
  const copies = run.map((node) => node.cloneNode(true)).filter(isChildNode);
  for (const copy of copies) {
    if (isElement(copy)) {
      retag(copy, rename);
      copy.setAttribute(PENDING_INSERT_ATTRIBUTE, 'clone');
    } else if (isComment(copy)) {
      copy.data = renamedMarker(copy.data, rename);
    }
  }
  return copies.some(isElement) ? copies : undefined;
}

function hasLiveState(nodes: readonly ChildNode[]): boolean {
  const opened = '[open], [aria-expanded="true"]';
  return nodes.some((node) => isElement(node) && (node.matches(opened) || node.querySelector(opened) !== null));
}

function retag(root: Element, rename: (value: string) => string): void {
  const tagged = [root, ...Array.from(root.querySelectorAll(`[${PATH_ATTRIBUTE}]`))];
  for (const element of tagged) {
    const value = element.getAttribute(PATH_ATTRIBUTE);
    if (value !== null) {
      element.setAttribute(PATH_ATTRIBUTE, value.split(' ').map(rename).join(' '));
    }
  }
  const walker = document.createTreeWalker(root, 128);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (isComment(node)) {
      node.data = renamedMarker(node.data, rename);
    }
  }
}

function renamedMarker(data: string, rename: (value: string) => string): string {
  const match = /^avb-([se]):(.*)$/.exec(data);
  return match?.[1] !== undefined && match[2] !== undefined ? `avb-${match[1]}:${rename(match[2])}` : data;
}

function standIn(node: CanvasInsert['node'], token: string, wait: Wait): Element {
  switch (node.kind) {
    case 'element': {
      const element = document.createElement(node.tag);
      for (const [name, value] of node.attributes) {
        element.setAttribute(name, value);
      }
      if (node.text !== undefined) {
        element.textContent = node.text;
      }
      return tagged(element, token, 'element');
    }
    case 'clone':
    case 'wrap':
      throw new Error('standIn: a clone is made by cloneOf and a wrap by applyWrap');
    case 'component':
      return tagged(document.createElement(wait === 'quiet' ? 'template' : 'div'), token, 'component');
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function tagged(element: Element, token: string, kind: 'element' | 'component'): Element {
  element.setAttribute(PATH_ATTRIBUTE, token);
  element.setAttribute(PENDING_INSERT_ATTRIBUTE, kind);
  return element;
}

function installPendingStyle(): void {
  if (stylesheet !== undefined && document.adoptedStyleSheets.includes(stylesheet)) {
    return;
  }
  stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(
    `div[${PENDING_INSERT_ATTRIBUTE}="component"] { display: block; align-self: stretch; justify-self: stretch; box-sizing: border-box; ` +
      'min-width: min(100%, 160px); height: 40px; border-radius: 4px; background: rgba(127, 127, 127, 0.14); }',
  );
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];
}

function applyWrap(insert: CanvasInsert, wrap: Extract<CanvasInsert['node'], { kind: 'wrap' }>): Applied | undefined {
  const sourceToken = insert.scope + wrap.from.join('.');
  const run = runOf(sourceToken);
  const first = run?.[0];
  const parent = first?.parentNode;
  if (run === undefined || first === undefined || parent === null || parent === undefined) {
    return undefined;
  }
  const marked = isComment(first) && first.data.startsWith('avb-s:');
  const next = run.at(-1)?.nextSibling ?? undefined;
  const paths = renumberPaths((token) => renumberedWrapPath(token, insert));
  const wrapper = tagged(document.createElement(wrap.tag), sourceToken, 'element');
  const before = marked ? document.createComment(`avb-s:${sourceToken}`) : undefined;
  const after = marked ? document.createComment(`avb-e:${sourceToken}`) : undefined;
  const nodes: ChildNode[] = [...(before === undefined ? [] : [before]), wrapper, ...(after === undefined ? [] : [after])];
  first.before(...nodes);
  wrapper.append(...run);
  assert(wrapper.parentNode === parent, 'applyWrap: the wrapper stands where the wrapped node stood');
  const release = (): void => {
    for (const node of run) {
      if (next !== undefined && next.parentNode === parent) {
        next.before(node);
      } else {
        parent.append(node);
      }
    }
  };
  return { insert, nodes, paths, release };
}
