import { assert } from '../core/assert';
import { record, text } from '../core/boundary';
import { toArray } from '../core/record';

export const COMPONENT_ACCESS_LIMITS = {
  rulesMax: 1024,
  pathCharsMax: 512,
  pathDepthMax: 32,
} as const satisfies Record<string, number>;

export class ComponentRulesBoundError extends Error {
  override readonly name = 'ComponentRulesBoundError';
}

export type ComponentRuleEffect = 'hide' | 'show';

export type ComponentRule =
  | { readonly kind: 'component'; readonly path: string; readonly effect: ComponentRuleEffect }
  | { readonly kind: 'folder'; readonly path: string; readonly effect: ComponentRuleEffect };

export type ComponentState = 'visible' | 'hidden';

export type ComponentDecision =
  | { readonly kind: 'default' }
  | { readonly kind: 'component'; readonly effect: ComponentRuleEffect }
  | { readonly kind: 'folder'; readonly folder: string; readonly effect: ComponentRuleEffect };

export interface ComponentResolution {
  readonly state: ComponentState;
  readonly decision: ComponentDecision;
}

export interface ComponentAccessIndex {
  readonly components: ReadonlyMap<string, ComponentRuleEffect>;
  readonly folders: ReadonlyMap<string, ComponentRuleEffect>;
}

export type ComponentTarget = { readonly kind: 'component' | 'folder'; readonly path: string };

export function parseComponentPath(input: unknown): string {
  const raw = text(input).replaceAll('\\', '/');
  const path = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  if (path.length === 0 || path.length > COMPONENT_ACCESS_LIMITS.pathCharsMax) {
    throw new Error(`A component path is 1 to ${COMPONENT_ACCESS_LIMITS.pathCharsMax} characters`);
  }
  const segments = path.split('/');
  if (segments.length > COMPONENT_ACCESS_LIMITS.pathDepthMax) {
    throw new Error(`A component path is at most ${COMPONENT_ACCESS_LIMITS.pathDepthMax} folders deep`);
  }
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`"${path}" is not a project path`);
    }
    if (/[\u0000-\u001f]/.test(segment)) {
      throw new Error(`"${path}" is not a project path`);
    }
  }
  assert(!path.startsWith('/'), 'A parsed component path is project-relative');
  assert(!path.endsWith('/'), 'A parsed component path has no trailing slash');
  return path;
}

export function parseComponentRules(input: unknown): readonly ComponentRule[] {
  if (input === undefined) {
    return [];
  }
  const items = toArray(input);
  if (items === undefined) {
    throw new Error('Component rules must be a list');
  }
  if (items.length > COMPONENT_ACCESS_LIMITS.rulesMax) {
    throw new Error(`A role has at most ${COMPONENT_ACCESS_LIMITS.rulesMax} component rules`);
  }
  const keyed = new Map<string, ComponentRule>();
  for (const item of items) {
    const rule = parseComponentRule(item);
    keyed.set(ruleKey(rule), rule);
  }
  const rules = [...keyed.values()];
  assert(rules.length <= items.length, 'Deduplication never adds rules');
  return rules;
}

function parseComponentRule(input: unknown): ComponentRule {
  const value = record(input);
  const kind = value['kind'];
  const path = parseComponentPath(value['path']);
  const effect = parseEffect(value['effect']);
  if (kind === 'component') {
    return { kind, path, effect };
  }
  if (kind === 'folder') {
    return { kind, path, effect };
  }
  throw new Error('A component rule is for a "component" or a "folder"');
}

function parseEffect(input: unknown): ComponentRuleEffect {
  if (input === undefined || input === 'hide') {
    return 'hide';
  }
  if (input === 'show') {
    return 'show';
  }
  throw new Error('A component rule hides or shows');
}

function ruleKey(rule: Pick<ComponentRule, 'kind' | 'path'>): string {
  return `${rule.kind}:${rule.path}`;
}

export function storedComponentRule(rule: ComponentRule): Readonly<Record<string, string>> {
  return rule.effect === 'show' ? { kind: rule.kind, path: rule.path, effect: 'show' } : { kind: rule.kind, path: rule.path };
}

