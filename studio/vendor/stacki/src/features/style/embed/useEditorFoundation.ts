
import { useTranslateDescribed } from '../../../lib/i18n/useTranslate';
import { assert } from '../../../../shared/core/assert';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadEmbedSource } from '../model/toolPreferences';
import { computeRuleModel } from '../model/cascade';
import { type ContextKey, type StateKey } from '../model/resolved';
import { type MatchTarget } from '../model/selectors';
import {
  loadEmbedDocs,
  rebuildRules,
  askCanvasAbout,
  embedWritesStarted,
  primeDomMatches,
  resolveTarget,
  scanPage,
  serializeElementId,
  writeEmbedDocument,
  type EmbedDocument,
  type EmbedScan,
} from '../model/webflow';
import type { ElementSnapshot, NativeModel } from '../model/styleTypes';
import type { ManualSourcePick } from '../model/selectorHome';
import { type ScanState, type Phase } from './EditorBasics';
import { rememberScanSnapshot, scanSnapshotKey } from './scanSnapshotCache';
import { forgetDocuments, rememberDocuments } from './memoryContent';
import { getHost } from '../model/host';
import { elementSelectionKey } from '../model/webflowElement';
import {
  streamDocs,
  loadComponentDocs,
  mergedContent,
  scanStateFor,
  resolveStatus,
  type EmbedWriteResult,
  type RescanOptions,
  type Content,
  selectorKeyOf,
  editorSession,
  viewKeyMatches,
  useRemovedClasses,
} from './editorModel';

export function useEditorRefs() {
  const selectedRef = useRef<unknown>(undefined);
  const restoredRef = useRef(viewKeyMatches(editorSession.view) ? editorSession.view : undefined);
  const selectedElementKeyRef = useRef(restoredRef.current?.elementKey ?? '');
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<Content | undefined>(editorSession.scan?.content);
  const docsRef = useRef<EmbedDocument[]>(editorSession.scan?.docs ?? []);
  const pageDocsRef = useRef<EmbedDocument[]>(editorSession.scan?.pageDocs ?? []);
  const pageInstancesRef = useRef<unknown[]>([]);
  const inComponentRef = useRef(editorSession.scan?.inComponent ?? false);
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const classListRef = useRef<string[]>([]);
  const targetRef = useRef<MatchTarget | undefined>(undefined);
  const seqRef = useRef(0);
  const appliedKeyRef = useRef(-1);
  const refreshingRef = useRef(false);
  const busyRef = useRef(false);
  const busyTimerRef = useRef<number | undefined>(undefined);
  const primedRef = useRef<{ target: MatchTarget; key: string } | undefined>(undefined);
  const lastSnapSigRef = useRef('');
  const lastScanAtRef = useRef(editorSession.scan?.scanAt ?? 0);
  const settledElementKeyRef = useRef('');
  return {
    appliedKeyRef,
    busyRef,
    busyTimerRef,
    classListRef,
    contentRef,
    docsRef,
    inComponentRef,
    lastScanAtRef,
    lastSnapSigRef,
    pageDocsRef,
    pageInstancesRef,
    pendingKeysRef,
    primedRef,
    refreshingRef,
    restoredRef,
    rootRef,
    selectedElementKeyRef,
    selectedRef,
    seqRef,
    settledElementKeyRef,
    targetRef,
  };
}

function focusedTextField(): Element | undefined {
  const active = document.activeElement;
  if (active === null) {
    return undefined;
  }
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') {
    return active;
  }
  if ('isContentEditable' in active && active.isContentEditable === true) {
    return active;
  }
  return undefined;
}

