
import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetComputedStyles } from '../model/computedStyle';
import { forgetComputedColors } from '../model/computedColor';
import { computeRuleModel } from '../model/cascade';
import { type MatchTarget } from '../model/selectors';
import { getHost, onHostChange, type HostState } from '../model/host';
import {
  adoptReload,
  buildSnapshot,
  onDocsReloaded,
  rebuildRules,
  primeDomMatches,
  scanHasElement,
  serializeElementId,
  scanPage,
  scanPageNow,
  syncNodeDocuments,
  webflowApi,
  embedWritesStarted,
  loadEmbedDocs,
  type EmbedDocument,
} from '../model/webflow';
import { elementSelectionKey } from '../model/webflowElement';
import { assert } from '../../../../shared/core/assert';
import { onCanvasRendered } from '../../../editor/canvasQuery';
import type { ElementSnapshot } from '../model/styleTypes';
import { EMPTY_RULE_MODEL, computePlaceholders } from './EditorBasics';
import { readScanSnapshot, scanSnapshotKey, type ScanSnapshot } from './scanSnapshotCache';
import { filledDocuments, memoryContent, type MemoryContent } from './memoryContent';
import {
  placeholdersFor,
  readDesignerState,
  unselectedScanState,
  type CanvasAnswer,
  type Content,
  BG_REFRESH_THROTTLE_MS,
  sheetSignature,
  DESIGNER_SYNC_INTERVAL_MS,
  selectorKeyOf,
  snapshotSignature,
  domMatchesChanged,
  nativeSignature,
  authoredClasses,
  contentForCurrentTree,
} from './editorModel';
import { useEditorRefs, useScanState, useSelectionState, useNativeState, useContentRebuild, useApplyResolve } from './useEditorFoundation';

const BACKGROUND_REFRESH_PASSES_MAX = 4;

interface SourceRevision {
  readonly historyTick: number;
  readonly nodes: HostState['nodes'];
}

function sourceRevision(): SourceRevision {
  const host = getHost();
  return { historyTick: host.historyTick, nodes: host.nodes };
}

function sameSourceRevision(left: SourceRevision, right: SourceRevision): boolean {
  if (left.historyTick !== right.historyTick) {
    return false;
  }
  return left.nodes === right.nodes;
}

