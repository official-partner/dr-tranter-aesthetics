import { assert } from '../../shared/core/assert';

export function foldSearchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function queryWords(query: string): readonly string[] {
  return foldSearchText(query)
    .split(/\s+/u)
    .filter((word) => word.length > 0);
}

export function isSearching(query: string): boolean {
  return queryWords(query).length > 0;
}

export function holdsEveryWord(haystack: string, words: readonly string[]): boolean {
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

export interface HighlightSegment {
  readonly text: string;
  readonly hit: boolean;
}

export function highlightSegments(label: string, words: readonly string[]): readonly HighlightSegment[] {
  assert(label.length <= 100_000, 'A label is short enough to cut');
  if (words.length === 0) {
    return [{ text: label, hit: false }];
  }
  const characters = Array.from(label);
  let folded = '';
  const owner: number[] = [];
  for (const [position, character] of characters.entries()) {
    const piece = foldSearchText(character);
    for (let step = 0; step < piece.length; step += 1) {
      owner.push(position);
    }
    folded += piece;
  }
  const marked = new Array<boolean>(characters.length).fill(false);
  for (const word of words) {
    let from = 0;
    for (let pass = 0; pass <= folded.length; pass += 1) {
      const at = folded.indexOf(word, from);
      if (at < 0) {
        break;
      }
      for (let offset = at; offset < at + word.length; offset += 1) {
        const position = owner[offset];
        if (position !== undefined) {
          marked[position] = true;
        }
      }
      from = at + word.length;
    }
  }
  const segments: HighlightSegment[] = [];
  for (const [position, character] of characters.entries()) {
    const hit = marked[position] === true;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.hit === hit) {
      segments[segments.length - 1] = { text: last.text + character, hit };
    } else {
      segments.push({ text: character, hit });
    }
  }
  assert(segments.map((segment) => segment.text).join('') === label, 'The runs put back together are the label');
  return segments;
}
