
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { toRecord } from '../../../shared/core/record';
import { isPickerShown, type ProjectFolders } from '../../../shared/properties/projectFolders';
import { namesInScope } from '../../editor/dataScope';
import { sampleNode, type TreeNode } from '../../editor/dataSample';
import type { ImportLike } from '../../editor/dataSource';
import { freeName } from '../../editor/frontmatterAdditions';
import { dataFileSection } from './dataPickerModel';

export interface CatalogFile {
  readonly rel: string;
  readonly data?: unknown;
  readonly error?: string;
}

export interface DataFileExport {
  readonly file: string;
  readonly exported: string;
  readonly value: unknown;
}

export type ImportStyle = { readonly kind: 'alias' } | { readonly kind: 'relative' };

export interface ProjectSourceInput {
  readonly exports: readonly DataFileExport[];
  readonly config: ProjectFolders | undefined;
  readonly style: ImportStyle;
  readonly file: string | undefined;
  readonly frontmatter: string;
  readonly imports: readonly ImportLike[];
}

const GENERAL = '*general';
const EXPRESSION = '__expr';
const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const DATA_EXTENSIONS = ['.ts', '.js', '.mjs', '.mts', '.cjs', '.cts', '.tsx', '.jsx', '.json'] as const;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
export const PROJECT_EXPORTS_MAX = 256;
export const PROJECT_LIST_ITEMS_MAX = 50;

export function dataFileExports(files: readonly CatalogFile[]): readonly DataFileExport[] {
  const out: DataFileExport[] = [];
  for (const entry of files) {
    if (out.length >= PROJECT_EXPORTS_MAX) {
      break;
    }
    const hash = entry.rel.indexOf('#');
    const file = 'src/' + (hash === -1 ? entry.rel : entry.rel.slice(0, hash));
    if (/\.astro$/i.test(file) || entry.data === undefined || entry.error !== undefined) {
      continue;
    }
    const address = hash === -1 ? undefined : entry.rel.slice(hash + 1);
    if (address === undefined) {
      if (/\.json$/i.test(file)) {
        out.push({ file, exported: 'default', value: entry.data });
      }
    } else if (address === GENERAL) {
      for (const [exported, value] of Object.entries(toRecord(entry.data) ?? {})) {
        out.push({ file, exported, value });
      }
    } else {
      out.push({ file, exported: address, value: entry.data });
    }
  }
  const listed = out.slice(0, PROJECT_EXPORTS_MAX).filter((item) => item.exported === 'default' || IDENTIFIER.test(item.exported));
  assert(
    listed.every((item) => item.file.startsWith('src/')),
    'dataFileExports: every data file is under src/',
  );
  return listed;
}

export function projectSourceNodes(input: ProjectSourceInput): TreeNode[] {
  const from = input.file;
  if (from === undefined || from === '') {
    return [];
  }
  assert(input.exports.length <= PROJECT_EXPORTS_MAX, 'projectSourceNodes: the export list is bounded');
  const files = new Set(input.exports.map((item) => item.file));
  const imported = input.imports.map((imp) => ({ imp, file: moduleFileOf(imp.path ?? '', from, files) }));
  const taken = new Set(namesInScope(input.frontmatter, input.imports));
  const nodes: TreeNode[] = [];
  for (const item of input.exports) {
    if (!isPickerShown(input.config, { kind: 'export', file: item.file, exported: item.exported })) {
      continue;
    }
    if (imported.some(({ imp, file }) => file === item.file && readsExport(imp, item.exported))) {
      continue;
    }
    const sibling = imported.find(({ imp, file }) => file === item.file && imp.named === true && imp.typeOnly !== true);
    const spec = sibling?.imp.path ?? importSpecFor(item.file, from, input.style);
    const name = freeName(item.exported === 'default' ? defaultName(item.file) : item.exported, taken);
    taken.add(name);
    nodes.push({
      ...valueNode(name, item.value),
      section: dataFileSection(item.file),
      importNeed: { spec, exported: item.exported, name },
    });
  }
  assert(nodes.length <= input.exports.length, 'projectSourceNodes: one root per export at most');
  return nodes;
}

export function importedProjectData(input: Pick<ProjectSourceInput, 'exports' | 'file' | 'imports'>): Readonly<Record<string, string>> {
  const from = input.file;
  if (from === undefined || from === '') {
    return {};
  }
  assert(input.exports.length <= PROJECT_EXPORTS_MAX, 'importedProjectData: the export list is bounded');
  const files = new Set(input.exports.map((item) => item.file));
  const out: Record<string, string> = {};
  for (const imp of input.imports) {
    const file = moduleFileOf(imp.path ?? '', from, files);
    const local = imp.name ?? '';
    if (file === undefined || local === '' || imp.typeOnly === true) {
      continue;
    }
    const exported = imp.named === true ? (imp.imported ?? local) : 'default';
    if (input.exports.some((item) => item.file === file && item.exported === exported)) {
      out[local] = file;
    }
  }
  assert(Object.keys(out).length <= input.imports.length, 'importedProjectData: one name per import at most');
  return out;
}

