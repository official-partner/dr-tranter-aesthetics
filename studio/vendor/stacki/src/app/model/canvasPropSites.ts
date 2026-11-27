
import type { Attr, ImportDecl } from '../../../shared/page/pageNode';
import type { ScanComponent } from '../../../shared/properties/projectScan';
import { assert } from '../../../shared/core/assert';
import { componentReference } from './componentReference';
import { readPropsDestructure } from '../../editor/loopProps';

export type PropTextSite =
  | {
      readonly kind: 'text';
      readonly prop: string;
      readonly path: string;
      readonly parent: string;
      readonly parentKind: 'element' | 'component';
      readonly tag: string;
      readonly siblings: readonly string[];
    }
  | {
      readonly kind: 'html';
      readonly prop: string;
      readonly path: string;
      readonly parent: string;
      readonly parentKind: 'element' | 'component';
      readonly tag: string;
    };

export interface PropSiteContext {
  readonly projectPath: string;
  readonly components: readonly ScanComponent[];
  readonly relative: (file: string) => string;
  readonly read: (file: string) => Promise<ComponentSource | undefined>;
}

export interface PropNode {
  readonly id?: string | undefined;
  readonly kind: string;
  readonly name?: string | undefined;
  readonly value?: string | undefined;
  readonly props?: Readonly<Record<string, Attr>> | undefined;
  readonly children?: readonly PropNode[] | undefined;
}

export interface ComponentSource {
  readonly nodes: readonly PropNode[];
  readonly imports: readonly ImportDecl[];
  readonly extraFrontmatter: string;
}

type PropOf = (local: string) => string | undefined;

export type InstanceNode = PropNode & {
  readonly kind: 'component';
  readonly id: string;
  readonly name: string;
};

const NESTING_MAX = 3;
export const SITES_MAX = 64;
export const REPEATS: readonly string[] = ['map', 'expr'];

export function propSiteReader(context: PropSiteContext) {
  const known = new Map<string, Promise<PropTextSite[]>>();
  const sites = (component: ScanComponent, depth = 0): Promise<PropTextSite[]> => {
    if (depth > NESTING_MAX) {
      return Promise.resolve([]);
    }
    const kept = known.get(component.path);
    if (kept) {
      return kept;
    }
    const reading = readSites(component, depth, context, sites).catch(() => []);
    known.set(component.path, reading);
    return reading;
  };
  return sites;
}

async function readSites(
  component: ScanComponent,
  depth: number,
  context: PropSiteContext,
  inner: (component: ScanComponent, depth: number) => Promise<PropTextSite[]>,
): Promise<PropTextSite[]> {
  const source = await context.read(component.path);
  const props = new Set(component.schema?.map((field) => field.name) ?? []);
  if (!source || props.size === 0) {
    return [];
  }
  const propOf = propReader(source.extraFrontmatter, props);
  const imported = new Set(source.imports.map((declaration) => declaration.name));
  const rel = context.relative(component.path);
  const walked = templateNodes(source.nodes);
  const paths = new Map(walked.map(({ node, path }) => [node, `${rel}|${path}`]));
  const pathOf = (node: PropNode) => paths.get(node);
  const sites: PropTextSite[] = [];
  for (const { node, parent } of walked) {
    const shown = printedSite(node, parent, propOf, pathOf) ?? htmlSite(node, parent, { propOf, pathOf, imported });
    if (shown) {
      sites.push(shown);
    }
    if (isInstance(node)) {
      sites.push(...(await handedOn(node, component, source, propOf, context, depth, inner)));
    }
  }
  assert(
    sites.every((site) => props.has(site.prop)),
    'Every site shows one of the props',
  );
  return sites.slice(0, SITES_MAX);
}

function propReader(frontmatter: string, props: ReadonlySet<string>): PropOf {
  const entries = readPropsDestructure(frontmatter)?.entries ?? [];
  const locals = new Map(entries.map((entry) => [entry.local, entry.key]));
  const renamed = new Set(entries.filter((entry) => entry.local !== entry.key).map((entry) => entry.key));
  assert(locals.size <= entries.length, 'Each local names one destructure entry');
  return (local) => {
    const key = locals.get(local) ?? (renamed.has(local) ? undefined : local);
    return key !== undefined && props.has(key) ? key : undefined;
  };
}

