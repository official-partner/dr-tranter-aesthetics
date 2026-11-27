
import { assert } from '../../../../shared/core/assert';
import type { CascadeOrigin, CascadeProperty } from '../../../../shared/properties/cascadeOrigin';
import { compareCascade } from './cascade';
import { explainLoss } from './cascadeResolve';
import type { Contributor, ResolvedProp, ResolvedStyle } from './resolved';
import { selectorListMembers } from './selectors';

export type TruthVerdict = 'confirmed' | 'corrected' | 'unlisted';

export function normalizeSelectorText(text: string): string {
  return text
    .replace(/['"]/g, '')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function sameSelector(listed: string, browser: string): boolean {
  const wanted = normalizeSelectorText(listed);
  return selectorListMembers(browser).some((member) => normalizeSelectorText(member.text) === wanted) || normalizeSelectorText(browser) === wanted;
}

const ZERO_LENGTH = /^[+-]?0*\.?0+(?:px|rem|em|%|vw|vh|ch|ex|pt)?$/;

export function sameDeclaredValue(left: string, right: string): boolean {
  const clean = (value: string) =>
    value
      .replace(/!important/gi, '')
      .replace(/;\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(^|\s)0(?:\.0+)?(?:px|rem|em|%)(?=\s|$)/g, '$10');
  const first = clean(left);
  const second = clean(right);
  if (first === second) {
    return true;
  }
  return ZERO_LENGTH.test(first) && ZERO_LENGTH.test(second);
}

function explains(contributor: Contributor, origin: CascadeOrigin): boolean {
  if (contributor.important !== origin.important) {
    return false;
  }
  if (!sameDeclaredValue(contributor.value, origin.value)) {
    return false;
  }
  if (origin.selector === 'style') {
    return contributor.origin === 'inline';
  }
  return contributor.origin === 'embed' && sameSelector(contributor.selectorText, origin.selector);
}

function mapCandidates(contributors: readonly Contributor[], candidates: readonly CascadeOrigin[]): Map<CascadeOrigin, Contributor> {
  const taken = new Set<Contributor>();
  const mapped = new Map<CascadeOrigin, Contributor>();
  for (const candidate of candidates) {
    const match = [...contributors]
      .sort((left, right) => left.order - right.order)
      .find((contributor) => !taken.has(contributor) && explains(contributor, candidate));
    if (match !== undefined) {
      taken.add(match);
      mapped.set(candidate, match);
    }
  }
  assert(mapped.size <= candidates.length, 'mapCandidates: no candidate maps twice');
  return mapped;
}

function describeConditions(origin: CascadeOrigin): string | undefined {
  return origin.conditions.length === 0 ? undefined : origin.conditions.join(' › ');
}

function usedValueContributor(prop: string, truth: CascadeProperty): Contributor {
  const origin = truth.winner;
  const condition = origin === undefined ? undefined : describeConditions(origin);
  return {
    selectorText: origin?.selector ?? '',
    ...(condition === undefined ? {} : { display: condition }),
    value: truth.used,
    important: origin?.important ?? false,
    specificity: [0, 0, 0],
    order: Number.MAX_SAFE_INTEGER,
    ruleId: `browser:${prop}`,
    origin: 'browser',
    isSelected: false,
    winning: true,
    complexOnly: false,
  };
}

function settle(prop: string, resolved: ResolvedProp, truth: CascadeProperty): { readonly next: ResolvedProp; readonly verdict: TruthVerdict } {
  const browserWinner = truth.winner;
  if (browserWinner === undefined) {
    return { next: resolved, verdict: 'confirmed' };
  }
  const mapped = mapCandidates(resolved.contributors, truth.candidates);
  const crowned = mapped.get(browserWinner) ?? resolved.contributors.find((contributor) => explains(contributor, browserWinner));
  if (crowned === undefined) {
    if (sameDeclaredValue(resolved.winner.value, browserWinner.value) && resolved.winner.important === browserWinner.important) {
      return { next: resolved, verdict: 'confirmed' };
    }
    const used = usedValueContributor(prop, truth);
    const losers = resolved.contributors.map((contributor) => ({ ...contributor, winning: false, lossReason: 'other' as const }));
    const contributors = [used, ...losers];
    return { next: { ...resolved, winner: used, overridden: resolved.selectedValue !== undefined, contributors }, verdict: 'unlisted' };
  }
  const ordered = resolved.contributors.map((contributor) => {
    const hit = [...mapped.entries()].find(([, listed]) => listed === contributor);
    return hit === undefined ? { ...contributor } : { ...contributor, order: hit[0].order };
  });
  const winner = ordered.find(
    (contributor) => contributor.ruleId === crowned.ruleId && contributor.origin === crowned.origin && contributor.selectorText === crowned.selectorText,
  );
  assert(winner !== undefined, 'settle: the crowned rule is among the contributors');
  const rest = ordered.filter((contributor) => contributor !== winner).sort((left, right) => compareCascade(left, right, left.order, right.order));
  const contributors = [
    { ...winner, winning: true },
    ...rest.map((contributor) => ({ ...contributor, winning: false, lossReason: explainLoss({ ...contributor }, { ...winner }) ?? ('other' as const) })),
  ];
  const first = contributors[0];
  assert(first !== undefined, 'settle: the winner leads');
  const editing = contributors.find((contributor) => contributor.editing === true);
  const verdict: TruthVerdict = first.ruleId === resolved.winner.ruleId && first.selectorText === resolved.winner.selectorText ? 'confirmed' : 'corrected';
  return { next: { ...resolved, winner: first, overridden: editing !== undefined && editing.ruleId !== first.ruleId, contributors }, verdict };
}

export function applyCascadeTruth(resolved: ResolvedStyle, truth: ReadonlyMap<string, CascadeProperty>): ResolvedStyle {
  if (truth.size === 0) {
    return resolved;
  }
  const props = new Map(resolved.props);
  let changed = false;
  for (const [prop, answer] of truth) {
    const current = props.get(prop);
    if (current !== undefined) {
      const { next } = settle(prop, current, answer);
      if (next !== current) {
        props.set(prop, next);
        changed = true;
      }
    }
  }
  assert(props.size === resolved.props.size, 'applyCascadeTruth: no property appears or vanishes');
  return changed ? { ...resolved, props } : resolved;
}
