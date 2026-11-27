
import type { TemplateWrapper } from '../../../../shared/properties/newStyleTag';
import { defaultSelectorPick, isUtilityClassName } from '../model/defaultSelector';
import { useEffect, useRef, useState } from 'react';
import { assert } from '../../../../shared/core/assert';
import { type RuleModel } from '../model/cascade';
import { snapshotTokens, tokensToSelector } from '../model/elementTokens';
import { chipLayer, selectorKey, selectorsMatch, stateForSelector, STATES, type MatchedSelector, type PanelLayer, type StyleContext } from '../model/resolved';
import type { Declaration } from 'postcss';
import {
  directDecls,
  createRuleAtRoot,
  createRuleInAtRule,
  createNestedRule,
  createRuleInMedia,
  createRuleInQuery,
  createRuleInPlacedQuery,
  listAtRuleBlocks,
  parseNestedInput,
  type NestStep,
} from '../model/css';
import {
  canonicalCompound,
  compareSpecificity,
  isGlobalSelector,
  normalizePseudoElement,
  selectorDependsOnAncestor,
  selectorListLayers,
  selectorSpecificity,
} from '../model/selectors';
import { findNode, getHost, onHostChange, propText, type HostNode } from '../model/host';
import { compileSelectorList } from '../model/selectorParse';
import { PSEUDO_ELEMENTS, pseudoLayerAllowed, pseudoValidityForTag } from '../../../../shared/page/pseudoElements';
import {
  dedupeByKey,
  loadEmbedDocs,
  readNativeStyles,
  resolveIdentityElement,
  askCanvasAbout,
  resolveTarget,
  scanAllComponents,
  serializeElementId,
  writeEmbedDocument,
  type EmbedDocument,
  type EmbedScan,
  type PageScan,
} from '../model/webflow';
import type { ElementSnapshot, NativeModel, ParsedRule } from '../model/styleTypes';
import { type ScanState, type PropWrite, EMPTY_RULE_MODEL, type Placeholder, computePlaceholders } from './EditorBasics';
import { selectorOrder, styledSelectorsFor } from './editorSignatures';
import { withInstanceChips, writableRegion } from '../model/instanceClasses';
import { writtenInMarkup, type ComponentMarkup } from '../model/componentMarkup';
export {
  BG_REFRESH_THROTTLE_MS,
  sheetSignature,
  DESIGNER_SYNC_INTERVAL_MS,
  selectorKeyOf,
  snapshotSignature,
  domMatchesChanged,
  nativeSignature,
  chainPrefixDepth,
  selectorOrder,
  styledSelectorsFor,
} from './editorSignatures';

export function streamDocs(pageScan: EmbedScan, onPartial: ((content: Content) => void) | undefined): (embedDocument: EmbedDocument) => void {
  const streamed: EmbedDocument[] = [];
  const streamedKeys = new Set<string>();
  let lastEmitAt = 0;
  return (embedDocument) => {
    if (streamedKeys.has(embedDocument.source.key)) {
      return;
    }
    streamedKeys.add(embedDocument.source.key);
    streamed.push(embedDocument);
    if (!onPartial) {
      return;
    }
    const now = Date.now();
    if (now - lastEmitAt < 100) {
      return;
    }
    lastEmitAt = now;
    onPartial({
      scan: pageScan,
      docs: [...streamed],
      rules: [],
      errors: [],
      embedCount: 0,
      componentEmbedCount: 0,
      partial: true,
    });
  };
}

export async function loadComponentDocs(
  readKeys: ReadonlySet<string>,
  onDocument: (embedDocument: EmbedDocument) => void,
): Promise<{ docs: EmbedDocument[]; errors: Content['errors'] }> {
  const docs: EmbedDocument[] = [];
  const errors: Content['errors'] = [];
  await scanAllComponents(async (embeds) => {
    const result = await loadEmbedDocs(
      embeds.filter((source) => !readKeys.has(source.key)),
      onDocument,
    );
    docs.push(...result.docs);
    errors.push(...result.errors);
  });
  return { docs, errors };
}