export function useBusyState(editorRefs: ReturnType<typeof useEditorRefs>) {
  const { busyRef, busyTimerRef } = editorRefs;

  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const setBusyBoth = useCallback(
    (value: boolean) => {
      busyRef.current = value;
      if (value) {
        setSaveError(undefined);
        if (busyTimerRef.current === undefined) {
          busyTimerRef.current = window.setTimeout(() => {
            busyTimerRef.current = undefined;
            const typing = focusedTextField();
            if (typing === undefined) {
              setBusy(true);
              return;
            }
            typing.addEventListener(
              'focusout',
              () => {
                if (busyRef.current) {
                  setBusy(true);
                }
              },
              { once: true },
            );
          }, 300);
        }
      } else {
        if (busyTimerRef.current !== undefined) {
          window.clearTimeout(busyTimerRef.current);
          busyTimerRef.current = undefined;
        }
        setBusy(false);
      }
    },
    [busyRef, busyTimerRef],
  );
  useEffect(
    () => () => {
      if (busyTimerRef.current !== undefined) {
        window.clearTimeout(busyTimerRef.current);
      }
    },
    [busyTimerRef],
  );
  return { busy, saveError, setBusyBoth, setSaveError };
}

export function useScanState(editorRefs: ReturnType<typeof useEditorRefs>) {
  const { restoredRef } = editorRefs;

  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<ScanState | undefined>(restoredRef.current?.scan);
  const [quickSnapshot, setQuickSnapshot] = useState<ElementSnapshot | undefined>(restoredRef.current?.quick);
  const removedClasses = useRemovedClasses();
  const [, setStatus] = useState('Select an element to inspect its embed styles.');
  const [nativeFallback, setNativeFallback] = useState<string | undefined>(undefined);
  const [, setRefreshing] = useState(false);
  const [scanningMore, setScanningMore] = useState(false);
  const [cssCodeOpen, setCssCodeOpen] = useState(false);
  return {
    cssCodeOpen,
    nativeFallback,
    phase,
    quickSnapshot,
    removedClasses,
    scan,
    scanningMore,
    setCssCodeOpen,
    setNativeFallback,
    setPhase,
    setQuickSnapshot,
    setRefreshing,
    setScan,
    setScanningMore,
    setStatus,
  };
}

export function useSelectionState() {
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const tokenIdentityRef = useRef('');
  const pendingDefaultRef = useRef(false);
  const typedClassRef = useRef<string | undefined>(undefined);
  const defaultTokensRef = useRef<string[]>([]);
  const [selectedSelectorText, setSelectedSelectorText] = useState<string | undefined>(undefined);
  const [context, setContext] = useState<ContextKey>('');
  const [contextStale, setContextStale] = useState(false);
  const [stateKey, setStateKey] = useState<StateKey>('');
  return {
    context,
    contextStale,
    defaultTokensRef,
    pendingDefaultRef,
    selectedSelectorText,
    selectedTokens,
    setContext,
    setContextStale,
    setSelectedSelectorText,
    setSelectedTokens,
    setStateKey,
    stateKey,
    tokenIdentityRef,
    typedClassRef,
  };
}

export function useNativeState(selectionState: ReturnType<typeof useSelectionState>) {
  const { stateKey } = selectionState;

  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  const [nativeModel, setNativeModel] = useState<NativeModel | undefined>(undefined);
  const [sourceSelection, setSourceSelection] = useState<string | undefined>(() => loadEmbedSource() ?? undefined);
  const sourceSelectionRef = useRef(sourceSelection);
  useEffect(() => {
    sourceSelectionRef.current = sourceSelection;
  }, [sourceSelection]);
  const previousInComponentRef = useRef(false);
  const manualSourcePickRef = useRef<ManualSourcePick | undefined>(undefined);
  const selectionKeyRef = useRef('');
  const pageSourceRef = useRef<string | undefined>(undefined);
  const wantCompSourceRef = useRef(false);
  const nativeModelRef = useRef<NativeModel | undefined>(undefined);
  const nativeIdentityRef = useRef('');
  const stateKeyRef = useRef<StateKey>('');
  useEffect(() => {
    stateKeyRef.current = stateKey;
  }, [stateKey]);
  const activeSelectorRef = useRef('');
  return {
    activeSelectorRef,
    manualSourcePickRef,
    nativeIdentityRef,
    nativeModel,
    nativeModelRef,
    pageSourceRef,
    pendingKeys,
    previousInComponentRef,
    selectionKeyRef,
    setNativeModel,
    setPendingKeys,
    setSourceSelection,
    sourceSelection,
    sourceSelectionRef,
    wantCompSourceRef,
  };
}

