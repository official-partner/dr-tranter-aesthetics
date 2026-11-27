import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

export interface SearchItem {
  readonly name?: string;
  readonly label?: string;
  readonly search?: string;
  readonly sub?: string;
  readonly folder?: string;
  readonly cat?: string;
}


function wordsOf(text: unknown): readonly string[] {
  const raw = String(text || '').toLowerCase();
  if (!raw) {
    return [];
  }
  const out = new Set<string>();
  out.add(raw);
  for (const part of raw.split(/[^a-z0-9]+/i)) {
    if (part) {
      out.add(part);
    }
  }
  for (const part of String(text || '').split(/[^A-Za-z0-9]+/)) {
    for (const piece of part.split(/(?<=[a-z0-9])(?=[A-Z])/)) {
      if (piece) {
        out.add(piece.toLowerCase());
      }
    }
  }
  return [...out];
}

const FIELDS = [
  { of: (item: SearchItem) => item.search || item.label || item.name, base: 0 },
  { of: (item: SearchItem) => item.label || item.name, base: 0 },
  { of: (item: SearchItem) => item.sub || item.folder, base: 4 },
];

type TokenState = 'finished' | 'typing';

function scoreToken(item: SearchItem, token: string, state: TokenState): number | undefined {
  let best: number | undefined;
  for (const field of FIELDS) {
    const text = String(field.of(item) || '').toLowerCase();
    if (!text) {
      continue;
    }
    const words = wordsOf(field.of(item));
    let score: number | undefined;
    if (text === token || words.includes(token)) {
      score = field.base;
    } else if (state === 'finished') {
      score = undefined;
    } else if (text.startsWith(token)) {
      score = field.base + 1;
    } else if (words.some((word) => word.startsWith(token))) {
      score = field.base + 2;
    } else if (text.includes(token)) {
      score = field.base + 3;
    }
    if (score !== undefined && (best === undefined || score < best)) {
      best = score;
    }
  }
  return best;
}

const TAG_WORDS: Readonly<Record<string, string>> = {
  a: 'link',
  blockquote: 'quote',
  br: 'line break',
  em: 'italic emphasis',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  hr: 'divider line',
  iframe: 'embed',
  img: 'image',
  li: 'list item',
  nav: 'navigation',
  ol: 'list ordered',
  p: 'paragraph',
  slot: 'children content',
  strong: 'bold',
  ul: 'list unordered',
};

export function tagSearchText(tag: string): string {
  assert(tag.length > 0, 'An element search text needs a tag');
  const words = Object.hasOwn(TAG_WORDS, tag) ? TAG_WORDS[tag] : undefined;
  return words === undefined ? tag : `${tag} ${words}`;
}

const CATEGORY: Readonly<Record<string, number>> = { components: 0, elements: 1, other: 2, apps: 3 };

export function rankInsertItems<T extends SearchItem>(items: readonly T[] | undefined, query: unknown): readonly T[] {
  assert((items?.length ?? 0) <= LIMITS.scanEntriesMax, 'Palette item count exceeds limit');
  const text = String(query || '').toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return [...(items || [])];
  }
  const finished = /\s$/.test(text);
  const scored = [];
  for (const [index, item] of (items || []).entries()) {
    let total = 0;
    let matched = true;
    for (const [at, token] of tokens.entries()) {
      const state = finished || at < tokens.length - 1 ? 'finished' : 'typing';
      const score = scoreToken(item, token, state);
      if (score === undefined) {
        matched = false;
        break;
      }
      total += score;
    }
    if (matched) {
      scored.push({ item, total, index });
    }
  }
  scored.sort(
    (left, right) => (CATEGORY[left.item.cat ?? ''] ?? 4) - (CATEGORY[right.item.cat ?? ''] ?? 4) || left.total - right.total || left.index - right.index,
  );
  return scored.map((entry) => entry.item);
}
