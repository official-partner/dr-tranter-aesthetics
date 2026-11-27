
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { toRecord, toArray } from '../../shared/core/record';
import {
  DATA_SUGGEST_LIMITS,
  parseDeclarations,
  type ImportLike,
  mayHoldData,
  NON_DATA_EXT,
  TOOL_MODULE,
  type Destructure,
  parseDestructures,
  looksCallable,
  collectionCallIn,
  referenceCallIn,
} from './dataSource';
import { entrySampleKey, sampleAt, sampleKey, type TreeNode, sampleNode, literalNode, previewFields } from './dataSample';
import { englishText, messageRef, type TypedMessageRef } from '../../shared/properties/i18n/messageRef';
import { queriesInScope, namesInScope, type CollectionReader, type DataContext, type SchemaField, type ShapeMember, autoQueryName } from './dataScope';
import { loopSourcePath, parseLoopHead } from './loopSource';
import { loopIndexesOfCopy } from './loopSelection';
import type { LoopCopy } from './loopSelection';
import type { ImportedValue } from './importedValues';
export {
  QUERY_MARK,
  type MarkedQuery,
  markedQueries,
  removeMarkedQuery,
  queriesInScope,
  namesInScope,
  type DataContext,
  type SchemaField,
  type ScopeChip,
  scopeChips,
  autoQueryName,
  collectionsInScope,
  type ImportedCall,
  importedCallsInScope,
  type SanityFetch,
  sanityFetchesInScope,
} from './dataScope';

export { sampleAt, sampleKey, type ReferenceNeed, referencesInScope, sampleKind, samplePreview, type TreeNode } from './dataSample';

export {
  parseDeclarations,
  type DeclarationSpan,
  findDeclaration,
  findImportOf,
  firstObjectIn,
  type ObjectEntry,
  objectEntries,
  type Destructure,
  parseDestructures,
  collectionCallIn,
  referenceCallIn,
} from './dataSource';

export function scopeCompletions(context: DataContext = {}): { label: string; detail: string }[] {
  const out: { label: string; detail: string }[] = [];
  const seen = new Set<string>();
  const add = (label: string | undefined, detail: string): void => {
    if (!label || seen.has(label)) {
      return;
    }
    seen.add(label);
    out.push({ label, detail });
  };
  const walk = (nodes: readonly TreeNode[] | undefined, depth: number): void => {
    for (const node of nodes ?? []) {
      add(node.path, node.preview ? String(node.preview).slice(0, 40) : (node.section ?? ''));
      if (depth < DATA_SUGGEST_LIMITS.completionDepthMax && Array.isArray(node.children)) {
        walk(node.children, depth + 1);
      }
    }
  };
  try {
    walk(dataTree(context), 0);
  } catch {
  }
  for (const name of namesInScope(context.frontmatter ?? '', context.imports ?? [])) {
    add(name, 'frontmatter');
  }
  return out;
}

const RENDER_SHAPE: Record<string, readonly { key: string; kind: string }[]> = {
  headings: [
    { key: 'depth', kind: 'number' },
    { key: 'slug', kind: 'text' },
    { key: 'text', kind: 'text' },
  ],
};

function shapeNode(name: string, fields: readonly { key: string; kind: string }[]): TreeNode {
  const item: TreeNode = {
    path: `${name}[0]`,
    key: '0',
    kind: 'object',
    preview: '',
    children: fields.map((field) => ({
      path: `${name}[0].${field.key}`,
      key: field.key,
      kind: field.kind,
      preview: '',
      children: undefined,
    })),
  };
  return { path: name, key: name, kind: 'list', preview: '', children: [item] };
}