export function componentAccessIndex(rules: readonly ComponentRule[]): ComponentAccessIndex {
  assert(rules.length <= COMPONENT_ACCESS_LIMITS.rulesMax, 'Component rules are bounded');
  const components = new Map<string, ComponentRuleEffect>();
  const folders = new Map<string, ComponentRuleEffect>();
  for (const rule of rules) {
    (rule.kind === 'component' ? components : folders).set(rule.path, rule.effect);
  }
  assert(components.size + folders.size <= rules.length, 'The index never holds more than the rules');
  return { components, folders };
}

export function resolveComponent(index: ComponentAccessIndex, file: string): ComponentResolution {
  assert(file.length > 0, 'A component has a file');
  assert(!file.startsWith('/'), 'A component file is project-relative');
  const own = index.components.get(file);
  if (own !== undefined) {
    return { state: stateOf(own), decision: { kind: 'component', effect: own } };
  }
  return resolveInFolders(index, file);
}

export function inheritedState(index: ComponentAccessIndex, path: string): ComponentResolution {
  assert(path.length > 0, 'A path is named');
  return resolveInFolders(index, path);
}

function resolveInFolders(index: ComponentAccessIndex, path: string): ComponentResolution {
  if (index.folders.size === 0) {
    return { state: 'visible', decision: { kind: 'default' } };
  }
  const segments = path.split('/');
  assert(segments.length <= COMPONENT_ACCESS_LIMITS.pathDepthMax + 1, 'A path is within the depth bound');
  for (let depth = Math.min(segments.length - 1, COMPONENT_ACCESS_LIMITS.pathDepthMax); depth >= 1; depth -= 1) {
    const folder = segments.slice(0, depth).join('/');
    const effect = index.folders.get(folder);
    if (effect !== undefined) {
      return { state: stateOf(effect), decision: { kind: 'folder', folder, effect } };
    }
  }
  return { state: 'visible', decision: { kind: 'default' } };
}

function stateOf(effect: ComponentRuleEffect): ComponentState {
  return effect === 'hide' ? 'hidden' : 'visible';
}

export function componentVisible(rules: readonly ComponentRule[], file: string): boolean {
  if (rules.length === 0) {
    return true;
  }
  return resolveComponent(componentAccessIndex(rules), file).state === 'visible';
}


export interface ComponentViewer {
  readonly isAdmin: boolean;
  readonly componentRules: readonly ComponentRule[];
}

export type ComponentSurface = 'browse' | 'search';

export type ComponentOffer = 'everywhere' | 'browse-only' | 'nowhere';

export function offeredOn(offer: ComponentOffer, surface: ComponentSurface): boolean {
  switch (offer) {
    case 'everywhere':
      return true;
    case 'browse-only':
      return surface === 'browse';
    case 'nowhere':
      return false;
    default: {
      const exhaustive: never = offer;
      return exhaustive;
    }
  }
}

export function componentOffers(viewer: ComponentViewer): (file: string | undefined) => ComponentOffer {
  if (viewer.componentRules.length === 0) {
    return () => 'everywhere';
  }
  const index = componentAccessIndex(viewer.componentRules);
  const hidden: ComponentOffer = viewer.isAdmin ? 'browse-only' : 'nowhere';
  return (file) => (file === undefined || resolveComponent(index, file).state === 'visible' ? 'everywhere' : hidden);
}

export function componentOffer(viewer: ComponentViewer, file: string | undefined): ComponentOffer {
  return componentOffers(viewer)(file);
}

export function componentAddable(viewer: ComponentViewer, file: string | undefined): boolean {
  return componentOffer(viewer, file) !== 'nowhere';
}

export function offeredComponents<T>(
  viewer: ComponentViewer,
  surface: ComponentSurface,
  items: readonly T[],
  fileOf: (item: T) => string | undefined,
): readonly T[] {
  if (viewer.componentRules.length === 0) {
    return items;
  }
  const offer = componentOffers(viewer);
  const kept = items.filter((item) => offeredOn(offer(fileOf(item)), surface));
  assert(kept.length <= items.length, 'Filtering never adds components');
  return kept;
}

