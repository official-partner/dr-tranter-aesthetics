
import { compareCascade } from './cascade';
import type { LayerPosition } from './cascadeLayers';
import type { LossKind } from './cascadeResolve';
import type { MatchedRule, RuleModel } from './cascade';
import { assert } from '../../../../shared/core/assert';
import {
  canonicalCompound,
  compareSpecificity,
  normalizePseudoElement,
  parseSelectorList,
  selectorLayerOf,
  selectorListLayers,
  type SelectorLayer,
} from './selectors';
import { spacingSides } from './spacingShorthand';
import type { BreakpointId, ParsedRule, Specificity } from './styleTypes';
import type { InlineDeclaration } from '../../../../shared/engine/inlineStyle';
import { INLINE_STYLE_LABEL, INLINE_STYLE_SELECTOR } from './inlineTarget';
import { queryContextImplies } from './queryWidth';

export type ContextKey = string;
export type StateKey = '' | ':hover' | ':focus' | ':active';

export type SourceKey = 'embed' | 'native';

export type ContributorOrigin = SourceKey | 'inline' | 'browser';

export type InlineResolveInput = {
  readonly declarations: readonly InlineDeclaration[];
  readonly selected: boolean;
};

export type StyleContext = {
  key: string;
  label: string;
  breakpoint: BreakpointId | undefined;
  embedAtContext: string | undefined;
  wrapper?: string;
  source?: string;
};

export type NativeContribution = {
  styleIndex: number;
  className: string;
  selector: string;
  prop: string;
  value: string;
  isVariable: boolean;
  classDepth: number;
  bpTier: number;
  atState: boolean;
};

export type PanelLayer = SelectorLayer | 'every';

export const STATES: readonly StateKey[] = ['', ':hover', ':focus', ':active'];
const INTERACTION_STATES = new Set<string>([':hover', ':focus', ':active']);

function isStateKey(value: string): value is Exclude<StateKey, ''> {
  return INTERACTION_STATES.has(value);
}

const NATIVE_ORDER_BASE = -1_000_000;

export type NativeResolveInput = {
  source: SourceKey;
  contribs: NativeContribution[];
  selectedIndex: number | undefined;
  selectedEmbedKey?: string | undefined;
  currentTier?: number;
  pseudoLayer?: string | undefined;
};

export type Contributor = {
  selectorText: string;
  display?: string;
  value: string;
  important: boolean;
  specificity: Specificity;
  order: number;
  ruleId: string;
  origin: ContributorOrigin;
  styleIndex?: number;
  bpTier?: number;
  atState?: boolean;
  embedKey?: string;
  embedLabel?: string;
  fromComponent?: boolean;
  isSelected: boolean;
  editing?: boolean;
  winning: boolean;
  complexOnly: boolean;
  layer?: LayerPosition | undefined;
  inline?: boolean;
  lossReason?: LossKind;
};

export type ResolvedProp = {
  prop: string;
  source: 'selected' | 'other';
  selectedOrigin?: ContributorOrigin;
  selectedValue?: { value: string; important: boolean };
  winner: Contributor;
  overridden: boolean;
  contributors: Contributor[];
};

export type ResolvedStyle = {
  props: Map<string, ResolvedProp>;
  selectedRule: ParsedRule | undefined;
  selectedRules: ReadonlyMap<string, ParsedRule>;
  contexts: ContextKey[];
  states: readonly StateKey[];
};

export function contextKeyOf(rule: ParsedRule): ContextKey {
  return rule.atContext.length ? rule.atContext.join(' › ') : '';
}

function stateOf(pseudoClasses: string[]): StateKey {
  for (const pseudo of pseudoClasses) {
    if (isStateKey(pseudo)) {
      return pseudo;
    }
  }
  return '';
}

export type ContextInfo = {
  key: ContextKey;
  hasStyles: boolean;
  styledCombos: string[][];
  bestTokens: string[] | undefined;
  wrapper?: string;
  querySelectors?: readonly string[];
};

