
import postcss, { type Root, type Rule, type AtRule, type ChildNode } from 'postcss';
import type { ParsedDeclaration, ParsedRule, StyleRegion } from './styleTypes';
import { LayerRegistry, layerNamesOf, type LayerPosition } from './cascadeLayers';
import { parseSelectorList, selectorListMembers } from './selectors';
import { ruleChainLevels, ruleHead, ruleLayout, sourceTextFromEditor } from './cssRuleText';
import { assert } from '../../../../shared/core/assert';
import type { TemplateWrapper } from '../../../../shared/properties/newStyleTag';
import { LIMITS } from '../../../../shared/core/limits';
import { failureOf, type Failure } from './failureMessage';
import {
  type DeclarationValue,
  squash,
  childRule,
  childAtRule,
  findChildRuleBySelector,
  setDeclOnRule,
  appendDecl,
  placeChild,
  setDeclDirect,
} from './cssRegions';
export { type DeclarationValue, extractStyleRegions, parseRegion, splitEmbed, renderEmbed, regionText, directDecls, appendDecl } from './cssRegions';

export { atRuleQueryText, queryKey, splitQuery, countAtRuleQuery, renameAtRuleQuery } from './cssQueries';
import { splitQuery } from './cssQueries';

type WalkContext = {
  embedKey: string;
  embedLabel: string;
  fromComponent: boolean;
  componentName: string | undefined;
  regionIndex: number;
  idSeed: string;
  order: { n: number };
  layers?: LayerRegistry;
  baseLayer?: readonly string[] | undefined;
};

function splitTopLevelCommas(text: string): string[] {
  return selectorListMembers(text).map((member) => member.text);
}

function combineNesting(parent: string, selector: string): string {
  const trimmed = selector.trim();
  if (trimmed.includes('&')) {
    return trimmed.replace(/&/g, parent);
  }
  return `${parent} ${trimmed}`;
}

function resolveNestedSelectors(rawSelector: string, parents: string[]): string[] {
  const nested = splitTopLevelCommas(rawSelector);
  const out: string[] = [];
  for (const parent of parents) {
    for (const selector of nested) {
      out.push(combineNesting(parent, selector));
    }
  }
  return out;
}

export function resolveSelectorChain(rawSelectors: readonly string[]): string {
  assert(rawSelectors.length <= LIMITS.treeDepthMax, 'resolveSelectorChain: a chain is no deeper than a parsed tree');
  let parents: string[] | undefined;
  for (const raw of rawSelectors) {
    parents = parents === undefined ? splitTopLevelCommas(raw) : resolveNestedSelectors(raw, parents);
  }
  const resolved = (parents ?? []).map((selector) => selector.trim().replace(/\s+/g, ' ')).filter((selector) => selector.length > 0);
  assert(
    resolved.every((selector) => !/\s{2}/.test(selector)),
    'resolveSelectorChain: whitespace is collapsed',
  );
  return resolved.join(', ');
}

function renderNestedPath(parts: string[], depth = 0): string {
  assert(depth <= LIMITS.treeDepthMax, 'renderNestedPath: depth limit');
  if (!parts.length) {
    return '';
  }
  const [head = '', ...rest] = parts;
  if (head === '@') {
    return rest.length ? `@ ${renderNestedPath(rest, depth + 1)}` : '@';
  }
  const restText = renderNestedPath(rest, depth + 1);
  if (rest.some((part) => part !== '@') || (depth === 0 && rest.length)) {
    return `${head} {${restText}}`;
  }
  return restText ? `${head} ${restText}` : head;
}

