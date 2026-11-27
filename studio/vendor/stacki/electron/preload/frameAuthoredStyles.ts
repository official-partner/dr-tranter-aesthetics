import { assert } from '../../shared/core/assert';
import { PRELOAD_LIMITS } from './frameBasics';
import { ownClasses } from './frameMeasure';
import { inheritedProperty } from './styleInheritance';
import { CASCADE_CANDIDATES_MAX, type CascadeOrigin, type CascadeProperty } from '../../shared/properties/cascadeOrigin';

const STYLE_LIMITS = { rulesMax: 20_000, propertiesMax: 512, workMax: 200_000 } as const;
type Probe = { readonly inherited: string; readonly local: string };
const registrations = new Map<string, Probe>();
let probeCounter = 0;
const prefix = `--stacki-inspect-${Math.random().toString(36).slice(2)}-`;
type InlineStyle = { readonly element: HTMLElement | SVGElement; readonly text: string };
type CollectedStyles = {
  readonly declarations: readonly CSSStyleDeclaration[];
  readonly inline: readonly InlineStyle[];
};
type Declaration = { readonly value: string; readonly priority: string };

export type AuthoredInspection = {
  readonly values: Readonly<Record<string, string | undefined>>;
  readonly sources: Readonly<Record<string, Element | undefined>>;
  readonly origins: Readonly<Record<string, CascadeProperty | undefined>>;
};

export function authoredProperties(element: Element, properties: readonly string[]) {
  return inspectAuthoredProperties(element, properties).values;
}

export function inspectAuthoredProperties(element: Element, properties: readonly string[]): AuthoredInspection {
  const empty: AuthoredInspection = { values: {}, sources: {}, origins: {} };
  if (typeof window.CSS?.registerProperty !== 'function') {
    return empty;
  }
  if (properties.length === 0 || properties.length > STYLE_LIMITS.propertiesMax) {
    return empty;
  }
  const styles = authoredStyles(element);
  if (styles === undefined) {
    return empty;
  }
  if (styles.declarations.length * properties.length * 2 > STYLE_LIMITS.workMax) {
    return empty;
  }
  const values: string[] = [];
  const records: DeclaredRecord[] = [];
  const patches = new Map<CSSStyleDeclaration, AuthoredPatch>();
  const names = properties.map((property) => ({ property, probe: registeredProbe(property) }));
  try {
    for (const { property, probe } of names) {
      if (probe !== undefined) {
        for (const style of styles.declarations) {
          const declaration = sourceDeclaration(style, property);
          if (declaration.value) {
            const token = probeToken(declaration.value, values.length);
            values.push(declaration.value);
            records.push({ property, style, value: declaration.value, important: declaration.priority === 'important' });
            const patch = patches.get(style) ?? authoredPatch(style);
            patches.set(style, patch);
            for (const name of [probe.inherited, probe.local]) {
              const value = name === probe.local ? localToken(token, property) : token;
              style.setProperty(name, value, declaration.priority);
              patch.probes.add(name);
            }
          }
        }
      }
    }
    assert(patches.size <= styles.declarations.length, 'Each declaration has one saved original');
    assert(values.length * 2 <= STYLE_LIMITS.workMax, 'Authored probe writes are bounded');
    return inspectProbeResults(element, names, values, records);
  } finally {
    restoreAuthoredStyles(patches, styles.inline);
  }
}

function localToken(token: string, property: string): string {
  const keyword = token.trim().toLowerCase();
  if (keyword === 'inherit') {
    return 'initial';
  }
  if (keyword === 'unset' && inheritedProperty(property)) {
    return 'initial';
  }
  return token;
}

function inspectProbeResults(
  element: Element,
  names: readonly { readonly property: string; readonly probe: Probe | undefined }[],
  declarations: readonly string[],
  records: readonly DeclaredRecord[],
): AuthoredInspection {
  const computed = getComputedStyle(element);
  const values: Record<string, string | undefined> = {};
  const sources: Record<string, Element | undefined> = {};
  const origins: Record<string, CascadeProperty | undefined> = {};
  const ranks = records.length > 0 ? documentRanks() : new Map<CSSStyleDeclaration, number>();
  for (const { property, probe } of names) {
    if (probe === undefined) {
      continue;
    }
    const token = computed.getPropertyValue(probe.inherited).trim();
    const index = /^\d+$/.test(token) ? Number(token) : -1;
    if (Number.isSafeInteger(index) && declarations[index] !== undefined) {
      values[property] = declarations[index];
      sources[property] = probeSource(element, probe.local, token);
      const winner = records[index];
      if (winner !== undefined && sources[property] === element) {
        origins[property] = cascadeProperty({ element, property, winner, records, ranks, used: computed.getPropertyValue(property).trim() });
      }
    }
  }
  return { values, sources, origins };
}