const KEEPS_SHAPE = new RegExp(
  /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*/.source + /(filter|slice|sort|reverse|concat|toSorted|toReversed|flat)\s*\(/.source,
  '',
);

const PICKS_ONE = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\.\s*(?:find|at|pop|shift)\s*\(|\[\s*\d+\s*\])/;

function addUnique(list: TreeNode[], node: TreeNode | undefined, seen: Set<string>): void {
  if (!node || seen.has(node.path)) {
    return;
  }
  seen.add(node.path);
  list.push(node);
}

function shapeChildren(field: SchemaField | undefined, base: string): TreeNode[] | undefined {
  if (!field?.shape?.length) {
    return undefined;
  }
  return shapeNodes(field, base, 1);
}

function shapeNodes(owner: Pick<ShapeMember, 'shape' | 'shapeIsList'>, base: string, depth: number): TreeNode[] {
  const shape = owner.shape ?? [];
  assert(depth <= LIMITS.listFieldDepthMax, 'shapeNodes: the shape nests within its bound');
  const fields = (at: string): TreeNode[] =>
    shape.map((member) => {
      const path = `${at}.${member.name}`;
      const nested = member.shape?.length && depth < LIMITS.listFieldDepthMax ? shapeNodes(member, path, depth + 1) : undefined;
      return {
        path,
        key: member.name,
        kind: nested ? (member.shapeIsList ? 'list' : 'object') : shapeMemberKind(member),
        preview: '',
        children: nested,
      };
    });
  return owner.shapeIsList === true
    ? [
        {
          path: `${base}[0]`,
          key: '0',
          kind: 'object',
          preview: '',
          children: fields(`${base}[0]`),
        },
      ]
    : fields(base);
}

function shapeMemberKind(member: ShapeMember): string {
  if (member.type === 'code') {
    return 'value';
  }
  if (member.format === 'image' || member.format === 'video' || member.format === 'file') {
    return 'image url';
  }
  return member.format === 'date' ? 'date' : (member.type ?? 'value');
}

function buildPropNodes(
  destructures: readonly Destructure[],
  schema: readonly SchemaField[],
  values: { readonly sample: unknown; readonly instance: DataContext['propsInstance'] },
  seen: Set<string>,
): TreeNode[] {
  const { sample, instance } = values;
  const props: TreeNode[] = [];
  const sampleRecord = toRecord(sample);
  const known = (name: string): boolean => sampleRecord !== undefined && Object.prototype.hasOwnProperty.call(sample, name);
  const renamed = new Set<string>();
  for (const destructure of destructures) {
    if (!/^Astro\.props\b/.test(destructure.from)) {
      continue;
    }
    const prop = destructure.prop;
    if (prop !== destructure.name) {
      renamed.add(prop);
    }
    if (known(prop) && sampleRecord) {
      addUnique(props, sampleNode(destructure.name, destructure.name, sampleRecord[prop], 0), seen);
      continue;
    }
    const field = schema.find((field) => field.name === prop);
    const shape = shapeChildren(field, destructure.name);
    const node: TreeNode = {
      path: destructure.name,
      key: destructure.name,
      kind: shape && field?.shapeIsList ? 'list' : destructure.kind === 'rest' ? 'rest props' : field?.type || destructure.kind || 'prop',
      preview: '',
      children: shape,
    };
    addUnique(props, destructure.kind === 'rest' ? node : withPropValue(node, prop, { field, defaultText: destructure.defaultText, instance }), seen);
  }
  for (const field of schema) {
    if (seen.has(field.name) || renamed.has(field.name)) {
      continue;
    }
    addUnique(
      props,
      known(field.name) && sampleRecord
        ? sampleNode(field.name, field.name, sampleRecord[field.name], 0)
        : withPropValue(
            {
              path: field.name,
              key: field.name,
              kind: field.shape && field.shapeIsList ? 'list' : field.type || 'prop',
              preview: '',
              children: shapeChildren(field, field.name),
            },
            field.name,
            { field, defaultText: undefined, instance },
          ),
      seen,
    );
  }
  return props;
}

function withPropValue(
  node: TreeNode,
  prop: string,
  from: { readonly field: SchemaField | undefined; readonly defaultText: string | undefined; readonly instance: DataContext['propsInstance'] },
): TreeNode {
  assert(node.preview === '', 'withPropValue: the prop has no value of its own yet');
  const passed = from.instance?.passed.includes(prop) ?? false;
  if (passed) {
    return node;
  }
  const fieldDefault = from.field?.default;
  if (fieldDefault !== undefined) {
    return { ...node, preview: typeof fieldDefault === 'string' ? JSON.stringify(fieldDefault) : String(fieldDefault) };
  }
  const literal = from.defaultText === undefined ? '' : literalNode(node.path, node.key, from.defaultText, 0).preview;
  if (literal !== '') {
    const words = /^(['`])([\s\S]*)\1$/.exec(literal);
    return { ...node, preview: words === null ? literal : `"${words[2] ?? ''}"` };
  }
  return from.instance === undefined
    ? node
    : { ...node, note: englishText(messageRef('editor.dataTree.notSet')), noteRef: messageRef('editor.dataTree.notSet') };
}

function referenceNode(name: string, value: string, samples: Record<string, unknown>, sample: unknown): TreeNode | undefined {
  const ref = referenceCallIn(value);
  if (ref === undefined) {
    return undefined;
  }
  const at = sampleAt(sample, ref.path);
  const targetList = toArray(at);
  const target = targetList ? targetList.find((candidate) => toRecord(candidate)?.['collection']) : at;
  const targetRecord = toRecord(target);
  const targetCollection = targetRecord?.['collection'];
  const targetId = targetRecord?.['id'];
  if (typeof targetCollection !== 'string') {
    return undefined;
  }
  const resolved = samples[sampleKey(targetCollection, typeof targetId === 'string' ? targetId : undefined)];
  if (!resolved) {
    return undefined;
  }
  const many = ref.fn === 'getEntries';
  const node = sampleNode(name, name, many ? [resolved] : resolved, 0);
  Object.assign(node, previewFields(messageRef(many ? 'editor.dataTree.collectionEntries' : 'editor.dataTree.collectionEntry', { name: targetCollection })));
  return node;
}

function buildValueNodes(
  decls: ReadonlyMap<string, string>,
  destructures: readonly Destructure[],
  page: PageData,
  sample: unknown,
  seen: Set<string>,
  valueSamples: Record<string, unknown> = {},
): TreeNode[] {
  const { imports, samples } = page;
  const values: TreeNode[] = [];
  for (const [name, value] of decls) {
    if (looksCallable(value)) {
      continue;
    }
    const returned = valueSamples[name];
    if (returned !== undefined && returned !== null) {
      addUnique(values, sampledValueNode(name, value, returned), seen);
      continue;
    }
    const written = /^[{[]/.test(value.trim());
    const call = written ? undefined : collectionCallIn(value);
    const entry = call ? samples[call.name] : undefined;
    if (call && entry) {
      const many = call.fn !== 'getEntry';
      const node = sampleNode(name, name, many ? [entry] : entry, 0);
      Object.assign(node, previewFields(messageRef(many ? 'editor.dataTree.collectionEntries' : 'editor.dataTree.collectionEntry', { name: call.name })));
      addUnique(values, node, seen);
      continue;
    }
    const listed = value.includes('(') ? (written ? listsHolderNode(name, value, page) : collectionListNode(name, page)) : undefined;
    if (listed !== undefined) {
      addUnique(values, listed, seen);
      continue;
    }
    const referenced = referenceNode(name, value, samples, sample);
    if (referenced !== undefined) {
      addUnique(values, referenced, seen);
      continue;
    }
    addUnique(values, literalNode(name, name, value, 0), seen);
  }
  for (const destructure of destructures) {
    if (/^Astro\.props\b/.test(destructure.from)) {
      continue;
    }
    const destructured = valueSamples[destructure.name];
    if (destructured !== undefined && destructured !== null) {
      addUnique(values, sampleNode(destructure.name, destructure.name, destructured, 0), seen);
      continue;
    }
    const shape = /\brender\s*\(/.test(destructure.from) ? RENDER_SHAPE[destructure.name] : undefined;
    addUnique(
      values,
      shape
        ? shapeNode(destructure.name, shape)
        : {
            path: destructure.name,
            key: destructure.name,
            kind: destructure.kind || 'value',
            preview: '',
            children: undefined,
          },
      seen,
    );
  }
  addImportNodes(values, decls, { imports, importedValues: page.importedValues, valueSamples }, seen);
  return values;
}

function sampledValueNode(name: string, declaration: string, sampled: unknown): TreeNode {
  const node = sampleNode(name, name, sampled, 0);
  const call = /^[{[]/.test(declaration.trim()) ? undefined : collectionCallIn(declaration);
  if (call !== undefined) {
    Object.assign(
      node,
      previewFields(messageRef(call.fn === 'getEntry' ? 'editor.dataTree.collectionEntry' : 'editor.dataTree.collectionEntries', { name: call.name })),
    );
  }
  assert(node.path === name, 'A sampled value is named as the page names it');
  return node;
}

function addImportNodes(
  values: TreeNode[],
  decls: ReadonlyMap<string, string>,
  scope: {
    readonly imports: readonly ImportLike[];
    readonly importedValues: Readonly<Record<string, ImportedValue>>;
    readonly valueSamples: Record<string, unknown>;
  },
  seen: Set<string>,
): void {
  const before = values.length;
  for (const imp of scope.imports) {
    if (imp.name === undefined || imp.typeOnly === true || decls.has(imp.name)) {
      continue;
    }
    const node = importNode(imp.name, imp, scope.importedValues[imp.name], scope.valueSamples[imp.name]);
    if (node !== undefined) {
      assert(node.path === imp.name, 'An import is named as the file names it');
      addUnique(values, node, seen);
    }
  }
  assert(values.length - before <= scope.imports.length, 'One node per import at most');
}

const CONSTANT_CASE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

function importNode(name: string, imp: ImportLike, declared: ImportedValue | undefined, sampled: unknown): TreeNode | undefined {
  const path = imp.path ?? '';
  if (NON_DATA_EXT.test(path) || TOOL_MODULE.test(path)) {
    return undefined;
  }
  if (declared === undefined && !mayHoldData(imp) && !CONSTANT_CASE.test(name)) {
    return undefined;
  }
  if (sampled !== undefined && sampled !== null) {
    return sampleNode(name, name, sampled, 0);
  }
  const from = `from ${path}`;
  if (declared === undefined) {
    return {
      path: name,
      key: name,
      kind: 'imported',
      preview: path === '' ? '' : from,
      ...(path === '' ? {} : { previewRef: messageRef('editor.dataTree.from', { path }) }),
      children: undefined,
    };
  }
  switch (declared.kind) {
    case 'function':
      return {
        path: name,
        key: name,
        kind: 'function',
        preview: englishText(functionPreviewRef(path)),
        previewRef: functionPreviewRef(path),
        children: undefined,
        unbindable: englishText(messageRef('editor.dataTree.unbindable', { name })),
        unbindableRef: messageRef('editor.dataTree.unbindable', { name }),
      };
    case 'data':
      return sampleNode(name, name, declared.value, 0);
    case 'literal': {
      const node = literalNode(name, name, declared.text, 0);
      return node.kind === 'value' ? { ...node, kind: 'imported', preview: from, previewRef: messageRef('editor.dataTree.from', { path }) } : node;
    }
    default: {
      const exhaustive: never = declared;
      return exhaustive;
    }
  }
}

function withDerivedShapes(
  decls: ReadonlyMap<string, string>,
  props: readonly TreeNode[],
  values: readonly TreeNode[],
): { readonly props: TreeNode[]; readonly values: TreeNode[] } {
  const byName = new Map<string, TreeNode>();
  const replaced = new Map<TreeNode, TreeNode>();
  for (const node of [...props, ...values]) {
    byName.set(node.path, node);
  }
  for (const [name, value] of decls) {
    const node = byName.get(name);
    if (!node || node.children) {
      continue;
    }
    const shaped = derivedShape(node, String(value).trim(), byName);
    if (shaped !== undefined) {
      byName.set(name, shaped);
      replaced.set(node, shaped);
    }
  }
  const latest = (node: TreeNode): TreeNode => replaced.get(node) ?? node;
  const derived = { props: props.map(latest), values: values.map(latest) };
  assert(derived.props.length === props.length, 'Deriving shapes keeps every prop');
  assert(derived.values.length === values.length, 'Deriving shapes keeps every value');
  return derived;
}

function derivedShape(node: TreeNode, declaration: string, byName: ReadonlyMap<string, TreeNode>): TreeNode | undefined {
  const name = node.path;
  const match = declaration.match(KEEPS_SHAPE);
  const baseName = match?.[1];
  const base = baseName !== undefined ? byName.get(baseName) : undefined;
  if (base?.children) {
    const children = rebase(base.children, base.path, name);
    return { ...node, kind: base.kind, preview: base.preview, ...(base.previewRef === undefined ? {} : { previewRef: base.previewRef }), children };
  }
  const one = declaration.match(PICKS_ONE);
  const oneName = one?.[1];
  const from = oneName !== undefined ? byName.get(oneName) : undefined;
  const item = from?.kind === 'list' && from.children?.length === 1 ? from.children[0] : undefined;
  if (!item?.children) {
    return undefined;
  }
  const preview = /\bentries$/.test(from?.preview ?? '') ? (from?.preview ?? '').replace(/\bentries$/, 'entry') : item.preview || '';
  const listRef = from?.previewRef;
  const previewRef = listRef?.key === 'editor.dataTree.collectionEntries' ? messageRef('editor.dataTree.collectionEntry', listRef.params) : item.previewRef;
  return { ...node, kind: item.kind, preview, ...(previewRef === undefined ? {} : { previewRef }), children: rebase(item.children, item.path, name) };
}

function buildCollectionNodes(
  collections: readonly { readonly name: string; readonly count?: number }[],
  fm: string,
  imports: readonly ImportLike[],
  samples: Record<string, unknown>,
  seen: Set<string>,
): TreeNode[] {
  const out: TreeNode[] = [];
  const queried = queriesInScope(fm);
  const taken = namesInScope(fm, imports);
  for (const collection of collections) {
    if (queried.has(collection.name)) {
      continue;
    }
    const identifier = autoQueryName(collection.name, taken);
    taken.add(identifier);
    const entry = samples[collection.name];
    const children = collectionEntryNodes(identifier, collection, samples);
    const node: TreeNode = { path: identifier, key: collection.name, kind: 'list', preview: '', children };
    Object.assign(
      node,
      previewFields(
        collection.count === undefined ? messageRef('editor.dataTree.collection') : messageRef('editor.dataTree.entryCount', { count: collection.count }),
      ),
    );
    node.section = 'collections';
    const entryCount = collection.count ?? children?.length ?? 0;
    if (entryCount > 1) {
      node.entryCount = entryCount;
    }
    node.query = { collection: collection.name, name: identifier };
    node.lazy = !entry;
    addUnique(out, node, seen);
  }
  return out;
}

function collectionEntryNodes(
  identifier: string,
  collection: { readonly name: string; readonly count?: number },
  samples: Record<string, unknown>,
): TreeNode[] | undefined {
  const indexes = new Set<number>();
  const prefix = `${collection.name}[`;
  for (const key of Object.keys(samples)) {
    const match = key.startsWith(prefix) ? /^\[(\d{1,6})\]$/.exec(key.slice(collection.name.length)) : undefined;
    const index = match?.[1] === undefined ? undefined : Number(match[1]);
    if (index !== undefined && (collection.count === undefined || index < collection.count)) {
      indexes.add(index);
    }
  }
  if (samples[collection.name] !== undefined) {
    indexes.add(0);
  }
  assert(indexes.size <= LIMITS.treeNodesMax, 'Collection entries exceed the node limit');
  const nodes = [...indexes]
    .sort((left, right) => left - right)
    .map((index) => {
      const entry = samples[entrySampleKey(collection.name, index)] ?? (index === 0 ? samples[collection.name] : undefined);
      return sampleNode(`${identifier}[${index}]`, String(index), entry, 1);
    });
  assert(
    nodes.every((node) => node.path.startsWith(`${identifier}[`)),
    'Collection entries are written under the query name',
  );
  return nodes.length > 0 ? nodes : undefined;
}

function everyField(entries: readonly TreeNode[] | undefined, at = 0): TreeNode[] | undefined {
  const first = entries?.[0];
  if (!first) {
    return undefined;
  }
  const out: TreeNode[] = [];
  const seenKeys = new Set<string>();
  const chosen = entries[at];
  const order = chosen !== undefined && at !== 0 ? [chosen, ...entries] : entries;
  for (const entry of order) {
    const home = entries[at] ?? first;
    const kids = entry === home ? (entry.children ?? []) : (rebase(entry.children, entry.path, home.path) ?? []);
    for (const child of kids) {
      if (seenKeys.has(child.key)) {
        continue;
      }
      seenKeys.add(child.key);
      out.push(child);
    }
  }
  return out.length ? out : undefined;
}

function buildLoopNodes(
  ancestorHeads: readonly string[],
  props: readonly TreeNode[],
  values: readonly TreeNode[],
  itemIndex: Record<string, number> | undefined,
  selection: LoopCopy | undefined,
  selectedItems: readonly (number | undefined)[] | undefined,
  seen: Set<string>,
): TreeNode[] {
  const first = resolveLoops(ancestorHeads, props, values, itemIndex);
  const marked = selectedItems !== undefined && selectedItems.length === ancestorHeads.length ? selectedItems : undefined;
  const indexes = marked === undefined ? (selection === undefined ? undefined : loopIndexesOfCopy(selection, first.counts)) : marked;
  const settled = indexes === undefined ? first : resolveLoops(ancestorHeads, props, values, withSelectionIndexes(first.items, indexes, itemIndex));
  const resolved = settled.nodes;
  assert(resolved.length <= ancestorHeads.length, 'One loop item per loop head at most');
  const loops: TreeNode[] = [];
  for (const nodes of [...resolved].reverse()) {
    for (const node of nodes) {
      addUnique(loops, node, seen);
    }
  }
  return loops;
}

function withSelectionIndexes(
  items: readonly (string | undefined)[],
  indexes: readonly (number | undefined)[],
  manual: Record<string, number> | undefined,
): Record<string, number> {
  assert(items.length === indexes.length, 'withSelectionIndexes: one index per loop');
  const merged: Record<string, number> = {};
  for (let position = 0; position < items.length; position++) {
    const name = items[position];
    const index = indexes[position];
    if (name !== undefined && index !== undefined) {
      merged[name] = index;
    }
  }
  return { ...merged, ...manual };
}

interface ResolvedLoops {
  readonly nodes: TreeNode[][];
  readonly items: (string | undefined)[];
  readonly counts: (number | undefined)[];
}

function resolveLoops(
  ancestorHeads: readonly string[],
  props: readonly TreeNode[],
  values: readonly TreeNode[],
  itemIndex: Record<string, number> | undefined,
): ResolvedLoops {
  const byPath = new Map<string, TreeNode>();
  const index = (list: readonly TreeNode[], depth: number): void => {
    assert(depth <= LIMITS.treeDepthMax, 'Data tree exceeds depth limit');
    for (const node of list) {
      byPath.set(node.path, node);
      if (node.children) {
        index(node.children, depth + 1);
      }
    }
  };
  index(props, 0);
  index(values, 0);

  const nodes: TreeNode[][] = [];
  const items: (string | undefined)[] = [];
  const counts: (number | undefined)[] = [];
  for (const head of ancestorHeads) {
    const loop = parseLoopHead(String(head));
    if (loop === undefined) {
      items.push(undefined);
      counts.push(undefined);
      continue;
    }
    const { node: item, count } = loopItemNode(loop.item, loop.source, byPath, itemIndex);
    for (const path of [...byPath.keys()]) {
      if (path === loop.item || path.startsWith(`${loop.item}.`) || path.startsWith(`${loop.item}[`)) {
        byPath.delete(path);
      }
    }
    index([item], 0);
    const loopNodes = [item];
    if (loop.index !== undefined) {
      loopNodes.push({ path: loop.index, key: loop.index, kind: 'number', preview: '0', children: undefined });
    }
    nodes.push(loopNodes);
    items.push(loop.item);
    counts.push(count);
  }
  assert(items.length === ancestorHeads.length, 'resolveLoops: one item name per head');
  assert(counts.length === ancestorHeads.length, 'resolveLoops: one count per head');
  return { nodes, items, counts };
}

function loopItemNode(
  item: string,
  source: string,
  byPath: ReadonlyMap<string, TreeNode>,
  itemIndex: Record<string, number> | undefined,
): { readonly node: TreeNode; readonly count: number | undefined } {
  const named = loopSourcePath(source);
  const list = named === undefined ? undefined : byPath.get(named.path);
  const listed = named?.kind === 'values' ? list?.kind === 'object' : list?.kind === 'list';
  const entries = listed ? (list?.children ?? []) : [];
  const first = entries[0];
  const at = Math.min(Math.max(itemIndex?.[item] ?? 0, 0), Math.max(entries.length - 1, 0));
  const shown = entries[at] ?? first;
  const node: TreeNode = {
    path: item,
    key: item,
    kind: first ? first.kind : 'loop item',
    preview: shown ? shown.preview : englishText(emptyLoopPreview(listed && list?.preview === '0 items' ? 'emptyList' : 'noSample')),
    ...(shown === undefined
      ? { previewRef: emptyLoopPreview(listed && list?.preview === '0 items' ? 'emptyList' : 'noSample') }
      : shown.previewRef === undefined
        ? {}
        : { previewRef: shown.previewRef }),
    ...(entries.length > 1 ? { nav: { index: at, count: entries.length } } : {}),
    children: shown ? rebase(everyField(entries, at), shown.path, item) : undefined,
  };
  assert(node.path === item, 'A loop item is named as its loop names it');
  return { node, count: shown === undefined ? undefined : entries.length };
}

export function dataTree(context: DataContext | undefined): TreeNode[] {
  const fm = context?.frontmatter ?? '';
  const decls = parseDeclarations(fm);
  const destructures = parseDestructures(fm);
  const sample = context?.propsSample;
  const schema = context?.propsSchema ?? [];
  const samples = context?.collectionSamples ?? {};
  const imports = context?.imports ?? [];
  const seen = new Set<string>();

  const derived = withDerivedShapes(
    decls,
    buildPropNodes(destructures, schema, { sample, instance: context?.propsInstance }, seen),
    buildValueNodes(
      decls,
      destructures,
      { frontmatter: fm, imports, samples, reader: context?.collectionReader, importedValues: context?.importedValues ?? {} },
      sample,
      seen,
      context?.valueSamples,
    ),
  );
  const props = derived.props;
  const values = [...derived.values, ...buildCollectionNodes(context?.collections ?? [], fm, imports, samples, seen)];
  for (const node of context?.projectSources ?? []) {
    assert(node.importNeed !== undefined, 'A project source carries the import it needs');
    addUnique(values, node, seen);
  }
  const loops = buildLoopNodes(context?.ancestorHeads ?? [], props, values, context?.itemIndex, context?.selectedCopy, context?.selectedItems, seen);

  const tree = [...inSection(loops, 'loop'), ...inSection(props, 'props'), ...inSection(values, 'frontmatter')];
  assert(tree.length === loops.length + props.length + values.length, 'Sectioning keeps every root');
  return tree;
}

function inSection(nodes: readonly TreeNode[], section: string): TreeNode[] {
  return nodes.map((node) => (node.section === undefined ? { ...node, section } : node));
}

function collectionListNode(name: string, page: PageData): TreeNode | undefined {
  const listed = page.reader?.listOf(name, page.frontmatter, page.imports);
  if (listed === undefined) {
    return undefined;
  }
  const collection = listed.collection;
  const entry = page.samples[collection];
  if (entry === undefined || entry === null) {
    return undefined;
  }
  const itemPath = listed.itemPath;
  const data = toRecord(entry)?.['data'];
  const id = toRecord(data)?.['_id'] ?? toRecord(entry)?.['id'];
  const item = itemPath[0] === 'fields' ? { id, fields: data } : entry;
  const node = sampleNode(name, name, [item], 0);
  Object.assign(node, previewFields(messageRef('editor.dataTree.collectionEntries', { name: collection })));
  assert(node.path === name, 'A collection list is named as the page names it');
  return node;
}

const HOLDER_ENTRIES_MAX = 100;
function listsHolderNode(name: string, value: string, page: PageData): TreeNode | undefined {
  const keys = page.reader?.keysOf(value);
  if (keys === undefined) {
    return undefined;
  }
  const children: TreeNode[] = [];
  for (const key of keys.slice(0, HOLDER_ENTRIES_MAX)) {
    const path = /^[A-Za-z_$][\w$]*$/.test(key) ? `${name}.${key}` : `${name}[${JSON.stringify(key)}]`;
    const node = collectionListNode(path, page);
    if (node !== undefined) {
      children.push({ ...node, key });
    }
  }
  assert(children.length <= HOLDER_ENTRIES_MAX, 'A holder lists a bounded number of lists');
  return children.length === 0
    ? undefined
    : {
        path: name,
        key: name,
        kind: 'object',
        preview: englishText(messageRef('editor.dataTree.lists', { count: children.length })),
        previewRef: messageRef('editor.dataTree.lists', { count: children.length }),
        children,
      };
}

interface PageData {
  readonly frontmatter: string;
  readonly imports: readonly ImportLike[];
  readonly samples: Record<string, unknown>;
  readonly reader: CollectionReader | undefined;
  readonly importedValues: Readonly<Record<string, ImportedValue>>;
}

const LOOPABLE = new Set(['list', 'value', 'imported', 'loop item', 'prop', 'rest props']);

export interface PickableNode extends TreeNode {
  pickable: boolean;
}

export function listsOnly(nodes: readonly TreeNode[] | undefined): PickableNode[] {
  return listsOnlyAt(nodes, 0);
}

function listsOnlyAt(nodes: readonly TreeNode[] | undefined, depth: number): PickableNode[] {
  assert(depth <= LIMITS.treeDepthMax, 'Data tree exceeds depth limit');
  const out: PickableNode[] = [];
  for (const node of nodes ?? []) {
    const children = listsOnlyAt(node.children, depth + 1);
    const pickable = LOOPABLE.has(node.kind);
    if (!pickable && !children.length) {
      continue;
    }
    out.push({ ...node, pickable, children: children.length ? children : undefined });
  }
  return out;
}

function rebase(nodes: readonly TreeNode[] | undefined, from: string, to: string, depth = 0): TreeNode[] | undefined {
  assert(depth <= LIMITS.treeDepthMax, 'Data tree exceeds depth limit');
  if (!nodes) {
    return undefined;
  }
  return nodes.map((node) => ({
    ...node,
    path: to + node.path.slice(from.length),
    children: rebase(node.children, from, to, depth + 1),
  }));
}

function emptyLoopPreview(reason: 'emptyList' | 'noSample'): TypedMessageRef {
  return messageRef(reason === 'emptyList' ? 'editor.dataTree.noItems' : 'editor.dataTree.noSample');
}

function functionPreviewRef(path: string): TypedMessageRef {
  return path === '' ? messageRef('editor.dataTree.function') : messageRef('editor.dataTree.functionFrom', { path });
}
