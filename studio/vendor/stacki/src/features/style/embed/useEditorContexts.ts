
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { chipStyleOf, inlineResolveInput, inlineTargetOf, type InlineState } from './useInlineTarget';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  contextKeyOf,
  resolveStyle,
  selectorKey,
  selectorsMatch,
  type ContextInfo,
  type ContextKey,
  type MatchedSelector,
  type SourceKey,
  type StyleContext,
} from '../model/resolved';
import { breakpointForAtContext, breakpointTier, buildStyleContexts, nativeContribsFor, nativeHasValues, selectedNativeIndexFor } from '../model/nativeStyles';
import { listAtRuleBlocks } from '../model/css';
import {
  contextKeysWithStyles,
  indexPlacedContexts,
  indexQuerySelectors,
  modelForContext,
  nestedQueryOfKey,
  placedContextKey,
  ruleContextKey,
  ruleSourcedContextKey,
  sourcedContextKey,
  splitSourcedKey,
} from '../model/queryWrapper';
import { reachOfWrapper, wrapperOnLayer, type WrapperReach } from '../model/queryReach';
import { canvasWidthForQuery } from '../model/queryWidth';
import { baseCanvasTarget } from '../model/baseWidth';
import { followedContextKey } from '../model/followWidth';
import { resolveActiveQuery } from '../model/activeQuery';
import { followBreakpoint } from './followBreakpoint';
import { useProjectBreakpoints } from '../../../ipc/useProjectBreakpoints';
import { followRetargetKey, useCanvasWidthPx, useFollowMode, useFollowToggleHandler, type FollowMode } from './contextFollow';
import { followTransition, rowPlacement, type RowPlacement } from './followTransition';
import { assert } from '../../../../shared/core/assert';
import { isGlobalSelector, type MatchTarget } from '../model/selectors';
import { selectedInstanceMarkup, selectedInstanceMarkupPending, selectedInstanceScope } from '../model/webflowElement';
import { rememberChipProvenance, rememberedGreenChips } from '../model/chipProvenanceMemory';
import { componentSource, componentSourcePending } from '../model/componentSourceCache';
import { applyCascadeTruth } from '../model/cascadeTruth';
import { useCascadeTruth } from '../model/computedStyle';
import { useComponentSourceTick } from './useComponentSourceTick';
import { nativeStylingAvailable, rebuildRules } from '../model/webflow';
import { indexQueriesByClass, orderContexts, relativeContexts, relativesOf } from '../model/contextOrder';
import { getHost, onHostChange } from '../model/host';
import { instanceSourceKey, type InstanceStyleDocument } from '../model/instanceClasses';
import { followSource, selectorHomeKey } from '../model/selectorHome';
import { CREATE_STYLE_TAG_KEY, chosenFileSourceKey, defaultStyleTarget, defaultTargetKey, type StyleTagFact } from '../model/newStyleTarget';
import { getNewStyleLocations, newStyleFileOf, onNewStyleLocations, openStyleScope } from '../model/newStyleTagSettings';
import { styleTagScopeOf } from '../../../../shared/properties/newStyleTag';
import { styleBlockFileSupported } from '../model/firstStyleBlock';
import { contextAfterDevice, deviceTargetOf } from '../model/deviceContext';
import { EMPTY_RULE_MODEL } from './EditorBasics';
import { chipsFor, pseudoLayerChips, readPanelLayer, styledSelectorsFor, usePanelLayer, usePseudoTarget } from './editorModel';
import { useEditorRefs, useScanState, useSelectionState, useNativeState, usePendingWrites } from './useEditorFoundation';
import { useElementTokens } from './useEditorRuleEdits';
import { useTokenDefault, useActiveSelector, useSelectorPick, useSourceDocument, useContextKeys } from './useEditorElement';