export function mergedContent(pageScan: EmbedScan, results: ReadonlyArray<{ docs: EmbedDocument[]; errors: Content['errors'] }>): Content {
  const seenDocs = new Set<string>();
  const docs = results
    .flatMap((result) => result.docs)
    .filter((embedDocument) => {
      if (seenDocs.has(embedDocument.source.key)) {
        return false;
      }
      seenDocs.add(embedDocument.source.key);
      return true;
    });
  const embeds = dedupeByKey(docs.map((embedDocument) => embedDocument.source));
  return {
    scan: { ...pageScan, embeds },
    docs,
    rules: [],
    errors: results.flatMap((result) => result.errors),
    embedCount: 0,
    componentEmbedCount: 0,
    partial: false,
  };
}

export function placeholdersFor(content: Content, classList: string[]): Placeholder[] {
  return content.scan.inComponentContext ? computePlaceholders(content.docs, classList) : [];
}

export async function readDesignerState(element: unknown, content: Content) {
  try {
    const asked = await askCanvasAbout(serializeElementId(element), content.rules);
    const resolved = await resolveTarget(element, content.scan, asked);
    const identity = await resolveIdentityElement(element);
    const native = await readNativeStyles(identity, STATES);
    return { target: resolved.target, snap: resolved.rootSnapshot, native, asked };
  } catch {
    return undefined;
  }
}

export function loneTypedClass(selector: string): string | undefined {
  const canon = canonicalCompound(selector);
  if (!canon.simple || !canon.oneCompound || canon.pseudoElement) {
    return undefined;
  }
  if (canon.pseudoClasses.length !== 0 || canon.tokens.length !== 1) {
    return undefined;
  }
  const token = canon.tokens[0] ?? '';
  return token.startsWith('class:') ? token.slice('class:'.length) : undefined;
}

export interface ChipInputs {
  model: RuleModel | undefined;
  nativeModel: NativeModel | undefined;
  currentContext: StyleContext;
  activeSelector: string;
  selectedSelectorText: string | undefined;
  tokens: ReturnType<typeof snapshotTokens>;
  classList: string[];
  removedClasses: ReadonlySet<string>;
  pseudo?: PanelLayer | undefined;
  elementTag?: string | undefined;
  instanceClasses?: readonly string[] | undefined;
  componentMarkup?: ComponentMarkup | undefined;
  rememberedGreen?: ReadonlySet<string> | undefined;
  typedLabels?: TypedLabels | undefined;
}

export type PseudoTarget = '::before' | '::after';

export function pseudoLayerChips(list: readonly MatchedSelector[], layer: PanelLayer): MatchedSelector[] {
  const shown = layer === 'every' ? [...list] : list.filter((entry) => chipLayer(entry) === layer);
  assert(shown.length <= list.length, 'pseudoLayerChips: a filter never adds');
  return shown;
}

export function pseudoChipApplies(selectorText: string, tag: string | undefined): boolean {
  if (tag === undefined || tag.length === 0) {
    return true;
  }
  const members = compileSelectorList(selectorText).map((selector) => normalizePseudoElement(selector.pseudoElement).replace(/^::/, ''));
  assert(members.length <= selectorText.length + 1, 'pseudoChipApplies: one member per selector in the list');
  if (members.length === 0) {
    return true;
  }
  return members.some((member) => {
    const known = PSEUDO_ELEMENTS.find((name) => name === member);
    if (known === undefined) {
      return true;
    }
    return pseudoValidityForTag(tag.toLowerCase(), known) !== 'invalid';
  });
}