export function usePendingWrites(
  editorRefs: ReturnType<typeof useEditorRefs>,
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  nativeState: ReturnType<typeof useNativeState>,
) {
  const translateDescribed = useTranslateDescribed();
  const { docsRef, inComponentRef, pendingKeysRef } = editorRefs;
  const { setSaveError } = busyState;
  const { scan, setStatus } = scanState;
  const { setPendingKeys } = nativeState;

  const markPending = useCallback(
    (key: string) => {
      if (pendingKeysRef.current.has(key)) {
        return;
      }
      const next = new Set(pendingKeysRef.current).add(key);
      pendingKeysRef.current = next;
      setPendingKeys(next);
    },
    [pendingKeysRef, setPendingKeys],
  );
  const clearPending = useCallback(
    (key: string) => {
      if (!pendingKeysRef.current.has(key)) {
        return;
      }
      const next = new Set(pendingKeysRef.current);
      next.delete(key);
      pendingKeysRef.current = next;
      setPendingKeys(next);
    },
    [pendingKeysRef, setPendingKeys],
  );
  const settleEmbedWrite = useCallback(
    (embedDocument: EmbedDocument, result: EmbedWriteResult, held: 'rule' | 'query'): boolean => {
      if (result.ok) {
        clearPending(embedDocument.source.key);
        return true;
      }
      if (inComponentRef.current && !embedDocument.source.fromComponent) {
        markPending(embedDocument.source.key);
        setStatus(`Held — this ${held} lives in the page, so the canvas shows it once you ` + 'leave the component.');
        return false;
      }
      setSaveError(translateDescribed({ message: result.error, messageRef: result.errorRef }));
      return false;
    },
    [clearPending, markPending, inComponentRef, setSaveError, setStatus, translateDescribed],
  );

  const documentByKey = useMemo(() => {
    const map = new Map<string, EmbedDocument>();
    docsRef.current.forEach((embedDocument) => map.set(embedDocument.source.key, embedDocument));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed per scan, on purpose
  }, [scan, docsRef]);
  return { documentByKey, markPending, settleEmbedWrite };
}

export function useContentBuild(editorRefs: ReturnType<typeof useEditorRefs>) {
  const { pageDocsRef, pageInstancesRef } = editorRefs;

  const buildContent = useCallback(
    async (
      _rescan: RescanOptions,
      onPartial?: (content: Content) => void,
    ): Promise<Content> => {
      const page = await scanPage();
      pageInstancesRef.current = page.instances;
      const pageScan: EmbedScan = {
        parentByKey: page.parentByKey,
        childrenByKey: page.childrenByKey,
        elementByKey: page.elementByKey,
        embeds: page.pageEmbeds,
        inComponentContext: page.inComponentContext,
      };
      const onDocument = streamDocs(pageScan, onPartial);
      const pageKeys = new Set(page.pageEmbeds.map((source) => source.key));
      const [pageResult, componentResult] = await Promise.all([loadEmbedDocs(page.pageEmbeds, onDocument), loadComponentDocs(pageKeys, onDocument)]);
      return mergedContent(pageScan, [pageResult, componentResult]);
    },
    [pageInstancesRef],
  );

  const composeDocs = useCallback(
    (content: Content): EmbedDocument[] => {
      if (!content.scan.inComponentContext) {
        return content.docs;
      }
      const seen = new Set(content.docs.map((embedDocument) => embedDocument.source.key));
      const remembered = pageDocsRef.current.filter((embedDocument) => !seen.has(embedDocument.source.key));
      return [...content.docs, ...remembered];
    },
    [pageDocsRef],
  );
  return { buildContent, composeDocs };
}

