import { componentOffers, componentRuleFile, offeredComponents, offeredOn, type ComponentViewer } from '../../../shared/properties/componentAccess';
import type { InsertableComponent } from '../../features/palette/componentVisibility';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import type { ImportDecl, PageModel, PageNode } from '../../../shared/page/pageNode';
import { ASTRO_ASSETS, ASTRO_ASSETS_MODULE } from '../../features/palette/astroAssets';
import type { Rename, TagOption } from '../../features/props/propNodeEditors';
import { frontmatterGesture, propsGesture, sequence, tagRenameGesture, wrapGesture } from '../../editor/editGestures';
import { getElementSchema, GLOBAL_ATTRS, HTML_TAGS, VOID_TAGS } from '../../editor/elementSchemas';
import { disconnectedLoops, parseLoopHead, renamedLoopVar } from '../../editor/loopBindings';
import type { EditGesture } from '../../editor/pageEdits';
import { findEditorNodeById as findNodeById } from '../../editor/pageState';
import { nodeId, type EditorModel, type EditorNode } from '../../editor/pageView';

export interface ImportPaths {
  readonly relative: string;
  readonly srcRelative: string | undefined;
}

type BranchNode = Extract<EditorNode, { readonly kind: 'branch' }>;

export function tagOptionsOf(
  components: readonly InsertableComponent[],
  imports: readonly Pick<ImportDecl, 'name'>[],
  viewer: ComponentViewer,
): readonly TagOption[] {
  assert(components.length <= LIMITS.scanEntriesMax, 'tagOptionsOf: components stay inside the scan bound');
  const out: TagOption[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: string): void => {
    if (name === '' || seen.has(name)) {
      return;
    }
    seen.add(name);
    out.push({ name, kind });
  };
  for (const tag of HTML_TAGS) {
    add(tag, 'element');
  }
  const searchable = offeredComponents(viewer, 'search', components, componentRuleFile);
  for (const component of searchable) {
    add(component.name, component.isLayout === true ? 'layout' : 'component');
  }
  const shownNames = new Set(searchable.map((component) => component.name));
  const unsearched = new Set(components.map((component) => component.name).filter((name) => !shownNames.has(name)));
  for (const asset of ASTRO_ASSETS) {
    add(asset.name, 'astroAsset');
  }
  for (const entry of imports) {
    if (!unsearched.has(entry.name)) {
      add(entry.name, 'component');
    }
  }
  assert(out.length === seen.size, 'tagOptionsOf: each name is offered once');
  return out;
}

export function layoutOptionsOf(layouts: readonly InsertableComponent[], viewer: ComponentViewer): readonly TagOption[] {
  assert(layouts.length <= LIMITS.scanEntriesMax, 'layoutOptionsOf: layouts stay inside the scan bound');
  const offer = componentOffers(viewer);
  return layouts.map((layout) => ({
    name: layout.name,
    kind: 'layout',
    ...(offeredOn(offer(componentRuleFile(layout)), 'search') ? {} : { unlisted: true }),
  }));
}

function keptByAnyTag(attr: string): boolean {
  return GLOBAL_ATTRS.has(attr) || /^(data-|aria-)/.test(attr);
}

export function rawContentsMatch(node: EditorNode, contents: string): boolean {
  return node.kind === 'raw' && node.inner === contents;
}

export function droppedForElement(node: Pick<EditorNode, 'kind' | 'name' | 'props'>, tag: string): readonly string[] {
  assert(/^[a-z][a-z0-9-]*$/.test(tag), 'droppedForElement: an element tag is lowercase');
  const wasComponent = node.kind !== 'element';
  const oldNames = wasComponent ? new Set(Object.keys(node.props || {})) : new Set(getElementSchema(node.name ?? '').map((field) => field.name));
  const newNames = new Set(getElementSchema(tag).map((field) => field.name));
  return Object.keys(node.props || {}).filter((attr) => oldNames.has(attr) && !newNames.has(attr) && !keptByAnyTag(attr));
}

export function droppedForComponent(node: Pick<EditorNode, 'kind' | 'name' | 'props'>): readonly string[] {
  const oldNames = node.kind === 'element' ? new Set(getElementSchema(node.name ?? '').map((field) => field.name)) : undefined;
  return Object.keys(node.props || {}).filter((attr) => oldNames?.has(attr) === true && !keptByAnyTag(attr));
}

export function withComponentImport(
  model: EditorModel,
  name: string,
  source: { readonly paths: ImportPaths | undefined; readonly asset: boolean },
): EditorModel {
  if (model.imports.some((entry) => entry.name === name)) {
    return withPrunedImports(model);
  }
  const entry = source.paths
    ? { name, path: chooseImportPath(model, source.paths), quote: "'" }
    : source.asset
      ? { name, imported: name, path: ASTRO_ASSETS_MODULE, quote: "'", named: true }
      : undefined;
  return withPrunedImports(entry ? { ...model, imports: [...model.imports, entry] } : model);
}

