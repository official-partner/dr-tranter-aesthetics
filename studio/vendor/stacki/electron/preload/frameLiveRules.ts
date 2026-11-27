
import { assert } from '../../shared/core/assert';
import { err, ok, type Result } from '../../shared/core/result';
import { elementsWithPath } from './frameRegions';
import {
  HOVER_STYLE_LIMITS,
  LIVE_RULE_LIMITS,
  isConditionAtRule,
  liveRuleKey,
  normalizeAtRule,
  parseHoverStyleMessage,
  parseLiveRuleMessage,
  selectorKeyOf,
  sheetPathIsAstroStyle,
  sheetPathIsSource,
  sheetScopeOf,
  sourceSelectorKey,
  type HoverDeclaration,
  type LiveRuleEdit,
  type LiveRuleTarget,
} from '../../shared/properties/liveRules';

interface Patch {
  readonly rule: CSSStyleRule;
  readonly value: string;
  readonly priority: string;
}

interface Override {
  readonly rule: LiveRuleTarget;
  readonly edit: LiveRuleEdit;
  readonly until: LiveRuleEdit | undefined;
  readonly framesWaited: number;
}

export interface LiveRuleProblem {
  readonly code: 'rules-over-cap';
  readonly message: string;
}

const overrides = new Map<string, Override>();
const patchesByKey = new Map<string, readonly Patch[]>();
let settleScheduled = false;

export function receiveLiveRules(input: unknown): boolean {
  if (receiveHoverStyle(input)) {
    return true;
  }
  const message = parseLiveRuleMessage(input);
  if (message === undefined) {
    return false;
  }
  const key = liveRuleKey(message.rule);
  switch (message.op) {
    case 'set': {
      if (!overrides.has(key)) {
        makeRoom();
      }
      overrides.delete(key);
      overrides.set(key, { rule: message.rule, edit: message.edit, until: undefined, framesWaited: 0 });
      patch(key, message.rule, message.edit);
      break;
    }
    case 'drop': {
      const override = overrides.get(key);
      if (override === undefined) {
        break;
      }
      if (message.until === undefined) {
        restore(key, override.rule.property);
        overrides.delete(key);
      } else {
        overrides.set(key, { ...override, edit: message.until, until: message.until, framesWaited: 0 });
        scheduleSettle();
      }
      break;
    }
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
  assert(overrides.size <= LIVE_RULE_LIMITS.entriesMax, 'receiveLiveRules: previews stay bounded');
  assert(patchesByKey.size <= overrides.size, 'receiveLiveRules: patches belong to held previews');
  return true;
}


interface HoverEntry {
  readonly element: ElementCSSInlineStyle & Element;
  readonly own: readonly { readonly property: string; readonly value: string; readonly priority: string }[];
  readonly hadStyle: boolean;
}

interface HoverSettle {
  readonly framesWaited: number;
  readonly wanted: readonly (readonly string[])[];
}

let hover:
  | {
      readonly declarations: readonly HoverDeclaration[];
      readonly entries: readonly HoverEntry[];
      readonly settle: HoverSettle | undefined;
    }
  | undefined = undefined;
let hoverFrameScheduled = false;

function receiveHoverStyle(input: unknown): boolean {
  const message = parseHoverStyleMessage(input);
  if (message === undefined) {
    return false;
  }
  switch (message.op) {
    case 'clear':
      clearHoverStyle();
      break;
    case 'settle':
      settleHoverStyle();
      break;
    case 'show':
      clearHoverStyle();
      showHoverStyle(message.path, message.declarations);
      break;
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
  assert(hover === undefined || hover.entries.length <= HOVER_STYLE_LIMITS.elementsMax, 'receiveHoverStyle: bounded');
  return true;
}

function showHoverStyle(path: string, declarations: readonly HoverDeclaration[]): void {
  assert(hover === undefined, 'showHoverStyle: the last preview is gone first');
  const entries: HoverEntry[] = [];
  for (const element of elementsWithPath(path)) {
    if (entries.length >= HOVER_STYLE_LIMITS.elementsMax) {
      break;
    }
    if (!hasInlineStyle(element)) {
      continue;
    }
    const own = declarations.map(({ property }) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    }));
    entries.push({ element, own, hadStyle: element.hasAttribute('style') });
    for (const { property, value, important } of declarations) {
      element.style.setProperty(property, value, important ? 'important' : '');
    }
  }
  hover = { declarations, entries, settle: undefined };
}