export function chipsFor(inputs: ChipInputs): MatchedSelector[] {
  const { model, nativeModel, currentContext, removedClasses } = inputs;
  const styled = styledSelectorsFor(model, nativeModel, currentContext).filter((entry) => {
    if (!removedClasses.size) {
      return true;
    }
    const canon = canonicalCompound(entry.text);
    return !(canon.simple && canon.tokens.some((tok) => removedClasses.has(tok)));
  });
  const list = withInstanceChips(styled, inputs.instanceClasses ?? []);
  const pending = pendingActiveChip(list, inputs);
  if (pending) {
    list.push(pending);
  }
  const drawable = list.filter((entry) => pseudoChipApplies(entry.text, inputs.elementTag) || selectorsMatch(entry.text, inputs.activeSelector));
  assert(drawable.length <= list.length, 'chipsFor: the pseudo-element filter never adds');
  const layered = pseudoLayerChips(drawable, inputs.pseudo ?? '');
  const typed = drawable.filter((entry) => chipLayer(entry) !== '' && !layered.includes(entry) && selectorsMatch(entry.text, inputs.activeSelector));
  const shown = [...layered, ...typed].map((entry) =>
    writtenInMarkup(entry.text, inputs.componentMarkup) || inputs.rememberedGreen?.has(selectorKey(entry.text)) === true
      ? { ...entry, inComponentMarkup: true }
      : entry,
  );
  return wellOrder(inChipOrder(shown, inputs.classList, { byOrder: true })).map((selector) =>
    currentContext.embedAtContext && selector.inContext !== false && selector.queryDisplay ? { ...selector, display: selector.queryDisplay } : selector,
  );
}

export function pendingActiveChip(
  list: MatchedSelector[],
  inputs: Pick<ChipInputs, 'activeSelector' | 'selectedSelectorText' | 'tokens' | 'typedLabels'>,
): MatchedSelector | undefined {
  const { activeSelector } = inputs;
  if (!activeSelector || list.some((entry) => selectorsMatch(entry.text, activeSelector))) {
    return undefined;
  }
  const ownTokens = new Set(inputs.tokens.map((token) => token.name));
  const canon = canonicalCompound(activeSelector);
  const own = canon.simple && canon.tokens.every((tok) => ownTokens.has(tok));
  if (own && inputs.selectedSelectorText === undefined) {
    return undefined;
  }
  const typedLabel = inputs.typedLabels?.get(selectorKey(activeSelector));
  return {
    text: activeSelector,
    ...(typedLabel === undefined ? {} : { display: typedLabel }),
    specificity: selectorSpecificity(activeSelector),
    state: stateForSelector(activeSelector),
    simple: canon.simple,
    key: `active:${activeSelector}`,
    pending: true,
    inContext: true,
    fromComponent: false,
  };
}

export function wellOrder<Chip extends Pick<MatchedSelector, 'specificity' | 'text' | 'pending' | 'inComponentMarkup'>>(chips: readonly Chip[]): Chip[] {
  const sorted = bySpecificity(chips);
  const tag = sorted.find((chip) => chip.pending !== true && isBareTagSelector(chip.text));
  const ranked = sorted.map((chip) => ({ chip, group: wellGroup(chip, tag) }));
  const ordered = [...ranked].sort((left, right) => left.group - right.group);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    assert(previous !== undefined, 'wellOrder: the previous chip is in range');
    assert(current !== undefined, 'wellOrder: the current chip is in range');
    if (previous.group === current.group) {
      assert(compareSpecificity(previous.chip.specificity, current.chip.specificity) <= 0, 'wellOrder: a group runs least specific first');
    } else {
      assert(previous.group < current.group, 'wellOrder: the groups come in order');
    }
  }
  const result = ordered.map((entry) => entry.chip);
  assert(result.length === chips.length, 'wellOrder: every chip is kept');
  assert(tag === undefined || result[0] === tag, 'wellOrder: a styled tag leads');
  return result;
}

function wellGroup(chip: Pick<MatchedSelector, 'text' | 'inComponentMarkup'>, tag: unknown): number {
  if (chip === tag) {
    return 0;
  }
  if (chip.inComponentMarkup === true) {
    return 2;
  }
  return isWellGlobal(chip.text) ? 1 : 3;
}

function isWellGlobal(text: string): boolean {
  return isGlobalSelector(text) && !selectorDependsOnAncestor(text);
}

export function isBareTagSelector(text: string): boolean {
  const canon = canonicalCompound(text);
  if (!canon.oneCompound) {
    return false;
  }
  if (canon.pseudoClasses.length > 0 || canon.pseudoElement !== '' || canon.functional) {
    return false;
  }
  return canon.tokens.length === 1 && (canon.tokens[0] ?? '').startsWith('tag:');
}

