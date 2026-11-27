
import type { ElementSnapshot } from './styleTypes';
import { type HasAxis, type HasCond, type AttrCond, type Compound, type PositionalPseudo, type CompiledSelector, compileSelectorList } from './selectorParse';
export {
  parseSelectorList,
  type SelectorListMember,
  selectorListMembers,
  type CanonicalCompound,
  canonicalCompound,
  selectorDependsOnAncestor,
  isGlobalSelector,
  type SelectorKind,
  selectorKind,
  normalizePseudoElement,
  type SelectorLayer,
  selectorLayerOf,
  selectorListLayers,
  formatSpecificity,
  compareSpecificity,
  selectorSpecificity,
} from './selectorParse';


export type MatchResult = { matched: boolean; approximate: boolean };
const NO_MATCH: MatchResult = { matched: false, approximate: false };

export type TreeView = {
  truncated: boolean;
  parentKey: (key: string) => string | undefined;
  childKeys: (key: string) => string[];
  elementChildKeys?: (key: string) => string[] | undefined;
  snapshot: (key: string) => Promise<ElementSnapshot | undefined>;
};

export type MatchTarget = {
  rootKey: string;
  view: TreeView;
  domMatched?: Map<string, boolean>;
};

const HAS_DESCENDANTS_MAX = 2000;

const SELECTOR_LIMITS = { chainDepthMax: 256 } as const;

export async function matchSelectorList(selectorText: string, target: MatchTarget): Promise<MatchResult[]> {
  const compiled = compileSelectorList(selectorText);
  const results: MatchResult[] = [];
  for (const selector of compiled) {
    const fromDom = target.domMatched?.get(selector.text);
    if (fromDom !== undefined) {
      results.push({ matched: fromDom, approximate: false });
      continue;
    }
    results.push(await matchComplex(selector, target.rootKey, target.view));
  }
  return results;
}

async function matchComplex(selector: CompiledSelector, subjectKey: string, view: TreeView): Promise<MatchResult> {
  if (!selector.compounds.length) {
    return NO_MATCH;
  }
  const keyIndex = selector.compounds.length - 1;
  const subject = selector.compounds[keyIndex];
  if (subject === undefined) {
    return NO_MATCH;
  }
  if (!(await matchCompound(subject, subjectKey, view))) {
    return NO_MATCH;
  }
  return { matched: await matchUpchain(selector, keyIndex, subjectKey, view), approximate: false };
}

async function matchUpchain(selector: CompiledSelector, compoundIndex: number, currentKey: string, view: TreeView): Promise<boolean> {
  if (compoundIndex === 0) {
    return true;
  }
  const chainDepth = selector.compounds.length - 1 - compoundIndex;
  if (chainDepth > SELECTOR_LIMITS.chainDepthMax) {
    return false;
  }
  const combinator = selector.combinators[compoundIndex - 1];
  const left = selector.compounds[compoundIndex - 1];
  if (left === undefined) {
    return false;
  }

  if (combinator === '>') {
    const parent = view.parentKey(currentKey);
    if (parent === undefined) {
      return false;
    }
    if (!(await matchCompound(left, parent, view))) {
      return false;
    }
    return matchUpchain(selector, compoundIndex - 1, parent, view);
  }

  if (combinator === ' ') {
    let ancestor = view.parentKey(currentKey);
    while (ancestor !== undefined) {
      if ((await matchCompound(left, ancestor, view)) && (await matchUpchain(selector, compoundIndex - 1, ancestor, view))) {
        return true;
      }
      ancestor = view.parentKey(ancestor);
    }
    return false;
  }

  const reach = combinator === '+' ? 'adjacent' : 'all';
  for (const sibling of precedingSiblings(currentKey, view, reach)) {
    if ((await matchCompound(left, sibling, view)) && (await matchUpchain(selector, compoundIndex - 1, sibling, view))) {
      return true;
    }
  }
  return false;
}

async function matchCompound(compound: Compound, key: string, view: TreeView): Promise<boolean> {
  const snapshot = await view.snapshot(key);
  if (!snapshot) {
    return false;
  }

  if (compound.id !== undefined && snapshot.id !== compound.id) {
    return false;
  }

  for (const cls of compound.classes) {
    if (!snapshot.classes.includes(cls)) {
      return false;
    }
  }

  for (const attr of compound.attrs) {
    if (!matchAttr(attr, snapshot)) {
      return false;
    }
  }

  if (compound.tag && compound.tag !== '*') {
    const hasOther =
      compound.id !== undefined || compound.classes.length > 0 || compound.attrs.length > 0 || compound.requireAny.length > 0 || compound.hasGroups.length > 0;
    if (snapshot.tag !== undefined) {
      if (snapshot.tag !== compound.tag) {
        return false;
      }
    } else if (!hasOther) {
      return false;
    }
  }

  for (const group of compound.requireAny) {
    let ok = false;
    for (const selector of group) {
      if ((await matchComplex(selector, key, view)).matched) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      return false;
    }
  }

  for (const cond of compound.hasGroups) {
    if (!(await matchHas(cond, key, view))) {
      return false;
    }
  }

  for (const negation of compound.negations) {
    if ((await matchComplex(negation, key, view)).matched) {
      return false;
    }
  }

  for (const pseudo of compound.pseudoClasses) {
    if (pseudo === ':root' && snapshot.tag !== 'html') {
      return false;
    }
  }

  for (const entry of compound.positional) {
    if ((await matchesPosition(entry, key, view)) === false) {
      return false;
    }
  }

  return true;
}