export function useBackgroundRefresh(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  contentRebuild: ReturnType<typeof useContentRebuild>,
  applyResolveHook: ReturnType<typeof useApplyResolve>,
) {
  const { busyRef, lastScanAtRef, refreshingRef, selectedRef, seqRef } = editorRefs;
  const { setRefreshing } = scanState;
  const { rebuildAndStore } = contentRebuild;
  const { applyResolve } = applyResolveHook;
  const staleRef = useRef(false);

  const backgroundRefresh = useCallback(
    async ({ now = false }: { now?: boolean } = {}) => {
      if (refreshingRef.current || busyRef.current) {
        if (now) {
          staleRef.current = true;
        }
        return;
      }
      const urgent = now || staleRef.current;
      if (!urgent && Date.now() - lastScanAtRef.current < BG_REFRESH_THROTTLE_MS) {
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        let passes = 0;
        for (; passes < BACKGROUND_REFRESH_PASSES_MAX; passes++) {
          staleRef.current = false;
          const revision = sourceRevision();
          lastScanAtRef.current = Date.now();
          const content = await rebuildAndStore();
          if (staleRef.current) {
            continue;
          }
          if (!sameSourceRevision(revision, sourceRevision())) {
            continue;
          }
          const element = selectedRef.current;
          if (element && scanHasElement(content.scan, element)) {
            await applyResolve(element, content, seqRef.current, { silent: true });
          }
          if (staleRef.current) {
            continue;
          }
          if (sameSourceRevision(revision, sourceRevision())) {
            break;
          }
        }
        assert(passes <= BACKGROUND_REFRESH_PASSES_MAX, 'backgroundRefresh: the passes are bounded');
        if (passes === BACKGROUND_REFRESH_PASSES_MAX) {
          staleRef.current = true;
        }
      } catch {
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [applyResolve, rebuildAndStore, busyRef, lastScanAtRef, refreshingRef, selectedRef, seqRef, setRefreshing],
  );
  return { backgroundRefresh };
}

export function useRematch(editorRefs: ReturnType<typeof useEditorRefs>, scanState: ReturnType<typeof useScanState>) {
  const { busyRef, classListRef, primedRef, selectedRef, targetRef } = editorRefs;
  const { setScan } = scanState;

  const rematchChanged = useCallback(
    async (element: unknown, content: Content, read: { target: MatchTarget; snap: ElementSnapshot; asked: CanvasAnswer }) => {
      const { target, snap } = read;
      await primeDomMatches(target, content.rules, read.asked);
      primedRef.current = { target, key: selectorKeyOf(content.rules) };
      const model = await computeRuleModel(content.rules, target);
      if (busyRef.current || element !== selectedRef.current) {
        return;
      }
      targetRef.current = target;
      classListRef.current = snap.classList;
      setScan((previous) =>
        previous
          ? {
              ...previous,
              rootSnapshot: snap,
              model,
              placeholders: placeholdersFor(content, snap.classList),
            }
          : previous,
      );
    },
    [busyRef, classListRef, primedRef, selectedRef, setScan, targetRef],
  );
  return { rematchChanged };
}

export function useDesignerSync(
  editorRefs: ReturnType<typeof useEditorRefs>,
  nativeState: ReturnType<typeof useNativeState>,
  rematch: ReturnType<typeof useRematch>,
) {
  const { busyRef, contentRef, lastSnapSigRef, refreshingRef, selectedRef, targetRef } = editorRefs;
  const { nativeModelRef, setNativeModel } = nativeState;
  const { rematchChanged } = rematch;

  const syncFromDesigner = useCallback(async () => {
    if (busyRef.current || refreshingRef.current) {
      return;
    }
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
    const element = selectedRef.current;
    const content = contentRef.current;
    if (!element || !content || !scanHasElement(content.scan, element)) {
      return;
    }
    const read = await readDesignerState(element, content);
    if (!read) {
      return;
    }
    const { target, snap, native, asked } = read;
    if (busyRef.current || element !== selectedRef.current) {
      return;
    }
    const snapSig = snapshotSignature(snap);
    const snapChanged = snapSig !== lastSnapSigRef.current;
    const nativeChanged = nativeSignature(native) !== nativeSignature(nativeModelRef.current);
    const matchesChanged = domMatchesChanged(targetRef.current?.domMatched, asked);
    if (!snapChanged && !nativeChanged && !matchesChanged) {
      return;
    }
    lastSnapSigRef.current = snapSig;
    if (nativeChanged) {
      nativeModelRef.current = native;
      setNativeModel(native);
    }
    if (snapChanged || matchesChanged) {
      await rematchChanged(element, content, { target, snap, asked });
    }
  }, [rematchChanged, busyRef, contentRef, lastSnapSigRef, nativeModelRef, refreshingRef, selectedRef, setNativeModel, targetRef]);
  return { syncFromDesigner };
}

function useRememberedSnapshot(editorRefs: ReturnType<typeof useEditorRefs>, setScan: ReturnType<typeof useScanState>['setScan']) {
  const { classListRef, docsRef, primedRef, settledElementKeyRef, targetRef } = editorRefs;
  return useCallback(
    (elementKey: string): boolean => {
      const remembered = rememberedSnapshotFor(docsRef.current, elementKey);
      if (remembered === undefined) {
        return false;
      }
      settledElementKeyRef.current = elementKey;
      targetRef.current = remembered.target;
      classListRef.current = [...remembered.classList];
      primedRef.current = remembered.primed;
      setScan(remembered.scan);
      return true;
    },
    [classListRef, docsRef, primedRef, settledElementKeyRef, targetRef, setScan],
  );
}

function rememberedSnapshotFor(docs: readonly EmbedDocument[], elementKey: string): ScanSnapshot | undefined {
  if (elementKey === '') {
    return undefined;
  }
  const remembered = readScanSnapshot(scanSnapshotKey(elementKey, docs));
  assert(remembered === undefined || remembered.scan.settled, 'rememberedSnapshotFor: a remembered answer is settled');
  return remembered;
}

export function useElementReset(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
) {
  const { selectedElementKeyRef, settledElementKeyRef } = editorRefs;
  const { setQuickSnapshot, setScan } = scanState;
  const paintRemembered = useRememberedSnapshot(editorRefs, setScan);
  const { pendingDefaultRef, setContextStale, setSelectedSelectorText, setSelectedTokens, setStateKey, tokenIdentityRef } = selectionState;
  const { nativeIdentityRef, nativeModelRef, setNativeModel } = nativeState;

  const resetForElement = useCallback(
    (element: unknown) => {
      const elementKey = elementSelectionKey(element);
      if (elementKey === selectedElementKeyRef.current) {
        return;
      }
      selectedElementKeyRef.current = elementKey;
      setContextStale(true);
      setSelectedSelectorText(undefined);
      setSelectedTokens([]);
      setStateKey('');
      setQuickSnapshot(undefined);
      if (!paintRemembered(elementKey)) {
        settledElementKeyRef.current = '';
        setScan((previous) =>
          previous ? { ...previous, rootSnapshot: undefined, model: EMPTY_RULE_MODEL, settled: false, awaitingFirstAnswer: true } : previous,
        );
      }
      setNativeModel(undefined);
      nativeModelRef.current = undefined;
      nativeIdentityRef.current = '';
      tokenIdentityRef.current = '';
      pendingDefaultRef.current = true;
    },
    [
      nativeIdentityRef,
      nativeModelRef,
      paintRemembered,
      pendingDefaultRef,
      selectedElementKeyRef,
      settledElementKeyRef,
      setContextStale,
      setNativeModel,
      setQuickSnapshot,
      setScan,
      setSelectedSelectorText,
      setSelectedTokens,
      setStateKey,
      tokenIdentityRef,
    ],
  );
  return { resetForElement };
}

export function useScanWithoutSelection(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  contentRebuild: ReturnType<typeof useContentRebuild>,
) {
  const { contentRef, pageDocsRef, selectedRef, seqRef } = editorRefs;
  const { setPhase, setScan, setScanningMore, setStatus } = scanState;
  const { rebuildAndStore } = contentRebuild;

  const scanWithoutSelection = useCallback(
    async (seq: number, options: { force?: boolean }) => {
      setPhase('no-selection');
      setScan(undefined);
      setStatus('No element selected — type a selector to style it directly.');
      const showContent = (content: Content) => {
        if (seq !== seqRef.current || selectedRef.current) {
          return;
        }
        setScan(unselectedScanState(content, pageDocsRef.current.length));
        setScanningMore(!!content.partial);
      };
      const cached = contentRef.current;
      if (cached) {
        showContent(cached);
      }
      setScanningMore(true);
      try {
        const content = await rebuildAndStore({ rescanComponents: options.force }, (partial) => showContent(partial));
        showContent(content);
      } catch (error: unknown) {
        if (seq !== seqRef.current || selectedRef.current) {
          return;
        }
        setScanningMore(false);
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [rebuildAndStore, contentRef, pageDocsRef, selectedRef, seqRef, setPhase, setScan, setScanningMore, setStatus],
  );
  return { scanWithoutSelection };
}

export function useScanSelection(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  contentRebuild: ReturnType<typeof useContentRebuild>,
  applyResolveHook: ReturnType<typeof useApplyResolve>,
  backgroundRefreshHook: ReturnType<typeof useBackgroundRefresh>,
) {
  const { contentRef, seqRef, settledElementKeyRef } = editorRefs;
  const { setPhase, setQuickSnapshot, setScan, setScanningMore, setStatus } = scanState;
  const { rebuildAndStore, storeContent } = contentRebuild;
  const { applyResolve } = applyResolveHook;
  const { backgroundRefresh } = backgroundRefreshHook;
  const paintRemembered = useRememberedSnapshot(editorRefs, setScan);

  const prepareSelection = useCallback(
    (element: unknown, options: { readonly force?: boolean }): Content | undefined => {
      const cached = contentRef.current;
      if (cached !== undefined && options.force !== true) {
        if (cached.scan.elementByKey.get(serializeElementId(element)) === element) {
          return undefined;
        }
        const sameFile = contentForCurrentTree(cached, scanPageNow(), element);
        if (sameFile !== undefined) {
          contentRef.current = sameFile;
          return sameFile;
        }
      }
      const fromMemory = memoryContent();
      if (fromMemory.missing.length > 0 || !scanHasElement(fromMemory.scan, element)) {
        return undefined;
      }
      return storeContent(memoryContentOf(fromMemory, []), { fromMemory: true });
    },
    [contentRef, storeContent],
  );

  const contentWithReads = useCallback(
    async (element: unknown): Promise<Content | undefined> => {
      const fromMemory = memoryContent();
      if (fromMemory.missing.length > MEMORY_MISSING_READS_MAX || !scanHasElement(fromMemory.scan, element)) {
        return undefined;
      }
      const writes = embedWritesStarted();
      const read = await loadEmbedDocs([...fromMemory.missing]);
      if (read.errors.length > 0 || writes !== embedWritesStarted()) {
        return undefined;
      }
      assert(read.docs.length === fromMemory.missing.length, 'contentWithReads: every missing source was read');
      return storeContent(memoryContentOf(fromMemory, read.docs), { fromMemory: true });
    },
    [storeContent],
  );

  const scanSelection = useCallback(
    async (element: unknown, seq: number, options: { force?: boolean }, prepared: Content | undefined) => {
      showSourceSnapshot(element, seq, seqRef, setQuickSnapshot);

      const cached = contentRef.current;
      let reusable = prepared ?? (await reuseSelectedContent(cached, element, options));
      if (seq !== seqRef.current) {
        return;
      }
      if (reusable && reusable !== cached) {
        contentRef.current = reusable;
      }
      if (reusable === undefined) {
        reusable = await contentWithReads(element);
        if (seq !== seqRef.current) {
          return;
        }
        const elementKey = elementSelectionKey(element);
        if (reusable !== undefined && settledElementKeyRef.current !== elementKey) {
          paintRemembered(elementKey);
        }
      }

      if (reusable) {
        await applyResolve(element, reusable, seq, { sourceOnly: true });
        if (seq !== seqRef.current) {
          return;
        }
        await applyResolve(element, reusable, seq);
        void backgroundRefresh();
        return;
      }

      setPhase('scanning');
      setStatus(cached ? 'Loading this view…' : 'Scanning embeds…');
      try {
        const content = await rebuildAndStore({ rescanComponents: options.force }, (partial) => {
          if (seq === seqRef.current) {
            void applyResolve(element, partial, seq);
          }
        });
        if (seq !== seqRef.current) {
          return;
        }
        await applyResolve(element, content, seq);
      } catch (error: unknown) {
        if (seq !== seqRef.current) {
          return;
        }
        setPhase('ready');
        setScanningMore(false);
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [
      applyResolve,
      backgroundRefresh,
      contentWithReads,
      paintRemembered,
      rebuildAndStore,
      contentRef,
      seqRef,
      settledElementKeyRef,
      setPhase,
      setQuickSnapshot,
      setScanningMore,
      setStatus,
    ],
  );
  return { prepareSelection, scanSelection };
}

const MEMORY_MISSING_READS_MAX = 8;

function memoryContentOf(fromMemory: MemoryContent, read: readonly EmbedDocument[]): Content {
  const docs = filledDocuments(fromMemory, read);
  assert(docs.length === fromMemory.scan.embeds.length, 'memoryContentOf: every source has its document');
  return { scan: fromMemory.scan, docs, rules: [], errors: [], embedCount: 0, componentEmbedCount: 0, partial: false };
}

function showSourceSnapshot(element: unknown, seq: number, seqRef: { readonly current: number }, publish: (snapshot: ElementSnapshot) => void): void {
  void buildSnapshot(element)
    .then((snapshot) => {
      if (seq === seqRef.current) {
        publish(snapshot);
      }
    })
    .catch(() => {});
}

async function reuseSelectedContent(cached: Content | undefined, element: unknown, options: { readonly force?: boolean }): Promise<Content | undefined> {
  if (!cached || options.force) {
    return undefined;
  }
  if (cached.scan.elementByKey.get(serializeElementId(element)) === element) {
    return cached;
  }
  return contentForCurrentTree(cached, await scanPage(), element);
}

export function useRefresh(
  editorRefs: ReturnType<typeof useEditorRefs>,
  elementReset: ReturnType<typeof useElementReset>,
  scanWithoutSelectionHook: ReturnType<typeof useScanWithoutSelection>,
  scanSelectionHook: ReturnType<typeof useScanSelection>,
) {
  const { selectedRef, seqRef } = editorRefs;
  const { resetForElement } = elementReset;
  const { scanWithoutSelection } = scanWithoutSelectionHook;
  const { prepareSelection, scanSelection } = scanSelectionHook;

  const resolveSelection = useCallback(
    async (element: unknown, options: { force?: boolean } = {}) => {
      const seq = ++seqRef.current;
      selectedRef.current = element;
      const prepared = element ? prepareSelection(element, options) : undefined;
      resetForElement(element);
      if (!element) {
        await scanWithoutSelection(seq, options);
        return;
      }
      await scanSelection(element, seq, options, prepared);
    },
    [prepareSelection, resetForElement, scanWithoutSelection, scanSelection, selectedRef, seqRef],
  );

  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(0);

  const refresh = useCallback(
    async (element: unknown, options: { force?: boolean } = {}) => {
      resolvingRef.current += 1;
      setResolving(true);
      try {
        await resolveSelection(element, options);
      } finally {
        resolvingRef.current -= 1;
        if (resolvingRef.current === 0) {
          setResolving(false);
        }
      }
    },
    [resolveSelection],
  );
  return { refresh, resolving };
}

export function useSelectionSubscriptions(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  refreshHook: ReturnType<typeof useRefresh>,
) {
  const { selectedRef, seqRef } = editorRefs;
  const { setPhase, setStatus } = scanState;
  const { refresh } = refreshHook;

  const sheetSigRef = useRef(sheetSignature());
  useEffect(
    () =>
      onHostChange(() => {
        const sig = sheetSignature();
        if (sig === sheetSigRef.current) {
          return;
        }
        sheetSigRef.current = sig;
        void refresh(selectedRef.current, { force: true });
      }),
    [refresh, selectedRef],
  );

  useEffect(() => {
    const api = webflowApi();
    if (!api?.getSelectedElement) {
      setPhase('unsupported');
      setStatus('The Webflow selection API is unavailable. Open this inside the Designer.');
      return;
    }
    void api.getSelectedElement().then((element) => refresh(element));
    const unsubscribe = api.subscribe?.('selectedelement', (element) => void refresh(element));
    return () => {
      seqRef.current += 1;
      unsubscribe?.();
    };
  }, [refresh, seqRef, setPhase, setStatus]);
}

export function useChangeSubscriptions(
  scanState: ReturnType<typeof useScanState>,
  backgroundRefreshHook: ReturnType<typeof useBackgroundRefresh>,
  designerSync: ReturnType<typeof useDesignerSync>,
) {
  const { phase } = scanState;
  const { backgroundRefresh } = backgroundRefreshHook;
  const { syncFromDesigner } = designerSync;

  const historyRef = useRef(getHost().historyTick);
  useEffect(
    () =>
      onHostChange(() => {
        const tick = getHost().historyTick;
        if (tick === historyRef.current) {
          return;
        }
        historyRef.current = tick;
        void backgroundRefresh({ now: true });
      }),
    [backgroundRefresh],
  );

  const classSigRef = useRef('');
  useEffect(() => {
    const onClasses = () => {
      const host = getHost();
      const sig = `${authoredClasses().join(' ')}|${(host.renderedClasses || []).join(' ')}`;
      if (sig === classSigRef.current) {
        return;
      }
      const first = classSigRef.current === '';
      classSigRef.current = sig;
      if (!first) {
        void syncFromDesigner();
      }
    };
    onClasses();
    return onHostChange(onClasses);
  }, [syncFromDesigner]);

  const nodesRef = useRef(getHost().nodes);
  useEffect(() => {
    let frame: number | undefined;
    const ask = () => {
      if (frame !== undefined) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        void syncFromDesigner();
      });
    };
    const offHost = onHostChange(() => {
      const nodes = getHost().nodes;
      if (nodes !== nodesRef.current) {
        nodesRef.current = nodes;
        ask();
      }
    });
    const offRender = onCanvasRendered(ask);
    return () => {
      offHost();
      offRender();
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [syncFromDesigner]);

  useEffect(() => {
    if (phase !== 'ready') {
      return;
    }
    const id = window.setInterval(() => {
      void syncFromDesigner();
      void backgroundRefresh();
    }, DESIGNER_SYNC_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase, syncFromDesigner, backgroundRefresh]);
}

export function useRefreshDerived(editorRefs: ReturnType<typeof useEditorRefs>, scanState: ReturnType<typeof useScanState>) {
  const { busyRef, classListRef, contentRef, docsRef, pageDocsRef, primedRef, targetRef } = editorRefs;
  const { setScan } = scanState;

  const refreshDerived = useCallback(async () => {
    forgetComputedStyles();
    forgetComputedColors();
    const rules = rebuildRules(docsRef.current);
    if (contentRef.current) {
      contentRef.current.rules = rules;
    }
    const target = targetRef.current;
    if (!target) {
      return;
    }
    const key = selectorKeyOf(rules);
    if (!(primedRef.current?.target === target && primedRef.current.key === key)) {
      await primeDomMatches(target, rules);
      primedRef.current = { target, key };
    }
    const model = await computeRuleModel(rules, target);
    const placeholders = contentRef.current?.scan.inComponentContext ? computePlaceholders(contentRef.current.docs, classListRef.current) : [];
    setScan((previous) => (previous ? { ...previous, model, placeholders } : previous));
  }, [classListRef, contentRef, docsRef, primedRef, setScan, targetRef]);

  useEffect(
    () =>
      onDocsReloaded((reloaded) => {
        adoptReload([...docsRef.current, ...pageDocsRef.current], reloaded);
        void refreshDerived();
      }),
    [docsRef, pageDocsRef, refreshDerived],
  );

  const nodesRef = useRef(getHost().nodes);
  useEffect(
    () =>
      onHostChange(() => {
        const nodes = getHost().nodes;
        if (nodes === nodesRef.current) {
          return;
        }
        nodesRef.current = nodes;
        if (busyRef.current) {
          return;
        }
        if (syncNodeDocuments(docsRef.current) > 0) {
          void refreshDerived();
        }
      }),
    [busyRef, docsRef, refreshDerived],
  );
  return { refreshDerived };
}