export function useEmbedContexts(
  selectionState: ReturnType<typeof useSelectionState>,
  elementTokens: ReturnType<typeof useElementTokens>,
  sourceDocumentHook: ReturnType<typeof useSourceDocument>,
  contextKeys: ReturnType<typeof useContextKeys>,
) {
  const { context } = selectionState;
  const { model } = elementTokens;
  const { sourceDocument } = sourceDocumentHook;
  const { allContextKeys } = contextKeys;
  const layer = usePanelLayer();

  const sourceContexts = useMemo(() => {
    const set = new Set<string>();
    if (sourceDocument) {
      for (const region of sourceDocument.regions) {
        for (const block of listAtRuleBlocks(region)) {
          set.add(sourcedContextKey(placedContextKey(block.atContext.join(' › '), block.placement), sourceDocument.source.key));
        }
      }
    }
    return set;
  }, [sourceDocument]);
  const styledEmbedContexts = useMemo(() => {
    const set = new Set<string>();
    if (model) {
      const known = new Set(allContextKeys);
      for (const key of contextKeysWithStyles(model, layer)) {
        if (known.has(key)) {
          set.add(key);
        }
      }
    }
    if (context) {
      set.add(context);
    }
    for (const key of sourceContexts) {
      set.add(key);
    }
    return set;
  }, [model, allContextKeys, context, sourceContexts, layer]);
  return { sourceContexts, styledEmbedContexts };
}

export function useStyleContexts(
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  contextKeys: ReturnType<typeof useContextKeys>,
  embedContexts: ReturnType<typeof useEmbedContexts>,
  wrapperReachHook: ReturnType<typeof useWrapperReach>,
) {
  const translate = useTranslate();
  const { context, setContext } = selectionState;
  const { nativeModel } = nativeState;
  const { allContextKeys } = contextKeys;
  const { sourceContexts, styledEmbedContexts } = embedContexts;
  const { reachOf, reachPending } = wrapperReachHook;

  const styleContexts = useMemo<StyleContext[]>(() => {
    const list = buildStyleContexts(allContextKeys, nativeModel, styledEmbedContexts, sourceContexts, translate).filter(
      (entry) => reachOf(entry.key).kind !== 'misses',
    );
    return list;
  }, [allContextKeys, nativeModel, styledEmbedContexts, sourceContexts, reachOf, translate]);
  const currentContext = useMemo<StyleContext>(
    () =>
      styleContexts.find((entry) => entry.key === context) ??
      styleContexts.find((entry) => splitSourcedKey(context).source === undefined && entry.key !== '' && splitSourcedKey(entry.key).placed === context) ??
      styleContexts[0] ?? { key: '', label: translate('styleModel.breakpoint.main'), breakpoint: 'main', embedAtContext: '' },
    [styleContexts, context, translate],
  );
  useEffect(() => {
    if (currentContext.key !== context && currentContext.key !== '' && splitSourcedKey(currentContext.key).placed === context) {
      setContext(currentContext.key);
    }
  }, [currentContext, context, setContext]);
  const canvasWidthKnown = useCanvasWidthPx() !== undefined;
  const followsCanvas = canvasWidthKnown;
  useDesktopReturnsToBase({ currentContext, followsCanvas }, setContext);
  const contextReach = reachOf(context).kind;
  useEffect(() => {
    if (contextReach === 'misses') {
      setContext('');
    }
  }, [contextReach, setContext]);
  return { currentContext, styleContexts, reachPending };
}