export function indexContexts(model: RuleModel, contextKeys: ContextKey[], layer: PanelLayer = ''): ContextInfo[] {
  const all = [...model.base, ...model.conditional];
  return contextKeys.map((key) => {
    let hasStyles = false;
    const combos: Array<{ tokens: string[]; specificity: Specificity }> = [];
    for (const matched of all) {
      if (contextKeyOf(matched.rule) !== key) {
        continue;
      }
      if (matched.rule.declarations.length === 0) {
        continue;
      }
      if (!ruleOnLayer(matched, layer)) {
        continue;
      }
      hasStyles = true;
      for (const selector of matched.matchedSelectors) {
        if (selector.pseudoElement !== undefined) {
          continue;
        }
        const canon = canonicalCompound(selector.text);
        if (!canon.simple) {
          continue;
        }
        combos.push({ tokens: canon.tokens, specificity: selector.specificity });
      }
    }
    combos.sort((left, right) => compareSpecificity(right.specificity, left.specificity));
    const seen = new Set<string>();
    const styledCombos: string[][] = [];
    for (const combo of combos) {
      const id = [...combo.tokens].sort().join('|');
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      styledCombos.push(combo.tokens);
    }
    return { key, hasStyles, styledCombos, bestTokens: styledCombos[0] };
  });
}

export function ruleOnLayer(matched: Pick<MatchedRule, 'matchedSelectors'>, layer: PanelLayer): boolean {
  return layer === 'every' || matched.matchedSelectors.some((selector) => selectorLayerOf(selector.pseudoElement) === layer);
}

export type MatchedSelector = {
  text: string;
  specificity: Specificity;
  state: StateKey;
  simple: boolean;
  fromComponent: boolean;
  inComponentMarkup?: boolean;
  fromInstance?: boolean;
  key: string;
  layer?: SelectorLayer;
  pending?: boolean;
  inContext?: boolean;
  order?: number;
  display?: string;
  queryDisplay?: string;
};

type MatchedSelectorCandidate = Omit<MatchedSelector, 'key' | 'order'>;

function listMatchedSelectorsCandidate(input: {
  readonly rule: ParsedRule;
  readonly text: string;
  readonly specificity: Specificity;
  readonly state: StateKey;
  readonly simple: boolean;
  readonly inContext: boolean;
  readonly layer: SelectorLayer;
  readonly member?: boolean;
}): MatchedSelectorCandidate {
  const display = input.member === true ? undefined : input.rule.nestedDisplay;
  const queryDisplay = input.member === true ? undefined : input.rule.queryDisplay;
  return {
    text: input.text,
    layer: input.layer,
    specificity: input.specificity,
    state: input.state,
    simple: input.simple,
    inContext: input.inContext,
    fromComponent: input.rule.fromComponent,
    ...(display === undefined ? {} : { display }),
    ...(queryDisplay === undefined ? {} : { queryDisplay }),
  };
}

const normalizeSelectorText = (text: string) =>
  text
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

export function selectorKey(text: string): string {
  const canon = canonicalCompound(text);
  const state = stateOf(canon.pseudoClasses);
  if (canon.simple) {
    return `s:${[...canon.tokens].sort().join('&')}|${state}`;
  }
  return `c:${normalizeSelectorText(text)}`;
}

export function selectorsMatch(left: string, right: string): boolean {
  return selectorKey(left) === selectorKey(right);
}

export function chipLayer(chip: Pick<MatchedSelector, 'layer' | 'text'>): SelectorLayer {
  return chip.layer ?? selectorListLayers(chip.text)[0] ?? '';
}

export function stateForSelector(text: string): StateKey {
  return stateOf(canonicalCompound(text).pseudoClasses);
}