type DeclaredRecord = {
  readonly property: string;
  readonly style: CSSStyleDeclaration;
  readonly value: string;
  readonly important: boolean;
};

function cascadeProperty(input: {
  readonly element: Element;
  readonly property: string;
  readonly winner: DeclaredRecord;
  readonly records: readonly DeclaredRecord[];
  readonly ranks: ReadonlyMap<CSSStyleDeclaration, number>;
  readonly used: string;
}): CascadeProperty {
  const { element, property, winner, records, ranks, used } = input;
  const candidates = records
    .filter((record) => record.property === property && (record === winner || reaches(record.style, element)))
    .map((record) => originOf(record, ranks))
    .sort((left, right) => left.order - right.order)
    .slice(-CASCADE_CANDIDATES_MAX);
  assert(candidates.length <= CASCADE_CANDIDATES_MAX, 'The reported candidates are bounded');
  return { used, winner: originOf(winner, ranks), candidates };
}

function reaches(style: CSSStyleDeclaration, element: Element): boolean {
  const rule = style.parentRule;
  if (rule === null) {
    return element instanceof HTMLElement && element.style === style;
  }
  if (!(rule instanceof CSSStyleRule) || rule.parentRule instanceof CSSStyleRule) {
    return true;
  }
  try {
    return element.matches(rule.selectorText);
  } catch {
    return true;
  }
}

function originOf(record: DeclaredRecord, ranks: ReadonlyMap<CSSStyleDeclaration, number>): CascadeOrigin {
  const where = describeDeclaration(record.style);
  const context = ruleContext(record.style);
  return {
    selector: where.selector,
    ...(where.file === undefined ? {} : { file: where.file }),
    value: record.value.replace(/\s+/g, ' ').trim(),
    important: record.important,
    ...(context.layer === undefined ? {} : { layer: context.layer }),
    conditions: context.conditions,
    order: ranks.get(record.style) ?? Number.MAX_SAFE_INTEGER,
  };
}

function ruleContext(style: CSSStyleDeclaration): { readonly layer: string | undefined; readonly conditions: string[] } {
  const layers: string[] = [];
  const conditions: string[] = [];
  let rule: CSSRule | undefined = style.parentRule ?? undefined;
  for (let depth = 0; rule !== undefined && depth < PRELOAD_LIMITS.cssRuleDepthMax; depth += 1) {
    if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
      layers.unshift(rule.name);
    } else if (rule instanceof CSSMediaRule) {
      conditions.unshift(`@media ${rule.conditionText}`.trim());
    } else if (rule instanceof CSSSupportsRule) {
      conditions.unshift(`@supports ${rule.conditionText}`.trim());
    } else if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
      conditions.unshift(`@container ${rule.conditionText}`.trim());
    }
    rule = rule.parentRule ?? undefined;
  }
  return { layer: layers.length === 0 ? undefined : layers.join('.'), conditions };
}

function documentRanks(): Map<CSSStyleDeclaration, number> {
  const ranks = new Map<CSSStyleDeclaration, number>();
  const stack: CSSRule[] = [];
  const sheets = [...Array.from(document.styleSheets), ...document.adoptedStyleSheets];
  for (const sheet of sheets.reverse()) {
    const rules = sheetRules(sheet);
    if (rules !== undefined) {
      stack.push(...Array.from(rules).reverse());
    }
  }
  for (let step = 0; step < STYLE_LIMITS.rulesMax * 4 && stack.length > 0; step += 1) {
    const rule = stack.pop();
    assert(rule !== undefined, 'The rank stack is non-empty inside the loop');
    if (rule instanceof CSSStyleRule || (typeof CSSNestedDeclarations !== 'undefined' && rule instanceof CSSNestedDeclarations)) {
      ranks.set(rule.style, ranks.size);
    }
    const children = authoredChildRules(rule);
    if (children !== undefined) {
      stack.push(...Array.from(children).reverse());
    }
  }
  return ranks;
}

function probeSource(element: Element, name: string, token: string): Element | undefined {
  let ancestor: Element | undefined = element;
  for (let depth = 0; depth < PRELOAD_LIMITS.domDepthMax; depth += 1) {
    if (ancestor === undefined) {
      return undefined;
    }
    if (getComputedStyle(ancestor).getPropertyValue(name).trim() === token) {
      return ancestor;
    }
    ancestor = ancestor.parentElement ?? undefined;
  }
  return undefined;
}

