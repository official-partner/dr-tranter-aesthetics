import { assert } from '../core/assert';
import { blankLinePrefix, markdownPrefix } from './markdownLayout';
import type { Placement } from './intent';
import { nodeAtPath, parentPath, siblingsOf, startsWith, textOf, type ValidProjection } from './planSupport';
import { toByteSpan, type ByteSpan, type ByteString } from '../core/span';
import type { ProjectedNode } from '../page/sourceProjection';

const NEWLINE = 0x0a;
const CARRIAGE = 0x0d;

export interface MarkdownSplice {
  readonly range: ByteSpan;
  readonly text: string;
}

export interface MarkdownInsertion extends MarkdownSplice {
  readonly anchorPath: readonly number[];
}

export function markdownRemoved(projection: ValidProjection, node: ProjectedNode): ProjectedNode {
  if (node.list === 'items') {
    if (siblingsOf(projection, node).length === 1) {
      const list = nodeAtPath(projection, parentPath(node.path));
      assert(list !== undefined, 'An item has its list');
      assert(list.list === 'blocks', 'A list is a block');
      return list;
    }
  }
  return node;
}

export function markdownRemoval(bytes: ByteString, projection: ValidProjection, node: ProjectedNode): MarkdownSplice | undefined {
  assert(node.list === 'blocks' || node.list === 'items', 'Only blocks and items are removed');
  const { previous, next } = neighboursOf(projection, node);
  if (previous !== undefined) {
    if (next !== undefined) {
      if (node.list === 'blocks') {
        return blockRemoval(bytes, previous, node, next);
      }
    }
    return { range: toByteSpan(previous.span.end, node.span.end), text: '' };
  }
  if (next !== undefined) {
    return { range: toByteSpan(node.span.start, next.span.start), text: '' };
  }
  return { range: node.span, text: '' };
}

function blockRemoval(bytes: ByteString, previous: ProjectedNode, node: ProjectedNode, next: ProjectedNode): MarkdownSplice | undefined {
  if (separates('blocks', gapText(bytes, previous, node))) {
    return { range: toByteSpan(node.span.start, next.span.start), text: '' };
  }
  if (separates('blocks', gapText(bytes, node, next))) {
    return { range: toByteSpan(previous.span.end, node.span.end), text: '' };
  }
  const blank = blankSeparator(bytes, next);
  if (blank === undefined) {
    return undefined;
  }
  return { range: toByteSpan(previous.span.end, next.span.start), text: blank };
}

export function markdownBeside(
  projection: ValidProjection,
  node: ProjectedNode,
  placement: Placement,
): { readonly node: ProjectedNode; readonly side: 'before' | 'after' } | undefined {
  switch (placement) {
    case 'before':
    case 'after':
      return { node, side: placement };
    case 'first-child':
    case 'last-child': {
      const children = projection.nodes.filter((candidate) => candidate.path.length === node.path.length + 1 && startsWith(candidate.path, node.path));
      const child = placement === 'first-child' ? children[0] : children[children.length - 1];
      if (child === undefined) {
        return undefined;
      }
      return { node: child, side: placement === 'first-child' ? 'before' : 'after' };
    }
    default: {
      const exhaustive: never = placement;
      return exhaustive;
    }
  }
}

export function markdownInsertion(
  bytes: ByteString,
  projection: ValidProjection,
  beside: { readonly node: ProjectedNode; readonly side: 'before' | 'after' },
  anchorPath: readonly number[],
  text: string,
): MarkdownInsertion | undefined {
  const node = beside.node;
  const { previous, next } = neighboursOf(projection, node);
  const far = beside.side === 'after' ? next : previous;
  if (node.list === 'blocks') {
    if (far !== undefined) {
      const first = beside.side === 'after' ? node : far;
      const second = beside.side === 'after' ? far : node;
      if (!separates('blocks', gapText(bytes, first, second))) {
        const blank = blankSeparator(bytes, second);
        if (blank === undefined) {
          return undefined;
        }
        const range = toByteSpan(first.span.end, second.span.start);
        return { range, text: `${blank}${text}${blank}`, anchorPath };
      }
    }
  }
  const separator = nearSeparator(bytes, { previous, node, next });
  if (separator === undefined) {
    return undefined;
  }
  if (beside.side === 'after') {
    const at = toByteSpan(node.span.end, node.span.end);
    return { range: at, text: `${separator}${text}`, anchorPath };
  }
  const at = toByteSpan(node.span.start, node.span.start);
  return { range: at, text: `${text}${separator}`, anchorPath };
}

