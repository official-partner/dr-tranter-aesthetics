
import { assert } from '../../shared/core/assert';
import { canvasMoveNodePath, renumberedCanvasPath, type CanvasMove } from '../../shared/page/canvasMove';
import { parseStampData, stampData } from '../../shared/page/previewToken';
import { PRELOAD_LIMITS, isComment, isElement, isText } from './frameBasics';

export const FRAME_MOVE_LIMITS = {
  pendingMax: 16,
  stampedMax: 50_000,
  stampsMax: 20_000,
  runMax: 256,
  holdMs: 20_000,
} as const satisfies Record<string, number>;

const PATH_ATTRIBUTE = 'data-avb-p';
const STAMP_ATTRIBUTE = 'data-avb-d';
const STAMP_PREFIX = 'avb-d:';
const MARKER = /^avb-([se]):(.*)$/;

export interface Undo {
  readonly nodes: readonly ChildNode[];
  readonly parent: ParentNode;
  readonly next: ChildNode | undefined;
  readonly attributes: readonly { readonly element: Element; readonly value: string }[];
  readonly comments: readonly { readonly comment: Comment; readonly data: string }[];
}

interface Shown {
  readonly move: CanvasMove;
  readonly undo: Undo;
  readonly base: string | undefined;
}

let shown: Shown[] = [];
let shownFrom: string | undefined;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let announcing = false;

export function showCanvasMove(move: CanvasMove, base?: string): boolean {
  assert(move.count >= 1, 'showCanvasMove: a move moves at least its node');
  assert(move.from.length > 0, 'showCanvasMove: a moved node has a path');
  if (shown.length >= FRAME_MOVE_LIMITS.pendingMax) {
    return false;
  }
  const stamps = shown.length === 0 ? sourceStamps(document) : shownFrom;
  const undo = applyMove(move);
  if (undo === undefined) {
    return false;
  }
  shown = [...shown, { move, undo, base }];
  shownFrom = stamps;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(revertCanvasMoves, FRAME_MOVE_LIMITS.holdMs);
  announceMoved();
  assert(shown.length <= FRAME_MOVE_LIMITS.pendingMax, 'showCanvasMove: pending moves stay inside their bound');
  return true;
}

export function revertCanvasMoves(): void {
  const had = shown.length > 0;
  takeBack();
  forget();
  if (had) {
    announceMoved();
  }
}

export function canvasMovesPending(): boolean {
  return shown.length > 0;
}

export function listenForCanvasMoves(): void {
  let replay: readonly Pick<Shown, 'move' | 'base'>[] = [];
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
    takeBack();
    if (replay.length === 0) {
      forget();
    } else if (from > 0) {
      shownFrom = incoming;
    }
  });
  document.addEventListener('avb:after-patch', () => {
    const moves = replay;
    replay = [];
    if (moves.length === 0) {
      return;
    }
    const kept: Shown[] = [];
    for (const { move, base } of moves) {
      const undo = applyMove(move);
      if (undo !== undefined) {
        kept.push({ move, undo, base });
      }
    }
    shown = kept;
    if (kept.length === 0) {
      forget();
    }
  });
}

export function announcingCanvasMove(): boolean {
  return announcing;
}


function forget(): void {
  clearTimeout(holdTimer);
  holdTimer = undefined;
  shown = [];
  shownFrom = undefined;
}

function takeBack(): void {
  for (let index = shown.length - 1; index >= 0; index--) {
    const entry = shown[index];
    assert(entry !== undefined, 'takeBack: the index lies inside the shown moves');
    undoMove(entry.undo);
  }
  shown = [];
}

function announceMoved(): void {
  announcing = true;
  try {
    document.dispatchEvent(new CustomEvent('avb:morphed', { detail: undefined }));
  } finally {
    announcing = false;
  }
}