export function collectRules(region: StyleRegion, context: WalkContext): ParsedRule[] {
  if (!region.root) {
    return [];
  }
  const rules: ParsedRule[] = [];
  let ruleCounter = 0;
  const layers = context.layers ?? new LayerRegistry();
  const layerStack: string[] = [...(context.baseLayer ?? [])];
  const layerOfRule = () => (layerStack.length === 0 ? undefined : layers.positionOf(layerStack));
  let anonymousLayers = 0;

  const walk = (container: Root | Rule | AtRule, atContext: string[], parentSelectors: string[] | undefined, ancestorDisplay: string[], depth: number) => {
    if (depth > LIMITS.treeDepthMax) {
      return;
    }
    container.each((child: ChildNode) => {
      if (child.type === 'rule') {
        const node = child as Rule;
        const raw = node.selector.trim();
        const resolved = parentSelectors ? resolveNestedSelectors(node.selector, parentSelectors) : undefined;
        const displayPath = raw === '&' ? ancestorDisplay : [...ancestorDisplay, raw];
        const selectorsOnly = displayPath.filter((part) => part !== '@');
        const nestedDisplay = selectorsOnly.length > 1 ? renderNestedPath(selectorsOnly) : undefined;
        const queryDisplay = displayPath.includes('@') ? renderNestedPath(displayPath) : undefined;
        rules.push(withLayer(buildRule(node, atContext, context, ruleCounter++, resolved, nestedDisplay, queryDisplay), layerOfRule()));
        const nextSelectors = resolved ?? splitTopLevelCommas(node.selector);
        walk(node, atContext, nextSelectors, displayPath, depth + 1);
      } else if (child.type === 'atrule') {
        const at = child as AtRule;
        const name = at.name.toLowerCase();
        if (name === 'media' || name === 'supports' || name === 'container') {
          const nextContext = [...atContext, `@${at.name} ${at.params}`.trim()];
          const nextDisplay = [...ancestorDisplay, '@'];
          if (parentSelectors && parentSelectors.length && at.nodes !== undefined && at.some((child) => child.type === 'decl')) {
            const selectorsOnly = nextDisplay.filter((part) => part !== '@');
            const nestedDisplay = selectorsOnly.length > 1 ? renderNestedPath(selectorsOnly) : undefined;
            const queryDisplay = renderNestedPath(nextDisplay);
            rules.push(
              withLayer(buildRule(at as unknown as Rule, nextContext, context, ruleCounter++, parentSelectors, nestedDisplay, queryDisplay), layerOfRule()),
            );
          }
          walk(at, nextContext, parentSelectors, nextDisplay, depth + 1);
        } else if (name === 'layer') {
          const names = layerNamesOf(at.params);
          if (at.nodes === undefined) {
            for (const path of names) {
              layers.positionOf([...layerStack, ...path]);
            }
          } else {
            const path = names[0] ?? [`\u0000anonymous-${context.embedKey}-${anonymousLayers++}`];
            const outer = layerStack.length;
            layerStack.push(...path);
            walk(at, atContext, parentSelectors, ancestorDisplay, depth + 1);
            layerStack.length = outer;
          }
        }
      }
    });
  };

  walk(region.root, [], undefined, [], 0);
  return rules;
}

export type NestStep = { kind: 'selector'; selector: string } | { kind: 'atrule'; name: string; params: string };

export function parseNestedInput(input: string): { selector: string; atContext: string[]; path: NestStep[] } | undefined {
  const text = input.trim();
  if (!text) {
    return undefined;
  }
  const normalized = text.replace(/([^{}]+?)\s*\}/g, (_match, content) => {
    const trimmed = String(content).trim();
    return trimmed ? `${trimmed} {} }` : ' }';
  });
  let root: Root;
  try {
    root = postcss.parse(normalized);
  } catch {
    return undefined;
  }
  const path: NestStep[] = [];
  const QUERY_ATS = new Set(['media', 'container', 'supports']);
  let container: Root | Rule | AtRule = root;
  while (path.length < LIMITS.treeDepthMax) {
    const children: ChildNode[] = [];
    container.each((child: ChildNode) => {
      children.push(child);
    });
    const next = children.find((child) => child.type === 'rule' || (child.type === 'atrule' && QUERY_ATS.has((child as AtRule).name.toLowerCase())));
    if (!next) {
      break;
    }
    if (next.type === 'rule') {
      path.push({ kind: 'selector', selector: (next as Rule).selector.trim() });
      container = next as Rule;
    } else {
      const at = next as AtRule;
      path.push({ kind: 'atrule', name: at.name.toLowerCase(), params: at.params.trim() });
      container = at;
    }
  }
  if (path.length === LIMITS.treeDepthMax) {
    return undefined;
  }
  if (!path.length) {
    return undefined;
  }
  let selector = '';
  const atContext: string[] = [];
  for (const step of path) {
    if (step.kind === 'selector') {
      const first = splitTopLevelCommas(step.selector)[0] ?? step.selector;
      selector = selector ? combineNesting(selector, first) : first;
    } else {
      atContext.push(`@${step.name} ${step.params}`.trim());
    }
  }
  return { selector, atContext, path };
}

