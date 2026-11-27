import { styleTransport } from '../../../ipc/editorEnvironment';

import { LayerRegistry } from './cascadeLayers';
import { orderByImports } from './cssImportOrder';
import { collectRules, parseRegion, regionText, renderEmbed, splitEmbed } from './css';
import { assert } from '../../../../shared/core/assert';
import { englishText, messageRef } from '../../../../shared/properties/i18n/messageRef';
import { failureOf, type Failure } from './failureMessage';
import { getHost, walkNodes, type HostNode } from './host';
import type { ElementSnapshot, NativeStyle, ParsedRule, StyleRegion } from './styleTypes';
import type { MatchTarget, TreeView } from './selectors';
import { hasCanvas, queryCanvas } from '../../../editor/canvasQuery';
import { variableEdit } from '../../../ipc/variableEditBridge';
import { type AnyElement, serializeElementId, nodeById, buildSnapshot } from './webflowElement';
import { type CanvasAsk, canvasIdentityOf } from './canvasAsk';
import { isGlobalRegion } from './projectResources';
import { PLACEMENT_END } from '../../../editor/classAttr';
import {
  newStyleTagOpening,
  templateFrame,
  type NewStyleTagSettings,
  type StyleTagAttribute,
  type StyleTagScope,
} from '../../../../shared/properties/newStyleTag';
export { type ProjectVariable, streamProjectVariables, getProjectFontFamilies, type ImageAsset, getImageAssets } from './projectResources';

export {
  nativeStylingAvailable,
  type NativeWriteTarget,
  readNativeStyles,
  readNativeStyleByName,
  applyNativePropertyAt,
  removeNativePropertyAt,
  applyNativeToNewBaseClass,
  liveSetNativeProperty,
} from './nativeStubs';

export { type CanvasIdentity, type CanvasAsk, askCanvasAbout, primeDomMatches } from './canvasAsk';

export { serializeElementId, webflowClassToCss, webflowApi, buildSnapshot, resolveIdentityElement, getCurrentBreakpoint } from './webflowElement';


export type EmbedSource = {
  key: string;
  label: string;
  classNames: string[];
  fromComponent: boolean;
  componentName: string | undefined;
  order: number;
  element: AnyElement;
  instance?: AnyElement;
  styleTag?: { readonly scope: StyleTagScope; readonly variables: 'defined' | 'none' };
  origin:
    | { kind: 'file'; path: string }
    | { kind: 'node'; nodeId: string; filePath: string | undefined }
    | { kind: 'astro'; path: string; reach?: 'page' };
};

export class EmbedDocument {
  readonly source: EmbedSource;
  #code: string;
  #segments: string[];
  #regions: StyleRegion[];
  #historyBase: string | undefined;

  constructor(source: EmbedSource, code: string, segments: string[], regions: StyleRegion[]) {
    assert(segments.length === regions.length + 1, 'EmbedDocument: segments around regions');
    this.source = source;
    this.#code = code;
    this.#segments = segments;
    this.#regions = regions;
  }

  get code(): string {
    return this.#code;
  }

  get segments(): string[] {
    return this.#segments;
  }

  get regions(): StyleRegion[] {
    return this.#regions;
  }

  get historyBase(): string {
    return this.#historyBase ?? this.#code;
  }

  recordWritten(code: string): void {
    this.#code = code;
    this.#historyBase = undefined;
  }

  recordLiveWritten(code: string): void {
    const base = this.historyBase;
    this.#code = code;
    this.#historyBase = code === base ? undefined : base;
  }

  replaceWith(fresh: EmbedDocument): void {
    assert(fresh.source.key === this.source.key, 'EmbedDocument: reload of the same source');
    this.#segments = fresh.segments;
    this.#regions = fresh.regions;
    this.#code = fresh.code;
    this.#historyBase = undefined;
  }
}

export type EmbedScan = {
  parentByKey: Map<string, string>;
  childrenByKey: Map<string, string[]>;
  elementByKey: Map<string, HostNode>;
  embeds: EmbedSource[];
  inComponentContext: boolean;
};

export type PageScan = {
  parentByKey: Map<string, string>;
  childrenByKey: Map<string, string[]>;
  elementByKey: Map<string, HostNode>;
  pageEmbeds: EmbedSource[];
  instances: AnyElement[];
  inComponentContext: boolean;
};

export function dedupeByKey(sources: EmbedSource[]): EmbedSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.key)) {
      return false;
    }
    seen.add(source.key);
    return true;
  });
}