function clearHoverStyle(): void {
  const shown = hover;
  hover = undefined;
  if (shown === undefined) {
    return;
  }
  for (let index = shown.entries.length - 1; index >= 0; index -= 1) {
    const entry = shown.entries[index];
    assert(entry !== undefined, 'clearHoverStyle: index within entries');
    putOwnStyleBack(entry);
  }
}

function putOwnStyleBack(entry: HoverEntry): void {
  for (let index = entry.own.length - 1; index >= 0; index -= 1) {
    const own = entry.own[index];
    assert(own !== undefined, 'putOwnStyleBack: index within declarations');
    if (own.value === '') {
      entry.element.style.removeProperty(own.property);
    } else {
      entry.element.style.setProperty(own.property, own.value, own.priority);
    }
  }
  if (!entry.hadStyle) {
    if (entry.element.style.length === 0) {
      entry.element.removeAttribute('style');
    }
  }
}

function settleHoverStyle(): void {
  const shown = hover;
  if (shown === undefined) {
    return;
  }
  if (shown.settle !== undefined) {
    return;
  }
  const wanted = shown.entries.map((entry) => computedOf(entry, shown.declarations));
  hover = { ...shown, settle: { framesWaited: 0, wanted } };
  scheduleHoverFrame();
}

function scheduleHoverFrame(): void {
  if (hoverFrameScheduled) {
    return;
  }
  hoverFrameScheduled = true;
  requestAnimationFrame(hoverFrame);
}

function hoverFrame(): void {
  hoverFrameScheduled = false;
  const shown = hover;
  if (shown === undefined) {
    return;
  }
  const settle = shown.settle;
  if (settle === undefined) {
    return;
  }
  let agrees = true;
  for (let index = 0; index < shown.entries.length; index += 1) {
    const entry = shown.entries[index];
    assert(entry !== undefined, 'hoverFrame: index within entries');
    putOwnStyleBack(entry);
    const now = computedOf(entry, shown.declarations);
    if (now.join('\n') !== (settle.wanted[index] ?? []).join('\n')) {
      agrees = false;
    }
  }
  if (agrees) {
    hover = undefined;
    return;
  }
  if (settle.framesWaited + 1 >= HOVER_STYLE_LIMITS.settleFramesMax) {
    hover = undefined;
    return;
  }
  for (const entry of shown.entries) {
    for (const { property, value, important } of shown.declarations) {
      entry.element.style.setProperty(property, value, important ? 'important' : '');
    }
  }
  hover = { ...shown, settle: { ...settle, framesWaited: settle.framesWaited + 1 } };
  scheduleHoverFrame();
}

function computedOf(entry: HoverEntry, declarations: readonly HoverDeclaration[]): readonly string[] {
  const view = entry.element.ownerDocument.defaultView;
  if (view === null) {
    return [];
  }
  const style = view.getComputedStyle(entry.element);
  return declarations.map(({ property }) => style.getPropertyValue(property));
}

function hasInlineStyle(element: Element): element is ElementCSSInlineStyle & Element {
  return 'style' in element && element.style instanceof Object && 'setProperty' in element.style;
}

export function hoverStyleCount(): number {
  return hover?.entries.length ?? 0;
}

export function liveRuleCount(): number {
  return overrides.size;
}

function makeRoom(): void {
  if (overrides.size < LIVE_RULE_LIMITS.entriesMax) {
    return;
  }
  const [oldestKey, oldest] = overrides.entries().next().value ?? [];
  assert(oldestKey !== undefined, 'makeRoom: a full map has an oldest entry');
  assert(oldest !== undefined, 'makeRoom: the oldest entry has a value');
  restore(oldestKey, oldest.rule.property);
  overrides.delete(oldestKey);
}

