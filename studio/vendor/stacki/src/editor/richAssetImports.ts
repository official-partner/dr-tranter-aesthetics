import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import type { Attr, ImportDecl } from '../../shared/page/pageNode';

const IMAGE_FILE = /\.(png|jpe?g|webp|avif|gif|svg|tiff?)$/i;
const VIDEO_FILE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const MEDIA_TAGS: ReadonlySet<string> = new Set(['img', 'video', 'source']);

export interface AssetScope {
  readonly imports: readonly ImportDecl[];
  readonly directory: string;
}

export function assetScopeOf(file: string, imports: readonly ImportDecl[]): AssetScope {
  return { imports, directory: file.split('/').slice(0, -1).join('/') };
}

export function importedAssetPath(specifier: string, directory: string): string | undefined {
  const bare = specifier.split('?')[0] ?? '';
  if (!IMAGE_FILE.test(bare) && !VIDEO_FILE.test(bare)) {
    return undefined;
  }
  const alias = /^[@~]\/(.+)$/.exec(bare)?.[1];
  if (alias === undefined && !/^\.\.?\//.test(bare)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of (alias === undefined ? `${directory}/${bare}` : `src/${alias}`).split('/')) {
    if (part === '..') {
      if (parts.pop() === undefined) {
        return undefined;
      }
    } else if (part !== '' && part !== '.') {
      parts.push(part);
    }
  }
  return parts[0] === 'src' ? `/${parts.join('/')}` : undefined;
}

function shownAddress(expression: string, scope: AssetScope): string | undefined {
  const match = /^\s*([A-Za-z_$][\w$]*)(\.src)?\s*$/.exec(expression);
  if (match === null) {
    return undefined;
  }
  const entry = scope.imports.find((candidate) => candidate.name === match[1] && candidate.named !== true && candidate.typeOnly !== true);
  const path = entry === undefined ? undefined : importedAssetPath(entry.path, scope.directory);
  return path !== undefined && IMAGE_FILE.test(path) === (match[2] !== undefined) ? path : undefined;
}

export function renderedAssetPath(address: string): string {
  const path = address.split(/[?#]/)[0] ?? '';
  if (!IMAGE_FILE.test(path) && !VIDEO_FILE.test(path)) {
    return address;
  }
  if (path.startsWith('/src/')) {
    return path;
  }
  const at = path.startsWith('/@fs/') ? path.lastIndexOf('/src/') : -1;
  return at < 0 ? address : path.slice(at);
}

export function shownAssetSource(source: string, scope: AssetScope): string {
  assert(source.length <= LIMITS.ipcFieldCharsMax, 'Content shown as rich text fits one field');
  return source.replace(/<(?:img|video|source)\b[^<>]*>/g, (tag) =>
    tag.replace(/(\ssrc=)\{([^{}]*)\}/g, (whole: string, attribute: string, expression: string) => {
      const path = shownAddress(expression, scope);
      return path === undefined ? whole : `${attribute}"${path}"`;
    }),
  );
}

export interface AssetNode {
  readonly kind: string;
  readonly name?: string;
  readonly props?: Readonly<Record<string, { readonly type: string; readonly value?: string } | undefined>> | undefined;
  readonly children?: readonly AssetNode[] | undefined;
}

export function shownAssetNodes<Node extends AssetNode>(nodes: readonly Node[], scope: AssetScope, depth = 0): readonly Node[] {
  assert(depth <= LIMITS.treeDepthMax, 'A page is no deeper than its bound');
  let changed = false;
  const shown = nodes.map((node): Node => {
    const source = node.props?.['src'];
    const path = MEDIA_TAGS.has(node.name ?? '') && source?.type === 'expr' ? shownAddress(source.value ?? '', scope) : undefined;
    const children = node.children === undefined ? undefined : shownAssetNodes(node.children, scope, depth + 1);
    if (path === undefined && children === node.children) {
      return node;
    }
    changed = true;
    return {
      ...node,
      ...(path === undefined ? {} : { props: { ...node.props, src: { type: 'string', value: path } } }),
      ...(children === undefined ? {} : { children }),
    };
  });
  return changed ? shown : nodes;
}

export function authoredSourcePaths(nodes: readonly AssetNode[]): ReadonlySet<string> {
  const found = new Set<string>();
  const pending: AssetNode[] = [...nodes];
  for (let visited = 0; visited < pending.length && visited < LIMITS.treeNodesMax; visited++) {
    const node = pending[visited];
    assert(node !== undefined, 'A visited node exists');
    const source = node.props?.['src'];
    if (source?.type === 'string' && source.value?.startsWith('/src/') === true) {
      found.add(source.value);
    }
    pending.push(...(node.children ?? []));
  }
  return found;
}

export type AssetContent =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'expr'; readonly value: string }
  | {
      readonly kind: 'element';
      readonly name: string;
      readonly props?: Readonly<Record<string, Attr | undefined>>;
      readonly children: readonly AssetContent[] | undefined;
    };

export function withAssetImports(
  content: readonly AssetContent[],
  scope: AssetScope,
  names: { readonly taken: ReadonlySet<string>; readonly authored: ReadonlySet<string> },
): { readonly content: AssetContent[]; readonly added: readonly ImportDecl[] } {
  const added: ImportDecl[] = [];
  const used = new Set(names.taken);
  const bindingFor = (path: string): string => {
    const known = [...scope.imports, ...added].find(
      (entry) => entry.named !== true && entry.typeOnly !== true && importedAssetPath(entry.path, scope.directory) === path,
    );
    if (known !== undefined) {
      return known.name;
    }
    const name = freeBinding(path, used);
    used.add(name);
    added.push({ name, path: specifierFor(path, scope), quote: scope.imports[0]?.quote === '"' ? '"' : "'" });
    return name;
  };
  const write = (nodes: readonly AssetContent[], depth: number): AssetContent[] => {
    assert(depth <= LIMITS.treeDepthMax, 'Rich text is no deeper than its bound');
    return nodes.map((node): AssetContent => {
      if (node.kind !== 'element') {
        return node;
      }
      const children = node.children === undefined ? undefined : write(node.children, depth + 1);
      const source = node.props?.['src'];
      const path = MEDIA_TAGS.has(node.name) && source?.type === 'string' ? renderedAssetPath(source.value) : undefined;
      if (path === undefined || !path.startsWith('/src/') || names.authored.has(path) || !(IMAGE_FILE.test(path) || VIDEO_FILE.test(path))) {
        return { ...node, children };
      }
      const binding = bindingFor(path);
      const expression: Attr = { type: 'expr', value: IMAGE_FILE.test(path) ? `${binding}.src` : binding };
      return { ...node, props: { ...node.props, src: expression }, children };
    });
  };
  return { content: write(content, 0), added };
}

function specifierFor(path: string, scope: AssetScope): string {
  const rel = path.slice(1);
  if (scope.imports.some((entry) => entry.path.startsWith('@/'))) {
    return `@/${rel.slice('src/'.length)}`;
  }
  const from = scope.directory.split('/').filter((part) => part !== '');
  const to = rel.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared++;
  }
  const up = from.slice(shared).map(() => '..');
  const rest = to.slice(shared).join('/');
  return up.length > 0 ? `${up.join('/')}/${rest}` : `./${rest}`;
}