export function embedSourceClassSuffix(_source?: EmbedSource): string {
  return '';
}

function styleSources(): EmbedSource[] {
  const host = getHost();
  const out: EmbedSource[] = [];
  let order = 0;
  const openComponentName =
    host.openFileKind === 'component'
      ? host.openFilePath
          ?.split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, '')
      : undefined;

  for (const file of host.files) {
    out.push({
      key: `file:${file.path}`,
      label: file.rel,
      classNames: [],
      fromComponent: false,
      componentName: undefined,
      order: order++,
      element: file.path,
      origin: { kind: 'file', path: file.path },
    });
  }

  const contextPage = host.openFileKind === 'component' && host.contextPagePath !== host.openFilePath ? host.contextPagePath : undefined;
  let contextPageListed = false;
  for (const file of host.astroFiles) {
    if (host.openFilePath && file.path === host.openFilePath) {
      continue;
    }
    const isContextPage = file.path === contextPage;
    contextPageListed ||= isContextPage;
    out.push({
      key: `astro:${file.path}`,
      label: file.name,
      classNames: [],
      fromComponent: !isContextPage,
      componentName: isContextPage ? undefined : file.name.replace(/\.astro$/i, ''),
      order: order++,
      element: file.path,
      origin: isContextPage ? { kind: 'astro', path: file.path, reach: 'page' } : { kind: 'astro', path: file.path },
    });
  }

  if (contextPage !== undefined && !contextPageListed) {
    out.push({
      key: `astro:${contextPage}`,
      label: contextPage.split(/[\\/]/).pop() ?? contextPage,
      classNames: [],
      fromComponent: false,
      componentName: undefined,
      order: order++,
      element: contextPage,
      origin: { kind: 'astro', path: contextPage, reach: 'page' },
    });
  }

  walkNodes(host.nodes, (node) => {
    if (node.kind !== 'raw' || node.name !== 'style') {
      return;
    }
    const isGlobal = !!node.props?.['is:global'];
    out.push({
      key: `node:${host.openFilePath ?? ''}:${node.id}`,
      label: isGlobal ? '<style is:global>' : '<style>',
      classNames: [],
      fromComponent: host.openFileKind === 'component',
      componentName: openComponentName,
      order: order++,
      element: node.id,
      origin: { kind: 'node', nodeId: node.id, filePath: host.openFilePath },
      styleTag: { scope: isGlobal ? 'global' : 'scoped', variables: node.props?.['define:vars'] === undefined ? 'none' : 'defined' },
    });
  });

  return out;
}

export async function scanPage(): Promise<PageScan> {
  return scanPageNow();
}

export function scanPageNow(): PageScan {
  const { parentByKey, childrenByKey, elementByKey } = buildTreeMaps();
  return {
    parentByKey,
    childrenByKey,
    elementByKey,
    pageEmbeds: styleSources(),
    instances: [],
    inComponentContext: false,
  };
}

export async function scanAllComponents(onEmbeds?: (embeds: EmbedSource[]) => void | Promise<void>): Promise<EmbedSource[]> {
  const embeds = styleSources();
  if (onEmbeds) {
    await onEmbeds(embeds);
  }
  return embeds;
}

export function scanHasElement(scan: EmbedScan, selected: AnyElement): boolean {
  return scan.elementByKey.has(serializeElementId(selected));
}

const ELEMENT_KINDS = new Set(['element', 'component', 'raw']);
const OPAQUE_COUNT_KINDS = new Set(['map', 'expr', 'chunk-group', 'cond', 'branch']);

function buildTreeMaps() {
  const parentByKey = new Map<string, string>();
  const childrenByKey = new Map<string, string[]>();
  const elementByKey = new Map<string, HostNode>();
  walkNodes(getHost().nodes, (node, parent) => {
    elementByKey.set(node.id, node);
    if (parent) {
      parentByKey.set(node.id, parent.id);
      const kids = childrenByKey.get(parent.id) || [];
      kids.push(node.id);
      childrenByKey.set(parent.id, kids);
    }
  });
  return { parentByKey, childrenByKey, elementByKey };
}

export function documentFromCode(source: EmbedSource, code: string): EmbedDocument {
  return documentForSource(source, code);
}

