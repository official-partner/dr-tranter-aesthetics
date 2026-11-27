import type { TextMatch } from './frameTextMatch';

export interface TextOffsets {
  readonly start: number;
  readonly end: number;
}

export interface TextSpace {
  readonly runs: readonly (readonly Text[])[];
  readonly primary: number;
}

export function textSelection(nodes: readonly Text[], range?: AbstractRange): TextOffsets | undefined {
  return runsSelection([nodes], range);
}

export function runsSelection(runs: TextSpace['runs'], range?: AbstractRange): TextOffsets | undefined {
  const selection = window.getSelection();
  const current = range ?? (selection?.rangeCount ? selection.getRangeAt(0) : undefined);
  if (!current) {
    return undefined;
  }
  const start = textOffset(runs, current.startContainer, current.startOffset);
  const end = textOffset(runs, current.endContainer, current.endOffset);
  if (start === undefined || end === undefined || start > end) {
    return undefined;
  }
  return { start, end };
}

export function selectTextOffsets(nodes: readonly Text[], offsets: TextOffsets): void {
  selectRunsOffsets([nodes], offsets);
}

export function selectRunsOffsets(runs: TextSpace['runs'], offsets: TextOffsets): void {
  const first = positionAt(runs, offsets.start);
  const last = positionAt(runs, offsets.end);
  if (!first || !last) {
    return;
  }
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function placeTextCaret(space: TextSpace, event: MouseEvent): void {
  const nodes = space.runs.flat();
  const onWords = pointOnWords(nodes, event.clientX, event.clientY);
  const offsets =
    (onWords ? caretOffsetsAt(space.runs, event.clientX, event.clientY) : undefined) ??
    caretByRunsGeometry(space.runs, event.clientX, event.clientY) ??
    caretOffsetsAt(space.runs, event.clientX, event.clientY) ??
    caretBesideText(space.runs, event);
  if (offsets) {
    selectRunsOffsets(space.runs, offsets);
  }
}

export function pointOnWords(nodes: readonly Text[], x: number, y: number): boolean {
  for (const node of nodes) {
    if (node.length === 0) {
      continue;
    }
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, node.length);
    if (typeof range.getClientRects !== 'function') {
      return false;
    }
    for (const box of Array.from(range.getClientRects())) {
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        return true;
      }
    }
  }
  return false;
}

function caretOffsetsAt(runs: TextSpace['runs'], x: number, y: number) {
  const range = document.caretRangeFromPoint(x, y);
  return range ? runsSelection(runs, range) : undefined;
}

const CARET_CHARS_MAX = 20_000;
export function caretByGeometry(nodes: readonly Text[], x: number, y: number) {
  return caretByRunsGeometry([nodes], x, y);
}

export function caretByRunsGeometry(runs: TextSpace['runs'], x: number, y: number) {
  const lines: {
    readonly top: number;
    readonly bottom: number;
    readonly first: number;
    last: number;
    readonly rects: { readonly left: number; readonly right: number; readonly at: number }[];
  }[] = [];
  let total = 0;
  for (const nodes of runs) {
    for (const node of nodes) {
      for (let index = 0; index < node.length && total < CARET_CHARS_MAX; index++, total++) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const box = typeof range.getClientRects === 'function' ? range.getClientRects()[0] : undefined;
        if (!box || box.width === 0) {
          continue;
        }
        const line = lines.find((entry) => Math.abs(entry.top - box.top) < box.height / 2);
        if (line) {
          line.rects.push({ left: box.left, right: box.right, at: total });
          line.last = total;
        } else {
          lines.push({ top: box.top, bottom: box.bottom, first: total, last: total, rects: [{ left: box.left, right: box.right, at: total }] });
        }
      }
    }
    total += 1;
  }
  if (lines.length === 0) {
    return undefined;
  }
  let nearest = lines[0];
  for (const line of lines) {
    const distance = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
    const best = nearest === undefined ? Infinity : y < nearest.top ? nearest.top - y : y > nearest.bottom ? y - nearest.bottom : 0;
    if (nearest === undefined || distance < best) {
      nearest = line;
    }
  }
  if (nearest === undefined) {
    return undefined;
  }
  let offset = nearest.last + 1;
  for (const rect of nearest.rects) {
    if (x < rect.left + (rect.right - rect.left) / 2) {
      offset = rect.at;
      break;
    }
  }
  return { start: offset, end: offset };
}

function caretBesideText(runs: TextSpace['runs'], event: MouseEvent) {
  const nodes = runs.flat();
  const first = nodes[0];
  const last = nodes.at(-1);
  if (!first || !last) {
    return undefined;
  }
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.length);
  const box = range.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
  const y = Math.min(Math.max(event.clientY, box.top + 1), box.bottom - 1);
  return caretOffsetsAt(runs, x, y);
}

export function textEditorRoot(match: TextMatch): HTMLElement | undefined {
  let root = match.nodes[0]?.parentElement;
  for (let depth = 0; root && depth < 32; depth++) {
    if (match.nodes.every((node) => root?.contains(node))) {
      return root instanceof HTMLElement ? root : undefined;
    }
    root = root.parentElement;
  }
  return undefined;
}

function textOffset(runs: TextSpace['runs'], container: Node, offset: number): number | undefined {
  let total = 0;
  for (const run of runs) {
    for (const node of run) {
      if (container === node) {
        return offset <= node.length ? total + offset : undefined;
      }
      const children = node.parentNode?.childNodes;
      if (container === node.parentNode && children) {
        const index = Array.from(children).indexOf(node);
        if (offset === index) {
          return total;
        }
        if (offset === index + 1) {
          return total + node.length;
        }
      }
      total += node.length;
    }
    total += 1;
  }
  return undefined;
}

function positionAt(runs: TextSpace['runs'], offset: number) {
  let remaining = offset;
  for (const run of runs) {
    for (const node of run) {
      if (remaining <= node.length) {
        return { node, offset: remaining };
      }
      remaining -= node.length;
    }
    remaining -= 1;
  }
  const node = runs.at(-1)?.at(-1);
  return node ? { node, offset: node.length } : undefined;
}