export function componentRuleFile(component: {
  readonly file?: string | undefined;
  readonly folder?: string | undefined;
  readonly name: string;
  readonly isLayout?: boolean | undefined;
  readonly origin?: { readonly kind: string } | undefined;
}): string | undefined {
  assert(component.name.length > 0, 'A component has a name');
  if (component.origin?.kind === 'package') {
    return undefined;
  }
  if (component.file !== undefined && component.file.length > 0) {
    return component.file.replaceAll('\\', '/');
  }
  const base = component.isLayout === true ? 'src/layouts' : 'src/components';
  const folder = (component.folder ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  return [base, folder, `${component.name}.astro`].filter((part) => part !== '').join('/');
}

export function setComponentState(rules: readonly ComponentRule[], target: ComponentTarget, state: ComponentState): readonly ComponentRule[] {
  assert(target.path.length > 0, 'A target names a path');
  const kept = rules.filter((rule) => !replacedBy(rule, target));
  const inherited = inheritedState(componentAccessIndex(kept.filter((rule) => rule.kind === 'folder')), target.path).state;
  const next =
    inherited === state ? kept : [...kept, { kind: target.kind, path: target.path, effect: state === 'hidden' ? ('hide' as const) : ('show' as const) }];
  if (next.length > COMPONENT_ACCESS_LIMITS.rulesMax) {
    throw new ComponentRulesBoundError(`A role has at most ${COMPONENT_ACCESS_LIMITS.rulesMax} component rules`);
  }
  assert(resolveTarget(next, target) === state, 'The target now has the state asked for');
  return next;
}

function replacedBy(rule: ComponentRule, target: ComponentTarget): boolean {
  if (rule.kind === target.kind && rule.path === target.path) {
    return true;
  }
  return target.kind === 'folder' && rule.path.startsWith(`${target.path}/`);
}

function resolveTarget(rules: readonly ComponentRule[], target: ComponentTarget): ComponentState {
  const index = componentAccessIndex(rules);
  if (target.kind === 'component') {
    return resolveComponent(index, target.path).state;
  }
  const own = index.folders.get(target.path);
  return own === undefined ? inheritedState(index, target.path).state : stateOf(own);
}

export function moveComponentRules(rules: readonly ComponentRule[], from: ComponentTarget, to: string): readonly ComponentRule[] {
  assert(from.path.length > 0, 'A move starts somewhere');
  assert(to.length > 0, 'A move ends somewhere');
  const target = parseComponentPath(to);
  const moved: ComponentRule[] = [];
  const rest: ComponentRule[] = [];
  for (const rule of rules) {
    const renamed = renamedRule(rule, from, target);
    if (renamed === undefined) {
      rest.push(rule);
    } else {
      moved.push(renamed);
    }
  }
  const movedKeys = new Set(moved.map(ruleKey));
  const next = [...rest.filter((rule) => !movedKeys.has(ruleKey(rule))), ...moved];
  assert(next.length <= rules.length, 'A move never adds rules');
  assert(moved.length === rules.length - rest.length, 'Every rule is moved or stays');
  return next;
}

function renamedRule(rule: ComponentRule, from: ComponentTarget, target: string): ComponentRule | undefined {
  if (rule.kind === from.kind && rule.path === from.path) {
    return { ...rule, path: target };
  }
  if (from.kind === 'folder' && rule.path.startsWith(`${from.path}/`)) {
    return { ...rule, path: `${target}${rule.path.slice(from.path.length)}` };
  }
  return undefined;
}

export function missingComponentRules(rules: readonly ComponentRule[], files: readonly string[]): readonly ComponentRule[] {
  assert(rules.length <= COMPONENT_ACCESS_LIMITS.rulesMax, 'Component rules are bounded');
  if (rules.length === 0) {
    return rules;
  }
  const present = new Set(files);
  const folders = new Set<string>();
  for (const file of files) {
    const segments = file.split('/');
    for (let depth = 1; depth < Math.min(segments.length, COMPONENT_ACCESS_LIMITS.pathDepthMax + 1); depth += 1) {
      folders.add(segments.slice(0, depth).join('/'));
    }
  }
  const missing = rules.filter((rule) => !(rule.kind === 'component' ? present.has(rule.path) : folders.has(rule.path)));
  assert(missing.length <= rules.length, 'Missing rules are among the rules');
  return missing;
}

export function sameComponentRules(left: readonly ComponentRule[], right: readonly ComponentRule[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const keyed = new Map(left.map((rule) => [ruleKey(rule), rule.effect] as const));
  return right.every((rule) => keyed.get(ruleKey(rule)) === rule.effect);
}