export function bySpecificity<Chip extends Pick<MatchedSelector, 'specificity'>>(chips: readonly Chip[]): Chip[] {
  const sorted = [...chips].sort((left, right) => compareSpecificity(left.specificity, right.specificity));
  assert(sorted.length === chips.length, 'bySpecificity: a sort keeps every chip');
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    assert(previous !== undefined, 'bySpecificity: the previous chip is in range');
    assert(current !== undefined, 'bySpecificity: the current chip is in range');
    assert(compareSpecificity(previous.specificity, current.specificity) <= 0, 'bySpecificity: no chip is weaker than the one before it');
  }
  return sorted;
}

export function inChipOrder(selectors: MatchedSelector[], classList: string[], { byOrder }: { readonly byOrder: boolean }): MatchedSelector[] {
  return selectors
    .map((entry) => ({ s: entry, rank: selectorOrder(entry.text, classList) }))
    .sort(
      (left, right) =>
        left.rank[0] - right.rank[0] ||
        left.rank[1] - right.rank[1] ||
        left.rank[2] - right.rank[2] ||
        compareSpecificity(left.s.specificity, right.s.specificity) ||
        (byOrder && left.s.order !== undefined && right.s.order !== undefined ? left.s.order - right.s.order : 0) ||
        left.s.text.localeCompare(right.s.text),
    )
    .map((ranked) => ranked.s);
}

export function upgradedDefault(
  local: MatchedSelector[],
  element: {
    tokens: ReturnType<typeof snapshotTokens>;
    classList: string[];
    defaultTokens: string[];
  },
): MatchedSelector | undefined {
  const { tokens, classList } = element;
  const defaultSelector = tokensToSelector(element.defaultTokens, tokens);
  const defaultClass = /^\.([\w-]+)$/.exec(defaultSelector)?.[1];
  if (
    defaultSelector &&
    !(defaultClass !== undefined && isUtilityClassName(defaultClass)) &&
    local.some((entry) => selectorsMatch(entry.text, defaultSelector))
  ) {
    return undefined;
  }
  const pickedText = defaultSelectorPick({
    styled: local.map((entry) => entry.text),
    classes: tokens.filter((token) => token.kind === 'class').map((token) => token.label ?? token.name.slice('class:'.length)),
    tag: tokens.find((token) => token.kind === 'tag')?.label,
  });
  const picked = pickedText === undefined ? undefined : local.find((entry) => entry.text === pickedText);
  if (picked !== undefined) {
    return picked;
  }
  const primaryStyled = tokens
    .filter((token) => token.kind === 'class')
    .map((token) => token.name)
    .flatMap((tok) => {
      const found = local.find((entry) => selectorsMatch(entry.text, tokensToSelector([tok], tokens)));
      return found ? [found] : [];
    })[0];
  const ordered = inChipOrder([...local], classList, { byOrder: false });
  const firstAfterTag = ordered.find((entry) => selectorOrder(entry.text, classList)[0] > 0);
  return primaryStyled ?? firstAfterTag ?? ordered[0] ?? local[local.length - 1];
}

export type EmbedRegion = EmbedDocument['regions'][number];

export function embedWriteTarget(
  target: {
    model: RuleModel | undefined;
    selectedEmbedKey: string | undefined;
    documentByKey: Map<string, EmbedDocument>;
  },
  inContext: ((rule: ParsedRule) => boolean) | undefined,
): { embedDocument: EmbedDocument; region: EmbedRegion } | undefined {
  const { model, selectedEmbedKey, documentByKey } = target;
  const matched = model ? [...model.base, ...model.conditional].map((entry) => entry.rule) : [];
  const ofSelected = (rule: ParsedRule) => rule.embedKey === selectedEmbedKey;
  let anchor: ParsedRule | undefined;
  if (inContext === undefined) {
    anchor = selectedEmbedKey ? matched.find(ofSelected) : matched[0];
  } else if (selectedEmbedKey) {
    anchor = matched.find((rule) => ofSelected(rule) && inContext(rule)) ?? matched.find(ofSelected);
  } else {
    anchor = matched.find(inContext) ?? matched[0];
  }
  const embedDocument = selectedEmbedKey ? documentByKey.get(selectedEmbedKey) : anchor ? documentByKey.get(anchor.embedKey) : [...documentByKey.values()][0];
  const region =
    anchor && embedDocument && anchor.embedKey === embedDocument.source.key
      ? embedDocument.regions[anchor.regionIndex]
      : embedDocument === undefined
        ? undefined
        : writableRegion(embedDocument.regions);
  return embedDocument && region ? { embedDocument, region } : undefined;
}

