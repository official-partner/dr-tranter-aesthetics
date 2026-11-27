import * as fs from 'node:fs';
import * as path from 'node:path';
import { assert } from '../../shared/core/assert';
import {
  COMPONENT_DEFAULTS_FILE,
  DEFAULT_LIMITS,
  parseDefaultsSource,
  resolveComponentRecipe,
  type ComponentDefaults,
  type DefaultComponent,
  type DefaultValue,
  type RecipeChild,
  type ResolvedContent,
  type ResolvedNode,
  type ResolvedRecipe,
} from '../../shared/properties/componentDefaults';
import { defaultSlotInline, parsePropSchema, parseSlots } from '../parse/astroParser';
import { parseAttrs } from '../parse/astroAttrs';
import { scanTag } from '../parse/astroTag';
import { literalProps, type PreviewImport } from './componentPreviewContext';
import { defaultAttributes, isFragmentTag, withoutMissingAssets } from '../../shared/properties/componentDefaultValues';

export const RECIPE_LIMITS = {
  slotsMax: 8,
} as const satisfies Record<string, number>;

export type PreviewRecipeNode =
  | { readonly literal: string }
  | { readonly element: string; readonly props: Readonly<Record<string, DefaultValue>>; readonly content: PreviewRecipeContent<readonly PreviewRecipeNode[]> }
  | {
      readonly component: string;
      readonly props: Readonly<Record<string, DefaultValue>>;
      readonly content: PreviewRecipeContent<readonly PreviewRecipeSlot[]>;
    };

export type PreviewRecipeContent<Children> =
  { readonly kind: 'empty' } | { readonly kind: 'text'; readonly text: string } | { readonly kind: 'children'; readonly children: Children };

export interface PreviewRecipeSlot {
  readonly name: string;
  readonly children: readonly PreviewRecipeNode[];
}

export interface PreviewRecipe {
  readonly recipe: ResolvedRecipe;
  readonly node: Extract<PreviewRecipeNode, { readonly component: string }>;
  readonly files: readonly string[];
  readonly code?: PreviewCode;
}

export interface PreviewCode {
  readonly imports: readonly string[];
  readonly values: readonly (readonly [string, string])[];
}

export function previewDefaultsPath(projectDirectory: string): string {
  assert(path.isAbsolute(projectDirectory), 'Preview defaults: the project directory is absolute');
  return path.join(projectDirectory, COMPONENT_DEFAULTS_FILE);
}

