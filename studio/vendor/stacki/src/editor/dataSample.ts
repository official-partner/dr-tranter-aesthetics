
import { toRecord, toArray } from '../../shared/core/record';
import { ENGLISH_TRANSLATE } from '../../shared/properties/i18n/englishTranslator';
import { englishText, messageRef, type MessageKey, type Translator, type TypedMessageRef } from '../../shared/properties/i18n/messageRef';
import { parseDeclarations, firstObjectIn, objectEntries, kindOf, parseDestructures, referenceCallIn } from './dataSource';

export interface PathStep {
  readonly key: string | number;
  readonly end: number;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const STEP = /^(?:\.?([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\])/;

export function pathSteps(path: string): readonly PathStep[] | undefined {
  const steps: PathStep[] = [];
  let at = 0;
  while (at < path.length) {
    const match = STEP.exec(path.slice(at));
    if (match === null || (steps.length === 0 && path.charAt(at) === '.')) {
      return undefined;
    }
    at += match[0].length;
    const quoted: unknown = match[3] === undefined ? undefined : JSON.parse(match[3]);
    const key = match[1] ?? (match[2] === undefined ? (typeof quoted === 'string' ? quoted : undefined) : Number(match[2]));
    if (key === undefined) {
      return undefined;
    }
    steps.push({ key, end: at });
  }
  return steps;
}

export function childPath(base: string, key: string): string {
  return IDENTIFIER.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

export function sampleAt(sample: unknown, path: unknown): unknown {
  const steps = pathSteps(String(path || ''));
  if (steps === undefined) {
    return undefined;
  }
  let current: unknown = sample;
  for (const step of steps) {
    if (typeof step.key === 'number') {
      current = toArray(current)?.[step.key];
    } else {
      current = toRecord(current)?.[step.key];
    }
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

export const isRef = (candidate: unknown): candidate is { id: string; collection: string } => {
  const record = toRecord(candidate);
  return record !== undefined && typeof record['id'] === 'string' && typeof record['collection'] === 'string' && record['data'] === undefined;
};

export const sampleKey = (collection: string, id?: string): string => (id ? `${collection}#${id}` : collection);

export const entrySampleKey = (collection: string, index: number): string => `${collection}[${index}]`;

export interface ReferenceNeed {
  readonly key: string;
  readonly collection: string;
  readonly id: string;
}

export function referencesInScope(frontmatter: string | undefined, propsSample: unknown): ReferenceNeed[] {
  if (!propsSample) {
    return [];
  }
  const out: ReferenceNeed[] = [];
  const seen = new Set<string>();
  const consider = (valueText: string): void => {
    const call = referenceCallIn(valueText);
    if (!call) {
      return;
    }
    const at = sampleAt(propsSample, call.path);
    const list = toArray(at);
    const ref = list ? list.find(isRef) : at;
    if (!isRef(ref)) {
      return;
    }
    const key = sampleKey(ref.collection, ref.id);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ key, collection: ref.collection, id: ref.id });
  };
  for (const [, value] of parseDeclarations(frontmatter ?? '')) {
    consider(value);
  }
  for (const destructure of parseDestructures(frontmatter ?? '')) {
    consider(destructure.from);
  }
  return out;
}


export const marker = (value: unknown): string | undefined => {
  const tag = toRecord(value)?.['__stacki'];
  return typeof tag === 'string' ? tag : undefined;
};

export function sampleKind(sample: unknown): string {
  if (sample === null || sample === undefined) {
    return 'empty';
  }
  if (Array.isArray(sample)) {
    return 'list';
  }
  if (typeof sample === 'object') {
    return marker(sample) ?? 'object';
  }
  if (typeof sample === 'string') {
    return 'text';
  }
  if (typeof sample === 'number') {
    return 'number';
  }
  if (typeof sample === 'boolean') {
    return 'boolean';
  }
  return 'empty';
}

export const ENTRY_INTERNALS = new Set(['filePath', 'digest', 'rendered', 'deferredRender', 'legacyId', 'assetImports']);
export const isEntry = (entry: Record<string, unknown>): boolean => 'collection' in entry && 'data' in entry;
export const shownKeys = (sample: unknown): string[] => {
  const record = toRecord(sample) ?? {};
  return isEntry(record) ? Object.keys(record).filter((key) => !ENTRY_INTERNALS.has(key)) : Object.keys(record);
};

export const clip = (text: unknown, max: number): string => (String(text).length > max ? `${String(text).slice(0, max)}…` : String(text));

export function samplePreview(sample: unknown): string {
  const kind = sampleKind(sample);
  if (kind === 'date') {
    const value = toRecord(sample)?.['value'];
    return value ? String(value).slice(0, 10) : 'date';
  }
  if (kind === 'deep') {
    return 'deeper…';
  }
  if (kind === 'more') {
    return `${String(toRecord(sample)?.['count'])} more`;
  }
  if (kind === 'empty') {
    return '—';
  }
  if (kind === 'text') {
    return sample === '' ? '""' : clip(`"${String(sample)}"`, 42);
  }
  if (kind === 'number' || kind === 'boolean') {
    return String(sample);
  }
  if (kind === 'list') {
    const list = toArray(sample) ?? [];
    const more = list.find((x) => marker(x) === 'more');
    const shown = list.length - (more ? 1 : 0);
    const count = toRecord(more)?.['count'];
    const total = more ? shown + (typeof count === 'number' ? count : 0) : shown;
    return englishText(messageRef('editor.dataTree.items', { count: total }));
  }
  const keys = shownKeys(sample);
  return keys.length ? englishText(messageRef('editor.dataTree.fields', { count: keys.length })) : '{}';
}

export function samplePreviewRef(sample: unknown): TypedMessageRef | undefined {
  const kind = sampleKind(sample);
  if (kind === 'date') {
    return toRecord(sample)?.['value'] ? undefined : messageRef('editor.dataTree.kind.date');
  }
  if (kind === 'deep') {
    return messageRef('editor.dataTree.deeper');
  }
  if (kind === 'more') {
    return messageRef('editor.dataTree.more', { count: Number(toRecord(sample)?.['count']) });
  }
  if (kind === 'list') {
    const list = toArray(sample) ?? [];
    const more = list.find((x) => marker(x) === 'more');
    const shown = list.length - (more ? 1 : 0);
    const count = toRecord(more)?.['count'];
    return messageRef('editor.dataTree.items', { count: more ? shown + (typeof count === 'number' ? count : 0) : shown });
  }
  if (kind === 'object') {
    const count = shownKeys(sample).length;
    return count > 0 ? messageRef('editor.dataTree.fields', { count }) : undefined;
  }
  return undefined;
}

export function previewText(node: Pick<TreeNode, 'preview' | 'previewRef'>, translate: Translator = ENGLISH_TRANSLATE): string {
  if (node.previewRef === undefined) {
    return node.preview;
  }
  return node.previewRef.params === undefined ? translate(node.previewRef.key) : translate(node.previewRef.key, node.previewRef.params);
}

export function previewFields(ref: TypedMessageRef): { readonly preview: string; readonly previewRef: TypedMessageRef } {
  return { preview: englishText(ref), previewRef: ref };
}

const TREE_KIND_KEYS: Readonly<Record<string, MessageKey>> = {
  text: 'editor.dataTree.kind.text',
  number: 'editor.dataTree.kind.number',
  boolean: 'editor.dataTree.kind.boolean',
  list: 'editor.dataTree.kind.list',
  object: 'editor.dataTree.kind.object',
  date: 'editor.dataTree.kind.date',
  'image url': 'editor.dataTree.kind.imageUrl',
  imported: 'editor.dataTree.kind.imported',
  function: 'editor.dataTree.kind.function',
  value: 'editor.dataTree.kind.value',
  empty: 'editor.dataTree.kind.empty',
  'loop item': 'editor.dataTree.kind.loopItem',
};

export function treeKindLabel(kind: string, translate: Translator = ENGLISH_TRANSLATE): string {
  const key = Object.hasOwn(TREE_KIND_KEYS, kind) ? TREE_KIND_KEYS[kind] : undefined;
  return key === undefined ? kind : translate(key);
}

export const TREE_DEPTH_MAX = 6;

export interface ImportNeed {
  readonly spec: string;
  readonly exported: string;
  readonly name: string;
}

export interface TreeNode {
  path: string;
  key: string;
  kind: string;
  preview: string;
  previewRef?: TypedMessageRef | undefined;
  children: TreeNode[] | undefined;
  section?: string;
  nav?: { index: number; count: number };
  entryCount?: number;
  query?: { collection: string; name: string };
  importNeed?: ImportNeed;
  unbindable?: string;
  unbindableRef?: TypedMessageRef | undefined;
  note?: string;
  noteRef?: TypedMessageRef | undefined;
  computedList?: boolean;
  lazy?: boolean;
  image?: string;
}

const IMAGE_URL = /^https:\/\/(?:cdn\.sanity\.io\/images\/\S+|\S+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]\S*)?)$/i;

export function fromSample(value: unknown, base: string, depth: number): TreeNode[] | undefined {
  if (depth >= TREE_DEPTH_MAX) {
    return undefined;
  }
  const kind = sampleKind(value);
  if (kind === 'object') {
    const record = toRecord(value) ?? {};
    return shownKeys(value).map((key) => sampleNode(childPath(base, key), key, record[key], depth + 1));
  }
  if (kind === 'list') {
    return (toArray(value) ?? [])
      .map((entry, i) => (marker(entry) === 'more' ? undefined : sampleNode(`${base}[${i}]`, String(i), entry, depth + 1)))
      .filter((node): node is TreeNode => node !== undefined);
  }
  return undefined;
}

export function sampleNode(path: string, key: string, value: unknown, depth: number): TreeNode {
  const children = fromSample(value, path, depth);
  const image = typeof value === 'string' && IMAGE_URL.test(value) ? value : undefined;
  const kind = sampleKind(value);
  const entryCount = kind === 'list' ? entryCountOf(children) : undefined;
  return {
    path,
    key,
    kind,
    preview: samplePreview(value),
    ...(samplePreviewRef(value) === undefined ? {} : { previewRef: samplePreviewRef(value) }),
    children: children && children.length ? children : undefined,
    ...(image === undefined ? {} : { image }),
    ...(entryCount === undefined ? {} : { entryCount }),
  };
}

function entryCountOf(children: readonly TreeNode[] | undefined): number | undefined {
  if (children === undefined) {
    return undefined;
  }
  if (children.length < 2) {
    return undefined;
  }
  return children.every((child) => child.children !== undefined) ? children.length : undefined;
}

export const LITERAL_DEPTH_MAX = 4;

export function fromLiteral(text: unknown, base: string, depth: number): TreeNode[] | undefined {
  if (depth >= LITERAL_DEPTH_MAX) {
    return undefined;
  }
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{')) {
    const entries = objectEntries(trimmed);
    return entries.length ? entries.map((entry) => literalNode(childPath(base, entry.key), entry.key, entry.value, depth + 1)) : undefined;
  }
  if (trimmed.startsWith('[')) {
    const first = firstObjectIn(trimmed);
    if (!first) {
      return undefined;
    }
    const item = literalNode(`${base}[0]`, '0', first, depth + 1);
    return item.children ? [item] : undefined;
  }
  return undefined;
}

export function literalNode(path: string, key: string, valueText: unknown, depth: number): TreeNode {
  const trimmed = String(valueText || '').trim();
  const kind = kindOf(trimmed) || 'value';
  const children = fromLiteral(trimmed, path, depth);
  return {
    path,
    key,
    kind,
    preview: kind === 'text' || kind === 'number' || kind === 'boolean' ? clip(trimmed, 42) : '',
    children: children && children.length ? children : undefined,
  };
}