export function placedQueryTarget(
  chosen: { embedDocument: EmbedDocument; region: EmbedRegion } | undefined,
  documents: ReadonlyMap<string, EmbedDocument>,
  query: { readonly atContextKey: string; readonly wrapper: string | undefined; readonly source: string | undefined },
): { embedDocument: EmbedDocument; region: EmbedRegion } | undefined {
  const holds = (region: EmbedRegion) =>
    listAtRuleBlocks(region).some((block) => {
      if (block.atContext.join(' › ') !== query.atContextKey) {
        return false;
      }
      if (query.wrapper === undefined) {
        return block.placement.kind === 'top-level';
      }
      return block.placement.kind === 'nested' && block.placement.wrapper === query.wrapper;
    });
  const named = query.source === undefined ? undefined : documents.get(query.source);
  if (named !== undefined) {
    const region = named.regions.find(holds) ?? named.regions[0];
    return region === undefined ? chosen : { embedDocument: named, region };
  }
  if (query.wrapper === undefined) {
    return chosen;
  }
  const ordered =
    chosen === undefined ? [...documents.values()] : [chosen.embedDocument, ...[...documents.values()].filter((document) => document !== chosen.embedDocument)];
  for (const embedDocument of ordered) {
    const region = embedDocument.regions.find(holds);
    if (region !== undefined) {
      return { embedDocument, region };
    }
  }
  return chosen;
}

export function createRuleForWrite(
  region: EmbedRegion,
  where: {
    nested: NestStep[] | undefined;
    bpMedia: string | undefined;
    embedContext: string | undefined;
    wrapper: string | undefined;
    selector: string;
    write: PropWrite;
    templateWrappers?: readonly TemplateWrapper[];
  },
): boolean {
  const { nested, bpMedia, embedContext, selector, wrapper } = where;
  const { prop, value, important } = where.write;
  if (nested) {
    return createNestedRule(region, nested, prop, { value, important });
  }
  if (wrapper !== undefined && embedContext) {
    return createRuleInPlacedQuery(region, { atContextKey: embedContext, wrapper, selector }, prop, { value, important });
  }
  if (bpMedia) {
    return createRuleInMedia(region, bpMedia, selector, prop, { value, important });
  }
  if (!embedContext) {
    return createRuleAtRoot(region, selector, prop, { value, important }, where.templateWrappers ?? []);
  }
  const block = listAtRuleBlocks(region).find((entry) => entry.atContext.join(' › ') === embedContext && entry.placement.kind === 'top-level');
  return block
    ? createRuleInAtRule(block.node, selector, prop, { value, important })
    : createRuleInQuery(region, embedContext, selector, prop, { value, important });
}

export function declsFor(rule: ParsedRule, prop: string): Declaration[] {
  const key = prop.toLowerCase();
  return directDecls(rule.node).filter((declaration) => declaration.prop.trim().toLowerCase() === key);
}

export function lastDeclFor(rule: ParsedRule, prop: string): Declaration | undefined {
  const matches = declsFor(rule, prop);
  return matches[matches.length - 1];
}

export function unselectedScanState(content: Content, rememberedPageEmbedCount: number): ScanState {
  return {
    rootSnapshot: undefined,
    model: EMPTY_RULE_MODEL,
    placeholders: [],
    embedCount: content.embedCount,
    componentEmbedCount: content.componentEmbedCount,
    rememberedPageEmbedCount: content.scan.inComponentContext ? rememberedPageEmbedCount : 0,
    errors: content.errors,
    inComponentContext: content.scan.inComponentContext,
    settled: true,
    awaitingFirstAnswer: false,
  };
}

