
import { described } from '../../../../shared/properties/i18n/messageRef';
import { useTranslate, useTranslateDescribed } from '../../../lib/i18n/useTranslate';
import { PLACEMENT_END } from '../../../editor/classAttr';
import { useEffect, useState } from 'react';
import { hslaToRgba } from '../model/colorWrite';
import { contextKeyOf, editableRuleFor, selectedRulesSetting, type SourceKey } from '../model/resolved';
import { mediaParamsForBreakpoint, optionsFor } from '../model/nativeStyles';
import { createRuleInPlacedQuery, ensureNestPath, ensureQueryBlock, parseNestedInput, type NestStep } from '../model/css';
import {
  applyNativePropertyAt,
  applyNativeToNewBaseClass,
  blankStyleDocument,
  nativeStylingAvailable,
  rebuildRules,
  removeNativePropertyAt,
  webflowApi,
  writeEmbedDocument,
  writeFirstStyleBlock,
  type EmbedDocument,
} from '../model/webflow';
import { getHost, walkNodes } from '../model/host';
import { authoredClassTokens } from '../model/webflowElement';
import { isCreateStyleTagKey } from '../model/newStyleTarget';
import { getNewStyleTagSettings, newRuleWrappers } from '../model/newStyleTagSettings';
import { isAutoClassSelector, planFirstStyles, type FirstStylesPlan } from '../model/firstStyleBlock';
import { FirstTagLane } from '../model/firstTagLane';
import { assert } from '../../../../shared/core/assert';
import { type PropWrite, type WriteSettle } from './EditorBasics';
import {
  upgradedDefault,
  type EmbedRegion,
  embedWriteTarget,
  placedQueryTarget,
  createRuleForWrite,
  type NativeAttempt,
  pseudoLayerChips,
  readPanelLayer,
  styledSelectorsFor,
  takeTypedPath,
} from './editorModel';
import { EMBED_ONLY_PROPS } from './ResolvedRows';
import { isGlobalSelector } from '../model/selectors';
import { asQuery } from './SelectorPicker';
import { useEditorRefs, useBusyState, useScanState, useSelectionState, useNativeState, usePendingWrites } from './useEditorFoundation';
import { useRefresh, useRefreshDerived } from './useEditorScanning';
import { usePropEdits, useElementTokens } from './useEditorRuleEdits';
import { useTokenDefault, useActiveSelector, useSelectorPick, useTypedSelector } from './useEditorElement';
import { useStyleContexts, useNativeTarget, useResolved } from './useEditorContexts';
import { useNativeRefresh, useNativeOps } from './useEditorNative';
export { useNativeRefresh, useNativeOps } from './useEditorNative';

export function useDefaultUpgrade(
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  elementTokens: ReturnType<typeof useElementTokens>,
  tokenDefault: ReturnType<typeof useTokenDefault>,
  selectorPick: ReturnType<typeof useSelectorPick>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
) {
  const { context, defaultTokensRef, pendingDefaultRef } = selectionState;
  const { nativeIdentityRef, nativeModel } = nativeState;
  const { model, snapshot, tokens } = elementTokens;
  const { elementIdentity } = tokenDefault;
  const { selectActiveSelector } = selectorPick;
  const { styleContexts } = styleContextsHook;

  if (pendingDefaultRef.current && model) {
    upgradeDefault();
  }
  function upgradeDefault(): void {
    if (!model) {
      return;
    }
    if (nativeStylingAvailable() && nativeIdentityRef.current !== elementIdentity) {
      return;
    }
    const activeContext = styleContexts.find((entry) => entry.key === context);
    if (!activeContext) {
      return;
    }
    const styled = pseudoLayerChips(styledSelectorsFor(model, nativeModel, activeContext), readPanelLayer()).filter((entry) => entry.inContext !== false);
    if (!styled.length) {
      return;
    }
    pendingDefaultRef.current = false;
    const local = styled.filter((entry) => !isGlobalSelector(entry.text));
    if (!local.length) {
      return;
    }
    const initial = upgradedDefault(local, {
      tokens,
      classList: snapshot?.classList ?? [],
      defaultTokens: defaultTokensRef.current,
    });
    if (initial !== undefined) {
      selectActiveSelector(initial.text);
    }
  }
}

