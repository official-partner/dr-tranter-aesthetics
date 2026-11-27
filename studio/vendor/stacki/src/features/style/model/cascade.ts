
import type { LayerPosition } from './cascadeLayers';
import { compareCandidates, type CascadeCandidate } from './cascadeResolve';
import { canonicalCompound, compareSpecificity, matchSelectorList, type MatchTarget } from './selectors';
import { spacingSides } from './spacingShorthand';
import type { ParsedRule, SelectorInfo, Specificity } from './styleTypes';
import { assert } from '../../../../shared/core/assert';

export type RuleKind = 'base' | 'pseudo-class' | 'pseudo-element' | 'at-rule';

const VIEW_STATES = new Set([':hover', ':focus', ':active']);
function subjectHasState(text: string): boolean {
  return canonicalCompound(text).pseudoClasses.some((pseudo) => VIEW_STATES.has(pseudo));
}

export type DeclStatus = {
  winning: boolean;
  overriddenBy: string | undefined;
};

export type MatchedRule = {
  rule: ParsedRule;
  matchedSelectors: SelectorInfo[];
  kind: RuleKind;
  conditional: boolean;
  label: string;
  declStatus: Record<string, DeclStatus>;
};

export type RuleModel = {
  base: MatchedRule[];
  conditional: MatchedRule[];
  matchedRuleCount: number;
};

type Hit = {
  rule: ParsedRule;
  matchedSelectors: SelectorInfo[];
  strongestBase: { selector: SelectorInfo; specificity: Specificity } | undefined;
  conditional: boolean;
  kind: RuleKind;
  label: string;
};

export function compareCascade(left: Omit<CascadeCandidate, 'order'>, right: Omit<CascadeCandidate, 'order'>, leftOrder: number, rightOrder: number): number {
  return compareCandidates({ ...left, order: leftOrder }, { ...right, order: rightOrder });
}

function strongestOf(selectors: SelectorInfo[]): { selector: SelectorInfo; specificity: Specificity } | undefined {
  let best: { selector: SelectorInfo; specificity: Specificity } | undefined;
  for (const selector of selectors) {
    if (!best || compareSpecificity(selector.specificity, best.specificity) > 0) {
      best = { selector, specificity: selector.specificity };
    }
  }
  return best;
}

export async function computeRuleModel(rules: ParsedRule[], target: MatchTarget): Promise<RuleModel> {
  const hits: Hit[] = [];
  for (const rule of rules) {
    const results = await matchSelectorList(rule.selectorText, target);
    const matchedSelectors = rule.selectors.filter((_, index) => results[index]?.matched);
    if (matchedSelectors.length) {
      hits.push(classifyHit(rule, matchedSelectors));
    }
  }

  const winners = cascadeWinners(hits);
  const base: MatchedRule[] = [];
  const conditional: MatchedRule[] = [];
  for (const hit of hits) {
    const matched: MatchedRule = {
      rule: hit.rule,
      matchedSelectors: hit.matchedSelectors,
      kind: hit.kind,
      conditional: hit.conditional,
      label: hit.label,
      declStatus: declStatusOf(hit, winners),
    };
    (hit.conditional ? conditional : base).push(matched);
  }

  base.sort((left, right) => left.rule.order - right.rule.order);
  conditional.sort((left, right) => left.rule.order - right.rule.order);
  assert(base.length + conditional.length === hits.length, 'Every hit lands in one bucket');
  return { base, conditional, matchedRuleCount: hits.length };
}

function classifyHit(rule: ParsedRule, matchedSelectors: SelectorInfo[]): Hit {
  assert(matchedSelectors.length > 0, 'classifyHit: a hit matched at least one selector');
  const selectorText = matchedSelectors.map((selector) => selector.text).join(', ');
  const hit = { rule, matchedSelectors, strongestBase: undefined };
  if (rule.atContext.length > 0) {
    const label = `${rule.atContext.join(' › ')} ${selectorText}`;
    return { ...hit, conditional: true, kind: 'at-rule', label };
  }
  const baseSelectors = matchedSelectors.filter((selector) => !subjectHasState(selector.text) && selector.pseudoElement === undefined);
  if (baseSelectors.length) {
    const strongestBase = strongestOf(baseSelectors);
    return { ...hit, strongestBase, conditional: false, kind: 'base', label: selectorText };
  }
  const kind = matchedSelectors.some((selector) => selector.pseudoElement !== undefined) ? 'pseudo-element' : 'pseudo-class';
  return { ...hit, conditional: true, kind, label: selectorText };
}

type Contribution = {
  declId: string;
  prop: string;
  important: boolean;
  layer: LayerPosition | undefined;
  specificity: Specificity;
  seq: number;
  selectorText: string;
};
type Winner = { declId: string; selectorText: string };

function cascadeWinners(hits: readonly Hit[]): Map<string, Winner> {
  const contributions: Contribution[] = [];
  let seq = 0;
  for (const hit of hits) {
    if (hit.conditional || !hit.strongestBase) {
      continue;
    }
    for (const decl of hit.rule.declarations) {
      const props = [decl.prop, ...spacingSides(decl.prop, decl.value).keys()];
      const order = seq++;
      for (const prop of props) {
        contributions.push({
          declId: decl.declId,
          prop,
          important: decl.important,
          layer: hit.rule.layer,
          specificity: hit.strongestBase.specificity,
          seq: order,
          selectorText: hit.strongestBase.selector.text,
        });
      }
    }
  }

  const winners = new Map<string, Winner>();
  const byProp = new Map<string, Contribution[]>();
  contributions.forEach((contribution) => {
    const list = byProp.get(contribution.prop) ?? [];
    list.push(contribution);
    byProp.set(contribution.prop, list);
  });
  byProp.forEach((list, prop) => {
    const winner = [...list].sort((left, right) => compareCascade(left, right, left.seq, right.seq))[0];
    if (winner === undefined) {
      throw new Error(`Cascade invariant failed: ${prop} has no contributions`);
    }
    winners.set(prop, { declId: winner.declId, selectorText: winner.selectorText });
  });
  assert(winners.size === byProp.size, 'One winner per contested property');
  return winners;
}

function declStatusOf(hit: Hit, winners: ReadonlyMap<string, Winner>): Record<string, DeclStatus> {
  const declStatus: Record<string, DeclStatus> = {};
  for (const decl of hit.rule.declarations) {
    if (hit.conditional) {
      declStatus[decl.declId] = { winning: true, overriddenBy: undefined };
      continue;
    }
    const winner = winners.get(decl.prop);
    declStatus[decl.declId] =
      winner && winner.declId === decl.declId
        ? { winning: true, overriddenBy: undefined }
        : { winning: false, overriddenBy: winner ? winner.selectorText : undefined };
  }
  return declStatus;
}