export function scanStateFor(
  content: Content,
  resolvedElement: { rootSnapshot: ElementSnapshot; model: RuleModel; settled: boolean },
  rememberedPageEmbedCount: number,
): ScanState {
  const { rootSnapshot, model, settled } = resolvedElement;
  return {
    rootSnapshot,
    model,
    placeholders: content.scan.inComponentContext ? computePlaceholders(content.docs, rootSnapshot.classList) : [],
    embedCount: content.embedCount,
    componentEmbedCount: content.componentEmbedCount,
    rememberedPageEmbedCount: content.scan.inComponentContext ? rememberedPageEmbedCount : 0,
    errors: content.errors,
    inComponentContext: content.scan.inComponentContext,
    settled,
    awaitingFirstAnswer: false,
  };
}

export function resolveStatus(content: Content, model: RuleModel): string {
  const count = model.matchedRuleCount;
  if (content.partial) {
    return count > 0 ? `${count} matching rule${count === 1 ? '' : 's'} so far — scanning components…` : 'Scanning component embeds…';
  }
  if (count > 0) {
    return `${count} matching rule${count === 1 ? '' : 's'}.`;
  }
  return content.embedCount ? 'No embed styles target this element.' : 'No HTML embeds with <style> blocks found.';
}


export type NativeAttempt = { applied: boolean; created?: boolean; reason: string };
export type EmbedWriteResult = Awaited<ReturnType<typeof writeEmbedDocument>>;
export type NestedInput = NonNullable<ReturnType<typeof parseNestedInput>>;

export type TypedPaths = Map<string, NestedInput['path']>;

const TYPED_PATHS_MAX = 32;

function typedPathKey(selector: string, context: string): string {
  return `${selector.trim()}\u0000${context}`;
}

export function rememberTypedPath(paths: TypedPaths, selector: string, context: string, path: NestedInput['path']): void {
  assert(path.length >= 2, 'A typed path nests at least one level');
  const key = typedPathKey(selector, context);
  paths.delete(key);
  paths.set(key, path);
  while (paths.size > TYPED_PATHS_MAX) {
    const oldest = paths.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    paths.delete(oldest);
  }
  assert(paths.size <= TYPED_PATHS_MAX, 'Typed paths are bounded');
}

export function takeTypedPath(paths: TypedPaths, selector: string, context: string): NestedInput['path'] | undefined {
  const key = typedPathKey(selector, context);
  const path = paths.get(key);
  paths.delete(key);
  return path;
}

export type TypedLabels = ReadonlyMap<string, string>;

export function withTypedLabel(labels: TypedLabels, selector: string, typed: string): TypedLabels {
  assert(selector.trim() !== '', 'withTypedLabel: a label belongs to a selector');
  assert(typed.trim() !== '', 'withTypedLabel: a label has text');
  const key = selectorKey(selector);
  const entries = [...labels].filter(([existing]) => existing !== key);
  const next = new Map([...entries, [key, typed.trim()] as const].slice(-TYPED_PATHS_MAX));
  assert(next.size <= TYPED_PATHS_MAX, 'withTypedLabel: labels are bounded');
  return next;
}

export type CanvasAnswer = Awaited<ReturnType<typeof askCanvasAbout>>;

export type RescanOptions = { readonly rescanComponents?: boolean | undefined };

export type Content = {
  scan: EmbedScan;
  docs: EmbedDocument[];
  rules: ParsedRule[];
  errors: Array<{ label: string; message: string }>;
  embedCount: number;
  componentEmbedCount: number;
  partial?: boolean;
};

