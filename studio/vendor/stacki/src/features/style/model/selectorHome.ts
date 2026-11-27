
import { assert } from '../../../../shared/core/assert';
import { selectorKey } from './resolved';
import { canonicalCompound } from './selectorParse';

export interface HomeRule {
  readonly embedKey: string;
  readonly order: number;
  readonly context: string;
  readonly selectorTexts: readonly string[];
}

const MATCH_PART = 1;
const MATCH_EXACT = 2;

interface Candidate {
  readonly embedKey: string;
  readonly order: number;
  readonly match: number;
  readonly specificity: number;
}

export function selectorHomeKey(rules: readonly HomeRule[], context: string, activeSelector: string): string | undefined {
  assert(activeSelector.length >= 0, 'selectorHomeKey: a selector text');
  const active = canonicalCompound(activeSelector);
  const activeTokens = new Set(active.tokens);
  const activeKey = selectorKey(activeSelector);
  const here: Candidate[] = [];
  const elsewhere: Candidate[] = [];
  for (const rule of rules) {
    const best = bestMatch(rule, activeKey, active, activeTokens);
    if (best === undefined) {
      continue;
    }
    (rule.context === context ? here : elsewhere).push({ embedKey: rule.embedKey, order: rule.order, ...best });
  }
  if (here.length > 0) {
    return here.reduce((left, right) => (outranks(right, left) ? right : left)).embedKey;
  }
  if (elsewhere.length === 0) {
    return undefined;
  }
  const exactFirst = elsewhere.filter((candidate) => candidate.match === MATCH_EXACT);
  const pool = exactFirst.length > 0 ? exactFirst : elsewhere;
  return pool.reduce((left, right) => (right.order < left.order ? right : left)).embedKey;
}

function outranks(candidate: Candidate, current: Candidate): boolean {
  if (candidate.match !== current.match) {
    return candidate.match > current.match;
  }
  if (candidate.specificity !== current.specificity) {
    return candidate.specificity > current.specificity;
  }
  return candidate.order > current.order;
}

function bestMatch(
  rule: HomeRule,
  activeKey: string,
  active: ReturnType<typeof canonicalCompound>,
  activeTokens: ReadonlySet<string>,
): Pick<Candidate, 'match' | 'specificity'> | undefined {
  let best: Pick<Candidate, 'match' | 'specificity'> | undefined;
  for (const text of rule.selectorTexts) {
    if (selectorKey(text) === activeKey) {
      return { match: MATCH_EXACT, specificity: active.tokens.length };
    }
    const part = canonicalCompound(text);
    if (!part.oneCompound || !active.oneCompound || part.tokens.every((token) => token.startsWith('tag:'))) {
      continue;
    }
    if (part.pseudoElement !== active.pseudoElement || part.pseudoClasses.join() !== active.pseudoClasses.join()) {
      continue;
    }
    if (!part.tokens.every((token) => activeTokens.has(token))) {
      continue;
    }
    if (best === undefined || part.tokens.length > best.specificity) {
      best = { match: MATCH_PART, specificity: part.tokens.length };
    }
  }
  return best;
}

export interface ManualSourcePick {
  readonly selectionKey: string;
  readonly sourceKey: string;
}

export interface SourceFollowInput {
  readonly selectionKey: string;
  readonly homeKey: string | undefined;
  readonly manualPick: ManualSourcePick | undefined;
}

export type SourceFollow =
  | { readonly kind: 'keep'; readonly manualPick: ManualSourcePick | undefined }
  | { readonly kind: 'move'; readonly sourceKey: string; readonly manualPick: undefined };

export function followSource(input: SourceFollowInput): SourceFollow {
  const { homeKey, manualPick, selectionKey } = input;
  if (manualPick !== undefined && manualPick.selectionKey === selectionKey) {
    return { kind: 'keep', manualPick };
  }
  if (homeKey === undefined) {
    return { kind: 'keep', manualPick: undefined };
  }
  return { kind: 'move', sourceKey: homeKey, manualPick: undefined };
}
