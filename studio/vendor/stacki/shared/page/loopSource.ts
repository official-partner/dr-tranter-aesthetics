
import { assert } from '../core/assert';

export const LOOP_SOURCE_LIMITS = {
  stepsMax: 16,
  headCharsMax: 4000,
} as const;

export interface LoopHead {
  readonly source: string;
  readonly item: string;
  readonly index: string | undefined;
}

export type LoopSource = { readonly kind: 'list'; readonly path: string } | { readonly kind: 'values'; readonly path: string };

const MAP_HEAD = /^([\s\S]+?)\s*\??\.\s*map\(\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)|([A-Za-z_$][\w$]*))\s*=>\s*\(?$/;
const VALUE_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\])*$/;
const KEEPS_ELEMENT = new Set(['filter', 'slice', 'sort', 'toSorted', 'reverse', 'toReversed', 'concat']);
const EMPTY_FALLBACK = /\s*(?:\?\?|\|\|)\s*\[\s*\]$/;
const OBJECT_VALUES = /^Object\.values\(([\s\S]*)\)$/;

export function parseLoopHead(head: string): LoopHead | undefined {
  const text = head.trim();
  if (LOOP_SOURCE_LIMITS.headCharsMax < text.length) {
    return undefined;
  }
  const match = MAP_HEAD.exec(text);
  const source = match?.[1]?.trim();
  const item = match?.[2] ?? match?.[4];
  if (source === undefined || source === '' || item === undefined) {
    return undefined;
  }
  assert(text.includes(item), 'A loop item is named in its head');
  return { source, item, index: match?.[3] };
}

export function loopSourcePath(source: string): LoopSource | undefined {
  let text = source.trim();
  let kind: LoopSource['kind'] = 'list';
  for (let step = 0; step < LOOP_SOURCE_LIMITS.stepsMax; step++) {
    const peeled = peelStep(text);
    if (peeled === undefined) {
      break;
    }
    text = peeled;
  }
  const values = OBJECT_VALUES.exec(text);
  if (values?.[1] !== undefined) {
    kind = 'values';
    text = values[1].trim();
    for (let step = 0; step < LOOP_SOURCE_LIMITS.stepsMax; step++) {
      const peeled = peelStep(text);
      if (peeled === undefined) {
        break;
      }
      text = peeled;
    }
  }
  const path = text.replace(/\?\.(?=\[)/g, '').replace(/\?\./g, '.');
  if (!VALUE_PATH.test(path)) {
    return undefined;
  }
  assert(path.length <= source.length, 'A loop source path is part of its source');
  return { kind, path };
}

function peelStep(text: string): string | undefined {
  const fallback = text.replace(EMPTY_FALLBACK, '');
  if (fallback !== text) {
    return fallback.trim();
  }
  if (!text.endsWith(')')) {
    return undefined;
  }
  const open = matchingOpen(text, text.length - 1);
  if (open === undefined) {
    return undefined;
  }
  if (open === 0) {
    return text.slice(1, -1).trim();
  }
  const call = /\??\.\s*([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, open));
  const method = call?.[1];
  if (call === null || method === undefined) {
    return undefined;
  }
  return KEEPS_ELEMENT.has(method) ? text.slice(0, open - call[0].length).trim() : undefined;
}

function matchingOpen(text: string, close: number): number | undefined {
  assert(close < text.length, 'A closing bracket is inside its text');
  let depth = 0;
  let quote: string | undefined = undefined;
  for (let i = close; i >= 0; i--) {
    const character = text.charAt(i);
    if (quote !== undefined) {
      if (character === quote && text.charAt(i - 1) !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === ')' || character === ']' || character === '}') {
      depth += 1;
    } else if (character === '(' || character === '[' || character === '{') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}