export function listMatchedSelectors(model: RuleModel, context: ContextKey): MatchedSelector[] {
  const all = [...model.base, ...model.conditional];
  const byKey = new Map<string, MatchedSelector>();
  let order = 0;
  for (const matched of all) {
    if (matched.rule.declarations.length === 0) {
      continue;
    }
    const inContext = contextKeyOf(matched.rule) === context;
    for (const chip of chipsForRule(matched, { inContext })) {
      const key = selectorKey(chip.text);
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, { ...chip, key, order: order++ });
        continue;
      }
      if (chip.inContext) {
        existing.inContext = true;
        if (chip.queryDisplay) {
          existing.queryDisplay = chip.queryDisplay;
        }
      }
      if (chip.fromComponent) {
        existing.fromComponent = true;
      }
    }
  }
  assert(order === byKey.size, 'listMatchedSelectors: one order rank per chip');
  return [...byKey.values()].sort((left, right) => compareSpecificity(left.specificity, right.specificity) || left.text.localeCompare(right.text));
}

function chipsForRule(matched: MatchedRule, options: { readonly inContext: boolean }): MatchedSelectorCandidate[] {
  const { inContext } = options;
  const layers = new Set(matched.matchedSelectors.map((selector) => selectorLayerOf(selector.pseudoElement)));
  if (layers.size > 1) {
    return chipsForMixedRule(matched, options);
  }
  const [layer = ''] = layers;
  const chips: MatchedSelectorCandidate[] = [];
  let complexSpec: Specificity | undefined;
  for (const selector of matched.matchedSelectors) {
    const canon = canonicalCompound(selector.text);
    if (isBareSelector(canon)) {
      continue;
    }
    if (canon.splittable) {
      chips.push(
        listMatchedSelectorsCandidate({
          rule: matched.rule,
          text: selector.text,
          simple: canon.simple,
          state: stateOf(canon.pseudoClasses),
          specificity: selector.specificity,
          inContext,
          layer,
        }),
      );
    } else if (!complexSpec || compareSpecificity(selector.specificity, complexSpec) > 0) {
      complexSpec = selector.specificity;
    }
  }
  if (complexSpec) {
    const canon = canonicalCompound(matched.rule.selectorText);
    chips.push(
      listMatchedSelectorsCandidate({
        rule: matched.rule,
        text: matched.rule.selectorText,
        simple: false,
        state: stateOf(canon.pseudoClasses),
        specificity: complexSpec,
        inContext,
        layer,
      }),
    );
  }
  return chips;
}

function chipsForMixedRule(matched: MatchedRule, options: { readonly inContext: boolean }): MatchedSelectorCandidate[] {
  const chips = matched.matchedSelectors.flatMap((selector) => {
    const canon = canonicalCompound(selector.text);
    if (isBareSelector(canon)) {
      return [];
    }
    return [
      listMatchedSelectorsCandidate({
        rule: matched.rule,
        text: selector.text,
        simple: canon.simple,
        state: stateOf(canon.pseudoClasses),
        specificity: selector.specificity,
        inContext: options.inContext,
        layer: selectorLayerOf(selector.pseudoElement),
        member: true,
      }),
    ];
  });
  assert(chips.length <= matched.matchedSelectors.length, 'chipsForMixedRule: at most one chip per member');
  return chips;
}

export function groupMemberToSplit(
  rule: Pick<ParsedRule, 'selectors'> & { readonly node: { readonly selectors?: readonly string[] } },
  active: string,
): number | undefined {
  const written = rule.node.selectors;
  if (written === undefined || written.length <= 1 || active.length === 0) {
    return undefined;
  }
  const splittable = written.findIndex((selector) => selectorsMatch(selector, active) && canonicalCompound(selector).splittable);
  if (splittable >= 0) {
    return splittable;
  }
  const layers = new Set(rule.selectors.map((selector) => selectorLayerOf(selector.pseudoElement)));
  const member = rule.selectors.findIndex((selector) => selectorsMatch(selector.text, active));
  if (layers.size < 2 || member < 0 || rule.selectors.length % written.length !== 0) {
    return undefined;
  }
  const index = member % written.length;
  assert(index < written.length, 'groupMemberToSplit: the member is one of the written ones');
  return index;
}