export function createNestedRule(region: StyleRegion, path: NestStep[], prop: string, declared: DeclarationValue): boolean {
  if (!region.root || !path.length) {
    return false;
  }
  const cleanProp = prop.trim();
  const cleanValue = declared.value.trim();
  if (!cleanProp || !cleanValue) {
    return false;
  }
  let container: Root | Rule | AtRule = region.root;
  for (const step of path) {
    const level = findOrMakeStep(container, step);
    if (level.created) {
      container.append(level.node);
      if (container.type !== 'root') {
        placeChild(container, level.node);
      }
    }
    container = level.node;
  }
  const leaf = path[path.length - 1];
  if (leaf === undefined) {
    return false;
  }
  if (container.type === 'rule') {
    assert(leaf.kind === 'selector', 'createNestedRule: a selector step builds a rule');
    appendDecl(container, cleanProp, { value: cleanValue, important: declared.important });
    container.raws.semicolon = true;
    return true;
  }
  assert(container.type === 'atrule', 'createNestedRule: a query step builds an at-rule');
  setDeclDirect(container, cleanProp, { value: cleanValue, important: declared.important });
  return true;
}

function findOrMakeStep(container: Root | Rule | AtRule, step: NestStep): { readonly node: Rule | AtRule; readonly created: boolean } {
  if (step.kind === 'selector') {
    const found = childRule(container, (rule) => squash(rule.selector) === squash(step.selector));
    return found ? { node: found, created: false } : { node: postcss.rule({ selector: step.selector }), created: true };
  }
  const found = childAtRule(container, step.name, step.params);
  return found ? { node: found, created: false } : { node: postcss.atRule({ name: step.name, params: step.params }), created: true };
}

export type BlockPlacement = { readonly kind: 'top-level' } | { readonly kind: 'nested'; readonly wrapper: string };

export type AtRuleBlock = {
  atContext: string[];
  node: AtRule;
  selectors: string[];
  placement: BlockPlacement;
};

export function listAtRuleBlocks(region: StyleRegion): AtRuleBlock[] {
  if (!region.root) {
    return [];
  }
  const blocks: AtRuleBlock[] = [];

  const walk = (container: Root | Rule | AtRule, atContext: string[], enclosing: readonly string[], depth: number) => {
    if (depth > LIMITS.treeDepthMax) {
      return;
    }
    container.each((child: ChildNode) => {
      if (child.type === 'rule') {
        walk(child, atContext, [...enclosing, child.selector.trim()], depth + 1);
        return;
      }
      if (child.type !== 'atrule') {
        return;
      }
      const at = child as AtRule;
      const name = at.name.toLowerCase();
      if (name === 'media' || name === 'supports' || name === 'container') {
        const blockContext = [...atContext, `@${at.name} ${at.params}`.trim()];
        const selectors: string[] = [];
        at.each((node) => {
          if (node.type === 'rule') {
            selectors.push((node as Rule).selector.trim());
          }
        });
        const wrapper = resolveSelectorChain(enclosing);
        const placement: BlockPlacement = wrapper.length === 0 ? { kind: 'top-level' } : { kind: 'nested', wrapper };
        blocks.push({ atContext: blockContext, node: at, selectors, placement });
        walk(at, blockContext, enclosing, depth + 1);
      } else if (name === 'layer' && at.nodes) {
        walk(at, atContext, enclosing, depth + 1);
      }
    });
  };

  walk(region.root, [], [], 0);
  return blocks;
}

function appendTopLevel(root: Root, node: ChildNode): void {
  const wasEmpty = !root.nodes || root.nodes.length === 0;
  const previous = blockRaws(root.last);
  root.append(node);
  if (wasEmpty) {
    node.assign({ raws: { ...node.raws, before: '\n' } });
    return;
  }
  if (previous === undefined) {
    return;
  }
  if (node.type !== 'rule' && node.type !== 'atrule') {
    return;
  }
  const lineIndent = previous.before.includes('\n') ? previous.before.slice(previous.before.lastIndexOf('\n') + 1) : '';
  const before = previous.before.includes('\n') ? previous.before : `\n${lineIndent}`;
  const after = `\n${lineIndent}`;
  node.assign({ raws: { ...node.raws, before, after } });
  assert((node.raws.before ?? '').includes('\n'), 'appendTopLevel: a new block starts a line');
  assert((node.raws.after ?? '').includes('\n'), 'appendTopLevel: a new block closes on a line of its own');
}

