
import selectorParser from 'postcss-selector-parser';
import type { SelectorInfo, Specificity } from './styleTypes';
import { assert } from '../../../../shared/core/assert';

export type Combinator = ' ' | '>' | '+' | '~';
export type HasAxis = 'descendant' | 'child' | 'sibling' | 'adjacent';
export type HasCond = { axis: HasAxis; sel: CompiledSelector };

export type AttrCond = {
  name: string;
  operator: string | undefined;
  value: string | undefined;
  insensitive: boolean;
};

export type Compound = {
  universal: boolean;
  tag: string | undefined;
  id: string | undefined;
  classes: string[];
  attrs: AttrCond[];
  negations: CompiledSelector[];
  requireAny: CompiledSelector[][];
  hasGroups: HasCond[];
  hasPseudoClass: boolean;
  pseudoClasses: string[];
  positional: PositionalPseudo[];
  pseudoElement: string | undefined;
};

export type PositionalPseudo = { name: string; arg: string | undefined };

export type CompiledSelector = {
  text: string;
  compounds: Compound[];
  combinators: Combinator[];
  specificity: Specificity;
  hasPseudoClass: boolean;
  pseudoElement: string | undefined;
};

export const emptyCompound = (): Compound => ({
  universal: false,
  tag: undefined,
  id: undefined,
  classes: [],
  attrs: [],
  negations: [],
  requireAny: [],
  hasGroups: [],
  hasPseudoClass: false,
  pseudoClasses: [],
  positional: [],
  pseudoElement: undefined,
});

export function normalizeCombinator(value: string): Combinator {
  const trimmed = value.trim();
  if (trimmed === '>') {
    return '>';
  }
  if (trimmed === '+') {
    return '+';
  }
  if (trimmed === '~') {
    return '~';
  }
  return ' ';
}

export function isPseudoElement(value: string): boolean {
  if (value.startsWith('::')) {
    return true;
  }
  return /^:(before|after|first-line|first-letter|placeholder|selection|marker|backdrop)$/i.test(value);
}

export function parseSelectorList(selectorText: string): SelectorInfo[] {
  const compiled = compileSelectorList(selectorText);
  return compiled.map((selector) => ({
    text: selector.text,
    specificity: selector.specificity,
    hasPseudoClass: selector.hasPseudoClass,
    pseudoElement: selector.pseudoElement,
    approximate: false,
  }));
}

export type SelectorListMember = {
  readonly text: string;
  readonly from: number;
  readonly to: number;
};

export function selectorListMembers(selectorText: string): readonly SelectorListMember[] {
  const members: SelectorListMember[] = [];
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let start = 0;
  const append = (end: number) => {
    const raw = selectorText.slice(start, end);
    const leadingLength = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.length === 0) {
      return;
    }
    const from = start + leadingLength;
    members.push({ text, from, to: from + text.length });
  };

  for (let index = 0; index < selectorText.length; index += 1) {
    const character = selectorText[index] ?? '';
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') {
      parenthesisDepth += 1;
      continue;
    }
    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }
    if (character === '[') {
      bracketDepth += 1;
      continue;
    }
    if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (character === ',' && parenthesisDepth === 0 && bracketDepth === 0) {
      append(index);
      start = index + 1;
    }
  }
  append(selectorText.length);
  return members;
}

export type CanonicalCompound = {
  simple: boolean;
  oneCompound: boolean;
  tokens: string[];
  pseudoClasses: string[];
  pseudoElement: string;
  splittable: boolean;
  universal: boolean;
  functional: boolean;
};

export const STATE_PSEUDO_CLASSES = new Set([':hover', ':focus', ':active']);

export function canonicalCompound(selectorText: string): CanonicalCompound {
  const first = compileSelectorList(selectorText)[0];
  const subject = first?.compounds[first.compounds.length - 1];
  if (!first || !subject) {
    return {
      simple: false,
      oneCompound: false,
      tokens: [],
      pseudoClasses: [],
      pseudoElement: '',
      splittable: false,
      universal: false,
      functional: false,
    };
  }

  const pseudoClasses = subject.pseudoClasses;
  const pseudoElement = normalizePseudoElement(first.pseudoElement);
  const oneCompound = first.compounds.length === 1 && first.combinators.length === 0;
  const noFunctionalPseudo = subject.negations.length === 0 && subject.requireAny.length === 0 && subject.hasGroups.length === 0;
  const stateOnly = pseudoClasses.every((pseudo) => STATE_PSEUDO_CLASSES.has(pseudo));
  const simple = oneCompound && !pseudoElement && !subject.universal && subject.id === undefined && noFunctionalPseudo && stateOnly;
  const splittable = oneCompound && !subject.universal && noFunctionalPseudo;

  const tokens: string[] = [];
  if (subject.tag) {
    tokens.push(`tag:${subject.tag}`);
  }
  subject.classes.forEach((cls) => tokens.push(`class:${cls}`));
  subject.attrs.forEach((attr) => {
    tokens.push(attr.operator && attr.value !== undefined ? `attr:${attr.name}${attr.operator}"${attr.value}"` : `attr:${attr.name}`);
  });
  return {
    simple,
    oneCompound,
    tokens,
    pseudoClasses,
    pseudoElement,
    splittable,
    universal: subject.universal,
    functional: !noFunctionalPseudo,
  };
}