export function readPreviewDefaults(projectDirectory: string): ComponentDefaults | undefined {
  const file = previewDefaultsPath(projectDirectory);
  let source: string;
  try {
    if (fs.statSync(file).size > DEFAULT_LIMITS.sourceCharsMax) {
      return undefined;
    }
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const parsed = parseDefaultsSource(source);
  return parsed.ok ? parsed.value : undefined;
}

export function componentPreviewRecipe(projectDirectory: string, relative: string, config: ComponentDefaults): PreviewRecipe | undefined {
  assert(path.isAbsolute(projectDirectory), 'Preview recipe: the project directory is absolute');
  assert(!relative.startsWith('/'), 'Preview recipe: the component path is project-relative');
  if (config.components[relative] === undefined) {
    return undefined;
  }
  const catalog = recipeCatalog(projectDirectory, config, relative);
  const resolved = resolveComponentRecipe(relative, config, catalog);
  if (!resolved.ok) {
    return undefined;
  }
  const present = withoutMissingAssets(resolved.value, (file) => fs.existsSync(path.join(projectDirectory, file))).node;
  const { recipe, code } = withStandIns(present);
  const node = previewRecipeNode(recipe, 0);
  if (node === undefined || !('component' in node)) {
    return undefined;
  }
  const files = [relative, ...recipeFiles(recipe).filter((file) => file !== relative)];
  assert(files.length <= DEFAULT_LIMITS.nodesMax + 1, 'Preview recipe: rendered components are bounded by the recipe node limit');
  return { recipe, node, files, ...(code.values.length === 0 ? {} : { code }) };
}

export function previewModuleSource(data: unknown, code: PreviewCode | undefined): string {
  let json = JSON.stringify(data);
  for (const [standIn, expression] of code?.values ?? []) {
    json = json.split(JSON.stringify(standIn)).join(`(${expression}\n)`);
  }
  return [...(code?.imports ?? []), `export default ${json};`].join('\n');
}

function withStandIns(root: ResolvedRecipe): { readonly recipe: ResolvedRecipe; readonly code: PreviewCode } {
  const bindings = new Map<string, string>();
  const values: (readonly [string, string])[] = [];
  const binding = (file: string): string => {
    const held = bindings.get(file) ?? `stackiDefaultAsset${bindings.size}`;
    bindings.set(file, held);
    return held;
  };
  const stand = <N extends Exclude<ResolvedNode, { readonly literal: string }>>(node: N, depth: number): N => {
    assert(depth <= DEFAULT_LIMITS.depthMax, 'Preview recipe: node depth is bounded');
    const held = defaultAttributes(
      { ...(node.assets === undefined ? {} : { assets: node.assets }), ...(node.literals === undefined ? {} : { literals: node.literals }) },
      binding,
    ).map(([name, attribute]) => {
      const standIn = `stacki-default:${values.length}:${JSON.stringify([attribute.value, node.assets, node.literals])}`;
      values.push([standIn, attribute.value]);
      return [name, standIn] as const;
    });
    const content =
      node.content.kind === 'children'
        ? { kind: 'children' as const, children: node.content.children.map((child) => ('literal' in child ? child : stand(child, depth + 1))) }
        : node.content;
    return { ...node, props: { ...node.props, ...Object.fromEntries(held) }, content, assets: {}, literals: {} };
  };
  const recipe = stand(root, 0);
  const imports = [...bindings].map(([file, name]) => `import ${name} from ${JSON.stringify('/' + file)};`);
  return { recipe, code: { imports, values } };
}

export function previewRecipeNode(node: ResolvedNode, depth: number): PreviewRecipeNode | undefined {
  assert(depth <= DEFAULT_LIMITS.depthMax, 'Preview recipe: node depth is bounded');
  if ('literal' in node) {
    return node;
  }
  const children: PreviewRecipeNode[] = [];
  if (node.content.kind === 'children') {
    for (const child of node.content.children) {
      const converted = previewRecipeNode(child, depth + 1);
      if (converted === undefined) {
        return undefined;
      }
      children.push(converted);
    }
  }
  if ('element' in node) {
    const boxed = isFragmentTag(node.tag) || node.from !== undefined;
    const element = boxed ? node.element : (node.tag ?? node.element);
    const props = boxed ? { ...node.props, style: 'display: contents' } : node.props;
    if (node.content.kind === 'children') {
      return { element, props, content: { kind: 'children', children } };
    }
    return { element, props, content: node.content };
  }
  if (node.content.kind === 'children') {
    const slots = slotGroups(children);
    if (slots.length > RECIPE_LIMITS.slotsMax) {
      return undefined;
    }
    return { component: node.component, props: node.props, content: { kind: 'children', children: slots } };
  }
  return { component: node.component, props: node.props, content: node.content };
}

function slotGroups(children: readonly PreviewRecipeNode[]): readonly PreviewRecipeSlot[] {
  const groups = new Map<string, PreviewRecipeNode[]>();
  for (const child of children) {
    const name = slotOf(child);
    const group = groups.get(name);
    if (group === undefined) {
      groups.set(name, [child]);
    } else {
      group.push(child);
    }
  }
  const slots = [...groups].map(([name, nodes]) => ({ name, children: nodes }));
  assert(slots.reduce((total, slot) => total + slot.children.length, 0) === children.length, 'Preview recipe: every child is in one slot');
  return slots;
}

function slotOf(node: PreviewRecipeNode): string {
  if ('literal' in node) {
    return 'default';
  }
  const slot = node.props['slot'];
  return typeof slot === 'string' ? slot : 'default';
}

export function recipeFiles(recipe: ResolvedRecipe): readonly string[] {
  const files = new Set<string>();
  const pending: ResolvedNode[] = recipe.content.kind === 'children' ? [...recipe.content.children] : [];
  for (let index = 0; index < pending.length; index++) {
    assert(index < DEFAULT_LIMITS.nodesMax, 'Preview recipe: the walk stays inside the node limit');
    const node = pending[index];
    assert(node !== undefined, 'Preview recipe: a pending node exists');
    if ('literal' in node) {
      continue;
    }
    if ('component' in node) {
      files.add(node.component);
    }
    if (node.content.kind === 'children') {
      pending.push(...node.content.children);
    }
  }
  return [...files];
}

function recipeCatalog(projectDirectory: string, config: ComponentDefaults, owner: string): readonly DefaultComponent[] {
  const files = new Set<string>([owner]);
  for (const [file, recipe] of Object.entries(config.components)) {
    files.add(file);
    for (const child of recipe.children ?? []) {
      addChildFiles(child, files, 0);
    }
  }
  assert(files.size <= DEFAULT_LIMITS.storedNodesMax + 1, 'Preview recipe: the catalog is bounded by the stored node limit');
  const catalog: DefaultComponent[] = [];
  for (const file of files) {
    const entry = catalogEntry(projectDirectory, file);
    if (entry !== undefined) {
      catalog.push(entry);
    }
  }
  return catalog;
}

function addChildFiles(child: RecipeChild, files: Set<string>, depth: number): void {
  assert(depth <= DEFAULT_LIMITS.depthMax, 'Preview recipe: child depth is bounded');
  if ('literal' in child) {
    return;
  }
  if ('component' in child) {
    files.add(child.component);
  }
  for (const nested of child.children ?? []) {
    addChildFiles(nested, files, depth + 1);
  }
}

function catalogEntry(projectDirectory: string, file: string): DefaultComponent | undefined {
  const absolute = path.join(projectDirectory, file);
  assert(absolute.startsWith(projectDirectory), 'Preview recipe: a component path stays inside the project');
  let source: string;
  try {
    source = fs.readFileSync(absolute, 'utf8');
  } catch {
    return undefined;
  }
  return {
    file,
    name: path.basename(file, '.astro'),
    props: parsePropSchema(source).map((field) => field.name),
    slots: parseSlots(source),
    slotText: defaultSlotInline(source),
  };
}

export const PREVIEW_EXPRESSION_TEXT = 'Lorem ipsum dolor sit amet';

const VOID_ELEMENTS: ReadonlySet<string> = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

interface MarkupFrame {
  readonly tag: string | undefined;
  readonly node: { readonly component: string } | { readonly element: string } | undefined;
  readonly props: Record<string, DefaultValue>;
  readonly children: ResolvedNode[];
}

export function instanceMarkupNodes(markup: string, imports: ReadonlyArray<PreviewImport>): readonly ResolvedNode[] | undefined {
  const root: MarkupFrame = { tag: undefined, node: undefined, props: {}, children: [] };
  const stack: MarkupFrame[] = [root];
  let nodes = 0;
  let position = 0;
  for (let pass = 0; position < markup.length; pass++) {
    assert(pass <= markup.length, 'Preview instance: the markup walk advances');
    const top = stack.at(-1);
    assert(top !== undefined, 'Preview instance: the root frame stays on the stack');
    if (markup.startsWith('<!--', position)) {
      const end = markup.indexOf('-->', position + 4);
      if (end < 0) {
        return undefined;
      }
      position = end + 3;
    } else if (markup.startsWith('</', position)) {
      const end = markup.indexOf('>', position);
      const name = end < 0 ? '' : markup.slice(position + 2, end).trim();
      if (stack.length < 2 || top.tag !== name) {
        return undefined;
      }
      stack.pop();
      const parent = stack.at(-1);
      assert(parent !== undefined, 'Preview instance: a closed tag has a parent');
      parent.children.push(...closeFrame(top));
      position = end + 1;
    } else if (markup.charAt(position) === '<' && /[A-Za-z]/.test(markup.charAt(position + 1))) {
      const tag = scanTag(markup, position);
      if (tag === undefined) {
        return undefined;
      }
      const frame = openFrame(tag.name, tag.attrs, imports);
      if (frame === undefined) {
        return undefined;
      }
      nodes += 1;
      if (nodes > DEFAULT_LIMITS.nodesMax) {
        return undefined;
      }
      if (tag.selfClose === '/' || VOID_ELEMENTS.has(tag.name)) {
        top.children.push(...closeFrame(frame));
      } else if (stack.length <= DEFAULT_LIMITS.depthMax) {
        stack.push(frame);
      } else {
        return undefined;
      }
      position = tag.end;
    } else if (markup.charAt(position) === '{') {
      const end = expressionEnd(markup, position);
      if (end === undefined) {
        return undefined;
      }
      const expression = markup.slice(position + 1, end).trim();
      if (/^[\w$.]+$/.test(expression)) {
        top.children.push({ literal: PREVIEW_EXPRESSION_TEXT });
      }
      position = end + 1;
    } else {
      const next = nextMarkup(markup, position);
      const text = markup.slice(position, next).replace(/\s+/g, ' ');
      if (text.trim() !== '') {
        top.children.push({ literal: text.trim() });
      }
      position = next;
    }
  }
  if (stack.length !== 1) {
    return undefined;
  }
  if (root.children.length > DEFAULT_LIMITS.childrenMax) {
    return undefined;
  }
  return root.children;
}

function openFrame(name: string, attributes: string, imports: ReadonlyArray<PreviewImport>): MarkupFrame | undefined {
  if (name === 'script' || name === 'style') {
    return undefined;
  }
  const props: Record<string, DefaultValue> = { ...literalProps(attributes) };
  const slot = parseAttrs(attributes)['slot'];
  if (slot?.type === 'string') {
    props['slot'] = slot.value;
  }
  if (name === 'Fragment') {
    return { tag: name, node: undefined, props, children: [] };
  }
  if (/^[a-z][a-z0-9-]*$/.test(name)) {
    return { tag: name, node: { element: name }, props, children: [] };
  }
  const imported = imports.find((candidate) => candidate.name === name);
  if (imported === undefined) {
    return undefined;
  }
  return { tag: name, node: { component: imported.relative }, props, children: [] };
}

function closeFrame(frame: MarkupFrame): readonly ResolvedNode[] {
  const content: ResolvedContent['content'] = frame.children.length === 0 ? { kind: 'empty' } : { kind: 'children', children: frame.children };
  if (frame.node === undefined) {
    const slot = frame.props['slot'];
    if (typeof slot !== 'string') {
      return frame.children;
    }
    return frame.children.flatMap((child) => ('literal' in child ? [] : [{ ...child, props: { ...child.props, slot } }]));
  }
  if ('component' in frame.node) {
    return [{ component: frame.node.component, props: frame.props, content }];
  }
  return [{ element: frame.node.element, props: frame.props, content }];
}

function expressionEnd(markup: string, start: number): number | undefined {
  let depth = 0;
  for (let index = start; index < markup.length; index++) {
    const character = markup.charAt(index);
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function nextMarkup(markup: string, from: number): number {
  const tag = markup.indexOf('<', from + 1);
  const expression = markup.indexOf('{', from + 1);
  const candidates = [tag, expression].filter((index) => index >= 0);
  return candidates.length === 0 ? markup.length : Math.min(...candidates);
}

export function instancePreviewRecipe(
  relative: string,
  props: Readonly<Record<string, DefaultValue>>,
  children: readonly ResolvedNode[],
): PreviewRecipe | undefined {
  assert(!relative.startsWith('/'), 'Preview instance: the component path is project-relative');
  assert(children.length <= DEFAULT_LIMITS.childrenMax, 'Preview instance: children are bounded');
  const recipe: ResolvedRecipe = { component: relative, props, content: children.length === 0 ? { kind: 'empty' } : { kind: 'children', children } };
  const node = previewRecipeNode(recipe, 0);
  if (node === undefined || !('component' in node)) {
    return undefined;
  }
  return { recipe, node, files: [relative, ...recipeFiles(recipe).filter((file) => file !== relative)] };
}