function isBareSelector(canon: ReturnType<typeof canonicalCompound>): boolean {
  if (canon.pseudoElement && canon.oneCompound && canon.tokens.length === 0 && !canon.functional) {
    return true;
  }
  return canon.universal && canon.oneCompound && canon.tokens.length === 0 && !canon.pseudoElement && canon.pseudoClasses.length === 0;
}

export function resolveStyle(
  model: RuleModel,
  context: ContextKey,
  activeSelector: string,
  native?: NativeResolveInput,
  inline?: InlineResolveInput,
): ResolvedStyle {
  const all = [...model.base, ...model.conditional];

  const activePseudo = activePseudoOf(activeSelector, native?.pseudoLayer);
  const view: ResolveView = {
    context,
    activeSelector,
    state: stateOfMember(activeSelector, activePseudo),
    activePseudo,
  };

  const byProp = new Map<string, Contributor[]>();
  const selectedRules = new Map<string, ParsedRule>();
  let selectedRule: ParsedRule | undefined;
  for (const matched of all) {
    const folded = foldEmbedRule(matched, view);
    if (folded === undefined) {
      continue;
    }
    if (folded.isSelected) {
      selectedRules.set(matched.rule.ruleId, matched.rule);
      if (selectedRule === undefined || matched.rule.order > selectedRule.order) {
        selectedRule = matched.rule;
      }
    }
    for (const contributor of folded.contributors) {
      const list = byProp.get(contributor.prop) ?? [];
      list.push(contributor.contributor);
      byProp.set(contributor.prop, list);
    }
  }

  for (const contribution of view.activePseudo ? [] : (native?.contribs ?? [])) {
    const list = byProp.get(contribution.prop) ?? [];
    list.push(nativeContributor(contribution));
    byProp.set(contribution.prop, list);
  }

  for (const [prop, contributor] of view.activePseudo ? [] : inlineContributors(inline)) {
    const list = byProp.get(prop) ?? [];
    list.push(contributor);
    byProp.set(prop, list);
  }

  const props = new Map<string, ResolvedProp>();
  byProp.forEach((list, prop) => {
    props.set(prop, resolveProp(prop, list, native));
  });
  assert(props.size === byProp.size, 'resolveStyle: one resolved entry per property');
  assert(selectedRule === undefined || selectedRules.has(selectedRule.ruleId), 'resolveStyle: the selected rule is one of the picked selector’s rules');
  return { props, selectedRule, selectedRules, contexts: contextsOf(all), states: STATES };
}

export function selectedRulesSetting(resolved: ResolvedStyle, prop: string): ParsedRule[] {
  const contributors = resolved.props.get(prop)?.contributors ?? [];
  const rules = contributors.flatMap((contributor) => {
    if (contributor.origin !== 'embed' || !contributor.isSelected) {
      return [];
    }
    const rule = resolved.selectedRules.get(contributor.ruleId);
    assert(rule !== undefined, 'selectedRulesSetting: a selected value comes from a picked rule');
    return [rule];
  });
  assert(rules.length <= resolved.selectedRules.size, 'selectedRulesSetting: rules are picked');
  return rules;
}

export function editableRuleFor(resolved: ResolvedStyle, prop: string): ParsedRule | undefined {
  const shown = resolved.props.get(prop);
  const setHere = shown?.contributors.find((contributor) => contributor.origin === 'embed' && contributor.editing === true);
  if (setHere === undefined) {
    return resolved.selectedRule;
  }
  const rule = resolved.selectedRules.get(setHere.ruleId);
  assert(rule !== undefined, 'editableRuleFor: the edited value comes from a picked rule');
  assert(rule.ruleId === setHere.ruleId, 'editableRuleFor: the rule is the one named');
  return rule;
}

function activePseudoOf(activeSelector: string, pseudoLayer: string | undefined): string {
  const members = parseSelectorList(activeSelector).map((selector) => normalizePseudoElement(selector.pseudoElement));
  const named = members.filter((member) => member !== '');
  if (pseudoLayer !== undefined && pseudoLayer !== '') {
    return named.includes(pseudoLayer) ? pseudoLayer : (named[0] ?? pseudoLayer);
  }
  return members.includes('') ? '' : (named[0] ?? '');
}