interface AuthoredPatch {
  readonly text: string;
  readonly all: boolean;
  readonly probes: Set<string>;
}

function authoredPatch(style: CSSStyleDeclaration): AuthoredPatch {
  return { text: style.cssText, all: style.getPropertyValue('all') !== '', probes: new Set() };
}

function restoreAuthoredStyles(patches: ReadonlyMap<CSSStyleDeclaration, AuthoredPatch>, inline: readonly InlineStyle[]): void {
  assert(patches.size <= STYLE_LIMITS.workMax, 'Authored probe cleanup is bounded');
  for (const [style, patch] of patches) {
    assert(patch.probes.size > 0, 'A saved declaration was probed');
    for (const name of patch.probes) {
      style.removeProperty(name);
    }
    if (patch.all) {
      if (style.cssText !== patch.text) {
        style.cssText = patch.text;
      }
    }
  }
  for (const { element, text } of inline) {
    if (element.getAttribute('style') !== text) {
      element.setAttribute('style', text);
    }
  }
}

export function authoredStyleMutation(record: MutationRecord): boolean {
  if (record.attributeName !== 'style') {
    return false;
  }
  if (!(record.target instanceof Element)) {
    return false;
  }
  const normalize = (text: string) => {
    const style = document.createElement('span').style;
    style.cssText = text.replace(new RegExp(`${prefix}\\d+\\s*:[^;]*;?`, 'g'), '');
    return style.cssText;
  };
  return normalize(record.oldValue ?? '') === normalize(record.target.getAttribute('style') ?? '');
}

function registeredProbe(property: string): Probe | undefined {
  const known = registrations.get(property);
  if (known !== undefined) {
    return known;
  }
  if (registrations.size >= STYLE_LIMITS.propertiesMax) {
    return undefined;
  }
  if (property.startsWith('--')) {
    return undefined;
  }
  if (typeof window.CSS?.registerProperty !== 'function') {
    return undefined;
  }
  const probe = newProbe({ inherits: inheritedProperty(property) });
  registrations.set(property, probe);
  return probe;
}

function probeToken(value: string, index: number): string {
  switch (value.trim().toLowerCase()) {
    case 'inherit':
    case 'initial':
    case 'unset':
    case 'revert':
    case 'revert-layer':
      return value;
    default:
      return String(index);
  }
}

function authoredDeclaration(style: CSSStyleDeclaration, property: string): Declaration {
  return { value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) };
}