function patch(key: string, target: LiveRuleTarget, edit: LiveRuleEdit): void {
  const patches = [...livePatches(key)];
  const found = matchingRules(document, target);
  if (!found.ok) {
    reportOnce(found.error);
    return;
  }
  for (const rule of found.value) {
    if (!patches.some((entry) => entry.rule === rule)) {
      if (patches.length < LIVE_RULE_LIMITS.patchesMax) {
        patches.push({ rule, value: rule.style.getPropertyValue(target.property), priority: rule.style.getPropertyPriority(target.property) });
      } else {
        continue;
      }
    }
    write(rule, target.property, edit);
  }
  assert(patches.length <= LIVE_RULE_LIMITS.patchesMax, 'patch: patches stay bounded');
  setPatches(key, patches);
}

function restore(key: string, property: string): void {
  const patches = livePatches(key);
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const entry = patches[index];
    assert(entry !== undefined, 'restore: index within patches');
    if (entry.value === '') {
      entry.rule.style.removeProperty(property);
    } else {
      entry.rule.style.setProperty(property, entry.value, entry.priority);
    }
  }
  patchesByKey.delete(key);
}

function livePatches(key: string): readonly Patch[] {
  const patches = patchesByKey.get(key) ?? [];
  const live = patches.filter((entry) => attached(entry.rule));
  setPatches(key, live);
  return live;
}

function setPatches(key: string, patches: readonly Patch[]): void {
  if (patches.length === 0) {
    patchesByKey.delete(key);
  } else {
    patchesByKey.set(key, patches);
  }
}

function write(rule: CSSStyleRule, property: string, edit: LiveRuleEdit): void {
  switch (edit.kind) {
    case 'value':
      rule.style.setProperty(property, edit.value, edit.important ? 'important' : '');
      return;
    case 'removed':
      rule.style.removeProperty(property);
      return;
    default: {
      const exhaustive: never = edit;
      return exhaustive;
    }
  }
}

function attached(rule: CSSStyleRule): boolean {
  const sheet = rule.parentStyleSheet;
  if (sheet === null) {
    return false;
  }
  const owner = sheet.ownerNode;
  if (owner === null) {
    return false;
  }
  if (!owner.isConnected) {
    return false;
  }
  return 'sheet' in owner && owner.sheet === sheet;
}


function scheduleSettle(): void {
  if (settleScheduled) {
    return;
  }
  settleScheduled = true;
  requestAnimationFrame(settle);
}

function settle(): void {
  settleScheduled = false;
  for (const [key, override] of [...overrides]) {
    const until = override.until;
    if (until === undefined) {
      continue;
    }
    const patches = livePatches(key);
    const found = matchingRules(document, override.rule);
    const rules = found.ok ? found.value : [];
    if (patches.length === 0) {
      if (rules.every((rule) => holds(rule, override.rule.property, until))) {
        overrides.delete(key);
        continue;
      }
    }
    if (override.framesWaited + 1 >= LIVE_RULE_LIMITS.settleFramesMax) {
      restore(key, override.rule.property);
      overrides.delete(key);
      continue;
    }
    overrides.set(key, { ...override, framesWaited: override.framesWaited + 1 });
    patch(key, override.rule, until);
  }
  if ([...overrides.values()].some((override) => override.until !== undefined)) {
    scheduleSettle();
  }
}

function holds(rule: CSSStyleRule, property: string, edit: LiveRuleEdit): boolean {
  const value = rule.style.getPropertyValue(property);
  switch (edit.kind) {
    case 'removed':
      return value === '';
    case 'value': {
      if (value !== canonicalValue(property, edit.value)) {
        return false;
      }
      return (rule.style.getPropertyPriority(property) === 'important') === edit.important;
    }
    default: {
      const exhaustive: never = edit;
      return exhaustive;
    }
  }
}

let scratch: CSSStyleDeclaration | undefined = undefined;