export function useFocusResync(
  editorRefs: ReturnType<typeof useEditorRefs>,
  refreshHook: ReturnType<typeof useRefresh>,
  nativeRefresh: ReturnType<typeof useNativeRefresh>,
) {
  const { busyRef } = editorRefs;
  const { refresh } = refreshHook;
  const { refreshNative } = nativeRefresh;

  useEffect(() => {
    const api = webflowApi();
    if (!api?.getSelectedElement) {
      return;
    }
    let timer: number | undefined = undefined;
    const resync = () => {
      if (busyRef.current) {
        return;
      }
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }
      if (timer !== undefined) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        void api.getSelectedElement?.().then((element) => {
          if (!element || busyRef.current) {
            return;
          }
          void refresh(element);
          void refreshNative();
        });
      }, 150);
    };
    const onVisible = () => {
      if (!document.hidden) {
        resync();
      }
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, refreshNative, busyRef]);
}

export function useWriteNewRule(
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  refreshDerivedHook: ReturnType<typeof useRefreshDerived>,
  selectorPick: ReturnType<typeof useSelectorPick>,
  resolvedHook: ReturnType<typeof useResolved>,
  editorRefs: ReturnType<typeof useEditorRefs>,
  nativeState: ReturnType<typeof useNativeState>,
) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const { setBusyBoth, setSaveError } = busyState;
  const { setStatus } = scanState;
  const { settleEmbedWrite } = pendingWrites;
  const { refreshDerived } = refreshDerivedHook;
  const { selectActiveSelector, typedPathsRef } = selectorPick;
  const { primedRef } = editorRefs;
  const { manualSourcePickRef } = nativeState;
  const { resolved } = resolvedHook;

  const selectedRule = resolved?.selectedRule ?? undefined;
  const ruleFor = (prop: string) => (resolved ? editableRuleFor(resolved, prop) : undefined);
  const rulesSetting = (prop: string) => (resolved ? selectedRulesSetting(resolved, prop) : []);
  const writeNewRule = async (
    where: {
      embedDocument: EmbedDocument;
      region: EmbedRegion;
      embedContext: string | undefined;
      wrapper: string | undefined;
      bpMedia: string | undefined;
      selector: string;
      firstStyles?: Exclude<FirstStylesPlan, { kind: 'normal' | 'refused' }>;
    },
    writes: readonly PropWrite[],
  ): Promise<boolean> => {
    const { embedDocument, region, embedContext, wrapper, bpMedia, firstStyles } = where;
    const fullSelector = where.selector;
    assert(writes.length > 0, 'writeNewRule: a new rule is written with at least one property');
    assert(fullSelector.length > 0, 'writeNewRule: a new rule has a selector');
    setBusyBoth(true);
    setStatus('Saving…');
    try {
      if (firstStyles?.kind === 'class') {
        const outcome = (await getHost().addClass?.(firstStyles.className, PLACEMENT_END)) ?? {
          tag: 'refused',
          ...described('styleModel.embed.hook.pageCannotTakeClass'),
        };
        if (outcome.tag === 'refused') {
          setSaveError(translate('styleModel.embed.hook.classNotOnElement', { selector: fullSelector, reason: translateDescribed(outcome) }));
          return false;
        }
      }
      const nested = takeTypedPath(typedPathsRef.current, fullSelector, embedContext ?? '');
      const templateWrappers = newRuleWrappers(embedDocument.source, embedDocument.code);
      const created = writes.map((write) =>
        createRuleForWrite(region, {
          templateWrappers,
          nested,
          bpMedia,
          embedContext,
          wrapper,
          selector: fullSelector,
          write,
        }),
      );
      if (!created.includes(true)) {
        setStatus('Nothing to save.');
        return false;
      }
      const result =
        firstStyles !== undefined && firstStyles.kind !== 'class'
          ? await writeFirstStyleBlock(embedDocument, {
              className: firstStyles.kind === 'block-and-class' ? firstStyles.className : undefined,
              attributes: getNewStyleTagSettings().attributes,
            })
          : await writeEmbedDocument(embedDocument);
      if (firstStyles !== undefined && result.ok) {
        primedRef.current = undefined;
        manualSourcePickRef.current = undefined;
        selectActiveSelector(fullSelector);
      }
      await refreshDerived();
      if (!settleEmbedWrite(embedDocument, result, 'rule')) {
        return false;
      }
      setStatus(`Added ${fullSelector}.`);
      return true;
    } finally {
      setBusyBoth(false);
    }
  };
  return { selectedRule, ruleFor, rulesSetting, writeNewRule };
}