function stateOfMember(activeSelector: string, activePseudo: string): StateKey {
  const members = parseSelectorList(activeSelector);
  const member = members.find((selector) => normalizePseudoElement(selector.pseudoElement) === activePseudo) ?? members[0];
  return stateOf(canonicalCompound(member?.text ?? activeSelector).pseudoClasses);
}

type ResolveView = {
  readonly context: ContextKey;
  readonly activeSelector: string;
  readonly state: StateKey;
  readonly activePseudo: string;
};

function contextsOf(all: readonly MatchedRule[]): ContextKey[] {
  const contexts: ContextKey[] = [];
  for (const matched of all) {
    const key = contextKeyOf(matched.rule);
    if (!contexts.includes(key)) {
      contexts.push(key);
    }
  }
  contexts.sort((left, right) => (left === '' ? -1 : right === '' ? 1 : 0));
  return contexts;
}

type ViewSelector = { text: string; specificity: Specificity; simple: boolean; tokens: string[] };

function strongestInView(matched: MatchedRule, view: ResolveView): ViewSelector | undefined {
  let best: ViewSelector | undefined;
  for (const selector of matched.matchedSelectors) {
    if (normalizePseudoElement(selector.pseudoElement) !== view.activePseudo) {
      continue;
    }
    const canon = canonicalCompound(selector.text);
    const selectorState = stateOf(canon.pseudoClasses);
    if (selectorState !== '' && selectorState !== view.state) {
      continue;
    }
    if (!best || compareSpecificity(selector.specificity, best.specificity) > 0) {
      best = {
        text: selector.text,
        specificity: selector.specificity,
        simple: canon.simple,
        tokens: canon.tokens,
      };
    }
  }
  return best;
}

type FoldedRule = {
  readonly isSelected: boolean;
  readonly contributors: ReadonlyArray<{
    readonly prop: string;
    readonly contributor: Contributor;
  }>;
};

function foldEmbedRule(matched: MatchedRule, view: ResolveView): FoldedRule | undefined {
  const ruleContext = contextKeyOf(matched.rule);
  const atContext = ruleContext === view.context;
  const inherited = !atContext && queryContextImplies(view.context, ruleContext);
  if (!atContext && !inherited) {
    return undefined;
  }
  const winner = strongestInView(matched, view);
  if (!winner) {
    return undefined;
  }
  const isSelected = atContext && isSelectedRule(matched, view);

  const contributors = [...declaredByProp(matched.rule)].map(([prop, decl]) => ({
    prop,
    contributor: {
      selectorText: winner.text,
      ...(matched.rule.nestedDisplay === undefined ? {} : { display: matched.rule.nestedDisplay }),
      value: decl.value,
      important: decl.important,
      specificity: winner.specificity,
      order: matched.rule.order,
      ruleId: matched.rule.ruleId,
      origin: 'embed' as const,
      embedKey: matched.rule.embedKey,
      embedLabel: matched.rule.embedLabel,
      fromComponent: matched.rule.fromComponent,
      isSelected,
      winning: false,
      complexOnly: !winner.simple,
      ...(matched.rule.layer === undefined ? {} : { layer: matched.rule.layer }),
    },
  }));
  return { isSelected, contributors };
}

function declaredByProp(rule: ParsedRule): ReadonlyMap<string, Declared> {
  const declared = new Map<string, Declared>();
  const declare = (prop: string, value: Declared): void => {
    if (declared.get(prop)?.important === true && !value.important) {
      return;
    }
    declared.set(prop, value);
  };
  for (const decl of rule.declarations) {
    declare(decl.prop, { value: decl.value, important: decl.important });
    for (const [side, value] of spacingSides(decl.prop, decl.value)) {
      declare(side, { value, important: decl.important });
    }
  }
  assert(declared.size >= Math.min(rule.declarations.length, 1), 'declaredByProp: none dropped');
  return declared;
}

