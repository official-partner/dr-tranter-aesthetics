
import { assert } from '../../../../shared/core/assert';
import type { CanvasAnswer } from '../../../editor/canvasReply';
import { getHost } from './host';
import type { ParsedRule } from './styleTypes';
import type { MatchTarget } from './selectors';
import { nestedWrappersOf, wrapperProbes } from './queryReach';
import { hasCanvas, queryCanvas } from '../../../editor/canvasQuery';


export const STATE_PSEUDO_NAMES = [
  'focus-visible',
  'focus-within',
  'focus',
  'hover',
  'active',
  'visited',
  'target',
  'checked',
  'indeterminate',
  'default',
  'disabled',
  'enabled',
  'placeholder-shown',
  'autofill',
  'user-invalid',
  'user-valid',
  'read-only',
  'read-write',
  'open',
] as const;
export const STATE_PSEUDO_RE = new RegExp(`:(?:${STATE_PSEUDO_NAMES.join('|')})(?![\\w-])`, 'g');
export const PSEUDO_ELEMENT_NAMES = [
  'before',
  'after',
  'first-line',
  'first-letter',
  'selection',
  'placeholder',
  'marker',
  'backdrop',
  'file-selector-button',
] as const;
export const PSEUDO_ELEMENT_RE = new RegExp(`::?(?:${PSEUDO_ELEMENT_NAMES.join('|')})(?![\\w-])|::(?:part|slotted)\\([^)]*\\)`, 'g');

export function askableForm(text: string): string | undefined {
  const bare = text.replace(PSEUDO_ELEMENT_RE, standIn).replace(STATE_PSEUDO_RE, standIn).trim();
  if (!bare || /[>+~]\s*$/.test(bare) || bare.startsWith('>')) {
    return undefined;
  }
  if (bare.replace(/[\s*>+~]/g, '') === '') {
    return undefined;
  }
  return bare;
}

function standIn(match: string, offset: number, whole: string): string {
  assert(whole.slice(offset, offset + match.length) === match, 'A stand-in replaces what it matched');
  const before = offset === 0 ? '' : (whole[offset - 1] ?? '');
  const after = whole[offset + match.length] ?? '';
  const startsCompound = before === '' || /[\s>+~(,]/.test(before);
  const endsCompound = after === '' || /[\s>+~),:]/.test(after);
  return startsCompound && endsCompound ? '*' : '';
}

export function askableSelectors(rules: ParsedRule[]): Map<string, string[]> {
  const askedFor = new Map<string, string[]>();
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      const ask = askableForm(selector.text);
      if (!ask) {
        continue;
      }
      addAsked(askedFor, ask, selector.text);
    }
  }
  for (const wrapper of nestedWrappersOf(rules)) {
    for (const probe of wrapperProbes(wrapper)) {
      const ask = askableForm(probe);
      if (ask !== undefined) {
        addAsked(askedFor, ask, probe);
      }
    }
  }
  return askedFor;
}

function addAsked(askedFor: Map<string, string[]>, ask: string, text: string): void {
  const list = askedFor.get(ask);
  if (list) {
    list.push(text);
  } else {
    askedFor.set(ask, [text]);
  }
}

export type CanvasIdentity = {
  tag: string;
  id?: string | undefined;
  classes: string[];
  attributes: Record<string, string>;
};
export type CanvasAsk =
  | { readonly kind: 'unasked' }
  | {
      readonly kind: 'asked';
      readonly answer:
        | {
            readonly identity: CanvasIdentity | undefined;
            readonly matched: Readonly<Record<string, boolean>>;
          }
        | undefined;
      readonly askedFor: Map<string, string[]>;
    };

export function canvasIdentityOf(identity: CanvasAnswer['identity']): CanvasIdentity | undefined {
  if (identity === undefined) {
    return undefined;
  }
  const { id, ...rest } = identity;
  return id === undefined ? rest : { ...rest, id };
}

export function matchedAnswers(matched: CanvasAnswer['matched']): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [selector, hit] of Object.entries(matched)) {
    if (typeof hit === 'boolean') {
      out[selector] = hit;
    }
  }
  return out;
}

export async function askCanvasAbout(rootKey: string, rules: ParsedRule[]): Promise<CanvasAsk> {
  const path = getHost().pathOf?.(rootKey);
  if (!path || !hasCanvas()) {
    return { kind: 'unasked' };
  }
  const askedFor = askableSelectors(rules);
  const answer = await queryCanvas(path, [...askedFor.keys()]);
  return {
    kind: 'asked',
    answer:
      answer === undefined
        ? undefined
        : {
            identity: canvasIdentityOf(answer.identity),
            matched: matchedAnswers(answer.matched),
          },
    askedFor,
  };
}

export async function primeDomMatches(
  target: MatchTarget,
  rules: ParsedRule[],
  asked?: CanvasAsk,
): Promise<void> {
  const ask = asked ?? (await askCanvasAbout(target.rootKey, rules));
  if (ask.kind === 'unasked') {
    return;
  }
  if (!ask.answer) {
    return;
  }
  const matched = new Map<string, boolean>();
  for (const [text, hit] of matchedTexts(ask)) {
    matched.set(text, hit);
  }
  // eslint-disable-next-line no-param-reassign -- fills the matcher's cache slot by design
  target.domMatched = matched;
}

export function* matchedTexts(ask: Extract<CanvasAsk, { kind: 'asked' }>): Generator<[string, boolean]> {
  for (const [selector, texts] of ask.askedFor) {
    const hit = ask.answer?.matched[selector];
    if (typeof hit !== 'boolean') {
      continue;
    }
    for (const text of texts) {
      yield [text, hit];
    }
  }
}