export function useCreateRule(
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  elementTokens: ReturnType<typeof useElementTokens>,
  activeSelectorHook: ReturnType<typeof useActiveSelector>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
  resolvedHook: ReturnType<typeof useResolved>,
  writeNewRuleHook: ReturnType<typeof useWriteNewRule>,
) {
  const translateDescribed = useTranslateDescribed();
  const { setStatus } = scanState;
  const { setSaveError } = busyState;
  const { documentByKey } = pendingWrites;
  const { model, snapshot } = elementTokens;
  const { activeSelector } = activeSelectorHook;
  const { currentContext } = styleContextsHook;
  const { selectedEmbedKey } = resolvedHook;
  const { writeNewRule } = writeNewRuleHook;

  const [firstTagLane] = useState(() => new FirstTagLane());
  const createSelectedRule = (write: PropWrite, selectorOverride?: string) => {
    const requested = selectorOverride ?? activeSelector;
    if (firstTagLane.holds(getHost().openFilePath)) {
      firstTagLane.join(requested, write);
      return 'until-model';
    }
    return createRules([write], requested);
  };
  const supersedeFirstTagWrite = (prop: string): void => {
    if (firstTagLane.holds(getHost().openFilePath)) {
      firstTagLane.supersede(activeSelector, prop);
    }
  };
  const contextBpMedia = () =>
    currentContext.embedAtContext === undefined && currentContext.breakpoint && currentContext.breakpoint !== 'main'
      ? mediaParamsForBreakpoint(currentContext.breakpoint)
      : undefined;
  const createRules = (writes: readonly PropWrite[], requested: string): WriteSettle => {
    assert(writes.length > 0, 'createRules: at least one property is written');
    const embedContext = currentContext.embedAtContext;
    const bpMedia = contextBpMedia();
    const where = newRuleTarget();
    const plan = firstStylesPlan(requested);
    if (plan.kind === 'refused') {
      setSaveError(translateDescribed(plan));
      return undefined;
    }
    if (plan.kind === 'normal') {
      if (!where) {
        setStatus('No embed here to write to — add an HTML embed first.');
        return undefined;
      }
      return writeNewRule({ ...where, embedContext, wrapper: currentContext.wrapper, bpMedia, selector: requested }, writes);
    }
    if (plan.kind === 'class') {
      if (!where) {
        setStatus('No embed here to write to — add an HTML embed first.');
        return undefined;
      }
      return writeNewRule({ ...where, embedContext, wrapper: currentContext.wrapper, bpMedia, selector: `.${plan.className}`, firstStyles: plan }, writes);
    }
    const filePath = getHost().openFilePath;
    const blank = blankTarget();
    if (filePath === undefined || blank === undefined) {
      setStatus('No embed here to write to — add an HTML embed first.');
      return undefined;
    }
    const selector = plan.kind === 'block' ? requested : `.${plan.className}`;
    firstTagLane.open({ filePath, requested, selector, knownKeys: documentByKey.keys() });
    for (const write of writes) {
      firstTagLane.join(requested, write);
    }
    queueMicrotask(() => {
      const first = firstTagLane.takeFirstWrites();
      void writeNewRule({ ...blank, embedContext, wrapper: currentContext.wrapper, bpMedia, selector, firstStyles: plan }, first).then(
        (landed) => firstTagLane.settle(landed ? 'written' : 'failed'),
        () => firstTagLane.settle('failed'),
      );
    });
    return 'until-model';
  };
  useEffect(() => {
    const filePath = getHost().openFilePath;
    const nodeKeys: string[] = [];
    for (const [key, embedDocument] of documentByKey) {
      const origin = embedDocument.source.origin;
      if (origin.kind === 'node' && origin.filePath === filePath) {
        nodeKeys.push(key);
      }
    }
    const outcome = firstTagLane.afterScan(filePath, nodeKeys);
    if (outcome.kind !== 'drain') {
      return;
    }
    assert(!firstTagLane.holds(filePath), 'useCreateRule: a drained lane is let go before its writes run');
    const tagDocument = outcome.tagKey === undefined ? undefined : documentByKey.get(outcome.tagKey);
    const tagRegion = tagDocument?.regions[0];
    for (const batch of outcome.batches) {
      if (tagDocument === undefined || tagRegion === undefined) {
        void createRules(batch.writes, batch.selector);
        continue;
      }
      void writeNewRule(
        {
          embedDocument: tagDocument,
          region: tagRegion,
          embedContext: currentContext.embedAtContext,
          wrapper: currentContext.wrapper,
          bpMedia: contextBpMedia(),
          selector: batch.selector,
        },
        batch.writes,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the scan is the trigger
  }, [documentByKey]);
  const blankTarget = () => {
    const embedDocument = blankStyleDocument(getNewStyleTagSettings());
    const region = embedDocument.regions[0];
    return region === undefined ? undefined : { embedDocument, region };
  };
  const firstStylesPlan = (selector: string): FirstStylesPlan => {
    const host = getHost();
    const tag = snapshot?.tag;
    const elementClasses = snapshot?.classes ?? [];
    const bareTag = tag !== undefined && selector === tag && elementClasses.length === 0;
    const documents = [...documentByKey.values()];
    const ruleSelectors = bareTag && documents.length > 0 ? rebuildRules(documents).flatMap((rule) => rule.selectors.map((info) => info.text)) : [];
    const taken = new Set<string>(elementClasses);
    walkNodes(host.nodes, (node) => {
      for (const name of authoredClassTokens(node)) {
        taken.add(name);
      }
    });
    for (const text of ruleSelectors) {
      if (isAutoClassSelector(text)) {
        taken.add(text.trim().slice(1));
      }
    }
    return planFirstStyles({
      selector,
      tag,
      elementClasses,
      sourceCount: documents.length,
      ruleSelectors,
      takenClasses: taken,
      filePath: host.openFilePath,
      createStyleTag: isCreateStyleTagKey(selectedEmbedKey) ? 'chosen' : 'not-chosen',
    });
  };
  const newRuleTarget = () => {
    const embedContext = currentContext.embedAtContext;
    const chosen = embedWriteTarget({ model, selectedEmbedKey, documentByKey }, (rule) => contextKeyOf(rule) === (embedContext ?? ''));
    if (!embedContext) {
      return chosen;
    }
    return placedQueryTarget(chosen, documentByKey, { atContextKey: embedContext, wrapper: currentContext.wrapper, source: currentContext.source });
  };
  const liveCreateInNestedQuery = (write: PropWrite): boolean => {
    const embedContext = currentContext.embedAtContext;
    const wrapper = currentContext.wrapper;
    if (wrapper === undefined || !embedContext || !activeSelector) {
      return false;
    }
    const where = newRuleTarget();
    if (!where) {
      return false;
    }
    const placed = createRuleInPlacedQuery(where.region, { atContextKey: embedContext, wrapper, selector: activeSelector }, write.prop, {
      value: write.value,
      important: write.important,
    });
    if (placed) {
      void writeEmbedDocument(where.embedDocument, true);
    }
    return placed;
  };
  return { createSelectedRule, liveCreateInNestedQuery, supersedeFirstTagWrite };
}

export function useEmptyContext(
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  refreshDerivedHook: ReturnType<typeof useRefreshDerived>,
  elementTokens: ReturnType<typeof useElementTokens>,
  resolvedHook: ReturnType<typeof useResolved>,
) {
  const { setBusyBoth } = busyState;
  const { setStatus } = scanState;
  const { documentByKey, settleEmbedWrite } = pendingWrites;
  const { refreshDerived } = refreshDerivedHook;
  const { model } = elementTokens;
  const { selectedEmbedKey } = resolvedHook;

  const writeEmptyContext = ({ path, contextKey }: { readonly path?: NestStep[]; readonly contextKey?: string }) => {
    const where = embedWriteTarget({ model, selectedEmbedKey, documentByKey }, undefined);
    if (!where) {
      return;
    }
    const { embedDocument, region } = where;
    void (async () => {
      setBusyBoth(true);
      setStatus('Adding query…');
      try {
        const ok = path ? ensureNestPath(region, path) : contextKey ? ensureQueryBlock(region, contextKey) : false;
        if (!ok) {
          setStatus('Couldn’t add the query.');
          return;
        }
        await refreshDerived();
        const result = await writeEmbedDocument(embedDocument);
        if (!settleEmbedWrite(embedDocument, result, 'rule')) {
          return;
        }
        setStatus('Query added.');
      } finally {
        setBusyBoth(false);
      }
    })();
  };
  return { writeEmptyContext };
}

export function useAddQuery(
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  propEdits: ReturnType<typeof usePropEdits>,
  activeSelectorHook: ReturnType<typeof useActiveSelector>,
  selectorPick: ReturnType<typeof useSelectorPick>,
  typedSelector: ReturnType<typeof useTypedSelector>,
  nativeTarget: ReturnType<typeof useNativeTarget>,
  resolvedHook: ReturnType<typeof useResolved>,
  writeNewRuleHook: ReturnType<typeof useWriteNewRule>,
  createRule: ReturnType<typeof useCreateRule>,
  emptyContext: ReturnType<typeof useEmptyContext>,
) {
  const { setContext } = selectionState;
  const { nativeModel } = nativeState;
  const { onSetProp } = propEdits;
  const { activeSelector } = activeSelectorHook;
  const { setTypedContexts } = selectorPick;
  const { addTypedSelector } = typedSelector;
  const { canNative } = nativeTarget;
  const { nativeContextOk, resolved, selectedNativeIndex } = resolvedHook;
  const { ruleFor } = writeNewRuleHook;
  const { createSelectedRule, supersedeFirstTagWrite } = createRule;
  const { writeEmptyContext } = emptyContext;

  const onAddQuery = (raw: string, mode: 'wrap' | 'nest') => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    const query = asQuery(trimmed);
    if (mode === 'nest' && activeSelector) {
      const nestedInput = `${activeSelector} { ${query} }`;
      addTypedSelector(nestedInput, PLACEMENT_END);
      const parsed = parseNestedInput(nestedInput);
      if (parsed && parsed.path.length) {
        writeEmptyContext({ path: parsed.path });
      }
      return;
    }
    setTypedContexts((previous) => (previous.includes(query) ? previous : [...previous, query]));
    setContext(query);
    writeEmptyContext({ contextKey: query });
  };
  const writeEmbedProp = (write: PropWrite) => {
    const rule = ruleFor(write.prop);
    if (rule === undefined) {
      return createSelectedRule(write);
    }
    supersedeFirstTagWrite(write.prop);
    return onSetProp(rule, write.prop, write.value, write.important);
  };

  const nativeHandle = () => (nativeModel && selectedNativeIndex !== undefined ? nativeModel.styles[selectedNativeIndex]?.style : undefined);
  const propLayer = (prop: string): SourceKey => {
    if (EMBED_ONLY_PROPS.has(prop)) {
      return 'embed';
    }
    if (!nativeContextOk) {
      return 'embed';
    }
    const resolvedProp = resolved?.props.get(prop);
    const origin = resolvedProp?.source === 'selected' ? resolvedProp.selectedOrigin : undefined;
    if (origin === 'embed' || origin === 'native') {
      return origin;
    }
    return canNative ? 'native' : 'embed';
  };
  return { nativeHandle, onAddQuery, propLayer, supersedeFirstTagWrite, writeEmbedProp };
}

export function useNativeAttempt(
  editorRefs: ReturnType<typeof useEditorRefs>,
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  selectionState: ReturnType<typeof useSelectionState>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
  nativeOps: ReturnType<typeof useNativeOps>,
) {
  const { selectedRef } = editorRefs;
  const { setBusyBoth } = busyState;
  const { setStatus } = scanState;
  const { stateKey } = selectionState;
  const { currentContext } = styleContextsHook;
  const { nativeWriteTargetAt } = nativeOps;

  const attemptNative = async (status: string, attempt: () => Promise<NativeAttempt>): Promise<NativeAttempt> => {
    try {
      setBusyBoth(true);
      setStatus(status);
      return await attempt();
    } catch (error: unknown) {
      return { applied: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      setBusyBoth(false);
    }
  };
  const clearCoercedNative = async (index: number, prop: string) => {
    try {
      setBusyBoth(true);
      await removeNativePropertyAt(selectedRef.current, nativeWriteTargetAt(index), [prop], optionsFor(currentContext, stateKey));
    } catch {
    } finally {
      setBusyBoth(false);
    }
  };
  return { attemptNative, clearCoercedNative };
}

export function useNativeSet(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  selectionState: ReturnType<typeof useSelectionState>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
  nativeRefresh: ReturnType<typeof useNativeRefresh>,
  nativeOps: ReturnType<typeof useNativeOps>,
  addQuery: ReturnType<typeof useAddQuery>,
  nativeAttempt: ReturnType<typeof useNativeAttempt>,
) {
  const translate = useTranslate();
  const { selectedRef } = editorRefs;
  const { setNativeFallback, setStatus } = scanState;
  const { stateKey } = selectionState;
  const { currentContext } = styleContextsHook;
  const { refreshNative } = nativeRefresh;
  const { nativeWriteTargetAt, runNativeOp } = nativeOps;
  const { writeEmbedProp } = addQuery;
  const { attemptNative, clearCoercedNative } = nativeAttempt;

  const nativeSetOrFallback = (index: number, write: PropWrite): Promise<unknown> => {
    const { prop } = write;
    const value = hslaToRgba(write.value);
    return runNativeOp(async () => {
      setNativeFallback(undefined);
      const { applied, reason } = await attemptNative('Saving…', async () => {
        const result = await applyNativePropertyAt(selectedRef.current, nativeWriteTargetAt(index), prop, value, optionsFor(currentContext, stateKey));
        return { applied: result.applied, reason: result.error ?? '' };
      });
      if (applied) {
        await refreshNative();
        setStatus('Saved to Webflow class style.');
        return;
      }
      await clearCoercedNative(index, prop);
      setStatus(`Couldn’t set ${prop} as a Webflow style${reason ? ` (${reason})` : ''}` + ' — moving it to an embed.');
      setNativeFallback(
        reason ? translate('styleModel.embed.hook.nativeApplyFailedReason', { prop, reason }) : translate('styleModel.embed.hook.nativeApplyFailed', { prop }),
      );
      void writeEmbedProp({ ...write, value });
    });
  };
  return { nativeSetOrFallback };
}

export function useCreateNativeClass(
  editorRefs: ReturnType<typeof useEditorRefs>,
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
  nativeRefresh: ReturnType<typeof useNativeRefresh>,
  nativeOps: ReturnType<typeof useNativeOps>,
) {
  const { selectedRef } = editorRefs;
  const { stateKey } = selectionState;
  const { nativeModelRef } = nativeState;
  const { currentContext } = styleContextsHook;
  const { refreshNative } = nativeRefresh;
  const { nativeWriteTargetAt } = nativeOps;

  const createNativeClass = async (className: string, write: PropWrite): Promise<NativeAttempt> => {
    const options = optionsFor(currentContext, stateKey);
    const result = await applyNativeToNewBaseClass(selectedRef.current, className, write.prop, write.value, options);
    const reason = result.error ?? '';
    if (result.applied || !/duplicate/i.test(reason)) {
      return { applied: result.applied, created: result.applied, reason };
    }
    await refreshNative();
    const baseIndex = nativeModelRef.current?.styles.findIndex((entry) => !entry.isCombo && entry.namePath.length === 1 && entry.className === className) ?? -1;
    if (baseIndex < 0) {
      return { applied: false, created: false, reason };
    }
    const retry = await applyNativePropertyAt(selectedRef.current, nativeWriteTargetAt(baseIndex), write.prop, write.value, options);
    return { applied: retry.applied, created: false, reason: retry.error ?? '' };
  };
  return { createNativeClass };
}

export function useNativeCreate(
  scanState: ReturnType<typeof useScanState>,
  nativeRefresh: ReturnType<typeof useNativeRefresh>,
  nativeOps: ReturnType<typeof useNativeOps>,
  addQuery: ReturnType<typeof useAddQuery>,
  nativeAttempt: ReturnType<typeof useNativeAttempt>,
  createNativeClassHook: ReturnType<typeof useCreateNativeClass>,
) {
  const translate = useTranslate();
  const { setNativeFallback, setStatus } = scanState;
  const { refreshNative } = nativeRefresh;
  const { runNativeOp } = nativeOps;
  const { writeEmbedProp } = addQuery;
  const { attemptNative } = nativeAttempt;
  const { createNativeClass } = createNativeClassHook;

  const nativeCreateAndSet = (className: string, write: PropWrite): Promise<unknown> => {
    const value = hslaToRgba(write.value);
    return runNativeOp(async () => {
      setNativeFallback(undefined);
      const { applied, created, reason } = await attemptNative('Creating Webflow class…', async () => createNativeClass(className, { ...write, value }));
      if (applied) {
        await refreshNative();
        setStatus(created ? `Created Webflow class .${className}.` : 'Saved to Webflow class style.');
        return;
      }
      setStatus(`Couldn’t create .${className} as a Webflow class${reason ? ` (${reason})` : ''}` + ' — moving it to an embed.');
      setNativeFallback(
        reason
          ? translate('styleModel.embed.hook.nativeCreateFailedReason', { className, reason })
          : translate('styleModel.embed.hook.nativeCreateFailed', { className }),
      );
      void writeEmbedProp({ ...write, value });
    });
  };
  return { nativeCreateAndSet };
}

export function useAutoSelect(
  nativeState: ReturnType<typeof useNativeState>,
  elementTokens: ReturnType<typeof useElementTokens>,
  selectorPick: ReturnType<typeof useSelectorPick>,
) {
  const { nativeModelRef } = nativeState;
  const { snapshot } = elementTokens;
  const { selectActiveSelector } = selectorPick;

  const autoSelectForEdit = (): { native: number } | { embedSelector: string } | undefined => {
    const styles = nativeModelRef.current?.styles ?? [];
    const baseIndex = styles.findIndex((style) => style.applied);
    const base = styles[baseIndex];
    if (base) {
      selectActiveSelector(`.${base.className}`);
      return { native: baseIndex };
    }
    const tag = snapshot?.tag;
    if (tag) {
      selectActiveSelector(tag);
      return { embedSelector: tag };
    }
    return undefined;
  };
  return { autoSelectForEdit };
}