export function useContentStore(editorRefs: ReturnType<typeof useEditorRefs>, contentBuild: ReturnType<typeof useContentBuild>) {
  const { contentRef, docsRef, inComponentRef, lastScanAtRef, pageDocsRef } = editorRefs;
  const { composeDocs } = contentBuild;
  const memoryOwnedRef = useRef(false);
  if (!memoryOwnedRef.current) {
    memoryOwnedRef.current = true;
    forgetDocuments();
  }

  const storeContent = useCallback(
    (scanned: Content, options: { readonly fromMemory?: boolean } = {}): Content => {
      if (!scanned.scan.inComponentContext && !scanned.partial) {
        pageDocsRef.current = scanned.docs;
      }
      const active = composeDocs(scanned);
      const content: Content = {
        ...scanned,
        rules: rebuildRules(active),
        embedCount: active.length,
        componentEmbedCount: active.filter((embedDocument) => embedDocument.source.fromComponent).length,
      };
      contentRef.current = content;
      docsRef.current = active;
      inComponentRef.current = content.scan.inComponentContext;
      rememberDocuments(active, getHost().openFilePath);
      if (options.fromMemory !== true) {
        lastScanAtRef.current = Date.now();
      }
      if (!content.partial) {
        editorSession.scan = {
          content,
          docs: active,
          pageDocs: pageDocsRef.current,
          inComponent: content.scan.inComponentContext,
          scanAt: lastScanAtRef.current,
        };
      }
      return content;
    },
    [composeDocs, contentRef, docsRef, inComponentRef, lastScanAtRef, pageDocsRef],
  );
  return { storeContent };
}

const REBUILD_AFTER_WRITE_ATTEMPTS_MAX = 3;

async function rereadPastWrites(first: { readonly content: Content; readonly writes: number }, read: () => Promise<Content>): Promise<Content | undefined> {
  let { content, writes } = first;
  for (let attempt = 0; writes !== embedWritesStarted(); attempt++) {
    if (attempt >= REBUILD_AFTER_WRITE_ATTEMPTS_MAX) {
      return undefined;
    }
    writes = embedWritesStarted();
    content = await read();
  }
  assert(writes <= embedWritesStarted(), 'rereadPastWrites: the write count only grows');
  return content;
}

function useFlushPending(
  editorRefs: ReturnType<typeof useEditorRefs>,
  nativeState: ReturnType<typeof useNativeState>,
  scanState: ReturnType<typeof useScanState>,
) {
  const { pageDocsRef, pendingKeysRef } = editorRefs;
  const { setPendingKeys } = nativeState;
  const { setStatus } = scanState;
  return useCallback(async () => {
    const keys = [...pendingKeysRef.current];
    if (!keys.length) {
      return;
    }
    const byKey = new Map(pageDocsRef.current.map((embedDocument) => [embedDocument.source.key, embedDocument]));
    let failed = 0;
    for (const key of keys) {
      const embedDocument = byKey.get(key);
      if (!embedDocument) {
        continue;
      }
      const result = await writeEmbedDocument(embedDocument);
      if (!result.ok) {
        failed += 1;
      }
    }
    pendingKeysRef.current = new Set();
    setPendingKeys(new Set());
    setStatus(failed ? `Saved your page-embed edits — ${failed} couldn't be written.` : 'Saved the page-embed edits you made inside the component.');
  }, [pageDocsRef, pendingKeysRef, setPendingKeys, setStatus]);
}