function printedSite(node: PropNode, parent: PropNode | undefined, propOf: PropOf, pathOf: (node: PropNode) => string | undefined): PropTextSite | undefined {
  const prop = node.kind === 'expr' ? propOf(propName(node.value ?? '')) : undefined;
  if (prop === undefined || !parent) {
    return undefined;
  }
  if (parent.kind !== 'element' && parent.kind !== 'component') {
    return undefined;
  }
  const path = pathOf(node);
  const parentPath = pathOf(parent);
  const siblings = childrenOf(parent)
    .filter((child) => !['text', 'expr', 'comment'].includes(child.kind))
    .map(pathOf);
  if (!path || !parentPath || siblings.some((sibling) => sibling === undefined)) {
    return undefined;
  }
  return {
    kind: 'text',
    prop,
    path,
    parent: parentPath,
    parentKind: parent.kind,
    tag: parent.name ?? '',
    siblings: siblings.filter((sibling): sibling is string => sibling !== undefined),
  };
}

function htmlSite(
  node: PropNode,
  parent: PropNode | undefined,
  read: { readonly propOf: PropOf; readonly pathOf: (node: PropNode) => string | undefined; readonly imported: ReadonlySet<string> },
): PropTextSite | undefined {
  const attr = 'props' in node ? node.props?.['set:html'] : undefined;
  const prop = attr?.type === 'expr' ? read.propOf(propName(attr.value)) : undefined;
  if (prop === undefined) {
    return undefined;
  }
  const fragment = node.kind === 'component' && 'name' in node && node.name === 'Fragment';
  if (fragment && 'props' in node && node.props?.['slot'] !== undefined) {
    return undefined;
  }
  const dynamicTag = node.kind === 'component' && !fragment && typeof node.name === 'string' && !read.imported.has(node.name);
  const host = fragment ? parent : node;
  if (host === undefined || (host.kind !== 'element' && !(host.kind === 'component' && (fragment || dynamicTag)))) {
    return undefined;
  }
  if (fragment && childrenOf(host).some((child) => child !== node && child.kind !== 'text')) {
    return undefined;
  }
  if (fragment && host.kind === 'component' && childrenOf(host).some((child) => child !== node && (child.value ?? '').trim() !== '')) {
    return undefined;
  }
  const path = read.pathOf(host);
  const nodePath = read.pathOf(node);
  if (path === undefined || nodePath === undefined) {
    return undefined;
  }
  return { kind: 'html', prop, path: nodePath, parent: path, parentKind: host.kind === 'element' ? 'element' : 'component', tag: host.name ?? '' };
}

async function handedOn(
  node: InstanceNode,
  component: ScanComponent,
  source: ComponentSource,
  propOf: PropOf,
  context: PropSiteContext,
  depth: number,
  inner: (component: ScanComponent, depth: number) => Promise<PropTextSite[]>,
): Promise<PropTextSite[]> {
  const handed = Object.entries(('props' in node ? node.props : undefined) ?? {}).flatMap(([name, attr]) => {
    const prop = attr.type === 'expr' ? propOf(propName(attr.value)) : undefined;
    return prop === undefined ? [] : [{ name, prop }];
  });
  if (handed.length === 0) {
    return [];
  }
  const nested = componentReference({
    name: node.name,
    project: context.projectPath,
    file: component.path,
    imports: source.imports,
    components: context.components,
  });
  if (!nested || nested.origin?.kind === 'package') {
    return [];
  }
  const sites = await inner(nested, depth + 1);
  return handed.flatMap(({ name, prop }) => sites.filter((site) => site.prop === name).map((site) => ({ ...site, prop })));
}

function templateNodes(nodes: readonly PropNode[]) {
  type Walked = {
    readonly node: PropNode;
    readonly parent: PropNode | undefined;
    readonly path: string;
  };
  const queue: Walked[] = nodes.map((node, at) => ({ node, parent: undefined, path: String(at) }));
  const out: Walked[] = [];
  for (let index = 0; index < queue.length && index < 10_000; index++) {
    const entry = queue[index];
    if (!entry) {
      continue;
    }
    out.push(entry);
    const children = childrenOf(entry.node).map((child, at) => ({
      node: child,
      parent: entry.node,
      path: `${entry.path}.${at}`,
    }));
    queue.push(...(REPEATS.includes(entry.node.kind) ? [] : children));
  }
  return out;
}

export function propName(expression: string): string {
  const bare = expression.trim();
  const inner = bare.startsWith('{') && bare.endsWith('}') ? bare.slice(1, -1) : bare;
  return inner.trim();
}

export function isInstance(node: PropNode): node is InstanceNode {
  return node.kind === 'component' && Boolean(node.id) && typeof node.name === 'string';
}

export function childrenOf(node: PropNode): readonly PropNode[] {
  return node.children ?? [];
}