export function useWrapperReach(
  editorRefs: ReturnType<typeof useEditorRefs>,
  elementTokens: ReturnType<typeof useElementTokens>,
  contextKeys: ReturnType<typeof useContextKeys>,
) {
  const { selectedRef, targetRef } = editorRefs;
  const { model } = elementTokens;
  const { allContextKeys } = contextKeys;
  const layer = usePanelLayer();
  const wrappers = useMemo(() => {
    const set = new Set<string>();
    for (const key of allContextKeys) {
      const nested = nestedQueryOfKey(key);
      if (nested !== undefined) {
        set.add(nested.wrapper);
      }
    }
    return [...set].sort();
  }, [allContextKeys]);
  const wrappersKey = wrappers.join('\u0000');
  const [answers, setAnswers] = useState<{ readonly target: MatchTarget | undefined; readonly reach: ReadonlyMap<string, WrapperReach> }>({
    target: undefined,
    reach: new Map(),
  });
  useEffect(() => {
    const target = selectedRef.current ? targetRef.current : undefined;
    let cancelled = false;
    void (async () => {
      const reach = new Map<string, WrapperReach>();
      for (const wrapper of wrappers) {
        reach.set(wrapper, await reachOfWrapper(wrapper, target));
      }
      if (!cancelled) {
        setAnswers({ target, reach });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrappersKey stands for wrappers
  }, [model, wrappersKey, selectedRef, targetRef]);
  const reachOf = useCallback(
    (key: ContextKey): WrapperReach => {
      const nested = nestedQueryOfKey(key);
      if (nested === undefined) {
        return { kind: 'reaches' };
      }
      if (!wrapperOnLayer(nested.wrapper, layer)) {
        return { kind: 'misses' };
      }
      const target = selectedRef.current ? targetRef.current : undefined;
      if (answers.target !== target) {
        return { kind: 'unknown' };
      }
      return answers.reach.get(nested.wrapper) ?? { kind: 'unknown' };
    },
    [answers, layer, selectedRef, targetRef],
  );
  const reachPending = wrappers.length > 0 && answers.target !== (selectedRef.current ? targetRef.current : undefined);
  return { reachOf, reachPending };
}

function useDesktopReturnsToBase(
  { currentContext, followsCanvas }: { readonly currentContext: StyleContext; readonly followsCanvas: boolean },
  setContext: (context: ContextKey) => void,
): void {
  const followsCanvasRef = useRef(followsCanvas);
  followsCanvasRef.current = followsCanvas;
  const currentContextRef = useRef(currentContext);
  currentContextRef.current = currentContext;
  useEffect(() => {
    let deviceLast = getHost().device;
    return onHostChange(() => {
      const device = getHost().device;
      if (device === deviceLast) {
        return;
      }
      deviceLast = device;
      if (followsCanvasRef.current) {
        return;
      }
      const next = contextAfterDevice(currentContextRef.current, deviceTargetOf(device));
      switch (next.kind) {
        case 'base':
          setContext('');
          return;
        case 'keep':
          return;
        default: {
          const exhaustive: never = next;
          return exhaustive;
        }
      }
    });
  }, [setContext]);
}

export function useNativeTarget(
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
) {
  const { selectedTokens } = selectionState;
  const { nativeModel, sourceSelection } = nativeState;
  const { documentByKey } = pendingWrites;

  const nativeIndex = useMemo(() => selectedNativeIndexFor(nativeModel, selectedTokens), [nativeModel, selectedTokens]);
  const nativeAvailable = nativeIndex !== undefined;
  const creatableClass = useMemo<string | undefined>(() => {
    if (nativeIndex !== undefined || selectedTokens.length !== 1) {
      return undefined;
    }
    const token = selectedTokens[0] ?? '';
    return token.startsWith('class:') ? token.slice('class:'.length) : undefined;
  }, [nativeIndex, selectedTokens]);
  const canNative = nativeStylingAvailable() && (nativeAvailable || creatableClass !== undefined);

  const embedList = useMemo(() => [...documentByKey.values()].sort((left, right) => left.source.order - right.source.order), [documentByKey]);

  const sourceKeys = useMemo(() => embedList.map((embedDocument) => embedDocument.source.key), [embedList]);
  const locations = useSyncExternalStore(onNewStyleLocations, getNewStyleLocations);
  const scope = openStyleScope();
  const newStyleTag = locations[scope].tag;
  const openFile = getHost().openFilePath;
  const canAddTag = styleBlockFileSupported(openFile) && getHost().addStyleBlock !== undefined;
  const styleTags = useMemo(
    () =>
      embedList.flatMap((embedDocument): StyleTagFact[] => {
        const { origin, styleTag } = embedDocument.source;
        const own = origin.kind === 'node' && origin.filePath === openFile && styleTag !== undefined;
        return own ? [{ key: embedDocument.source.key, scope: styleTag.scope, variables: styleTag.variables, order: embedDocument.source.order }] : [];
      }),
    [embedList, openFile],
  );
  const fileCanHoldTag = canAddTag ? 'yes' : 'no';
  const chosenFileKey = chosenFileSourceKey(
    embedList.map((embedDocument) => ({ key: embedDocument.source.key, label: embedDocument.source.label, originKind: embedDocument.source.origin.kind })),
    newStyleFileOf(
      scope,
      getHost().files.map((file) => file.rel),
    ),
  );
  const defaultTarget = defaultStyleTarget({
    tags: styleTags,
    preferredScope: styleTagScopeOf(newStyleTag.attributes),
    fileCanHoldTag,
    ...(chosenFileKey === undefined ? {} : { chosenFileKey }),
  });
  const createOffered = defaultTarget.kind === 'create';
  const defaultKey = defaultTargetKey(defaultTarget);
  const picked = sourceSelection === CREATE_STYLE_TAG_KEY ? (createOffered ? sourceSelection : undefined) : sourceSelection;
  const effectiveSourceSelection =
    picked && (picked === CREATE_STYLE_TAG_KEY || sourceKeys.includes(picked)) ? picked : (sourceKeys[0] ?? (createOffered ? CREATE_STYLE_TAG_KEY : ''));
  return { canNative, chosenFileKey, creatableClass, createOffered, defaultKey, effectiveSourceSelection, embedList, nativeIndex };
}

export function useComponentSource(
  scanState: ReturnType<typeof useScanState>,
  nativeState: ReturnType<typeof useNativeState>,
  nativeTarget: ReturnType<typeof useNativeTarget>,
) {
  const { scan } = scanState;
  const { pageSourceRef, previousInComponentRef, setSourceSelection, sourceSelectionRef, wantCompSourceRef } = nativeState;
  const { chosenFileKey, embedList } = nativeTarget;

  const ownKey = embedList.find((embedDocument) => embedDocument.source.fromComponent && embedDocument.source.origin.kind === 'node')?.source.key;
  const inComponentContext = (scan?.inComponentContext ?? false) || ownKey !== undefined;
  useEffect(() => {
    const componentSourceKey = chosenFileKey ?? ownKey ?? embedList.find((embedDocument) => embedDocument.source.fromComponent)?.source.key;
    if (inComponentContext !== previousInComponentRef.current) {
      previousInComponentRef.current = inComponentContext;
      if (inComponentContext) {
        pageSourceRef.current = sourceSelectionRef.current;
        wantCompSourceRef.current = true;
      } else {
        wantCompSourceRef.current = false;
        setSourceSelection(pageSourceRef.current);
      }
    }
    if (inComponentContext && wantCompSourceRef.current && componentSourceKey) {
      wantCompSourceRef.current = false;
      setSourceSelection(componentSourceKey);
    }
  }, [inComponentContext, chosenFileKey, embedList, ownKey, pageSourceRef, previousInComponentRef, setSourceSelection, sourceSelectionRef, wantCompSourceRef]);
  return { inComponentContext };
}

export function useResolved(
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  elementTokens: ReturnType<typeof useElementTokens>,
  tokenDefault: ReturnType<typeof useTokenDefault>,
  activeSelectorHook: ReturnType<typeof useActiveSelector>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
  nativeTarget: ReturnType<typeof useNativeTarget>,
  componentSource: ReturnType<typeof useComponentSource>,
  inlineState: InlineState,
) {
  const { stateKey } = selectionState;
  const { nativeModel, setSourceSelection, sourceSelectionRef } = nativeState;
  const { instanceClasses, model } = elementTokens;
  const { elementIdentity } = tokenDefault;
  const { activeSelector } = activeSelectorHook;
  const { currentContext } = styleContextsHook;
  const { canNative, defaultKey, effectiveSourceSelection, embedList, nativeIndex } = nativeTarget;
  const { inComponentContext } = componentSource;

  const nativeContextOk = currentContext.breakpoint !== undefined;
  const pseudoLayer = usePseudoTarget();
  const nativeTargetOk = canNative && nativeContextOk && pseudoLayer === undefined;
  const effectiveSource: SourceKey = nativeTargetOk ? 'native' : 'embed';
  const selectedEmbedKey = effectiveSourceSelection || undefined;
  const selectedNativeIndex = nativeTargetOk ? nativeIndex : undefined;

  const nativeContribs = useMemo(() => nativeContribsFor(nativeModel, currentContext, stateKey), [nativeModel, currentContext, stateKey]);
  const componentSourceTick = useComponentSourceTick();
  const { snapshot } = elementTokens;
  const inlineStyle = chipStyleOf(inlineState, snapshot);
  const inlineActive = inlineTargetOf(inlineState, inlineStyle).active;
  const { branchKey } = inlineState;
  const inlineNow = inlineResolveInput({ style: inlineStyle, active: inlineActive, branchKey });
  const inlineKey = `${componentSourceTick}:${inlineNow === undefined ? '' : JSON.stringify(inlineNow)}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- inlineKey stands for inlineNow's contents
  const inline = useMemo(() => inlineNow, [inlineKey]);

  const ranked = useMemo(
    () =>
      resolveStyle(
        modelForContext(model ?? EMPTY_RULE_MODEL, currentContext),
        currentContext.embedAtContext ?? ' native-only',
        activeSelector,
        {
          source: effectiveSource,
          contribs: nativeContribs,
          selectedIndex: selectedNativeIndex,
          selectedEmbedKey,
          ...(currentContext.breakpoint ? { currentTier: breakpointTier(currentContext.breakpoint) } : {}),
          pseudoLayer,
        },
        inline,
      ),
    [model, currentContext, activeSelector, effectiveSource, nativeContribs, selectedNativeIndex, selectedEmbedKey, pseudoLayer, inline],
  );

  const checkable =
    stateKey === '' && pseudoLayer === undefined && (currentContext.embedAtContext ?? ' native-only') === '' && !/::|:(before|after)\b/.test(activeSelector);
  const checkedProps = useMemo(() => (checkable ? [...ranked.props.keys()] : []), [ranked, checkable]);
  const cascadeTruth = useCascadeTruth(checkedProps);
  const resolved = useMemo(() => (checkable ? applyCascadeTruth(ranked, cascadeTruth) : ranked), [ranked, checkable, cascadeTruth]);

  const homeEmbedKey = useMemo(
    () =>
      resolved.selectedRule?.embedKey ??
      selectorHomeKey(
        [...(model?.base ?? []), ...(model?.conditional ?? [])].map((matched) => ({
          embedKey: matched.rule.embedKey,
          order: matched.rule.order,
          context: contextKeyOf(matched.rule),
          selectorTexts: [matched.rule.selectorText, ...matched.matchedSelectors.map((selector) => selector.text)],
        })),
        currentContext.embedAtContext ?? '',
        activeSelector,
      ),
    [resolved.selectedRule, model, currentContext, activeSelector],
  );

  const { manualSourcePickRef, selectionKeyRef } = nativeState;
  const selectionKey = `${elementIdentity}\u0000${activeSelector}`;
  selectionKeyRef.current = selectionKey;
  useEffect(() => {
    if (inComponentContext) {
      return;
    }
    const follow = followSource({ selectionKey, homeKey: homeEmbedKey ?? defaultKey, manualPick: manualSourcePickRef.current });
    manualSourcePickRef.current = follow.manualPick;
    if (follow.kind === 'move') {
      setSourceSelection((previous) => (previous === follow.sourceKey ? previous : follow.sourceKey));
    }
  }, [selectionKey, homeEmbedKey, defaultKey, inComponentContext, manualSourcePickRef, setSourceSelection]);

  useInstanceSource({
    activeSelector,
    contextPagePath: getHost().contextPagePath,
    elementIdentity,
    embedList,
    homeEmbedKey,
    inComponentContext,
    instanceClasses,
    setSourceSelection,
    sourceSelectionRef,
  });
  return { effectiveSource, nativeContextOk, resolved, selectedEmbedKey, selectedNativeIndex };
}

function useInstanceSource(input: {
  readonly activeSelector: string;
  readonly contextPagePath: string | undefined;
  readonly elementIdentity: string;
  readonly embedList: readonly InstanceStyleDocument[];
  readonly homeEmbedKey: string | undefined;
  readonly inComponentContext: boolean;
  readonly instanceClasses: readonly string[];
  readonly setSourceSelection: (key: string | undefined) => void;
  readonly sourceSelectionRef: { readonly current: string | undefined };
}): void {
  const {
    activeSelector,
    contextPagePath,
    elementIdentity,
    embedList,
    homeEmbedKey,
    inComponentContext,
    instanceClasses,
    setSourceSelection,
    sourceSelectionRef,
  } = input;
  const target = useMemo(
    () => (inComponentContext ? instanceSourceKey({ activeSelector, instanceClasses, documents: embedList, contextPagePath, homeEmbedKey }) : undefined),
    [inComponentContext, activeSelector, instanceClasses, embedList, contextPagePath, homeEmbedKey],
  );
  const movedRef = useRef<{ readonly key: string; readonly restore: string | undefined } | undefined>(undefined);
  useEffect(() => {
    const moved = movedRef.current;
    if (target !== undefined) {
      if (sourceSelectionRef.current !== target) {
        movedRef.current = { key: target, restore: moved === undefined ? sourceSelectionRef.current : moved.restore };
        setSourceSelection(target);
      }
      return;
    }
    if (moved === undefined) {
      return;
    }
    movedRef.current = undefined;
    if (inComponentContext && sourceSelectionRef.current === moved.key) {
      setSourceSelection(moved.restore);
    }
  }, [elementIdentity, target, inComponentContext, setSourceSelection, sourceSelectionRef]);
}

export function useSelectorChips(
  scanState: ReturnType<typeof useScanState>,
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  elementTokens: ReturnType<typeof useElementTokens>,
  activeSelectorHook: ReturnType<typeof useActiveSelector>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  selectorPick: ReturnType<typeof useSelectorPick>,
) {
  const { removedClasses } = scanState;
  const { documentByKey } = pendingWrites;
  const { selectedSelectorText } = selectionState;
  const { typedLabels } = selectorPick;
  const { nativeModel } = nativeState;
  const { instanceClasses, model, snapshot, tokens } = elementTokens;
  const componentSourceTick = useComponentSourceTick();
  const componentMarkup = useMemo(
    () => elementTokens.componentMarkup ?? (snapshot === undefined ? undefined : selectedInstanceMarkup(documentByKey.values(), componentSource)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tick stands for the cache's contents
    [elementTokens.componentMarkup, snapshot, documentByKey, componentSourceTick],
  );
  const provenancePending = useMemo(
    () =>
      elementTokens.componentMarkup === undefined && snapshot !== undefined && selectedInstanceMarkupPending(documentByKey.values(), componentSourcePending),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tick stands for the cache's contents
    [elementTokens.componentMarkup, snapshot, documentByKey, componentSourceTick],
  );
  const instanceScope = selectedInstanceScope();
  const rememberedGreen = provenancePending && instanceScope !== undefined ? rememberedGreenChips(instanceScope) : undefined;
  const { activeSelector } = activeSelectorHook;
  const { currentContext, styleContexts } = styleContextsHook;
  const pseudo = usePanelLayer();

  const selectorChips = useMemo<MatchedSelector[]>(
    () =>
      chipsFor({
        model: model === undefined ? undefined : modelForContext(model, currentContext),
        nativeModel,
        currentContext,
        activeSelector,
        selectedSelectorText,
        tokens,
        classList: snapshot?.classList ?? [],
        removedClasses,
        pseudo,
        elementTag: snapshot?.tag,
        instanceClasses,
        componentMarkup,
        rememberedGreen,
        typedLabels,
      }),
    [
      rememberedGreen,
      model,
      nativeModel,
      currentContext,
      activeSelector,
      selectedSelectorText,
      tokens,
      snapshot,
      removedClasses,
      pseudo,
      instanceClasses,
      componentMarkup,
      typedLabels,
    ],
  );

  useEffect(() => {
    if (!provenancePending && instanceScope !== undefined) {
      rememberChipProvenance(instanceScope, {
        greenKeys: selectorChips.filter((chip) => chip.inComponentMarkup === true).map((chip) => selectorKey(chip.text)),
        plainKeys: selectorChips.filter((chip) => chip.inComponentMarkup !== true && chip.pending !== true).map((chip) => selectorKey(chip.text)),
      });
    }
  }, [provenancePending, instanceScope, selectorChips]);

  const querySelectorIndex = useMemo(() => indexQuerySelectors([...documentByKey.values()]), [documentByKey]);
  const contextInfos = useMemo<ContextInfo[]>(() => {
    const embedInfos = indexPlacedContexts(model ?? EMPTY_RULE_MODEL, styleContexts, querySelectorIndex, pseudo);
    return styleContexts.map((sc, index) => {
      const embed = embedInfos[index];
      const nativeHas = sc.breakpoint ? nativeHasValues(nativeModel, sc.breakpoint) : false;
      return {
        key: sc.key,
        hasStyles: (embed?.hasStyles ?? false) || nativeHas,
        styledCombos: embed?.styledCombos ?? [],
        bestTokens: embed?.bestTokens,
        ...(embed?.wrapper === undefined ? {} : { wrapper: embed.wrapper }),
        ...(embed?.querySelectors === undefined ? {} : { querySelectors: embed.querySelectors }),
      };
    });
  }, [model, styleContexts, nativeModel, querySelectorIndex, pseudo]);

  const queryIndex = useMemo(
    () =>
      indexQueriesByClass(rebuildRules([...documentByKey.values()]), (atContext, rule) => {
        const placed = ruleContextKey(rule);
        const breakpoint = placed === atContext ? breakpointForAtContext(atContext) : undefined;
        return breakpoint === undefined ? ruleSourcedContextKey(rule) : `bp:${breakpoint}`;
      }),
    [documentByKey],
  );
  const orderedContexts = useMemo(() => {
    const own = new Set(contextInfos.filter((info) => info.hasStyles).map((info) => info.key));
    const host = getHost();
    const relatives = relativeContexts(relativesOf(host.nodes, host.selectedId), queryIndex);
    return orderContexts(styleContexts, own, relatives);
  }, [contextInfos, queryIndex, styleContexts]);
  return { contextInfos, orderedContexts, selectorChips };
}

const ROOT_FONT_SIZE_PX = 16;

function showBaseOnCanvas(atContexts: readonly string[]): void {
  const target = baseCanvasTarget(atContexts, ROOT_FONT_SIZE_PX);
  const host = getHost();
  switch (target.kind) {
    case 'width':
      host.setCanvasWidth?.(target.widthPx);
      return;
    case 'desktop':
      host.showDesktopCanvas?.();
      return;
    case 'keep':
      return;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

function showRowOnCanvas(placement: RowPlacement): void {
  const host = getHost();
  switch (placement.kind) {
    case 'width':
      host.setCanvasWidth?.(placement.widthPx);
      return;
    case 'desktop':
      host.showDesktopCanvas?.();
      return;
    case 'none':
      return;
    default: {
      const exhaustive: never = placement;
      return exhaustive;
    }
  }
}

export function useContextChange(
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  elementTokens: ReturnType<typeof useElementTokens>,
  activeSelectorHook: ReturnType<typeof useActiveSelector>,
  selectorPick: ReturnType<typeof useSelectorPick>,
  styleContextsHook: ReturnType<typeof useStyleContexts>,
) {
  const { context, contextStale, pendingDefaultRef, setContext, setContextStale } = selectionState;
  const { nativeModel } = nativeState;
  const { model, scan } = elementTokens;
  const { activeSelector } = activeSelectorHook;
  const { selectActiveSelector, setTypedContexts } = selectorPick;
  const { styleContexts, reachPending } = styleContextsHook;
  const [followMode, setFollowMode] = useFollowMode(getHost().projectPath);
  const canvasWidthPx = useCanvasWidthPx();
  const { resolved: projectBreakpoints } = useProjectBreakpoints(getHost().projectPath);
  const breakpointTarget = useMemo(
    () => (canvasWidthPx === undefined ? undefined : followBreakpoint(styleContexts, canvasWidthPx, projectBreakpoints)),
    [canvasWidthPx, styleContexts, projectBreakpoints],
  );
  const followKeyAt = useCallback(
    (widthPx: number): string => {
      const target = followBreakpoint(styleContexts, widthPx, projectBreakpoints);
      const rows =
        target === undefined || target.existingKey !== undefined ? styleContexts : [...styleContexts, { key: target.query, embedAtContext: target.query }];
      return followedContextKey(rows, widthPx, ROOT_FONT_SIZE_PX);
    },
    [styleContexts, projectBreakpoints],
  );
  const matchedKey = useMemo(() => (canvasWidthPx === undefined ? undefined : followKeyAt(canvasWidthPx)), [canvasWidthPx, followKeyAt]);

  const changeContext = useCallback(
    (next: ContextKey, options: { readonly canvas: 'move' | 'keep'; readonly selector: 'repick' | 'keep' }) => {
      if (options.selector === 'repick') {
        pendingDefaultRef.current = false;
      }
      setContext(next);
      const nextContext = styleContexts.find((entry) => entry.key === next);
      if (options.canvas === 'move') {
        if (nextContext?.embedAtContext) {
          const width = canvasWidthForQuery(nextContext.embedAtContext, ROOT_FONT_SIZE_PX);
          if (width.kind === 'width') {
            getHost().setCanvasWidth?.(width.widthPx);
          }
        } else if (next === '') {
          showBaseOnCanvas(styleContexts.map((entry) => entry.embedAtContext ?? ''));
        }
      }
      if (options.selector === 'keep' || !nextContext || !model) {
        return;
      }
      const styled = pseudoLayerChips(styledSelectorsFor(modelForContext(model, nextContext), nativeModel, nextContext), readPanelLayer()).filter(
        (entry) => entry.inContext !== false && !isGlobalSelector(entry.text),
      );
      if (!styled.length) {
        return;
      }
      if (activeSelector && styled.some((entry) => selectorsMatch(entry.text, activeSelector))) {
        return;
      }
      const strongest = styled[styled.length - 1];
      if (strongest !== undefined) {
        selectActiveSelector(strongest.text);
      }
    },
    [styleContexts, model, nativeModel, activeSelector, selectActiveSelector, pendingDefaultRef, setContext],
  );
  const changeContextRef = useRef(changeContext);
  changeContextRef.current = changeContext;

  const pickPendingRef = useRef<{ readonly fromWidthPx: number } | undefined>(undefined);

  const onContextChange = useCallback(
    (next: ContextKey) => {
      if (canvasWidthPx === undefined) {
        changeContext(next, { canvas: 'move', selector: 'repick' });
        return;
      }
      const row = styleContexts.find((entry) => entry.key === next) ?? { key: next, embedAtContext: next };
      const placement = rowPlacement(row, styleContexts, projectBreakpoints, ROOT_FONT_SIZE_PX, followKeyAt);
      const outcome = followTransition(
        { following: followMode === 'follow', targetIsBase: context === '' },
        { kind: 'pick', holdsAtCanvas: next === matchedKey, placement },
      );
      assert(outcome.target === 'row', 'onContextChange: a pick always targets the picked row');
      assert(outcome.canvas === 'keep' || placement.kind !== 'none', 'onContextChange: the canvas moves only to a placement');
      pickPendingRef.current = outcome.canvas === 'move' ? { fromWidthPx: canvasWidthPx } : undefined;
      setFollowMode(outcome.following ? 'follow' : 'pinned');
      changeContext(next, { canvas: 'keep', selector: next === context ? 'keep' : 'repick' });
      if (outcome.canvas === 'move') {
        showRowOnCanvas(placement);
      }
    },
    [followMode, context, matchedKey, canvasWidthPx, styleContexts, projectBreakpoints, followKeyAt, changeContext, setFollowMode],
  );

  const settled = (scan === undefined || scan.settled) && !reachPending;

  if (contextStale && settled) {
    const available = styleContexts.flatMap((entry) => (entry.key === '' ? [] : [entry.key, splitSourcedKey(entry.key).placed]));
    const resolved = resolveActiveQuery({
      previous: context,
      available,
      followedKey: followMode === 'follow' ? matchedKey : undefined,
    });
    setContextStale(false);
    if (resolved !== context) {
      setContext(resolved);
    }
  }

  const retargetTo = useCallback(
    (target: ContextKey) => {
      if (breakpointTarget !== undefined && breakpointTarget.existingKey === undefined && target === breakpointTarget.query) {
        setTypedContexts((previous) => (previous.includes(target) ? previous : [...previous, target]));
      }
      changeContextRef.current(target, { canvas: 'keep', selector: 'keep' });
    },
    [breakpointTarget, setTypedContexts],
  );

  const toggleFollow = useCallback(
    (from: FollowMode) => {
      const outcome = followTransition({ following: from === 'follow', targetIsBase: context === '' }, { kind: 'toggle' });
      assert(outcome.canvas === 'keep', 'toggleFollow: the toggle never moves the canvas');
      assert(outcome.target !== 'row', 'toggleFollow: the toggle picks no row');
      pickPendingRef.current = undefined;
      setFollowMode(outcome.following ? 'follow' : 'pinned');
      switch (outcome.target) {
        case 'base':
          changeContext('', { canvas: 'keep', selector: 'keep' });
          return;
        case 'matched':
          if (settled && matchedKey !== undefined && matchedKey !== context) {
            retargetTo(matchedKey);
          }
          return;
        case 'keep':
          return;
        default: {
          const exhaustive: never = outcome.target;
          return exhaustive;
        }
      }
    },
    [context, settled, matchedKey, changeContext, retargetTo, setFollowMode],
  );
  useFollowToggleHandler(toggleFollow);

  const following = followMode === 'follow' && matchedKey !== undefined;
  useEffect(() => {
    const pending = pickPendingRef.current;
    if (pending !== undefined && pending.fromWidthPx !== canvasWidthPx) {
      pickPendingRef.current = undefined;
    }
    const pickPending = pickPendingRef.current !== undefined;
    const target = followRetargetKey({ following, settled, matchedKey, context, pickPending });
    if (target !== undefined) {
      retargetTo(target);
    }
  }, [following, settled, matchedKey, context, canvasWidthPx, retargetTo]);

  const followingShownRef = useRef(followMode === 'follow');
  if (settled) {
    followingShownRef.current = followMode === 'follow';
  }
  const contextFollow =
    canvasWidthPx === undefined
      ? undefined
      : {
          following: followingShownRef.current,
          onFollow: () => toggleFollow('pinned'),
          onHold: () => toggleFollow('follow'),
        };
  return { onContextChange, contextFollow, contextsSettled: settled };
}
