import { assert } from '../../shared/core/assert';

export const MENTION_LIMITS = {
  namesMax: 100_000,
  piecesPerNameMax: 16,
} as const satisfies Record<string, number>;

export interface MentionInterest {
  readonly words: ReadonlySet<string>;
  readonly odd: readonly string[];
  readonly heads: ReadonlySet<string>;
  readonly bareHeads: ReadonlySet<string>;
  readonly tails: ReadonlySet<string>;
}

export interface MentionHits {
  readonly words: Set<string>;
  readonly heads: Set<string>;
  readonly tails: Set<string>;
}

const WORD_ONLY = /^[A-Za-z0-9_-]+$/;
const SEPARATORS = /[-_]+/g;

export function mentionInterest(names: Iterable<string>): MentionInterest {
  const words = new Set<string>();
  const odd: string[] = [];
  const heads = new Set<string>();
  const bareHeads = new Set<string>();
  const tails = new Set<string>();
  for (const name of names) {
    assert(name.length > 0, 'mentionInterest: names are non-empty');
    if (!WORD_ONLY.test(name)) {
      odd.push(name);
      continue;
    }
    words.add(name);
    for (const piece of namePieces(name)) {
      heads.add(piece.head);
      bareHeads.add(piece.bareHead);
      tails.add(piece.tail);
    }
  }
  assert(words.size + odd.length <= MENTION_LIMITS.namesMax, 'mentionInterest: the report bounds names');
  return { words, odd, heads, bareHeads, tails };
}

export function emptyHits(): MentionHits {
  return { words: new Set(), heads: new Set(), tails: new Set() };
}

interface InterestIndex {
  readonly all: ReadonlySet<string>;
  readonly lengths: Uint8Array;
}
const indexes = new WeakMap<MentionInterest, InterestIndex>();
const TOKEN_CHARS_MAX = 256;

function indexOf(interest: MentionInterest): InterestIndex {
  const existing = indexes.get(interest);
  if (existing !== undefined) {
    return existing;
  }
  const all = new Set([...interest.words, ...interest.heads, ...interest.bareHeads, ...interest.tails]);
  const lengths = new Uint8Array(TOKEN_CHARS_MAX + 1);
  for (const token of all) {
    if (token.length <= TOKEN_CHARS_MAX) {
      lengths[token.length] = 1;
    }
  }
  const index = { all, lengths };
  indexes.set(interest, index);
  return index;
}

export function scanMentions(text: string, interest: MentionInterest, hits: MentionHits): void {
  const { all, lengths } = indexOf(interest);
  const length = text.length;
  let start = 0;
  while (start < length) {
    if (!isWordCode(text.charCodeAt(start))) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < length && isWordCode(text.charCodeAt(end))) {
      end += 1;
    }
    const size = end - start;
    if (size <= TOKEN_CHARS_MAX && lengths[size] === 1) {
      const token = text.slice(start, end);
      if (all.has(token)) {
        recordToken(text, token, start, end, interest, hits);
      }
    }
    start = end;
  }
  for (const name of interest.odd) {
    if (!hits.words.has(name)) {
      if (containsWord(text, name)) {
        hits.words.add(name);
      }
    }
  }
}

function recordToken(text: string, token: string, start: number, end: number, interest: MentionInterest, hits: MentionHits): void {
  if (interest.words.has(token)) {
    hits.words.add(token);
  }
  if (interest.heads.has(token)) {
    if (isQuote(text.charCodeAt(end)) || text.startsWith('${', end)) {
      hits.heads.add(token);
    }
  }
  if (interest.bareHeads.has(token)) {
    if (isQuote(text.charCodeAt(end)) && /^\s*\+/.test(text.slice(end + 1, end + 64))) {
      hits.heads.add(token);
    }
  }
  if (interest.tails.has(token)) {
    const before = text.charCodeAt(start - 1);
    if (before === 0x7d || isQuote(before)) {
      hits.tails.add(token);
    }
  }
}

export function mergeHits(target: MentionHits, source: MentionHits): void {
  for (const word of source.words) {
    target.words.add(word);
  }
  for (const head of source.heads) {
    target.heads.add(head);
  }
  for (const tail of source.tails) {
    target.tails.add(tail);
  }
}

export function assembledPiece(name: string, hits: MentionHits): string | undefined {
  if (!WORD_ONLY.test(name)) {
    return undefined;
  }
  for (const piece of namePieces(name)) {
    if (hits.heads.has(piece.head)) {
      return `${piece.head}…`;
    }
    if (hits.heads.has(piece.bareHead)) {
      return `${piece.bareHead} + …`;
    }
    if (hits.tails.has(piece.tail)) {
      return `…${piece.tail}`;
    }
  }
  return undefined;
}

export function asksAbout(interest: MentionInterest, name: string): boolean {
  if (interest.words.has(name) || interest.odd.includes(name)) {
    return true;
  }
  if (!WORD_ONLY.test(name)) {
    return false;
  }
  return namePieces(name).some((piece) => interest.heads.has(piece.head) || interest.bareHeads.has(piece.bareHead) || interest.tails.has(piece.tail));
}

export function remainingInterest(interest: MentionInterest, hits: MentionHits): MentionInterest {
  const words = new Set([...interest.words].filter((word) => !hits.words.has(word)));
  const odd = interest.odd.filter((name) => !hits.words.has(name));
  return {
    words,
    odd,
    heads: new Set([...interest.heads].filter((head) => !hits.heads.has(head))),
    bareHeads: new Set([...interest.bareHeads].filter((head) => !hits.heads.has(head))),
    tails: new Set([...interest.tails].filter((tail) => !hits.tails.has(tail))),
  };
}

export function interestIsEmpty(interest: MentionInterest): boolean {
  return interest.words.size === 0 && interest.odd.length === 0 && interest.heads.size === 0 && interest.bareHeads.size === 0 && interest.tails.size === 0;
}

interface NamePiece {
  readonly head: string;
  readonly bareHead: string;
  readonly tail: string;
}

function namePieces(name: string): readonly NamePiece[] {
  const pieces: NamePiece[] = [];
  SEPARATORS.lastIndex = 0;
  for (let match = SEPARATORS.exec(name); match !== null; match = SEPARATORS.exec(name)) {
    if (pieces.length >= MENTION_LIMITS.piecesPerNameMax) {
      break;
    }
    const start = match.index;
    const end = start + match[0].length;
    if (start > 0) {
      if (end < name.length) {
        pieces.push({ head: name.slice(0, end), bareHead: name.slice(0, start), tail: name.slice(start) });
      }
    }
  }
  return pieces;
}

function containsWord(text: string, name: string): boolean {
  for (let index = text.indexOf(name); index !== -1; index = text.indexOf(name, index + 1)) {
    if (!isWordCode(text.charCodeAt(index - 1))) {
      if (!isWordCode(text.charCodeAt(index + name.length))) {
        return true;
      }
    }
  }
  return false;
}

function isWordCode(code: number): boolean {
  if (code >= 0x30 && code <= 0x39) {
    return true;
  }
  if (code >= 0x41 && code <= 0x5a) {
    return true;
  }
  if (code >= 0x61 && code <= 0x7a) {
    return true;
  }
  return code === 0x2d || code === 0x5f;
}

function isQuote(code: number): boolean {
  return code === 0x22 || code === 0x27 || code === 0x60;
}