function nearSeparator(
  bytes: ByteString,
  around: {
    readonly previous: ProjectedNode | undefined;
    readonly node: ProjectedNode;
    readonly next: ProjectedNode | undefined;
  },
): string | undefined {
  const { previous, node, next } = around;
  assert(node.list === 'blocks' || node.list === 'items', 'Blocks and items have separators');
  if (previous !== undefined) {
    const gap = gapText(bytes, previous, node);
    if (separates(node.list, gap)) {
      return gap;
    }
  }
  if (next !== undefined) {
    const gap = gapText(bytes, node, next);
    if (separates(node.list, gap)) {
      return gap;
    }
  }
  return blankSeparator(bytes, node);
}

function blankSeparator(bytes: ByteString, node: ProjectedNode): string | undefined {
  const prefix = markdownPrefix(bytes, node.span.start);
  if (prefix === undefined) {
    return undefined;
  }
  const eol = lineBreakOf(bytes);
  if (node.list === 'items') {
    return `${eol}${prefix}`;
  }
  return `${eol}${blankLinePrefix(prefix)}${eol}${prefix}`;
}

function neighboursOf(
  projection: ValidProjection,
  node: ProjectedNode,
): { readonly previous: ProjectedNode | undefined; readonly next: ProjectedNode | undefined } {
  const siblings = siblingsOf(projection, node);
  const index = siblings.indexOf(node);
  assert(index >= 0, 'A node is among its siblings');
  return { previous: siblings[index - 1], next: siblings[index + 1] };
}

function gapText(bytes: ByteString, first: ProjectedNode, second: ProjectedNode): string {
  assert(first.span.end <= second.span.start, 'Siblings do not overlap');
  return textOf(bytes, toByteSpan(first.span.end, second.span.start));
}

function separates(list: 'blocks' | 'items', gap: string): boolean {
  return lineBreaks(gap) >= (list === 'items' ? 1 : 2);
}

export function reprefixed(bytes: ByteString, node: ProjectedNode, destination: string): string | undefined {
  const source = markdownPrefix(bytes, node.span.start);
  if (source === undefined) {
    return undefined;
  }
  const lines = textOf(bytes, node.span).split('\n');
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index === 0) {
      out.push(line);
      continue;
    }
    const moved = movedLine(line, source, destination);
    if (moved === undefined) {
      return undefined;
    }
    out.push(moved);
  }
  assert(out.length === lines.length, 'Every line is moved');
  return out.join('\n');
}

function movedLine(line: string, source: string, destination: string): string | undefined {
  const crlf = line.endsWith('\r');
  const body = crlf ? line.slice(0, -1) : line;
  const end = crlf ? '\r' : '';
  if (body.startsWith(source)) {
    if (body.length > source.length) {
      return `${destination}${body.slice(source.length)}${end}`;
    }
  }
  const blank = blankLinePrefix(source);
  if (body.startsWith(blank)) {
    if (body.slice(blank.length).trim() === '') {
      return `${blankLinePrefix(destination)}${end}`;
    }
  }
  return undefined;
}

export function itemMarker(bytes: ByteString, item: ProjectedNode): string {
  assert(item.list === 'items', 'Only an item has a marker');
  let at = item.span.start;
  while (at < item.span.end) {
    const byte = bytes[at];
    assert(byte !== undefined, 'A marker lies inside the item');
    if (byte < 0x30 || byte > 0x39) {
      return String.fromCharCode(byte);
    }
    at++;
  }
  throw new Error('Assertion failed: an item starts with its marker');
}

export function lineBreakOf(bytes: ByteString): string {
  const first = bytes.indexOf(NEWLINE);
  if (first > 0) {
    return bytes[first - 1] === CARRIAGE ? '\r\n' : '\n';
  }
  return '\n';
}

function lineBreaks(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    count++;
  }
  return count;
}