function blockRaws(node: ChildNode | undefined): { readonly before: string; readonly after: string } | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (node.type !== 'rule' && node.type !== 'atrule') {
    return undefined;
  }
  const { before, after } = node.raws;
  if (before === undefined || after === undefined) {
    return undefined;
  }
  return { before, after };
}

export function createRuleInAtRule(atRule: AtRule, selector: string, prop: string, declared: DeclarationValue): boolean {
  const cleanProp = prop.trim();
  const cleanValue = declared.value.trim();
  if (!cleanProp || !cleanValue) {
    return false;
  }
  const existing = findChildRuleBySelector(atRule, selector);
  if (existing) {
    setDeclOnRule(existing, cleanProp, { value: cleanValue, important: declared.important });
    return true;
  }
  const rule = postcss.rule({ selector });
  atRule.append(rule);
  placeChild(atRule, rule);
  setDeclOnRule(rule, cleanProp, { value: cleanValue, important: declared.important });
  placeNewRuleBody(rule);
  return true;
}

function placeNewRuleBody(rule: Rule): void {
  assert(rule.parent !== undefined, 'placeNewRuleBody: the rule is attached');
  const children = rule.nodes ?? [];
  assert(children.length <= LIMITS.treeNodesMax, "placeNewRuleBody: the rule's body is bounded");
  for (const child of children) {
    placeChild(rule, child);
  }
}

export function createRuleInMedia(region: StyleRegion, params: string, selector: string, prop: string, declared: DeclarationValue): boolean {
  if (!region.root) {
    return false;
  }
  const want = squash(params);
  const matching: AtRule[] = [];
  region.root.walkAtRules('media', (atRule) => {
    if (squash(atRule.params) === want) {
      matching.push(atRule);
    }
  });
  let target = matching[0];
  if (!target) {
    target = postcss.atRule({ name: 'media', params });
    appendTopLevel(region.root, target);
  }
  return createRuleInAtRule(target, selector, prop, declared);
}

export function createRuleInQuery(region: StyleRegion, atContextKey: string, selector: string, prop: string, declared: DeclarationValue): boolean {
  if (!region.root) {
    return false;
  }
  const container = ensureQueryChain(region.root, querySegments(atContextKey));
  if (container === undefined || container.type === 'root') {
    return false;
  }
  return createRuleInAtRule(container, selector, prop, declared);
}

export function createRuleInPlacedQuery(
  region: StyleRegion,
  where: { readonly atContextKey: string; readonly wrapper: string; readonly selector: string },
  prop: string,
  declared: DeclarationValue,
): boolean {
  if (!region.root || !prop.trim() || !declared.value.trim()) {
    return false;
  }
  const wrapper = collapseSpaces(where.wrapper);
  const selector = collapseSpaces(where.selector);
  assert(wrapper.length > 0, 'createRuleInPlacedQuery: a nested query has a wrapper');
  const block = listAtRuleBlocks(region).find(
    (entry) => entry.atContext.join(' › ') === where.atContextKey && entry.placement.kind === 'nested' && entry.placement.wrapper === wrapper,
  );
  const inner = selector === wrapper ? undefined : selector.startsWith(`${wrapper} `) ? selector.slice(wrapper.length + 1) : selector;
  if (block !== undefined) {
    if (inner === undefined) {
      setDeclDirect(block.node, prop.trim(), { value: declared.value.trim(), important: declared.important });
      return true;
    }
    return createRuleInAtRule(block.node, inner, prop, declared);
  }
  const steps: NestStep[] = [{ kind: 'selector', selector: wrapper }];
  for (const segment of querySegments(where.atContextKey)) {
    const query = splitQuery(segment);
    if (query === undefined) {
      return false;
    }
    steps.push({ kind: 'atrule', name: query.name.toLowerCase(), params: query.params });
  }
  if (inner !== undefined) {
    steps.push({ kind: 'selector', selector: inner });
  }
  assert(steps.length >= 2, 'createRuleInPlacedQuery: a wrapper and at least one query');
  return createNestedRule(region, steps, prop, declared);
}