export function importSpecFor(target: string, from: string, style: ImportStyle): string {
  assert(target.startsWith('src/'), 'importSpecFor: the target is under src/');
  const module = target.replace(SCRIPT_EXTENSION, '');
  switch (style.kind) {
    case 'alias':
      return '@/' + module.slice('src/'.length);
    case 'relative': {
      const relative = relativePath(directoryOf(from), module);
      return relative.startsWith('.') ? relative : './' + relative;
    }
    default: {
      const exhaustive: never = style;
      return exhaustive;
    }
  }
}

export function moduleFileOf(spec: string, from: string, files: ReadonlySet<string>): string | undefined {
  let base: string | undefined;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    base = joinPath(directoryOf(from), spec);
  } else if (spec.startsWith('@/')) {
    base = 'src/' + spec.slice('@/'.length);
  }
  if (base === undefined) {
    return undefined;
  }
  const candidates = [base, ...DATA_EXTENSIONS.map((extension) => base + extension), ...DATA_EXTENSIONS.map((extension) => `${base}/index${extension}`)];
  return candidates.find((candidate) => files.has(candidate));
}

export function aliasProbeFor(target: string): string | undefined {
  return target.startsWith('src/') ? importSpecFor(target, target, { kind: 'alias' }) : undefined;
}

function readsExport(imp: ImportLike, exported: string): boolean {
  if (imp.typeOnly === true) {
    return false;
  }
  if (exported === 'default') {
    return imp.named !== true;
  }
  return imp.named === true && (imp.imported ?? imp.name) === exported;
}

function defaultName(file: string): string {
  const base = (file.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  const words = base.split(/[^A-Za-z0-9_$]+/).filter((word) => word !== '');
  const name = words.map((word, index) => (index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1))).join('');
  return IDENTIFIER.test(name) ? name : 'data';
}

function valueNode(name: string, value: unknown): TreeNode {
  const bounded = boundedLists(value, 0);
  const marked = markExpressions(sampleNode(name, name, withoutExpressions(bounded, 0), 0), bounded, 0);
  return isComputedList(value) ? { ...marked, computedList: true } : marked;
}

export function isComputedList(value: unknown): boolean {
  const record = toRecord(value);
  const code = record?.[EXPRESSION];
  return isExpression(value) && typeof code === 'string' && code.trimStart().startsWith('[');
}

function boundedLists(value: unknown, depth: number): unknown {
  assert(depth <= LIMITS.treeDepthMax, 'boundedLists: depth limit exceeded');
  if (Array.isArray(value)) {
    const kept = value.slice(0, PROJECT_LIST_ITEMS_MAX).map((item: unknown) => boundedLists(item, depth + 1));
    const rest = value.length - kept.length;
    const out = rest > 0 ? [...kept, { __stacki: 'more', count: rest }] : kept;
    assert(out.length <= PROJECT_LIST_ITEMS_MAX + 1, 'boundedLists: the cut list is bounded');
    return out;
  }
  const record = toRecord(value);
  if (record === undefined || isExpression(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, boundedLists(item, depth + 1)]));
}

function withoutExpressions(value: unknown, depth: number): unknown {
  assert(depth <= LIMITS.treeDepthMax, 'withoutExpressions: depth limit exceeded');
  if (isExpression(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withoutExpressions(item, depth + 1));
  }
  const record = toRecord(value);
  if (record === undefined) {
    return value;
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, withoutExpressions(item, depth + 1)]));
}

function markExpressions(node: TreeNode, value: unknown, depth: number): TreeNode {
  assert(depth <= LIMITS.treeDepthMax, 'markExpressions: depth limit exceeded');
  if (isExpression(value)) {
    return { ...node, kind: 'value', preview: '' };
  }
  const children = node.children;
  if (children === undefined) {
    return node;
  }
  const list = Array.isArray(value) ? value : undefined;
  const record = toRecord(value);
  const marked = children.map((child) => markExpressions(child, list !== undefined ? list[Number(child.key)] : record?.[child.key], depth + 1));
  return { ...node, children: marked };
}

function isExpression(value: unknown): boolean {
  const record = toRecord(value);
  return record !== undefined && typeof record[EXPRESSION] === 'string' && Object.keys(record).length === 1;
}

function directoryOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash === -1 ? '' : file.slice(0, slash);
}

function joinPath(directory: string, spec: string): string | undefined {
  const parts = directory === '' ? [] : directory.split('/');
  for (const part of spec.split('/')) {
    if (part === '..') {
      if (parts.length === 0) {
        return undefined;
      }
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function relativePath(directory: string, target: string): string {
  const from = directory === '' ? [] : directory.split('/');
  const to = target.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) {
    shared++;
  }
  const up = from.slice(shared).map(() => '..');
  return [...up, ...to.slice(shared)].join('/');
}