function documentForSource(source: EmbedSource, code: string): EmbedDocument {
  if (source.origin.kind === 'astro') {
    const { segments, regions } = splitEmbed(code);
    const reachesPage = source.origin.reach === 'page';
    const parsed = regions.map((region) => (isGlobalRegion(region) || reachesPage ? parseRegion(region) : region));
    return new EmbedDocument(source, code, segments, parsed);
  }
  const region = parseRegion({ start: 0, end: code.length, css: code, root: undefined });
  return new EmbedDocument(source, code, ['', ''], [region]);
}

async function readSource(source: EmbedSource): Promise<string> {
  if (source.origin.kind === 'file' || source.origin.kind === 'astro') {
    const result = await variableEdit('readStyleFile', source.origin.path);
    if (!result.ok) {
      throw new Error(result.error || 'Could not read stylesheet');
    }
    return result.css ?? '';
  }
  const node = nodeById(source.origin.nodeId);
  return String(node?.inner ?? '');
}

export function serializeDocument(embedDocument: EmbedDocument): string {
  if (embedDocument.source.origin.kind === 'astro') {
    return renderEmbed(embedDocument.segments, embedDocument.regions);
  }
  const region = embedDocument.regions[0];
  return region === undefined ? '' : regionText(region);
}

export async function loadEmbedDocs(
  sources: EmbedSource[],
  onDocument?: (doc: EmbedDocument) => void,
): Promise<{ docs: EmbedDocument[]; errors: Array<{ label: string; message: string }> }> {
  const loaded = await Promise.all(
    sources.map(async (source) => {
      try {
        const embedDocument = documentForSource(source, await readSource(source));
        onDocument?.(embedDocument);
        return { doc: embedDocument, error: undefined };
      } catch (error: unknown) {
        return {
          doc: undefined,
          error: {
            label: source.label,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );
  const docs: EmbedDocument[] = [];
  const errors: Array<{ label: string; message: string }> = [];
  for (const entry of loaded) {
    if (entry.doc) {
      docs.push(entry.doc);
    }
    if (entry.error) {
      errors.push(entry.error);
    }
  }
  return { docs, errors };
}

let embedWriteCount = 0;

export function embedWritesStarted(): number {
  return embedWriteCount;
}

export type EmbedWriteResult = { ok: true; code: string } | Failure;

type FileWriteLane = {
  tail: Promise<void>;
  waiting: { readonly embedDocument: EmbedDocument; readonly result: Promise<EmbedWriteResult>; live: boolean } | undefined;
};

const fileWriteLanes = new Map<string, FileWriteLane>();
const FILE_WRITE_LANES_MAX = 1_000;

function fileWriteLane(path: string): FileWriteLane {
  const existing = fileWriteLanes.get(path);
  if (existing !== undefined) {
    return existing;
  }
  assert(fileWriteLanes.size < FILE_WRITE_LANES_MAX, 'fileWriteLane: one lane per edited file');
  const lane: FileWriteLane = { tail: Promise.resolve(), waiting: undefined };
  fileWriteLanes.set(path, lane);
  return lane;
}

function queueOnLane<T>(path: string, task: () => Promise<T>): Promise<T> {
  const lane = fileWriteLane(path);
  const run = lane.tail.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  lane.tail = tail;
  void tail.then(() => {
    if (lane.tail === tail) {
      assert(lane.waiting === undefined, 'queueOnLane: an idle lane has nothing waiting');
      fileWriteLanes.delete(path);
    }
  });
  return run;
}

function queueFileWrite(embedDocument: EmbedDocument, path: string, options: { readonly live: boolean }): Promise<EmbedWriteResult> {
  const lane = fileWriteLane(path);
  if (lane.waiting !== undefined && lane.waiting.embedDocument === embedDocument) {
    lane.waiting.live = lane.waiting.live && options.live;
    return lane.waiting.result;
  }
  const { live } = options;
  let waiting: { readonly embedDocument: EmbedDocument; readonly result: Promise<EmbedWriteResult>; live: boolean } | undefined;
  const result = queueOnLane(path, () => {
    const liveNow = waiting?.live ?? live;
    if (lane.waiting === waiting) {
      lane.waiting = undefined;
    }
    return writeFileNow(embedDocument, path, { live: liveNow });
  });
  waiting = { embedDocument, live, result };
  lane.waiting = waiting;
  return result;
}

async function writeFileNow(embedDocument: EmbedDocument, path: string, options: { readonly live: boolean }): Promise<EmbedWriteResult> {
  const code = serializeDocument(embedDocument);
  const base = embedDocument.code;
  const undoTarget = embedDocument.historyBase;
  try {
    if (base !== code) {
      await styleTransport.writeStyleFile({ filePath: path, css: code, base });
    }
    if (!options.live && undoTarget !== code) {
      const stylesIn = messageRef('shell.history.stylesIn', { name: embedDocument.source.label });
      getHost().recordUndo?.({
        label: englishText(stylesIn),
        labelRef: stylesIn,
        coalesceKey: `css:${path}`,
        undo: () => writeStyleFileAndReload(embedDocument, path, undoTarget),
        redo: () => writeStyleFileAndReload(embedDocument, path, code),
      });
    }
    if (options.live) {
      embedDocument.recordLiveWritten(code);
    } else {
      embedDocument.recordWritten(code);
    }
    assert(embedDocument.code === code, 'writeFileNow: the document holds what was written');
    return { ok: true, code };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return { ok: false, error: message || String(error) };
  } finally {
    embedWriteCount += 1;
  }
}

export async function writeEmbedDocument(
  embedDocument: EmbedDocument,
  live = false,
): Promise<EmbedWriteResult> {
  embedWriteCount += 1;
  const origin = embedDocument.source.origin;
  if (origin.kind === 'file' || origin.kind === 'astro') {
    return queueFileWrite(embedDocument, origin.path, { live });
  }
  const code = serializeDocument(embedDocument);
  const write = getHost().writeStyleNode;
  if (!write) {
    return failureOf('styleModel.write.noPage');
  }
  try {
    if (write({ nodeId: origin.nodeId, filePath: origin.filePath }, code, !live) === false) {
      return failureOf('styleModel.write.blockMissing', { tag: '<style>' });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return { ok: false, error: message || String(error) };
  }
  embedDocument.recordWritten(code);
  return { ok: true, code };
}

export function blankStyleDocument(settings: NewStyleTagSettings): EmbedDocument {
  const host = getHost();
  const frame = templateFrame(settings.content);
  assert(frame.ok, 'blankStyleDocument: the stored template parses');
  const skeleton = frame.frame.skeleton;
  const source: EmbedSource = {
    key: `node:${host.openFilePath ?? ''}:new`,
    label: newStyleTagOpening(settings.attributes),
    classNames: [],
    fromComponent: host.openFileKind === 'component',
    componentName: undefined,
    order: 0,
    element: 'new',
    origin: { kind: 'node', nodeId: 'new', filePath: host.openFilePath },
  };
  const region = parseRegion({ start: 0, end: skeleton.length, css: skeleton, root: undefined });
  return new EmbedDocument(source, '', ['', ''], [region]);
}

export async function writeFirstStyleBlock(
  embedDocument: EmbedDocument,
  block: { readonly className: string | undefined; readonly attributes: readonly StyleTagAttribute[] },
): Promise<EmbedWriteResult> {
  embedWriteCount += 1;
  const add = getHost().addStyleBlock;
  if (!add) {
    return failureOf('styleModel.write.pageCannotTakeBlock');
  }
  const code = serializeDocument(embedDocument);
  if (code.trim().length === 0) {
    return failureOf('styleModel.write.nothingToAdd');
  }
  try {
    const outcome = await add({ css: code, attributes: block.attributes, className: block.className, placement: PLACEMENT_END });
    if (outcome.tag === 'refused') {
      return { ok: false, error: outcome.message };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return { ok: false, error: message || String(error) };
  }
  embedDocument.recordWritten(code);
  return { ok: true, code };
}

export interface ReloadedSource {
  readonly key: string;
  readonly code: string;
}
const docsReloaded = new Set<(reloaded: ReloadedSource) => void>();
export function onDocsReloaded(listener: (reloaded: ReloadedSource) => void): () => void {
  docsReloaded.add(listener);
  return () => {
    docsReloaded.delete(listener);
  };
}

async function writeStyleFileAndReload(embedDocument: EmbedDocument, path: string, text: string): Promise<void> {
  embedWriteCount += 1;
  await queueOnLane(path, async () => {
    try {
      await styleTransport.writeStyleFile({ filePath: path, css: text, base: embedDocument.code });
    } finally {
      embedWriteCount += 1;
    }
  });
  embedDocument.replaceWith(documentForSource(embedDocument.source, text));
  assert(embedDocument.code === text, 'writeStyleFileAndReload: the document holds the text written');
  const reloaded: ReloadedSource = { key: embedDocument.source.key, code: text };
  for (const listener of docsReloaded) {
    listener(reloaded);
  }
}

export function adoptReload(docs: readonly EmbedDocument[], reloaded: ReloadedSource): number {
  let adopted = 0;
  for (const embedDocument of new Set(docs)) {
    if (embedDocument.source.key === reloaded.key) {
      if (embedDocument.code !== reloaded.code) {
        embedDocument.replaceWith(documentForSource(embedDocument.source, reloaded.code));
        adopted += 1;
      }
      assert(embedDocument.code === reloaded.code, 'adoptReload: every document of the source holds its text');
    }
  }
  assert(adopted <= docs.length, 'adoptReload: at most one read per document');
  return adopted;
}

export function syncNodeDocuments(docs: readonly EmbedDocument[]): number {
  const host = getHost();
  let synced = 0;
  for (const embedDocument of docs) {
    const origin = embedDocument.source.origin;
    if (origin.kind !== 'node') {
      continue;
    }
    if (origin.filePath !== host.openFilePath) {
      continue;
    }
    if (embedDocument.historyBase !== embedDocument.code) {
      continue;
    }
    const node = nodeById(origin.nodeId);
    if (node === undefined) {
      continue;
    }
    const text = String(node.inner ?? '');
    if (text === embedDocument.code) {
      continue;
    }
    embedDocument.replaceWith(documentForSource(embedDocument.source, text));
    assert(embedDocument.code === text, 'syncNodeDocuments: the document holds the node text');
    synced += 1;
  }
  assert(synced <= docs.length, 'syncNodeDocuments: at most one read per document');
  return synced;
}

export function rebuildRules(docs: EmbedDocument[]): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const order = { n: 0 };
  const layers = new LayerRegistry();
  const { ordered, baseLayers } = documentsInCascadeOrder(docs);

  for (const embedDocument of ordered) {
    const origin = embedDocument.source.origin;
    const reachesPage = origin.kind === 'astro' && origin.reach === 'page';
    embedDocument.regions.forEach((region, regionIndex) => {
      if (!region.root) {
        return;
      }
      const collected = collectRules(region, {
        embedKey: embedDocument.source.key,
        embedLabel: embedDocument.source.label,
        fromComponent: embedDocument.source.fromComponent,
        componentName: embedDocument.source.componentName,
        regionIndex,
        idSeed: embedDocument.source.key,
        order,
        layers,
        baseLayer: baseLayers.get(embedDocument.source.key),
      });
      const scopedToPage = reachesPage && !isGlobalRegion(region);
      rules.push(...(scopedToPage ? collected.filter(reachesComponent) : collected));
    });
  }
  return rules;
}

function documentsInCascadeOrder(docs: readonly EmbedDocument[]): {
  readonly ordered: EmbedDocument[];
  readonly baseLayers: ReadonlyMap<string, readonly string[]>;
} {
  const listed = [...docs].sort((left, right) => left.source.order - right.source.order);
  const files = listed.flatMap((document) => (document.source.origin.kind === 'file' ? [{ document, path: document.source.origin.path }] : []));
  const placements = orderByImports(files.map(({ document, path }) => ({ path, code: document.code })));
  const rankByPath = new Map(placements.map((placement) => [placement.path, placement]));
  const baseLayers = new Map<string, readonly string[]>();
  const fileDocuments = files.map(({ document }) => document);
  fileDocuments.sort((left, right) => {
    const leftPath = left.source.origin.kind === 'file' ? left.source.origin.path : '';
    const rightPath = right.source.origin.kind === 'file' ? right.source.origin.path : '';
    return (rankByPath.get(leftPath)?.rank ?? 0) - (rankByPath.get(rightPath)?.rank ?? 0);
  });
  for (const document of fileDocuments) {
    const origin = document.source.origin;
    const layer = origin.kind === 'file' ? rankByPath.get(origin.path)?.layer : undefined;
    if (layer !== undefined) {
      baseLayers.set(document.source.key, layer);
    }
  }
  const others = listed.filter((document) => document.source.origin.kind !== 'file');
  const ordered = [...fileDocuments, ...others];
  assert(ordered.length === docs.length, 'documentsInCascadeOrder: every document is placed once');
  return { ordered, baseLayers };
}

function reachesComponent(rule: ParsedRule): boolean {
  return rule.selectors.some((selector) => selector.text.includes(':global('));
}

export async function navigateToEmbed(source: EmbedSource, _pageInstances?: unknown): Promise<{ ok: true } | Failure> {
  if (source.origin.kind === 'astro') {
    return failureOf(source.origin.reach === 'page' ? 'styleModel.navigate.livesInPage' : 'styleModel.navigate.livesInComponent', { label: source.label });
  }
  if (source.origin.kind !== 'node') {
    return failureOf('styleModel.navigate.stylesheet', { label: source.label });
  }
  const select = getHost().selectNode;
  if (!select) {
    return failureOf('styleModel.navigate.nothing');
  }
  select(source.origin.nodeId);
  return { ok: true };
}


export async function resolveTarget(
  selected: AnyElement,
  scan: EmbedScan,
  asked?: CanvasAsk,
): Promise<{ target: MatchTarget; rootSnapshot: ElementSnapshot }> {
  const rootKey = serializeElementId(selected);
  const snapshots = new Map<string, ElementSnapshot | undefined>();
  const view: TreeView = {
    truncated: false,
    parentKey: (key) => scan.parentByKey.get(key),
    childKeys: (key) => scan.childrenByKey.get(key) ?? [],
    elementChildKeys: (key) => {
      const kids = scan.childrenByKey.get(key) ?? [];
      const nodes = kids.map((childKey) => scan.elementByKey.get(childKey));
      if (nodes.some((node) => node && OPAQUE_COUNT_KINDS.has(node.kind))) {
        return undefined;
      }
      return kids.filter((_, i) => ELEMENT_KINDS.has(nodes[i]?.kind ?? ''));
    },
    snapshot: async (key) => {
      if (snapshots.has(key)) {
        return snapshots.get(key);
      }
      const element = scan.elementByKey.get(key);
      const snap = element ? await buildSnapshot(element) : undefined;
      snapshots.set(key, snap);
      return snap;
    },
  };
  const target: MatchTarget = { rootKey, view };
  let rootSnapshot = await buildSnapshot(selected);
  let identity = asked?.kind === 'asked' ? asked.answer?.identity : undefined;
  if (asked === undefined) {
    const path = getHost().pathOf?.(rootKey);
    if (path && hasCanvas()) {
      identity = canvasIdentityOf((await queryCanvas(path, []))?.identity);
    }
  }
  if (identity) {
    const attributes = { ...identity.attributes };
    delete attributes['class'];
    if (identity.classes.length) {
      attributes['class'] = identity.classes.join(' ');
    }
    rootSnapshot = {
      ...rootSnapshot,
      tag: identity.tag,
      id: identity.id ?? rootSnapshot.id,
      classes: identity.classes,
      classList: identity.classes,
      attributes,
    };
  }
  snapshots.set(rootKey, rootSnapshot);
  return { target, rootSnapshot };
}


function isFlexNumber(token: string): boolean {
  return /^-?(\d+\.?\d*|\.\d+)$/.test(token);
}

export function parseFlexShorthand(value: string): Record<string, string> | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'none') {
    return { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' };
  }
  if (normalized === 'auto') {
    return { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' };
  }
  if (normalized === 'initial') {
    return { 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto' };
  }
  if (normalized === '' || /^(inherit|unset|revert|revert-layer)$/.test(normalized)) {
    return undefined;
  }
  if (/[a-z-]+\(/i.test(normalized)) {
    return undefined;
  }
  const tokens = normalized.split(/\s+/);
  if (tokens.length > 3) {
    return undefined;
  }
  let grow: string, shrink: string, basis: string;
  if (tokens.length === 1) {
    const first = tokens[0] ?? '';
    if (isFlexNumber(first)) {
      grow = first;
      shrink = '1';
      basis = '0';
    } else {
      grow = '1';
      shrink = '1';
      basis = first;
    }
  } else if (tokens.length === 2) {
    grow = tokens[0] ?? '';
    const second = tokens[1] ?? '';
    if (isFlexNumber(second)) {
      shrink = second;
      basis = '0';
    } else {
      shrink = '1';
      basis = second;
    }
  } else {
    grow = tokens[0] ?? '';
    shrink = tokens[1] ?? '';
    basis = tokens[2] ?? '';
  }
  if (!isFlexNumber(grow) || !isFlexNumber(shrink)) {
    return undefined;
  }
  return { 'flex-grow': grow, 'flex-shrink': shrink, 'flex-basis': basis };
}

export type { NativeStyle };
