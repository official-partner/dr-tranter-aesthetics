
import { foldNodeProp, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { assert } from '../../shared/core/assert';

export const STICKY_LINES_MAX = 3;

const STICKY_HEIGHT_SHARE_MAX = 0.4;
const STICKY_TREE_DEPTH_MAX = 256;
const STICKY_SIBLINGS_MAX = 32;
const STICKY_HEADER_LINES_MAX = 32;

const NO_BLOCKS: readonly StickyBlock[] = [];
const NO_STACK: StickyStack = { rows: [], heightPx: 0 };

export interface StickyBlock {
  readonly headerFrom: number;
  readonly openFrom: number;
  readonly openTo: number;
  readonly to: number;
}

export interface StickyHeaderPiece {
  readonly from: number;
  readonly to: number;
  readonly separator: '' | ' ';
}

export interface StickyLineBox {
  readonly from: number;
  readonly top: number;
  readonly bottom: number;
}

export interface StickyLineMap {
  lineBlockAt(position: number): StickyLineBox;
  lineBlockAtHeight(height: number): StickyLineBox;
}

export interface StickyStackInput {
  readonly scrollTop: number;
  readonly lineHeight: number;
  readonly rowsMax: number;
  readonly lines: StickyLineMap;
  readonly blocksAt: (position: number) => readonly StickyBlock[];
}

export interface StickyRow {
  readonly block: StickyBlock;
  readonly offsetPx: number;
}

export interface StickyStack {
  readonly rows: readonly StickyRow[];
  readonly heightPx: number;
}

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

interface StickyPlace {
  readonly line: number;
  readonly position: number;
  readonly side: -1 | 1;
}

interface PinnedBlock {
  readonly block: StickyBlock;
  readonly openTop: number;
  readonly endBottom: number;
}

export function stickyRowsMax(viewportHeightPx: number, lineHeightPx: number): number {
  assert(Number.isFinite(viewportHeightPx), 'stickyRowsMax: the viewport height is finite');
  assert(lineHeightPx > 0, 'stickyRowsMax: a line has height');
  const rows = Math.floor((viewportHeightPx * STICKY_HEIGHT_SHARE_MAX) / lineHeightPx);
  return Math.max(0, Math.min(STICKY_LINES_MAX, rows));
}

export function stickyBlocksAt(state: EditorState, position: number): readonly StickyBlock[] {
  assert(position >= 0, 'stickyBlocksAt: the position is in the document');
  assert(position <= state.doc.length, 'stickyBlocksAt: the position is in the document');
  const line = state.doc.lineAt(position);
  const textFrom = line.from + (line.text.length - line.text.trimStart().length);
  const textTo = line.from + line.text.trimEnd().length;
  const atStart = stickyBlocksAround(state, { line: line.from, position: textFrom, side: 1 });
  if (textFrom >= textTo) {
    return atStart;
  }
  const atEnd = stickyBlocksAround(state, { line: line.from, position: textTo, side: -1 });
  return stickyBlocksStartWith(atStart, atEnd) ? atStart : atEnd;
}

export function stickyHeightAt(state: EditorState, position: number, options: { readonly lineHeight: number; readonly rowsMax: number }): number {
  assert(options.lineHeight > 0, 'stickyHeightAt: a line has height');
  assert(options.rowsMax >= 0, 'stickyHeightAt: the row limit is not negative');
  const lineFrom = state.doc.lineAt(position).from;
  const above = stickyBlocksAt(state, position).filter((block) => block.openFrom < lineFrom);
  return Math.min(above.length, options.rowsMax) * options.lineHeight;
}

export function stickyHeaderPieces(state: EditorState, block: StickyBlock): readonly StickyHeaderPiece[] {
  assert(block.headerFrom <= block.openFrom, 'stickyHeaderPieces: a block opens at or after its first line');
  const first = state.doc.lineAt(block.headerFrom);
  const last = state.doc.lineAt(block.openFrom);
  assert(first.from === block.headerFrom, 'stickyHeaderPieces: a header starts at the start of a line');
  if (first.number === last.number) {
    return [{ from: first.from, to: first.to, separator: '' }];
  }
  if (last.number - first.number >= STICKY_HEADER_LINES_MAX) {
    return [{ from: first.from, to: first.to, separator: '' }];
  }
  const pieces: StickyHeaderPiece[] = [{ from: first.from, to: first.from + first.text.trimEnd().length, separator: '' }];
  let previous = first.text.trimEnd();
  for (let number = first.number + 1; number <= last.number; number++) {
    const line = state.doc.line(number);
    const text = line.text.trim();
    if (text.length > 0) {
      const from = line.from + (line.text.length - line.text.trimStart().length);
      pieces.push({ from, to: from + text.length, separator: stickySeparator(previous, text) });
      previous = text;
    }
  }
  return pieces;
}

export function stickyStack(input: StickyStackInput): StickyStack {
  const { scrollTop, lineHeight, rowsMax } = input;
  assert(Number.isFinite(scrollTop), 'stickyStack: the scroll position is finite');
  assert(lineHeight > 0, 'stickyStack: a line has height');
  assert(Number.isSafeInteger(rowsMax), 'stickyStack: the row limit is a whole number');
  assert(rowsMax >= 0, 'stickyStack: the row limit is not negative');
  if (rowsMax === 0) {
    return NO_STACK;
  }
  if (scrollTop <= 0) {
    return NO_STACK;
  }
  const blocksAt = stickyBlocksMemo(input.blocksAt);
  const pinned = stickyPinnedBlocks({ ...input, blocksAt });
  const rows = pinned.length > rowsMax ? stickyRowsPastLimit(pinned, { ...input, blocksAt }) : stickyRowsWithinLimit(pinned, input);
  const visible = rows.filter((row) => row.offsetPx + lineHeight > 0);
  if (visible.length === 0) {
    return NO_STACK;
  }
  const heightPx = Math.max(...visible.map((row) => row.offsetPx + lineHeight));
  assert(visible.length <= rowsMax + 1, 'stickyStack: only one line past the limit shows, as it leaves');
  assert(heightPx <= (rowsMax + 1) * lineHeight, 'stickyStack: the stack stays within its limit');
  return { rows: visible, heightPx };
}

function stickyBlocksAround(state: EditorState, place: StickyPlace): readonly StickyBlock[] {
  const innerFirst: StickyBlock[] = [];
  let node: SyntaxNode | undefined = syntaxTree(state).resolveInner(place.position, place.side);
  for (let depth = 0; node !== undefined && depth < STICKY_TREE_DEPTH_MAX; depth++) {
    const block = stickyIsBlock(node) ? stickyBlockOf(node, state) : undefined;
    if (block !== undefined) {
      if (stickyBlockHolds(block, place)) {
        if (innerFirst.at(-1)?.headerFrom === block.headerFrom) {
          innerFirst.pop();
        }
        innerFirst.push(block);
      }
    }
    node = node.parent ?? undefined;
  }
  return innerFirst.length === 0 ? NO_BLOCKS : innerFirst.reverse();
}

function stickyBlocksStartWith(blocks: readonly StickyBlock[], prefix: readonly StickyBlock[]): boolean {
  if (blocks.length <= prefix.length) {
    return false;
  }
  return prefix.every((block, index) => block.headerFrom === blocks[index]?.headerFrom);
}

function stickyIsBlock(node: SyntaxNode): boolean {
  if (node.type.prop(foldNodeProp) === undefined) {
    return false;
  }
  return !node.name.includes('Comment');
}

function stickyBlockOf(node: SyntaxNode, state: EditorState): StickyBlock | undefined {
  const fold = node.type.prop(foldNodeProp);
  assert(fold !== undefined, 'stickyBlockOf: a block folds');
  const inside = fold(node, state);
  if (inside === null) {
    return undefined;
  }
  const openFrom = state.doc.lineAt(inside.from).from;
  const last = state.doc.lineAt(node.to);
  if (openFrom >= last.from) {
    return undefined;
  }
  return { headerFrom: state.doc.lineAt(stickyHeaderPosition(node)).from, openFrom, openTo: inside.from, to: node.to };
}

function stickyHeaderPosition(node: SyntaxNode): number {
  const owner = node.parent;
  if (owner === null) {
    return node.from;
  }
  if (owner.type.isTop) {
    return node.from;
  }
  if (stickyIsBlock(owner)) {
    return node.from;
  }
  return stickyFollowsBlock(node) ? node.from : owner.from;
}

function stickyFollowsBlock(node: SyntaxNode): boolean {
  let sibling = node.prevSibling;
  for (let count = 0; sibling !== null && count < STICKY_SIBLINGS_MAX; count++) {
    if (stickyIsBlock(sibling)) {
      return true;
    }
    sibling = sibling.prevSibling;
  }
  return false;
}

function stickySeparator(before: string, after: string): StickyHeaderPiece['separator'] {
  if (/[([{]$/.test(before)) {
    return '';
  }
  return /^(?:[)\]}]|\/?>$)/.test(after) ? '' : ' ';
}

function stickyBlockHolds(block: StickyBlock, place: StickyPlace): boolean {
  if (block.openFrom > place.line) {
    return false;
  }
  return place.position <= block.to;
}

function stickyBlocksMemo(blocksAt: StickyStackInput['blocksAt']): StickyStackInput['blocksAt'] {
  const seen = new Map<number, readonly StickyBlock[]>();
  return (position) => {
    const known = seen.get(position);
    if (known !== undefined) {
      return known;
    }
    const blocks = blocksAt(position);
    seen.set(position, blocks);
    return blocks;
  };
}

function stickyPinnedBlocks(input: StickyStackInput): readonly PinnedBlock[] {
  const pinned: PinnedBlock[] = [];
  for (let depth = 0; depth < STICKY_TREE_DEPTH_MAX; depth++) {
    const next = stickyPinnedAtDepth(input, depth, pinned.at(-1));
    if (next === undefined) {
      break;
    }
    pinned.push(next);
  }
  return pinned;
}

function stickyPinnedAtDepth(input: StickyStackInput, depth: number, parent: PinnedBlock | undefined): PinnedBlock | undefined {
  const { scrollTop, lineHeight, rowsMax } = input;
  const withinLimit = depth < rowsMax;
  const rowTop = scrollTop + Math.min(depth, rowsMax - 1) * lineHeight;
  const openLimit = withinLimit ? rowTop : rowTop + lineHeight;
  const probes = withinLimit ? [rowTop] : [rowTop, openLimit];
  for (const probe of probes) {
    const blocks = input.blocksAt(input.lines.lineBlockAtHeight(probe).from);
    const block = blocks[depth];
    if (block !== undefined) {
      if (blocks[depth - 1]?.headerFrom === parent?.block.headerFrom) {
        const candidate = stickyPinnedBlock(block, input.lines);
        if (stickyStaysPinned(candidate, { openLimit, rowTop, lineHeight })) {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

function stickyPinnedBlock(block: StickyBlock, lines: StickyLineMap): PinnedBlock {
  const openTop = lines.lineBlockAt(block.openFrom).top;
  const endBottom = lines.lineBlockAt(block.to).bottom;
  assert(endBottom >= openTop, 'stickyPinnedBlock: a block ends below where it opens');
  return { block, openTop, endBottom };
}

function stickyStaysPinned(candidate: PinnedBlock, place: { readonly openLimit: number; readonly rowTop: number; readonly lineHeight: number }): boolean {
  if (candidate.openTop >= place.openLimit) {
    return false;
  }
  if (candidate.endBottom - candidate.openTop < place.lineHeight * 1.5) {
    return false;
  }
  return candidate.endBottom > place.rowTop;
}

function stickyRowsWithinLimit(pinned: readonly PinnedBlock[], input: StickyStackInput): readonly StickyRow[] {
  const { scrollTop, lineHeight } = input;
  return pinned.map((item, depth) => ({
    block: item.block,
    offsetPx: Math.min(depth * lineHeight, item.endBottom - scrollTop - lineHeight),
  }));
}

function stickyRowsPastLimit(pinned: readonly PinnedBlock[], input: StickyStackInput): readonly StickyRow[] {
  const { scrollTop, lineHeight, rowsMax } = input;
  const innermost = pinned.at(-1);
  assert(innermost !== undefined, 'stickyRowsPastLimit: more blocks than rows means at least one');
  const lastRowTop = (rowsMax - 1) * lineHeight;
  const entering = Math.min(lineHeight, Math.max(0, innermost.openTop - scrollTop - lastRowTop));
  const leaving = Math.min(lineHeight, Math.max(0, lastRowTop - (innermost.endBottom - scrollTop - lineHeight)));
  const stackBottom = input.lines.lineBlockAtHeight(scrollTop + rowsMax * lineHeight).from;
  const followed = input.blocksAt(stackBottom).length >= pinned.length;
  const stackShift = entering > 0 ? entering : followed ? 0 : leaving;
  const innermostShift = entering > 0 ? entering : followed ? -leaving : 0;
  const shown = pinned.slice(-(rowsMax + 1));
  assert(shown.length === rowsMax + 1, 'stickyRowsPastLimit: the window is one row taller than the limit');
  return shown.map((item, index) => {
    const shift = item === innermost ? innermostShift : stackShift;
    return {
      block: item.block,
      offsetPx: Math.min((index - 1) * lineHeight + shift, item.endBottom - scrollTop - lineHeight),
    };
  });
}