export function contentForCurrentTree(cached: Content, current: PageScan, selected: unknown): Content | undefined {
  const selectedId = serializeElementId(selected);
  if (!current.elementByKey.has(selectedId)) {
    return undefined;
  }
  const samePage = [...cached.scan.elementByKey].some(([id, node]) => current.elementByKey.get(id) === node);
  if (!samePage || cached.scan.embeds.length !== current.pageEmbeds.length) {
    return undefined;
  }
  const sameSources = current.pageEmbeds.every((source, index) => {
    const old = cached.scan.embeds[index];
    if (old?.key !== source.key) {
      return false;
    }
    if (source.origin.kind !== 'node') {
      return true;
    }
    const id = source.origin.nodeId;
    return current.elementByKey.get(id) === cached.scan.elementByKey.get(id);
  });
  if (!sameSources) {
    return undefined;
  }
  return {
    ...cached,
    scan: {
      ...cached.scan,
      parentByKey: current.parentByKey,
      childrenByKey: current.childrenByKey,
      elementByKey: current.elementByKey,
    },
  };
}

export type PersistedScan = {
  content: Content;
  docs: EmbedDocument[];
  pageDocs: EmbedDocument[];
  inComponent: boolean;
  scanAt: number;
};

export type PersistedView = {
  hostId: string;
  filePath: string | undefined;
  elementKey: string;
  scan: ScanState;
  quick: ElementSnapshot | undefined;
};

export const editorSession: {
  scan: PersistedScan | undefined;
  view: PersistedView | undefined;
} = { scan: undefined, view: undefined };

export const viewKeyMatches = (view: PersistedView | undefined) => {
  const host = getHost();
  return !!view && !!host.selectedId && view.hostId === host.selectedId && view.filePath === (host.openFilePath ?? undefined);
};

export function authoredClasses(): string[] {
  const host = getHost();
  const node = host.selectedId ? findNode(host.nodes, host.selectedId) : undefined;
  return propText(node, 'class').trim().split(/\s+/).filter(Boolean);
}

export function useRemovedClasses(): ReadonlySet<string> {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(EMPTY_CLASSES);
  const previousRef = useRef<string[]>(authoredClasses());
  const nodeRef = useRef(getHost().selectedId);
  useEffect(() => {
    const sync = () => {
      const host = getHost();
      const now = authoredClasses();
      const previous = previousRef.current;
      previousRef.current = now;
      if (host.selectedId !== nodeRef.current) {
        nodeRef.current = host.selectedId;
        setRemoved((old) => (old.size ? EMPTY_CLASSES : old));
        return;
      }
      setRemoved((old) => {
        const next = new Set(old);
        for (const cls of previous) {
          if (!now.includes(cls)) {
            next.add(cls);
          }
        }
        for (const cls of now) {
          next.delete(cls);
        }
        const rendered = host.renderedClasses || [];
        for (const cls of [...next]) {
          if (!rendered.includes(cls)) {
            next.delete(cls);
          }
        }
        if (next.size === old.size && [...next].every((name) => old.has(name))) {
          return old;
        }
        return next;
      });
    };
    sync();
    return onHostChange(sync);
  }, []);
  return removed;
}

export const EMPTY_CLASSES: ReadonlySet<string> = new Set();

export function withoutClasses(snapshot: ElementSnapshot | undefined, hidden: ReadonlySet<string>): ElementSnapshot | undefined {
  if (!snapshot || !hidden.size) {
    return snapshot;
  }
  const classes = snapshot.classes.filter((name) => !hidden.has(name));
  const classList = snapshot.classList.filter((name) => !hidden.has(name));
  if (classes.length === snapshot.classes.length && classList.length === snapshot.classList.length) {
    return snapshot;
  }
  return {
    ...snapshot,
    classes,
    classList,
    attributes: { ...snapshot.attributes, class: classList.join(' ') },
  };
}

export const nativeModelCache = new Map<string, NativeModel>();

export function pseudoSelectorInput(node: HostNode | undefined, pseudo: 'before' | 'after'): string | undefined {
  const first = propText(node, 'class').trim().split(/\s+/)[0] ?? '';
  const base = /^-?[A-Za-z_][\w-]*$/.test(first)
    ? `.${first}`
    : node?.kind === 'element' && node.name !== undefined && /^[a-z][\w-]*$/i.test(node.name)
      ? node.name
      : undefined;
  if (base === undefined) {
    return undefined;
  }
  const input = `${base}{&::${pseudo}}`;
  assert(input.endsWith(`::${pseudo}}`), 'A pseudo pick names its pseudo-element');
  return input;
}