function parseNthFormula(raw: string | undefined): { step: number; offset: number } | undefined {
  if (!raw) {
    return undefined;
  }
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  if (compact === 'odd') {
    return { step: 2, offset: 1 };
  }
  if (compact === 'even') {
    return { step: 2, offset: 0 };
  }
  if (compact.includes('of')) {
    return undefined;
  }
  const anb = /^([+-]?\d*)n([+-]\d+)?$/.exec(compact);
  if (anb) {
    const lead = anb[1];
    const step = lead === '' || lead === '+' ? 1 : lead === '-' ? -1 : Number(lead);
    const offset = anb[2] ? Number(anb[2]) : 0;
    return Number.isFinite(step) && Number.isFinite(offset) ? { step, offset } : undefined;
  }
  if (/^[+-]?\d+$/.test(compact)) {
    return { step: 0, offset: Number(compact) };
  }
  return undefined;
}

function nthMatches(position: number, step: number, offset: number): boolean {
  if (step === 0) {
    return position === offset;
  }
  const cycles = (position - offset) / step;
  return Number.isInteger(cycles) && cycles >= 0;
}

async function matchesPosition(entry: PositionalPseudo, key: string, view: TreeView): Promise<boolean | undefined> {
  const parent = view.parentKey(key);
  if (parent === undefined) {
    return undefined;
  }
  const siblings = view.elementChildKeys?.(parent);
  if (!siblings || siblings.indexOf(key) < 0) {
    return undefined;
  }

  let list = siblings;
  if (entry.name.endsWith('-of-type')) {
    const snaps = await Promise.all(siblings.map((siblingKey) => view.snapshot(siblingKey)));
    if (snaps.some((snapshot) => !snapshot?.tag)) {
      return undefined;
    }
    const ownTag = snaps[siblings.indexOf(key)]?.tag;
    if (!ownTag) {
      return undefined;
    }
    list = siblings.filter((_, i) => snaps[i]?.tag === ownTag);
  }

  const position = list.indexOf(key) + 1;
  if (position === 0) {
    return undefined;
  }
  const total = list.length;

  switch (entry.name) {
    case ':first-child':
    case ':first-of-type':
      return position === 1;
    case ':last-child':
    case ':last-of-type':
      return position === total;
    case ':only-child':
    case ':only-of-type':
      return total === 1;
    case ':nth-child':
    case ':nth-of-type': {
      const anb = parseNthFormula(entry.arg);
      return anb ? nthMatches(position, anb.step, anb.offset) : undefined;
    }
    case ':nth-last-child':
    case ':nth-last-of-type': {
      const anb = parseNthFormula(entry.arg);
      return anb ? nthMatches(total - position + 1, anb.step, anb.offset) : undefined;
    }
    default:
      return undefined;
  }
}

async function matchHas(cond: HasCond, subjectKey: string, view: TreeView): Promise<boolean> {
  for (const candidate of hasCandidates(cond.axis, subjectKey, view)) {
    if ((await matchComplex(cond.sel, candidate, view)).matched) {
      return true;
    }
  }
  return false;
}

function hasCandidates(axis: HasAxis, key: string, view: TreeView): string[] {
  if (axis === 'child') {
    return view.childKeys(key);
  }
  if (axis === 'adjacent') {
    return followingSiblings(key, view, 'adjacent');
  }
  if (axis === 'sibling') {
    return followingSiblings(key, view, 'all');
  }
  return descendants(key, view);
}

type SiblingReach = 'adjacent' | 'all';

function precedingSiblings(key: string, view: TreeView, reach: SiblingReach): string[] {
  const parent = view.parentKey(key);
  if (parent === undefined) {
    return [];
  }
  const siblings = view.childKeys(parent);
  const index = siblings.indexOf(key);
  if (index <= 0) {
    return [];
  }
  const adjacent = siblings[index - 1];
  return reach === 'adjacent' && adjacent !== undefined ? [adjacent] : siblings.slice(0, index).reverse();
}

function followingSiblings(key: string, view: TreeView, reach: SiblingReach): string[] {
  const parent = view.parentKey(key);
  if (parent === undefined) {
    return [];
  }
  const siblings = view.childKeys(parent);
  const index = siblings.indexOf(key);
  if (index < 0) {
    return [];
  }
  const after = siblings.slice(index + 1);
  return reach === 'adjacent' ? after.slice(0, 1) : after;
}

function descendants(key: string, view: TreeView): string[] {
  const out: string[] = [];
  const stack = [...view.childKeys(key)];
  while (stack.length && out.length < HAS_DESCENDANTS_MAX) {
    const current = stack.shift();
    if (current === undefined) {
      break;
    }
    out.push(current);
    for (const child of view.childKeys(current)) {
      stack.push(child);
    }
  }
  return out;
}

function attrValue(snapshot: ElementSnapshot, name: string): string | undefined {
  if (name === 'class') {
    return snapshot.classes.join(' ');
  }
  if (name === 'id') {
    return snapshot.id;
  }
  return snapshot.attributes[name];
}

function matchAttr(attr: AttrCond, snapshot: ElementSnapshot): boolean {
  const actual = attrValue(snapshot, attr.name);
  if (actual === undefined) {
    return false;
  }
  if (attr.operator === undefined || attr.value === undefined) {
    return true;
  }

  const expected = attr.insensitive ? attr.value.toLowerCase() : attr.value;
  const got = attr.insensitive ? actual.toLowerCase() : actual;

  switch (attr.operator) {
    case '=':
      return got === expected;
    case '~=':
      return got.split(/\s+/).includes(expected);
    case '|=':
      return got === expected || got.startsWith(`${expected}-`);
    case '^=':
      return expected.length > 0 && got.startsWith(expected);
    case '$=':
      return expected.length > 0 && got.endsWith(expected);
    case '*=':
      return expected.length > 0 && got.includes(expected);
    default:
      return false;
  }
}