function applyMove(move: CanvasMove): Undo | undefined {
  const nodeToken = move.scope + canvasMoveNodePath(move).join('.');
  const anchorToken = move.scope + move.anchor.path.join('.');
  const moved = runOf(nodeToken);
  const anchor = runOf(anchorToken);
  if (moved === undefined || anchor === undefined) {
    return undefined;
  }
  const first = moved[0];
  const last = moved.at(-1);
  const anchorFirst = anchor[0];
  const anchorLast = anchor.at(-1);
  if (first === undefined || last === undefined || anchorFirst === undefined || anchorLast === undefined) {
    return undefined;
  }
  const parent = first.parentNode;
  const anchorParent = anchorFirst.parentNode;
  if (parent === null || anchorParent === null) {
    return undefined;
  }
  if (moved.some((node) => node === anchorFirst || node.contains(anchorFirst)) || anchor.some((node) => node.contains(first))) {
    return undefined;
  }
  const next = last.nextSibling ?? undefined;
  const reference = move.anchor.placement === 'before' ? anchorFirst : anchorLast.nextSibling;
  for (const node of moved) {
    anchorParent.insertBefore(node, reference);
  }
  assert(first.parentNode === anchorParent, 'applyMove: the moved run sits beside its anchor');
  const renumbered = renumber(move);
  return { nodes: moved, parent, next, ...renumbered };
}

export function putBackPaths(undo: Pick<Undo, 'attributes' | 'comments'>): void {
  for (const { element, value } of undo.attributes) {
    element.setAttribute(PATH_ATTRIBUTE, value);
  }
  for (const { comment, data } of undo.comments) {
    comment.data = data;
  }
}

function undoMove(undo: Undo): void {
  const next = undo.next !== undefined && undo.next.parentNode === undo.parent ? undo.next : undefined;
  for (const node of undo.nodes) {
    if (next === undefined) {
      undo.parent.appendChild(node);
    } else {
      undo.parent.insertBefore(node, next);
    }
  }
  putBackPaths(undo);
  assert(
    undo.nodes.every((node) => node.parentNode === undo.parent),
    'undoMove: the run is back where it was',
  );
}

export function runOf(token: string): ChildNode[] | undefined {
  return markedRun(token) ?? taggedRun(token);
}

function markedRun(token: string): ChildNode[] | undefined {
  const starts = commentsWhere((data) => data === `avb-s:${token}`);
  if (starts.length !== 1) {
    return undefined;
  }
  const start = starts[0];
  assert(start !== undefined, 'markedRun: the one start marker is present');
  const run: ChildNode[] = [start];
  for (let node = start.nextSibling; node !== null; node = node.nextSibling) {
    run.push(node);
    if (isComment(node) && node.data === `avb-e:${token}`) {
      return run.some(isElement) ? run : undefined;
    }
    if (run.length > FRAME_MOVE_LIMITS.runMax) {
      return undefined;
    }
  }
  return undefined;
}

function taggedRun(token: string): ChildNode[] | undefined {
  if (!/^[^"\\]*$/.test(token)) {
    return undefined;
  }
  const tagged = document.querySelectorAll(`[${PATH_ATTRIBUTE}~="${token}"]`);
  const outermost: Element[] = [];
  for (let index = 0; index < tagged.length && outermost.length <= FRAME_MOVE_LIMITS.runMax; index++) {
    const element = tagged.item(index);
    if (element !== null && !hasTaggedAncestor(element, token)) {
      outermost.push(element);
    }
  }
  const first = outermost[0];
  if (first === undefined || outermost.length > FRAME_MOVE_LIMITS.runMax) {
    return undefined;
  }
  const run: ChildNode[] = [];
  let remaining = outermost.length;
  for (let node: ChildNode | undefined = first; node !== undefined && remaining > 0; node = node.nextSibling ?? undefined) {
    if (isElement(node) && outermost.includes(node)) {
      remaining -= 1;
    } else if (!(isComment(node) || (isText(node) && node.data.trim() === ''))) {
      return undefined;
    }
    run.push(node);
    if (run.length > FRAME_MOVE_LIMITS.runMax) {
      return undefined;
    }
  }
  return remaining === 0 ? run : undefined;
}

function hasTaggedAncestor(element: Element, token: string): boolean {
  let depth = 0;
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    depth += 1;
    assert(depth <= PRELOAD_LIMITS.domDepthMax, 'hasTaggedAncestor: the page nests inside the walk bound');
    if ((parent.getAttribute(PATH_ATTRIBUTE) ?? '').split(' ').includes(token)) {
      return true;
    }
  }
  return false;
}