type Declared = { readonly value: string; readonly important: boolean };

function isSelectedRule(matched: MatchedRule, view: ResolveView): boolean {
  return (
    selectorsMatch(matched.rule.selectorText, view.activeSelector) ||
    matched.matchedSelectors.some(
      (selector) =>
        normalizePseudoElement(selector.pseudoElement) === view.activePseudo &&
        stateOf(canonicalCompound(selector.text).pseudoClasses) === view.state &&
        selectorsMatch(selector.text, view.activeSelector),
    )
  );
}

const INLINE_SPECIFICITY: Specificity = [1_000_000, 0, 0];
const INLINE_ORDER = Number.MAX_SAFE_INTEGER;

function inlineContributors(inline: InlineResolveInput | undefined): ReadonlyMap<string, Contributor> {
  const contributors = new Map<string, Contributor>();
  if (inline === undefined) {
    return contributors;
  }
  const declare = (prop: string, value: Declared): void => {
    if (contributors.get(prop)?.important === true && !value.important) {
      return;
    }
    contributors.set(prop, {
      selectorText: INLINE_STYLE_SELECTOR,
      display: INLINE_STYLE_LABEL,
      value: value.value,
      important: value.important,
      specificity: INLINE_SPECIFICITY,
      order: INLINE_ORDER,
      ruleId: `inline:${prop}`,
      origin: 'inline',
      isSelected: inline.selected,
      winning: false,
      complexOnly: false,
      inline: true,
    });
  };
  for (const declaration of inline.declarations) {
    declare(declaration.property, { value: declaration.value, important: declaration.important });
    for (const [side, value] of spacingSides(declaration.property, declaration.value)) {
      declare(side, { value, important: declaration.important });
    }
  }
  assert(contributors.size >= Math.min(inline.declarations.length, 1), 'inlineContributors: none dropped');
  return contributors;
}

function nativeContributor(contribution: NativeContribution): Contributor {
  return {
    selectorText: contribution.selector,
    value: contribution.value,
    important: false,
    specificity: [0, contribution.classDepth, 0],
    order: NATIVE_ORDER_BASE + contribution.bpTier * 1_000 + contribution.styleIndex,
    ruleId: `native:${contribution.styleIndex}:${contribution.bpTier}:` + `${contribution.atState ? 's' : 'b'}:${contribution.prop}`,
    origin: 'native',
    styleIndex: contribution.styleIndex,
    bpTier: contribution.bpTier,
    atState: contribution.atState,
    isSelected: false,
    winning: false,
    complexOnly: false,
  };
}

function resolveProp(prop: string, list: Contributor[], native: NativeResolveInput | undefined): ResolvedProp {
  const source = native?.source ?? 'embed';
  list.sort((left, right) => compareCascade(left, right, left.order, right.order));
  const winner = list[0];
  if (winner === undefined) {
    throw new Error(`Resolved style invariant failed: ${prop} has no contributors`);
  }
  winner.winning = true;
  const nativeSelected = list.find(
    (contribution) =>
      contribution.origin === 'native' &&
      contribution.styleIndex === native?.selectedIndex &&
      (native?.currentTier === undefined || contribution.bpTier === native.currentTier) &&
      contribution.atState !== false,
  );
  const embedSelected = list.find((contribution) => contribution.origin === 'embed' && contribution.isSelected);
  const inlineSelected = list.find((contribution) => contribution.origin === 'inline' && contribution.isSelected);
  const layerSelected = source === 'native' ? (nativeSelected ?? embedSelected) : embedSelected;
  const selected = inlineSelected ?? layerSelected;
  if (selected) {
    selected.editing = true;
  }
  return {
    prop,
    source: selected ? 'selected' : 'other',
    ...(selected === undefined ? {} : { selectedOrigin: selected.origin }),
    ...(selected === undefined ? {} : { selectedValue: { value: selected.value, important: selected.important } }),
    winner,
    overridden: selected !== undefined && winner !== selected,
    contributors: list,
  };
}
