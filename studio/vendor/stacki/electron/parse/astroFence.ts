
import { skipStringOrComment } from './astroLexical';

export type FenceRead =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'fence';
      readonly codeStart: number;
      readonly codeEnd: number;
      readonly code: string;
      readonly length: number;
    }
  | { readonly kind: 'unreadable'; readonly what: string; readonly near: string };

const OPENING_FENCE = /^\s*---[ \t]*\r?\n/;
const FENCE_TAIL = /[ \t]*(?:\r?\n|$)/y;
const LEADING_COMMENTS = /^(?:\s|<!--[\s\S]*?-->)*---/;

export function readFence(text: string): FenceRead {
  const start = text.startsWith('﻿') ? 1 : 0;
  const opening = OPENING_FENCE.exec(text.slice(start));
  if (opening === null) {
    if (/^\s*---/.test(text.slice(start))) {
      return {
        kind: 'unreadable',
        what: 'a frontmatter fence the editor cannot read (an unclosed fence, or code on the opening line)',
        near: text.slice(start).trimStart().slice(0, 40),
      };
    }
    return LEADING_COMMENTS.test(text.slice(start))
      ? { kind: 'unreadable', what: 'a frontmatter fence after a comment', near: text.slice(start, start + 40) }
      : { kind: 'none' };
  }
  const codeStart = start + opening[0].length;
  const codeEnd = firstFenceIn(text, codeStart);
  if (codeEnd === -1) {
    return {
      kind: 'unreadable',
      what: 'a frontmatter fence the editor cannot read (an unclosed fence, or code on the opening line)',
      near: text.slice(start, start + 40),
    };
  }
  if (codeEnd > codeStart && text.charAt(codeEnd - 1) !== '\n') {
    return { kind: 'unreadable', what: 'a --- that shares its line with frontmatter code', near: text.slice(codeEnd - 20, codeEnd + 20) };
  }
  FENCE_TAIL.lastIndex = codeEnd + 3;
  const tail = FENCE_TAIL.exec(text);
  if (tail === null) {
    return { kind: 'unreadable', what: 'text after the closing frontmatter fence on its line', near: text.slice(codeEnd, codeEnd + 40) };
  }
  return { kind: 'fence', codeStart, codeEnd, code: text.slice(codeStart, codeEnd), length: codeEnd + 3 + tail[0].length };
}

export function frontmatterOf(source: string): Extract<FenceRead, { kind: 'fence' }> | undefined {
  const fence = readFence(source);
  return fence.kind === 'fence' ? fence : undefined;
}

function firstFenceIn(text: string, from: number): number {
  for (let position = from; position < text.length; position++) {
    const skipped = skipStringOrComment(text, position);
    if (skipped !== position) {
      position = skipped - 1;
    } else if (text.startsWith('---', position)) {
      return position;
    }
  }
  return -1;
}