function canonicalValue(property: string, value: string): string {
  scratch ??= document.createElement('div').style;
  scratch.removeProperty(property);
  scratch.setProperty(property, value);
  const canonical = scratch.getPropertyValue(property);
  scratch.removeProperty(property);
  return canonical === '' ? value.trim() : canonical;
}


const reported = new WeakSet<CSSStyleSheet>();
const problems: LiveRuleProblem[] = [];

function reportOnce(problem: LiveRuleProblem & { readonly sheet: CSSStyleSheet }): void {
  if (reported.has(problem.sheet)) {
    return;
  }
  reported.add(problem.sheet);
  if (problems.length < LIVE_RULE_LIMITS.entriesMax) {
    problems.push({ code: problem.code, message: problem.message });
  }
  console.warn(`Stacki live rule preview: ${problem.message}`);
}

export function liveRuleProblems(): readonly LiveRuleProblem[] {
  return problems;
}

export function matchingRules(page: Document, target: LiveRuleTarget): Result<readonly CSSStyleRule[], LiveRuleProblem & { readonly sheet: CSSStyleSheet }> {
  const context = target.context.filter(isConditionAtRule).map(normalizeAtRule).join('\n');
  const wanted = sourceSelectorKey(target.selector);
  const rules: CSSStyleRule[] = [];
  const own = sheetsOf(page, (sheetPath) => sheetPathIsSource(sheetPath, target.source));
  const imported = own.length === 0 && isPlainStylesheet(target.source);
  const sheets = imported ? sheetsOf(page, (sheetPath) => isPlainStylesheet(sheetPath)) : own;
  for (const { sheet, sheetPath } of sheets) {
    const index = sheetIndex(sheet, sheetPath);
    if (index === undefined) {
      continue;
    }
    if (index.kind === 'over-cap') {
      const message = `${target.source} has more than ${LIVE_RULE_LIMITS.sheetRulesMax} rules in one stylesheet; edits show once saved.`;
      return err({ code: 'rules-over-cap', message, sheet });
    }
    const scope = index.scoped ? wanted.scope : 'global';
    for (const rule of index.rules.get(indexKey(context, scope, wanted.selector)) ?? []) {
      if (rule.parentStyleSheet === sheet) {
        rules.push(rule);
      }
    }
  }
  assert(rules.length <= LIVE_RULE_LIMITS.sheetRulesMax, 'matchingRules: bounded by the index');
  if (imported) {
    return ok(rules.length === 1 ? rules : []);
  }
  return ok(rules);
}

function sheetsOf(page: Document, accepts: (sheetPath: string) => boolean): readonly { readonly sheet: CSSStyleSheet; readonly sheetPath: string }[] {
  const found: { readonly sheet: CSSStyleSheet; readonly sheetPath: string }[] = [];
  for (let sheetAt = 0; sheetAt < page.styleSheets.length; sheetAt += 1) {
    const sheet = page.styleSheets.item(sheetAt);
    if (sheet === null) {
      continue;
    }
    const sheetPath = sheetPathOf(sheet);
    if (sheetPath === undefined) {
      continue;
    }
    if (accepts(sheetPath)) {
      found.push({ sheet, sheetPath });
    }
  }
  assert(found.length <= page.styleSheets.length, 'sheetsOf: a subset of the page sheets');
  return found;
}

function isPlainStylesheet(path: string): boolean {
  const queryAt = path.indexOf('?');
  const file = queryAt < 0 ? path : path.slice(0, queryAt);
  return /\.(?:css|scss|sass|less|styl|pcss|postcss)$/i.test(file);
}

function sheetPathOf(sheet: CSSStyleSheet): string | undefined {
  const owner = sheet.ownerNode;
  if (owner === null || !('getAttribute' in owner)) {
    return undefined;
  }
  const devId = owner.getAttribute('data-vite-dev-id');
  if (devId !== null) {
    return devId;
  }
  if (sheet.href === null) {
    return undefined;
  }
  try {
    return decodeURIComponent(new URL(sheet.href).pathname);
  } catch {
    return undefined;
  }
}