function collapseSpaces(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function querySegments(atContextKey: string): string[] {
  return atContextKey
    .split('›')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function ensureQueryChain(root: Root, segments: readonly string[]): Root | AtRule | undefined {
  let container: Root | AtRule = root;
  for (const segment of segments) {
    const match = /^@(\w+)\s*([\s\S]*)$/.exec(segment);
    if (!match) {
      return undefined;
    }
    const name = (match[1] ?? '').toLowerCase();
    const params = (match[2] ?? '').trim();
    let found = childAtRule(container, name, params);
    if (!found) {
      found = postcss.atRule({ name, params });
      if (container.type === 'root') {
        appendTopLevel(container, found);
      } else {
        container.append(found);
        placeChild(container, found);
      }
    }
    container = found;
  }
  return container;
}

export function createRuleAtRoot(
  region: StyleRegion,
  selector: string,
  prop: string,
  declared: DeclarationValue,
  wrappers: readonly TemplateWrapper[] = [],
): boolean {
  if (!region.root) {
    return false;
  }
  const cleanProp = prop.trim();
  const cleanValue = declared.value.trim();
  if (!cleanProp || !cleanValue) {
    return false;
  }
  const existing = findChildRuleBySelector(region.root, selector);
  if (existing) {
    setDeclOnRule(existing, cleanProp, { value: cleanValue, important: declared.important });
    return true;
  }
  const container = wrapperContainer(region.root, wrappers);
  if (container !== undefined) {
    openEmptyWrapper(container);
    return createRuleInAtRule(container, selector, prop, declared);
  }
  const rule = postcss.rule({ selector });
  appendTopLevel(region.root, rule);
  setDeclOnRule(rule, cleanProp, { value: cleanValue, important: declared.important });
  placeNewRuleBody(rule);
  return true;
}

function openEmptyWrapper(container: AtRule): void {
  if ((container.nodes ?? []).length > 0) {
    return;
  }
  const before = container.raws.before ?? '';
  const lineIndent = before.includes('\n') ? before.slice(before.lastIndexOf('\n') + 1) : '';
  container.assign({ raws: { ...container.raws, after: `\n${lineIndent}` } });
  assert((container.raws.after ?? '').startsWith('\n'), 'openEmptyWrapper: the closing brace starts a line');
  assert(!/\n[ \t]*\n/.test(container.raws.after ?? ''), 'openEmptyWrapper: no blank line before the closing brace');
}

export function wrapperContainer(root: Root, wrappers: readonly TemplateWrapper[]): AtRule | undefined {
  assert(wrappers.length <= LIMITS.treeDepthMax, 'wrapperContainer: a template nests a bounded number of blocks');
  let container: Root | AtRule = root;
  let found: AtRule | undefined;
  for (const wrapper of wrappers) {
    const link: AtRule | undefined = (container.nodes ?? []).find(
      (child): child is AtRule => child.type === 'atrule' && child.name.toLowerCase() === wrapper.name && squash(child.params) === wrapper.params,
    );
    if (link === undefined) {
      return undefined;
    }
    found = link;
    container = link;
  }
  return found;
}

export function ensureQueryBlock(region: StyleRegion, atContextKey: string): boolean {
  const root = region.root;
  if (!root) {
    return false;
  }
  const segments = querySegments(atContextKey);
  if (!segments.length) {
    return false;
  }
  return ensureQueryChain(root, segments) !== undefined;
}

export function ensureNestPath(region: StyleRegion, path: NestStep[]): boolean {
  const root = region.root;
  if (!root || !path.length) {
    return false;
  }
  let container: Root | Rule | AtRule = root;
  for (const step of path) {
    const level = findOrMakeStep(container, step);
    if (level.created) {
      if (container === root) {
        appendTopLevel(root, level.node);
      } else if (container.type !== 'root') {
        container.append(level.node);
        placeChild(container, level.node);
      }
    }
    container = level.node;
  }
  return true;
}

function withLayer(rule: ParsedRule, layer: LayerPosition | undefined): ParsedRule {
  return layer === undefined ? rule : { ...rule, layer };
}

function buildRule(
  node: Rule,
  atContext: string[],
  context: WalkContext,
  index: number,
  resolvedSelectors?: string[],
  nestedDisplay?: string,
  queryDisplay?: string,
): ParsedRule {
  const ruleId = `${context.idSeed}:${context.regionIndex}:${index}`;
  const declarations: ParsedDeclaration[] = [];
  let declCounter = 0;
  node.each((child) => {
    if (child.type === 'decl') {
      declarations.push({
        declId: `${ruleId}:d${declCounter++}`,
        prop: child.prop.trim().toLowerCase(),
        value: child.value.trim(),
        important: child.important === true,
        node: child,
      });
    }
  });

  const selectorText = resolvedSelectors && resolvedSelectors.length ? resolvedSelectors.join(', ') : node.selector;
  const parents = ruleChainLevels(node);

  return {
    ruleId,
    order: context.order.n++,
    embedKey: context.embedKey,
    embedLabel: context.embedLabel,
    fromComponent: context.fromComponent,
    componentName: context.componentName,
    regionIndex: context.regionIndex,
    node,
    selectorText,
    ...(nestedDisplay === undefined ? {} : { nestedDisplay }),
    ...(queryDisplay === undefined ? {} : { queryDisplay }),
    ...(parents.length === 0 ? {} : { written: { parents, head: ruleHead(node) } }),
    atContext,
    selectors: parseSelectorList(selectorText),
    declarations,
  };
}

export function removeDeclaration(decl: ParsedDeclaration) {
  decl.node.remove();
}

export function removeRule(rule: ParsedRule) {
  rule.node.remove();
}

export function splitRuleSelectorAt(node: Rule, index: number): Rule | undefined {
  const selectors = node.selectors;
  if (index < 0 || index >= selectors.length || selectors.length <= 1) {
    return undefined;
  }
  const clone = node.clone();
  clone.selector = selectors[index] ?? '';
  if (!clone.raws.before?.includes('\n')) {
    clone.raws.before = `\n${clone.raws.before ?? ''}`;
  }
  node.assign({ selectors: selectors.filter((_, i) => i !== index) });
  node.parent?.insertAfter(node, clone);
  return clone;
}

export function removeRuleIfEmpty(rule: ParsedRule): boolean {
  let hasDeclaration = false;
  let hasNested = false;
  rule.node.each((node) => {
    if (node.type === 'decl') {
      hasDeclaration = true;
    } else if (node.type === 'rule' || node.type === 'atrule') {
      hasNested = true;
    }
  });
  if (hasDeclaration || hasNested) {
    return false;
  }
  rule.node.remove();
  return true;
}

export function addDeclaration(rule: ParsedRule, prop: string, declared: DeclarationValue): boolean {
  const cleanProp = prop.trim();
  const cleanValue = declared.value.trim();
  if (!cleanProp || !cleanValue) {
    return false;
  }
  appendDecl(rule.node, cleanProp, { value: cleanValue, important: declared.important });
  return true;
}

export function reorderDeclarations(rule: ParsedRule, orderedDeclIds: string[]) {
  const byId = new Map(rule.declarations.map((declaration) => [declaration.declId, declaration.node]));
  const nodes = orderedDeclIds.map((id) => byId.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node));
  nodes.forEach((node) => node.remove());
  nodes.forEach((node) => rule.node.append(node));
}

export function replaceRuleCss(rule: ParsedRule, editorCss: string): { ok: true } | Failure {
  const before = rule.node.raws.before;
  const sourceCss = sourceTextFromEditor(editorCss, ruleLayout(rule.node));
  try {
    const parsed = postcss.parse(sourceCss);
    const nodes = parsed.nodes.filter((node) => node.type === rule.node.type);
    if (!nodes.length) {
      return failureOf('styleModel.css.noRule');
    }
    const first = parsed.first;
    assert(first !== undefined, 'replaceRuleCss: a parse with a rule has a first node');
    if (before !== undefined) {
      first.assign({ raws: { ...first.raws, before } });
    }
    rule.node.replaceWith(...parsed.nodes);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