export function selectorDependsOnAncestor(selectorText: string): boolean {
  const selectors = compileSelectorList(selectorText);
  return selectors.some((selector) => selector.combinators.some((combinator) => combinator === ' ' || combinator === '>'));
}

export type SelectorKind = 'class' | 'plain';

export const SELECTOR_KIND_PARSE_MAX = 2048;

export function selectorKind(text: string): SelectorKind {
  assert(typeof text === 'string', 'selectorKind: the selector is text');
  if (text.length > SELECTOR_KIND_PARSE_MAX) {
    return /[.#[]/.test(text) ? 'class' : 'plain';
  }
  let root: selectorParser.Root;
  try {
    root = selectorParser().astSync(text);
  } catch {
    return /[.#[]/.test(text) ? 'class' : 'plain';
  }
  let named = false;
  root.walk((node) => {
    if (node.type === 'class' || node.type === 'id' || node.type === 'attribute') {
      named = true;
      return false;
    }
    return undefined;
  });
  const kind: SelectorKind = named ? 'class' : 'plain';
  assert(kind === 'class' || !/^[.#[]/.test(text.trim()), 'selectorKind: a selector led by a class, id or attribute is a class chip');
  return kind;
}

export function isGlobalSelector(text: string): boolean {
  return selectorKind(text) === 'plain';
}

export function normalizePseudoElement(pseudoElement: string | undefined): string {
  if (!pseudoElement) {
    return '';
  }
  return `::${pseudoElement.replace(/^::?/, '').toLowerCase()}`;
}

export type SelectorLayer = '' | '::before' | '::after';

export function selectorLayerOf(pseudoElement: string | undefined): SelectorLayer {
  const normalized = normalizePseudoElement(pseudoElement);
  return normalized === '::before' || normalized === '::after' ? normalized : '';
}

export function selectorListLayers(selectorText: string): readonly SelectorLayer[] {
  const layers = compileSelectorList(selectorText).map((selector) => selectorLayerOf(selector.pseudoElement));
  assert(layers.length <= selectorText.length + 1, 'selectorListLayers: one layer per member');
  return layers;
}

export const compileCache = new Map<string, CompiledSelector[]>();

export function compileSelectorList(selectorText: string): CompiledSelector[] {
  const cached = compileCache.get(selectorText);
  if (cached) {
    return cached;
  }

  let result: CompiledSelector[] = [];
  try {
    selectorParser((root) => {
      root.each((selector) => {
        if (selector.type !== 'selector') {
          return;
        }
        result.push(compileSelector(selector));
      });
    }).processSync(selectorText);
  } catch {
    result = [
      {
        text: selectorText.trim(),
        compounds: [],
        combinators: [],
        specificity: [0, 0, 0],
        hasPseudoClass: false,
        pseudoElement: undefined,
      },
    ];
  }

  compileCache.set(selectorText, result);
  return result;
}

export type SelectorNode = selectorParser.Selector;

export function compileSelector(selector: SelectorNode): CompiledSelector {
  const builder = new SelectorBuilder();
  selector.each((node) => {
    builder.add(node);
  });
  return builder.finish(selector.toString().trim());
}

export class SelectorBuilder {
  private readonly compounds: Compound[] = [];
  private readonly combinators: Combinator[] = [];
  private current = emptyCompound();
  private started = false;
  private idCount = 0;
  private classCount = 0;
  private typeCount = 0;
  private hasPseudoClass = false;

  add(node: selectorParser.Node): void {
    switch (node.type) {
      case 'combinator': {
        if (this.started) {
          this.pushCurrent();
          this.combinators.push(normalizeCombinator(node.value));
          this.started = false;
        }
        return;
      }
      case 'tag': {
        this.current.tag = node.value.toLowerCase();
        this.typeCount += 1;
        break;
      }
      case 'universal': {
        this.current.universal = true;
        break;
      }
      case 'id': {
        this.current.id = node.value;
        this.idCount += 1;
        break;
      }
      case 'class': {
        this.current.classes.push(node.value);
        this.classCount += 1;
        break;
      }
      case 'attribute': {
        this.current.attrs.push({
          name: node.attribute.toLowerCase(),
          operator: node.operator,
          value: node.value,
          insensitive: Boolean(node.insensitive),
        });
        this.classCount += 1;
        break;
      }
      case 'pseudo': {
        this.addPseudo(node);
        break;
      }
      case 'string':
      case 'root':
      case 'comment':
      case 'nesting':
      case 'selector':
        return;
      default: {
        const unhandled: never = node;
        return unhandled;
      }
    }
    this.started = true;
  }

  private addPseudo(node: selectorParser.Pseudo): void {
    const value = node.value;
    if (isPseudoElement(value)) {
      this.current.pseudoElement = value;
      this.typeCount += 1;
    } else if (value === ':not') {
      const inner = compileFunctionalArg(node);
      this.current.negations.push(...inner);
      this.addSpecificity(mostSpecific(inner));
    } else if (value === ':global') {
      const inner = compileFunctionalArg(node);
      if (inner.length) {
        this.current.requireAny.push(inner);
      }
      this.addSpecificity(mostSpecific(inner));
      this.current.pseudoElement ??= sharedPseudoElement(inner);
    } else if (value === ':is' || value === ':matches' || value === ':where') {
      const inner = compileFunctionalArg(node);
      if (inner.length) {
        this.current.requireAny.push(inner);
      }
      if (value !== ':where') {
        this.addSpecificity(mostSpecific(inner));
      }
    } else if (value === ':has') {
      const conditions = compileHasArg(node);
      this.current.hasGroups.push(...conditions);
      this.addSpecificity(mostSpecific(conditions.map((condition) => condition.sel)));
    } else {
      this.current.hasPseudoClass = true;
      const pseudoName = value.toLowerCase();
      this.current.pseudoClasses.push(pseudoName);
      if (POSITIONAL_PSEUDOS.has(pseudoName)) {
        this.current.positional.push({ name: pseudoName, arg: pseudoArgText(node) });
      }
      this.hasPseudoClass = true;
      this.classCount += 1;
    }
  }

  private addSpecificity(top: Specificity | undefined): void {
    if (top) {
      this.idCount += top[0];
      this.classCount += top[1];
      this.typeCount += top[2];
    }
  }

  private pushCurrent(): void {
    this.compounds.push(this.current);
    this.current = emptyCompound();
  }

  finish(text: string): CompiledSelector {
    if (this.started) {
      this.pushCurrent();
    }
    assert(this.combinators.length <= Math.max(0, this.compounds.length - 1), 'SelectorBuilder: a combinator sits between two compounds');
    return {
      text,
      compounds: this.compounds,
      combinators: this.combinators,
      specificity: [this.idCount, this.classCount, this.typeCount],
      hasPseudoClass: this.hasPseudoClass,
      pseudoElement: this.compounds[this.compounds.length - 1]?.pseudoElement,
    };
  }
}

function sharedPseudoElement(selectors: readonly CompiledSelector[]): string | undefined {
  const first = selectors[0]?.pseudoElement;
  return selectors.every((selector) => normalizePseudoElement(selector.pseudoElement) === normalizePseudoElement(first)) ? first : undefined;
}

export function compileFunctionalArg(node: selectorParser.Pseudo): CompiledSelector[] {
  const out: CompiledSelector[] = [];
  node.each?.((child) => {
    if (child.type === 'selector') {
      out.push(compileSelector(child));
    }
  });
  return out;
}

export function axisFromCombinator(value: string): HasAxis {
  const trimmed = value.trim();
  if (trimmed === '>') {
    return 'child';
  }
  if (trimmed === '+') {
    return 'adjacent';
  }
  if (trimmed === '~') {
    return 'sibling';
  }
  return 'descendant';
}

export function compileHasArg(node: selectorParser.Pseudo): HasCond[] {
  const out: HasCond[] = [];
  node.each?.((child) => {
    if (child.type !== 'selector') {
      return;
    }
    const first = child.nodes[0];
    const axis: HasAxis = first && first.type === 'combinator' ? axisFromCombinator(first.value) : 'descendant';
    out.push({ axis, sel: compileSelector(child) });
  });
  return out;
}

export function mostSpecific(selectors: CompiledSelector[]): Specificity | undefined {
  let best: Specificity | undefined;
  for (const selector of selectors) {
    if (!best || compareSpecificity(selector.specificity, best) > 0) {
      best = selector.specificity;
    }
  }
  return best;
}

export function selectorSpecificity(selectorText: string): Specificity {
  const strongest = mostSpecific(compileSelectorList(selectorText)) ?? [0, 0, 0];
  assert(
    strongest.every((count) => Number.isSafeInteger(count)),
    'selectorSpecificity: counts are integers',
  );
  assert(
    strongest.every((count) => count >= 0),
    'selectorSpecificity: counts are never negative',
  );
  return strongest;
}

export const POSITIONAL_PSEUDOS = new Set([
  ':first-child',
  ':last-child',
  ':only-child',
  ':nth-child',
  ':nth-last-child',
  ':first-of-type',
  ':last-of-type',
  ':only-of-type',
  ':nth-of-type',
  ':nth-last-of-type',
]);

export function pseudoArgText(node: { toString: () => string }): string | undefined {
  const text = String(node);
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  return open !== -1 && close > open ? text.slice(open + 1, close).trim() : undefined;
}

export function formatSpecificity(spec: Specificity): string {
  return `${spec[0]},${spec[1]},${spec[2]}`;
}

export function compareSpecificity(left: Specificity, right: Specificity): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