type SheetIndex =
  { readonly kind: 'indexed'; readonly scoped: boolean; readonly rules: ReadonlyMap<string, readonly CSSStyleRule[]> } | { readonly kind: 'over-cap' };

const indexes = new WeakMap<CSSStyleSheet, SheetIndex>();

function indexKey(context: string, scope: 'scoped' | 'global', selector: string): string {
  return `${context}\n\n${scope}\n${selector}`;
}

function sheetIndex(sheet: CSSStyleSheet, sheetPath: string): SheetIndex | undefined {
  const known = indexes.get(sheet);
  if (known !== undefined) {
    return known;
  }
  let list: CSSRuleList;
  try {
    list = sheet.cssRules;
  } catch {
    return undefined;
  }
  const collected = collectStyleRules(list);
  if (collected === undefined) {
    indexes.set(sheet, { kind: 'over-cap' });
    return { kind: 'over-cap' };
  }
  const ownScope = sheetPathIsAstroStyle(sheetPath) ? sheetScopeOf(collected.map((entry) => entry.rule.selectorText)) : undefined;
  const index = buildIndex(collected, ownScope);
  indexes.set(sheet, index);
  return index;
}

interface Collected {
  readonly rule: CSSStyleRule;
  readonly context: string;
}

function collectStyleRules(list: CSSRuleList): readonly Collected[] | undefined {
  const collected: Collected[] = [];
  const pending: { readonly rules: CSSRuleList; readonly chain: readonly string[] }[] = [{ rules: list, chain: [] }];
  let visited = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    assert(entry !== undefined, 'collectStyleRules: stack underflow');
    for (let ruleAt = 0; ruleAt < entry.rules.length; ruleAt += 1) {
      const rule = entry.rules.item(ruleAt);
      if (rule === null) {
        continue;
      }
      visited += 1;
      if (visited > LIVE_RULE_LIMITS.sheetRulesMax) {
        return undefined;
      }
      if (isStyleRule(rule)) {
        collected.push({ rule, context: entry.chain.join('\n') });
        continue;
      }
      const prelude = groupingPrelude(rule);
      if (prelude === undefined) {
        continue;
      }
      if (!(rule instanceof CSSGroupingRule)) {
        continue;
      }
      if (entry.chain.length < LIVE_RULE_LIMITS.contextMax) {
        const chain = isConditionAtRule(prelude) ? [...entry.chain, normalizeAtRule(prelude)] : entry.chain;
        pending.push({ rules: rule.cssRules, chain });
      }
    }
  }
  assert(visited <= LIVE_RULE_LIMITS.sheetRulesMax, 'collectStyleRules: visits stay under the cap');
  return collected;
}

function buildIndex(collected: readonly Collected[], ownScope: string | undefined): SheetIndex {
  const rules = new Map<string, CSSStyleRule[]>();
  for (const entry of collected) {
    const key = selectorKeyOf(entry.rule.selectorText, ownScope);
    const indexed = indexKey(entry.context, key.scope, key.selector);
    const bucket = rules.get(indexed);
    if (bucket === undefined) {
      rules.set(indexed, [entry.rule]);
    } else {
      bucket.push(entry.rule);
    }
  }
  assert(rules.size <= collected.length, 'buildIndex: one key per rule at most');
  return { kind: 'indexed', scoped: ownScope !== undefined, rules };
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return rule.constructor.name === 'CSSStyleRule' && 'selectorText' in rule && 'style' in rule;
}

function groupingPrelude(rule: CSSRule): string | undefined {
  switch (rule.constructor.name) {
    case 'CSSMediaRule':
      return 'media' in rule && rule.media instanceof Object && 'mediaText' in rule.media ? `@media ${String(rule.media.mediaText)}` : undefined;
    case 'CSSSupportsRule':
      return 'conditionText' in rule ? `@supports ${String(rule.conditionText)}` : undefined;
    case 'CSSContainerRule':
      return 'conditionText' in rule ? `@container ${String(rule.conditionText)}` : undefined;
    case 'CSSLayerBlockRule':
      return 'name' in rule ? `@layer ${String(rule.name)}` : undefined;
    default:
      return undefined;
  }
}