function sourceDeclaration(style: CSSStyleDeclaration, property: string): Declaration {
  const declared = authoredDeclaration(style, property);
  if (property === 'direction' || property === 'unicode-bidi' || property.startsWith('--')) {
    return declared;
  }
  const reset = authoredDeclaration(style, 'all');
  if (!reset.value) {
    return declared;
  }
  if (!declared.value) {
    return reset;
  }
  if (declared.priority !== reset.priority) {
    return declared.priority === 'important' ? declared : reset;
  }
  const properties = Array.from(style);
  return properties.indexOf(property) > properties.indexOf('all') ? declared : reset;
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | undefined {
  try {
    return sheet.cssRules;
  } catch {
    return undefined;
  }
}

function authoredStyles(element: Element): CollectedStyles | undefined {
  const styles: CSSStyleDeclaration[] = [];
  const sheets = [...Array.from(document.styleSheets), ...document.adoptedStyleSheets].filter((sheet) => {
    const owner = sheet.ownerNode;
    return !(owner instanceof Element && /^avb-(design-style|vh-override)$/.test(owner.id));
  });
  if (sheets.length > STYLE_LIMITS.rulesMax) {
    return undefined;
  }
  const pending: CSSRule[] = [];
  for (const sheet of sheets) {
    const rules = sheetRules(sheet);
    if (rules === undefined) {
      return undefined;
    }
    if (pending.length + rules.length > STYLE_LIMITS.rulesMax) {
      return undefined;
    }
    pending.push(...Array.from(rules));
  }
  for (let index = 0; index < pending.length; index += 1) {
    const rule = pending[index];
    assert(rule !== undefined, 'The rule queue index is in bounds');
    if (rule instanceof CSSStyleRule) {
      styles.push(rule.style);
    }
    if (typeof CSSNestedDeclarations !== 'undefined') {
      if (rule instanceof CSSNestedDeclarations) {
        styles.push(rule.style);
      }
    }
    const children = authoredChildRules(rule);
    if (children === undefined) {
      return undefined;
    }
    if (pending.length + children.length > STYLE_LIMITS.rulesMax) {
      return undefined;
    }
    pending.push(...Array.from(children));
  }
  const inline: InlineStyle[] = [];
  let ancestor: Element | undefined = element;
  for (let depth = 0; ancestor !== undefined; depth += 1) {
    if (depth >= PRELOAD_LIMITS.domDepthMax) {
      return undefined;
    }
    if (ancestor instanceof HTMLElement || ancestor instanceof SVGElement) {
      const text = ancestor.getAttribute('style');
      if (text !== null) {
        styles.push(ancestor.style);
        inline.push({ element: ancestor, text });
      }
    }
    ancestor = ancestor.parentElement ?? undefined;
  }
  return { declarations: styles, inline };
}

function authoredChildRules(rule: CSSRule): CSSRuleList | readonly CSSRule[] | undefined {
  if (rule instanceof CSSImportRule) {
    return rule.styleSheet ? sheetRules(rule.styleSheet) : [];
  }
  if (rule instanceof CSSGroupingRule) {
    return rule.cssRules;
  }
  if (rule instanceof CSSStyleRule) {
    return rule.cssRules;
  }
  return [];
}

function newProbe({ inherits }: { readonly inherits: boolean }): Probe {
  const probe = { inherited: `${prefix}${probeCounter}`, local: `${prefix}${probeCounter + 1}` };
  probeCounter += 2;
  window.CSS.registerProperty({ name: probe.inherited, syntax: '*', inherits });
  window.CSS.registerProperty({ name: probe.local, syntax: '*', inherits: false });
  return probe;
}


export const WINNING_LIMITS = { namesMax: 512, writesMax: 200_000 } as const;

export interface WinningDeclaration {
  readonly expression: string;
  readonly selector: string;
  readonly file?: string;
  readonly depth: number;
  readonly ancestor: string;
}

const customProbes: Probe[] = [];

function customProbe(index: number): Probe | undefined {
  if (typeof window.CSS?.registerProperty !== 'function') {
    return undefined;
  }
  while (customProbes.length <= index) {
    if (customProbes.length >= WINNING_LIMITS.namesMax) {
      return undefined;
    }
    customProbes.push(newProbe({ inherits: true }));
  }
  return customProbes[index];
}

type DeclaredSource = { readonly style: CSSStyleDeclaration; readonly expression: string };

export function inspectWinningDeclarations(element: Element, names: readonly string[]): Readonly<Record<string, WinningDeclaration>> {
  const wanted = [...new Set(names.filter((name) => name.startsWith('--')))];
  if (wanted.length === 0 || wanted.length > WINNING_LIMITS.namesMax) {
    return {};
  }
  const styles = authoredStyles(element);
  if (styles === undefined) {
    return {};
  }
  const probes = wanted.map((_, index) => customProbe(index));
  if (probes.some((probe) => probe === undefined)) {
    return {};
  }
  const indexOf = new Map(wanted.map((name, index) => [name, index]));
  const declared: DeclaredSource[] = [];
  const patches = new Map<CSSStyleDeclaration, AuthoredPatch>();
  try {
    for (const style of styles.declarations) {
      for (const name of Array.from(style).filter((candidate) => indexOf.has(candidate))) {
        const probe = probes[indexOf.get(name) ?? -1];
        if (probe === undefined || declared.length * 2 >= WINNING_LIMITS.writesMax) {
          return {};
        }
        const value = style.getPropertyValue(name);
        const token = probeToken(value, declared.length);
        const patch = patches.get(style) ?? authoredPatch(style);
        patches.set(style, patch);
        style.setProperty(probe.inherited, token, style.getPropertyPriority(name));
        style.setProperty(probe.local, localToken(token, name), style.getPropertyPriority(name));
        patch.probes.add(probe.inherited);
        patch.probes.add(probe.local);
        declared.push({ style, expression: value });
      }
    }
    return readWinners(element, wanted, probes, declared);
  } finally {
    restoreAuthoredStyles(patches, styles.inline);
  }
}

function readWinners(
  element: Element,
  names: readonly string[],
  probes: ReadonlyArray<Probe | undefined>,
  declared: readonly DeclaredSource[],
): Record<string, WinningDeclaration> {
  const chain: Element[] = [];
  for (let node: Element | undefined = element; node !== undefined && chain.length < PRELOAD_LIMITS.domDepthMax; node = node.parentElement ?? undefined) {
    chain.push(node);
  }
  const computed = chain.map((node) => getComputedStyle(node));
  const winners: Record<string, WinningDeclaration> = {};
  names.forEach((name, position) => {
    const probe = probes[position];
    const atElement = probe === undefined ? '' : (computed[0]?.getPropertyValue(probe.inherited).trim() ?? '');
    const index = /^\d+$/.test(atElement) ? Number(atElement) : -1;
    const source = declared[index];
    if (probe === undefined || source === undefined) {
      return;
    }
    const depth = computed.findIndex((style) => style.getPropertyValue(probe.local).trim() === atElement);
    const owner = chain[depth];
    if (depth < 0 || owner === undefined) {
      return;
    }
    const where = describeDeclaration(source.style);
    winners[name] = {
      expression: source.expression.replace(/\s+/g, ' ').trim(),
      selector: where.selector,
      ...(where.file === undefined ? {} : { file: where.file }),
      depth,
      ancestor: elementLabel(owner),
    };
  });
  return winners;
}

function elementLabel(element: Element): string {
  if (element.id) {
    return `#${element.id}`;
  }
  const classes = ownClasses(element).map((name) => `.${name}`);
  return classes.length > 0 ? classes.join('') : element.tagName.toLowerCase();
}

function describeDeclaration(style: CSSStyleDeclaration): { readonly selector: string; readonly file: string | undefined } {
  let rule: CSSRule | undefined = style.parentRule ?? undefined;
  if (rule === undefined) {
    return { selector: 'style', file: undefined };
  }
  let selector = '';
  for (let depth = 0; rule !== undefined && depth < PRELOAD_LIMITS.cssRuleDepthMax; depth += 1) {
    if (rule instanceof CSSStyleRule) {
      selector = selector === '' ? rule.selectorText : `${rule.selectorText} ${selector}`;
    }
    if (rule.parentRule === null) {
      return { selector, file: sheetFile(rule.parentStyleSheet ?? undefined) };
    }
    rule = rule.parentRule;
  }
  return { selector, file: undefined };
}

function sheetFile(sheet: CSSStyleSheet | undefined): string | undefined {
  if (sheet === undefined) {
    return undefined;
  }
  const owner = sheet.ownerNode;
  const id = owner instanceof HTMLElement ? owner.dataset['viteDevId'] : undefined;
  const file = id ?? sheet.href ?? undefined;
  if (file === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(file, document.baseURI);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.pathname.slice(0, 1024) : file.slice(0, 1024);
  } catch {
    return file.slice(0, 1024);
  }
}


export const SCOPED_NAMES_MAX = 512;

export function inspectScopedProperties(element: Element): Readonly<Record<string, WinningDeclaration>> {
  const styles = authoredStyles(element);
  if (styles === undefined) {
    return {};
  }
  const chain: Element[] = [];
  for (let node: Element | undefined = element; node !== undefined && chain.length < PRELOAD_LIMITS.domDepthMax; node = node.parentElement ?? undefined) {
    chain.push(node);
  }
  const found: Record<string, WinningDeclaration> = {};
  let count = 0;
  for (const style of styles.declarations) {
    const names = Array.from(style).filter((name) => name.startsWith('--'));
    if (names.length === 0) {
      continue;
    }
    const depth = reachDepth(style, chain);
    if (depth < 0) {
      continue;
    }
    const owner = chain[depth];
    if (owner === undefined) {
      continue;
    }
    const where = describeDeclaration(style);
    for (const name of names) {
      const known = found[name];
      if (known === undefined) {
        if (count >= SCOPED_NAMES_MAX) {
          continue;
        }
        count += 1;
      } else if (known.depth < depth) {
        continue;
      }
      found[name] = {
        expression: style.getPropertyValue(name).replace(/\s+/g, ' ').trim(),
        selector: where.selector,
        ...(where.file === undefined ? {} : { file: where.file }),
        depth,
        ancestor: elementLabel(owner),
      };
    }
  }
  return found;
}

function reachDepth(style: CSSStyleDeclaration, chain: readonly Element[]): number {
  const rule = style.parentRule;
  if (rule === null) {
    return chain.findIndex((node) => node instanceof HTMLElement && node.style === style);
  }
  const owner = rule instanceof CSSStyleRule ? rule : rule.parentRule instanceof CSSStyleRule ? rule.parentRule : undefined;
  if (owner === undefined) {
    return -1;
  }
  return chain.findIndex((node) => {
    try {
      return node.matches(owner.selectorText);
    } catch {
      return false;
    }
  });
}
