
import { renumberedDeletePath } from '../../shared/page/canvasMove';
import { PREVIEW_STAMP_PREFIX } from '../../shared/page/previewToken';
import { isComment, isElement } from './frameBasics';
import { pendingKeptFrom, putBackPaths, renumberPaths, sourceStamps, type Undo } from './frameMove';
import { allElementsWithPath, runsOf } from './frameRegions';

const PENDING_CLEAR_MS = 5000;
const GHOSTS_MAX = 4096;
const COMMENTS_MAX = 20_000;
const STAMP_PREFIX = PREVIEW_STAMP_PREFIX;
const DOCUMENT_POSITION_FOLLOWING = 4;

interface Ghost {
  readonly element: ChildNode;
  readonly parent: ParentNode;
  readonly next: ChildNode | undefined;
}

interface Deleted {
  readonly path: string;
  readonly ghosts: readonly Ghost[];
  readonly paths: Pick<Undo, 'attributes' | 'comments'>;
  readonly base: string | undefined;
}

let deleted: Deleted[] = [];
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let removedFrom: string | undefined;

export function hidePendingDelete(path: string, base?: string): void {
  const stamps = deleted.length === 0 ? sourceStamps(document) : removedFrom;
  const entry = detach(path, base);
  if (entry === undefined) {
    return;
  }
  removedFrom = stamps;
  deleted = [...deleted, entry];
  clearTimeout(clearTimer);
  clearTimer = setTimeout(clearPendingDeletes, PENDING_CLEAR_MS);
  announce();
}

export function clearPendingDeletes(): void {
  const had = deleted.length > 0;
  putBack();
  forget();
  if (had) {
    announce();
  }
}

export function pendingDeletesCount(): number {
  return deleted.length;
}

export function listenForPendingDeletes(): void {
  let replay: readonly Pick<Deleted, 'path' | 'base'>[] = [];
  document.addEventListener('avb:before-morph', (event) => {
    if (deleted.length === 0) {
      replay = [];
      return;
    }
    const incoming = event instanceof CustomEvent && event.detail instanceof Document ? sourceStamps(event.detail) : undefined;
    const from = pendingKeptFrom(
      deleted.map((entry) => entry.base),
      incoming,
      removedFrom,
    );
    replay = deleted.slice(from);
    putBack();
    if (replay.length === 0) {
      forget();
    } else if (from > 0) {
      removedFrom = incoming;
    }
  });
  document.addEventListener('avb:after-patch', () => {
    const paths = replay;
    replay = [];
    if (paths.length === 0) {
      return;
    }
    const kept: Deleted[] = [];
    for (const { path, base } of paths) {
      const entry = detach(path, base);
      if (entry !== undefined) {
        kept.push(entry);
      }
    }
    deleted = kept;
    if (kept.length === 0) {
      forget();
    }
  });
}


function forget(): void {
  clearTimeout(clearTimer);
  clearTimer = undefined;
  deleted = [];
  removedFrom = undefined;
}

function putBack(): void {
  for (let index = deleted.length - 1; index >= 0; index -= 1) {
    const entry = deleted[index];
    if (entry === undefined) {
      continue;
    }
    putBackPaths(entry.paths);
    for (let at = entry.ghosts.length - 1; at >= 0; at -= 1) {
      const ghost = entry.ghosts[at];
      if (ghost === undefined) {
        continue;
      }
      if (ghost.next !== undefined && ghost.next.parentNode === ghost.parent) {
        ghost.next.before(ghost.element);
      } else {
        ghost.parent.append(ghost.element);
      }
    }
  }
  deleted = [];
}

function detach(path: string, base: string | undefined): Deleted | undefined {
  const nodes = pendingNodes(path);
  if (nodes === undefined || nodes.length === 0 || nodes.length > GHOSTS_MAX) {
    return undefined;
  }
  const ghosts: Ghost[] = [];
  for (const node of nodes) {
    const parent = node.parentNode;
    if (parent !== null) {
      ghosts.push({ element: node, parent, next: node.nextSibling ?? undefined });
    }
  }
  for (const ghost of ghosts) {
    ghost.element.remove();
  }
  if (ghosts.length === 0) {
    return undefined;
  }
  const paths = renumberPaths((token) => renumberedDeletePath(token, path));
  return { path, ghosts, paths, base };
}

function announce(): void {
  document.dispatchEvent(new CustomEvent('avb:morphed', { detail: undefined }));
}

function pendingNodes(path: string): ChildNode[] | undefined {
  const runs = markerRuns(path);
  if (runs === undefined) {
    return undefined;
  }
  const tagged = allElementsWithPath(path);
  const marked = (runsOf(path) ?? []).flatMap((run) => run.filter(isElement));
  const chosen: ChildNode[] = [...runs];
  for (const element of new Set([...tagged, ...marked])) {
    if (!chosen.some((node) => node === element || node.contains(element))) {
      chosen.push(element);
    }
  }
  const outermost = chosen.filter((node) => !chosen.some((other) => other !== node && other.contains(node)));
  return outermost.sort((left, right) => (left.compareDocumentPosition(right) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function markerRuns(path: string): ChildNode[] | undefined {
  const start = `avb-s:${path}`;
  const end = `avb-e:${path}`;
  const found: ChildNode[] = [];
  const walker = document.createTreeWalker(document, 128);
  for (let visited = 0; visited < COMMENTS_MAX; visited++) {
    const node = walker.nextNode();
    if (node === null) {
      return found;
    }
    if (!isComment(node) || node.data !== start) {
      continue;
    }
    const run: ChildNode[] = [node];
    for (let next = node.nextSibling; next !== null && run.length <= GHOSTS_MAX; next = next.nextSibling) {
      if (isComment(next) && next.data === end) {
        found.push(...run, next);
        break;
      }
      if (!isComment(next) || !next.data.startsWith(STAMP_PREFIX)) {
        run.push(next);
      }
    }
    if (found.length > GHOSTS_MAX) {
      return undefined;
    }
  }
  return undefined;
}