export function toggledElseBranch(node: EditorNode, want: 'else' | 'no-else', newId: () => string): EditorNode | undefined {
  assert(node.kind === 'cond', 'toggledElseBranch: a condition has the branches');
  const kids = node.children;
  assert(kids.length <= 2, 'toggledElseBranch: a condition has a then and at most an else');
  const thenBranch: BranchNode = kids[0] ?? { id: nodeId(newId()), kind: 'branch', name: 'then', children: [] };
  if (want === 'else') {
    if (kids.length < 2) {
      const elseBranch: BranchNode = { id: nodeId(newId()), kind: 'branch', name: 'else', children: [] };
      return { ...node, op: '?', children: [thenBranch, elseBranch] };
    }
    return undefined;
  }
  if (kids.length > 1) {
    const elseBranch = kids[1];
    assert(elseBranch !== undefined, 'Else branch exists before removal');
    const rescued = elseBranch.children || [];
    const merged = { ...thenBranch, children: [...(thenBranch.children || []), ...rescued] };
    return { ...node, op: '&&', children: [merged] };
  }
  return undefined;
}


export function collectUsedNames(model: PageModel): Set<string> {
  const used = new Set<string>();
  const walk = (list: readonly PageNode[], depth: number): void => {
    assert(depth <= LIMITS.treeDepthMax, 'collectUsedNames: depth exceeds the tree cap');
    for (const node of list) {
      if ('name' in node && node.name) {
        used.add(node.name);
      }
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(model.nodes, 0);
  return used;
}

export function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

export function codeText(model: PageModel): string {
  const parts = [stripComments(model.extraFrontmatter || '')];
  const walk = (list: readonly PageNode[], depth: number): void => {
    assert(depth <= LIMITS.treeDepthMax, 'codeText: depth exceeds the tree cap');
    for (const node of list) {
      if (node.kind === 'expr' || node.kind === 'raw-line') {
        parts.push(node.value || '');
      }
      if (node.kind === 'map') {
        parts.push(node.head || '');
      }
      if (node.kind === 'cond') {
        parts.push(node.test || '');
      }
      const props = 'props' in node ? node.props : undefined;
      for (const value of Object.values(props || {})) {
        if (value && (value.type === 'expr' || value.type === 'spread')) {
          parts.push(String(value.value ?? ''));
        }
      }
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(model.nodes, 0);
  return parts.join('\n');
}

export interface TagChange {
  readonly kind: 'element' | 'component';
  readonly name: string;
  readonly asset: boolean;
  readonly dropped: readonly string[];
}

export function tagChangeGesture(model: EditorModel, node: EditorNode, change: TagChange, imports: (model: EditorModel) => EditorModel): EditGesture {
  const options = { coalesceKey: undefined, urgency: true };
  const patch = Object.fromEntries(change.dropped.map((attr) => [attr, undefined]));
  const removal = propsGesture(node.id, patch, options);
  const kept = change.dropped.length > 0 ? removal.apply(model) : model;
  const before = findNodeById(kept.nodes, node.id);
  assert(before !== undefined, 'The renamed node survives its attribute removals');
  const children = VOID_TAGS.has(change.name) ? undefined : before.children;
  const next: EditorNode = Object.assign({}, before, {
    kind: change.kind,
    name: change.name,
    children,
  });
  Reflect.deleteProperty(next, 'dynamicTag');
  Reflect.deleteProperty(next, 'astroAsset');
  if (change.asset) {
    Object.assign(next, { astroAsset: true });
  }
  const rename = tagRenameGesture(node, next, options);
  const renamed = rename.apply(kept);
  const named = change.dropped.length > 0 ? sequence(removal, rename) : rename;
  if (frontmatterOf(imports(renamed)) === frontmatterOf(renamed)) {
    return named;
  }
  return sequence(named, frontmatterGesture(renamed, options, imports));
}

export function restatedText(node: EditorNode, value: string, renames: readonly Rename[] | undefined): EditorNode | undefined {
  switch (node.kind) {
    case 'map': {
      const renamed = (renames || []).reduce(
        (children, { from, to }) => (from && to && from !== to ? renamedLoopVar(children, from, to) : children),
        node.children,
      );
      const before = parseLoopHead(node.head);
      const after = parseLoopHead(value);
      const vars = after ? [after.item, after.index].filter(Boolean) : [];
      const moved = before && after && before.data !== after.data && vars.length > 0;
      const children = moved ? disconnectedLoops(renamed, vars) : renamed;
      return { ...node, head: value, children };
    }
    case 'cond':
      return { ...node, test: value };
    case 'raw':
      return { ...node, inner: value };
    case 'text':
    case 'expr':
    case 'comment':
      return { ...node, value };
    case 'element':
    case 'component':
    case 'branch':
    case 'raw-line':
    case 'chunk-group':
      return undefined;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export function statedText(node: EditorNode): string | undefined {
  switch (node.kind) {
    case 'map':
      return node.head;
    case 'cond':
      return node.test;
    case 'raw':
      return node.inner;
    case 'text':
    case 'expr':
    case 'comment':
      return node.value;
    case 'element':
    case 'component':
    case 'branch':
    case 'raw-line':
    case 'chunk-group':
      return undefined;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export function frontmatterOf(model: PageModel): string {
  return JSON.stringify([model.imports, model.extraFrontmatter]);
}

export const COMPONENT_IMPORT_RE = /\.(astro|jsx|tsx|vue|svelte)$/i;
export const ASSET_IMPORT_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export function prunableImport(i: ImportDecl): boolean {
  return COMPONENT_IMPORT_RE.test(i.path) || ASSET_IMPORT_RE.test(i.path) || i.path === ASTRO_ASSETS_MODULE;
}

export function withPrunedImports(model: EditorModel): EditorModel {
  const used = collectUsedNames(model);
  const code = codeText(model);
  const mentioned = (name: string): boolean => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(code);
  const imports = model.imports.filter((i) => !prunableImport(i) || used.has(i.name) || mentioned(i.name));
  return imports.length === model.imports.length ? model : { ...model, imports };
}

export function chooseImportPath(model: Pick<PageModel, 'imports'>, paths: { readonly relative: string; readonly srcRelative: string | undefined }): string {
  const { relative, srcRelative: sourceRelative } = paths;
  if (sourceRelative) {
    for (const imp of model.imports) {
      if (imp.path.startsWith('.')) {
        continue;
      }
      for (const marker of ['/components/', '/layouts/']) {
        const index = imp.path.indexOf(marker);
        if (index > 0) {
          return imp.path.slice(0, index + 1) + sourceRelative;
        }
      }
    }
  }
  return relative;
}

export const withLayoutField = (frontmatter: string, layoutPath: string | undefined): string => {
  const fm = frontmatter ?? '';
  if (/^[ \t]*layout[ \t]*:/m.test(fm)) {
    return layoutPath ? fm.replace(/^[ \t]*layout[ \t]*:.*$/m, `layout: ${layoutPath}`) : fm.replace(/^[ \t]*layout[ \t]*:.*(\n|$)/m, '');
  }
  if (!layoutPath) {
    return fm;
  }
  return fm ? `layout: ${layoutPath}\n${fm}` : `layout: ${layoutPath}`;
};

export function markdownLayoutGesture(model: EditorModel, rel: string | undefined): EditGesture {
  const framed = (pageModel: EditorModel): EditorModel => ({
    ...pageModel,
    extraFrontmatter: withLayoutField(pageModel.extraFrontmatter, rel),
    layoutPath: rel,
  });
  return frontmatterGesture(model, { coalesceKey: undefined, urgency: true }, framed);
}

export function withImportsGesture(model: EditorModel, gesture: EditGesture, imports: (pageModel: EditorModel) => EditorModel): EditGesture {
  const after = gesture.apply(model);
  const options = { coalesceKey: undefined, urgency: true };
  return frontmatterOf(imports(after)) === frontmatterOf(after) ? gesture : sequence(gesture, frontmatterGesture(after, options, imports));
}

export function layoutWrapperGesture(
  model: EditorModel,
  wrapper: EditorNode | undefined,
  layout: { readonly name: string; readonly paths: ImportPaths },
): EditGesture | undefined {
  const { name, paths } = layout;
  const imports = (pageModel: EditorModel): EditorModel =>
    withPrunedImports(
      pageModel.imports.some((i) => i.name === name)
        ? pageModel
        : {
            ...pageModel,
            imports: [...pageModel.imports, { name, path: chooseImportPath(pageModel, paths), quote: "'" }],
          },
    );
  if (wrapper) {
    if (wrapper.kind !== 'component' && wrapper.kind !== 'element') {
      return undefined;
    }
    if (wrapper.name === name) {
      return undefined;
    }
    const renamed: EditorNode = { ...wrapper, name };
    const options = { coalesceKey: undefined, urgency: true };
    return withImportsGesture(model, tagRenameGesture(wrapper, renamed, options), imports);
  }
  const created: EditorNode = {
    id: nodeId('layout'),
    kind: 'component',
    name,
    props: {},
    children: [],
  };
  return withImportsGesture(model, wrapGesture(model, created), imports);
}