const ADDED_MAX = 500;
const addedHere = new Set<string>();

const addedKey = (file: string, entry: Pick<ImportDecl, 'name' | 'path'>) => `${file}\n${entry.name}\n${entry.path}`;

export function noteAddedImports(file: string, added: readonly ImportDecl[]): void {
  for (const entry of added) {
    addedHere.add(addedKey(file, entry));
    const oldest = addedHere.values().next().value;
    if (addedHere.size > ADDED_MAX && oldest !== undefined) {
      addedHere.delete(oldest);
    }
  }
}

export function unusedAddedImports(
  file: string,
  page: { readonly imports: readonly ImportDecl[]; readonly nodes: readonly unknown[]; readonly frontmatter: string },
): ReadonlySet<string> {
  const written = JSON.stringify(page.nodes, (key, value: unknown) => (key === 'source' || key === 'attrSpans' ? undefined : value));
  const unused = page.imports
    .filter((entry) => addedHere.has(addedKey(file, entry)))
    .filter((entry) => {
      const name = new RegExp(`(?<![\\w$])${entry.name.replaceAll('$', '\\$')}(?![\\w$])`);
      return !name.test(written) && !name.test(page.frontmatter);
    });
  return new Set(unused.map((entry) => entry.name));
}

const BINDING_SUFFIX_MAX = 100;

function freeBinding(path: string, taken: ReadonlySet<string>): string {
  const file = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  const joined = file
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('')
    .slice(0, 48);
  const wanted = joined === '' ? 'asset' : /^\d/.test(joined) ? `asset${joined}` : joined;
  for (let suffix = 1; suffix <= BINDING_SUFFIX_MAX; suffix++) {
    const candidate = suffix === 1 ? wanted : `${wanted}${suffix}`;
    if (!taken.has(candidate) && !RESERVED.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No free import name for ${path}`);
}

const RESERVED: ReadonlySet<string> = new Set([
  'class',
  'default',
  'export',
  'import',
  'new',
  'delete',
  'switch',
  'case',
  'public',
  'static',
  'function',
  'var',
  'const',
  'let',
  'for',
  'if',
  'else',
  'return',
  'this',
  'in',
  'do',
  'void',
  'with',
  'yield',
  'await',
]);