export function useContentRebuild(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  nativeState: ReturnType<typeof useNativeState>,
  contentBuild: ReturnType<typeof useContentBuild>,
  contentStore: ReturnType<typeof useContentStore>,
) {
  const { contentRef, inComponentRef, pendingKeysRef } = editorRefs;
  const { buildContent } = contentBuild;
  const { storeContent } = contentStore;

  const flushPending = useFlushPending(editorRefs, nativeState, scanState);

  const rebuildAndStore = useCallback(
    async (rescan: RescanOptions = {}, onPartial?: (content: Content) => void): Promise<Content> => {
      const wasInComponent = inComponentRef.current;
      let writes = embedWritesStarted();
      const emitPartial = onPartial
        ? (partial: Content) => {
            if (writes === embedWritesStarted()) {
              onPartial(storeContent(partial));
            }
          }
        : undefined;
      let content = await buildContent(rescan, emitPartial);
      if (wasInComponent && !content.scan.inComponentContext && pendingKeysRef.current.size) {
        await flushPending();
        writes = embedWritesStarted();
        content = await buildContent(rescan);
      }
      const fresh = await rereadPastWrites({ content, writes }, () => buildContent(rescan));
      if (fresh === undefined && contentRef.current !== undefined) {
        return contentRef.current;
      }
      return storeContent(completeRefresh(fresh ?? content, { allowPartial: !!onPartial || !contentRef.current }));
    },
    [buildContent, flushPending, storeContent, contentRef, inComponentRef, pendingKeysRef],
  );
  return { rebuildAndStore, storeContent };
}

export function useApplyResolve(editorRefs: ReturnType<typeof useEditorRefs>, scanState: ReturnType<typeof useScanState>) {
  const { appliedKeyRef, classListRef, docsRef, pageDocsRef, primedRef, seqRef, settledElementKeyRef, targetRef } = editorRefs;
  const { setPhase, setScan, setScanningMore, setStatus } = scanState;

  const applyResolve = useCallback(
    async (element: unknown, content: Content, seq: number, options: { readonly silent?: boolean; readonly sourceOnly?: boolean } = {}) => {
      const asked = options.sourceOnly ? ({ kind: 'unasked' } as const) : await askCanvasAbout(serializeElementId(element), content.rules);
      const { target, rootSnapshot } = await resolveTarget(element, content.scan, asked);
      if (seq !== seqRef.current) {
        return;
      }
      const settled = !content.partial && options.sourceOnly !== true;
      const elementKey = elementSelectionKey(element);
      if (!settled && settledElementKeyRef.current === elementKey) {
        return;
      }
      targetRef.current = target;
      await primeDomMatches(target, content.rules, asked);
      if (!options.sourceOnly) {
        primedRef.current = { target, key: selectorKeyOf(content.rules) };
      }
      const model = await computeRuleModel(content.rules, target);
      if (seq !== seqRef.current) {
        return;
      }
      const key = seq * 2 + (content.partial ? 0 : 1);
      if (key < appliedKeyRef.current) {
        return;
      }
      appliedKeyRef.current = key;
      classListRef.current = rootSnapshot.classList;
      const landed: ScanState = {
        ...scanStateFor(content, { rootSnapshot, model, settled }, pageDocsRef.current.length),
        awaitingFirstAnswer: false,
      };
      setScan((previous) => ({ ...landed, awaitingFirstAnswer: !settled && previous?.awaitingFirstAnswer === true }));
      if (settled) {
        settledElementKeyRef.current = elementKey;
        rememberScanSnapshot(scanSnapshotKey(elementKey, docsRef.current), {
          scan: landed,
          target,
          classList: rootSnapshot.classList,
          primed: options.sourceOnly ? undefined : { target, key: selectorKeyOf(content.rules) },
        });
      }
      setPhase('ready');
      setScanningMore(!!content.partial);
      if (!options.silent) {
        setStatus(resolveStatus(content, model));
      }
    },
    [appliedKeyRef, classListRef, docsRef, pageDocsRef, primedRef, seqRef, setPhase, setScan, setScanningMore, setStatus, settledElementKeyRef, targetRef],
  );
  return { applyResolve };
}

function completeRefresh(content: Content, options: { readonly allowPartial: boolean }): Content {
  if (!options.allowPartial && content.errors.length) {
    throw new Error('Stylesheet refresh interrupted; keeping the last complete scan.');
  }
  return content;
}