function renumber(move: CanvasMove): Pick<Undo, 'attributes' | 'comments'> {
  return renumberPaths((token) => renumberedCanvasPath(token, move));
}

export function renumberPaths(rename: (token: string) => string): Pick<Undo, 'attributes' | 'comments'> {
  const attributes: { readonly element: Element; readonly value: string }[] = [];
  const tagged = document.querySelectorAll(`[${PATH_ATTRIBUTE}]`);
  const count = Math.min(tagged.length, FRAME_MOVE_LIMITS.stampedMax);
  for (let index = 0; index < count; index++) {
    const element = tagged.item(index);
    const value = element?.getAttribute(PATH_ATTRIBUTE);
    if (element === null || value === null || value === undefined) {
      continue;
    }
    const next = value
      .split(' ')
      .map((token) => (token === '' ? token : rename(token)))
      .join(' ');
    if (next !== value) {
      attributes.push({ element, value });
      element.setAttribute(PATH_ATTRIBUTE, next);
    }
  }
  const comments: { readonly comment: Comment; readonly data: string }[] = [];
  for (const comment of commentsWhere((data) => MARKER.test(data))) {
    const match = MARKER.exec(comment.data);
    const side = match?.[1];
    const path = match?.[2];
    if (side === undefined || path === undefined) {
      continue;
    }
    const data = `avb-${side}:${rename(path)}`;
    if (data !== comment.data) {
      comments.push({ comment, data: comment.data });
      comment.data = data;
    }
  }
  return { attributes, comments };
}

function commentsWhere(accept: (data: string) => boolean): Comment[] {
  const found: Comment[] = [];
  const walker = document.createTreeWalker(document, 128);
  for (let visited = 0; visited < FRAME_MOVE_LIMITS.stampedMax; visited++) {
    const node = walker.nextNode();
    if (node === null) {
      break;
    }
    if (isComment(node) && accept(node.data)) {
      found.push(node);
    }
  }
  return found;
}

export function pendingKeptFrom(bases: readonly (string | undefined)[], incoming: string | undefined, shownFrom: string | undefined): number {
  assert(bases.length <= FRAME_MOVE_LIMITS.stampedMax, 'pendingKeptFrom: pending changes stay inside their bound');
  if (incoming === undefined) {
    return bases.length;
  }
  if (shownFrom !== undefined && shownFrom !== '' && incoming === shownFrom) {
    return 0;
  }
  const stamps = new Set(incoming.split('\n'));
  const index = bases.findIndex((base) => base !== undefined && stamps.has(base));
  assert(index < bases.length, 'pendingKeptFrom: a found change lies inside the list');
  return index < 0 ? bases.length : index;
}

export function parsePendingBase(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 2_000) {
    return undefined;
  }
  const stamp = parseStampData(input);
  return stamp === undefined ? undefined : stampData(stamp);
}

export function sourceStamps(root: Document): string | undefined {
  const stamps = new Set<string>();
  const tagged = root.querySelectorAll(`[${STAMP_ATTRIBUTE}]`);
  if (tagged.length > FRAME_MOVE_LIMITS.stampsMax) {
    return undefined;
  }
  for (let index = 0; index < tagged.length; index++) {
    for (const token of (tagged.item(index)?.getAttribute(STAMP_ATTRIBUTE) ?? '').split('\n')) {
      if (token !== '') {
        stamps.add(token);
      }
    }
  }
  const walker = root.createTreeWalker(root, 128);
  for (let visited = 0; visited <= FRAME_MOVE_LIMITS.stampsMax; visited++) {
    const node = walker.nextNode();
    if (node === null) {
      return [...stamps].sort().join('\n');
    }
    if (isComment(node) && node.data.startsWith(STAMP_PREFIX)) {
      stamps.add(node.data);
    }
  }
  return undefined;
}