export function usePseudoTarget(): PseudoTarget | undefined {
  const [target, setTarget] = useState(readPseudoTarget);
  useEffect(() => onHostChange(() => setTarget(readPseudoTarget())), []);
  return target;
}

export function usePanelLayer(): PanelLayer {
  const [layer, setLayer] = useState(readPanelLayer);
  useEffect(() => onHostChange(() => setLayer(readPanelLayer())), []);
  return layer;
}

export function readPanelLayer(): PanelLayer {
  if (!getHost().pseudoRows) {
    return 'every';
  }
  return readPseudoTarget() ?? '';
}

export function pseudoPickPending(activeSelector: string): boolean {
  if (readPseudoTarget() === undefined) {
    return false;
  }
  return selectorListLayers(activeSelector).every((layer) => layer === '');
}

export function readPseudoTarget(): PseudoTarget | undefined {
  const host = getHost();
  const request = host.pseudoRequest;
  if (request === undefined) {
    return undefined;
  }
  if (request.nodeId !== host.selectedId) {
    return undefined;
  }
  const node = findNode(host.nodes, request.nodeId);
  if (node !== undefined && !pseudoLayerAllowed(node, request.pseudo)) {
    return undefined;
  }
  return request.pseudo === 'before' ? '::before' : '::after';
}

export function pseudoPickFor(
  node: HostNode | undefined,
  pseudo: 'before' | 'after',
  scan: { readonly snapshot: ElementSnapshot | undefined; readonly model: RuleModel | undefined },
): { readonly kind: 'existing'; readonly selector: string } | { readonly kind: 'typed'; readonly input: string } | { readonly kind: 'wait' } | undefined {
  const { snapshot, model } = scan;
  if (snapshot === undefined || model === undefined || !snapshotIs(snapshot, node)) {
    return { kind: 'wait' };
  }
  const strongest = strongestPseudoSelector(model, `::${pseudo}`);
  if (strongest !== undefined) {
    return { kind: 'existing', selector: strongest };
  }
  const input = pseudoSelectorInput(node, pseudo);
  return input === undefined ? undefined : { kind: 'typed', input };
}

function strongestPseudoSelector(model: RuleModel, wanted: string): string | undefined {
  assert(wanted.startsWith('::'), 'strongestPseudoSelector: a pseudo-element is named with ::');
  let strongest: { readonly text: string; readonly specificity: MatchedSelector['specificity']; readonly order: number; readonly variant: boolean } | undefined;
  for (const matched of [...model.base, ...model.conditional]) {
    if (matched.rule.atContext.length > 0) {
      continue;
    }
    for (const selector of matched.matchedSelectors) {
      if (normalizePseudoElement(selector.pseudoElement) !== wanted) {
        continue;
      }
      const candidate = { text: selector.text, specificity: selector.specificity, order: matched.rule.order, variant: selector.hasPseudoClass };
      if (strongest === undefined || outranks(candidate, strongest)) {
        strongest = candidate;
      }
    }
  }
  assert(strongest === undefined || strongest.text.toLowerCase().includes(wanted.slice(1)), 'strongestPseudoSelector: the pick names its pseudo-element');
  return strongest?.text;
}

function outranks(
  candidate: { readonly specificity: MatchedSelector['specificity']; readonly order: number; readonly variant: boolean },
  held: { readonly specificity: MatchedSelector['specificity']; readonly order: number; readonly variant: boolean },
): boolean {
  if (candidate.variant !== held.variant) {
    return held.variant;
  }
  const specificity = compareSpecificity(candidate.specificity, held.specificity);
  return specificity === 0 ? candidate.order >= held.order : specificity > 0;
}

function snapshotIs(snapshot: ElementSnapshot, node: HostNode | undefined): boolean {
  if (node?.kind !== 'element' || snapshot.tag !== node.name?.toLowerCase()) {
    return false;
  }
  const written = propText(node, 'class').trim().split(/\s+/).filter(Boolean);
  return written.every((name) => snapshot.classList.includes(name) || snapshot.classes.includes(name));
}
