
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultSelectorTokens, selectorToClassTokens, tokensToSelector } from '../model/elementTokens';
import { stateForSelector, STATES, type ContextKey } from '../model/resolved';
import { listAtRuleBlocks, parseNestedInput, renameAtRuleQuery, atRuleQueryText, queryKey, splitQuery } from '../model/css';
import { canonicalCompound } from '../model/selectors';
import { placedContextKey, placementOfPath, renameQueryInContextKey, sourcedContextKey, splitSourcedKey } from '../model/queryWrapper';
import { findNode, getHost, onHostChange } from '../model/host';
import { readNativeStyleByName, readNativeStyles, resolveIdentityElement, writeEmbedDocument, type EmbedDocument } from '../model/webflow';
import type { NativeModel } from '../model/styleTypes';
import { standaloneNativeClass } from './EditorBasics';
import { PLACEMENT_END, type ClassPlacement } from '../../../editor/classAttr';
import {
  loneTypedClass,
  type NestedInput,
  nativeModelCache,
  pseudoPickFor,
  readPseudoTarget,
  rememberTypedPath,
  withTypedLabel,
  type TypedLabels,
  type TypedPaths,
  usePseudoTarget,
} from './editorModel';
import { asQuery, type QuerySuggestion, COMMON_QUERIES } from './SelectorPicker';
import { useEditorRefs, useBusyState, useScanState, useSelectionState, useNativeState, usePendingWrites } from './useEditorFoundation';
import { assert } from '../../../../shared/core/assert';
import { useRefreshDerived } from './useEditorScanning';
import { useApplyEdit, useElementTokens } from './useEditorRuleEdits';

export function useTokenDefault(
  scanState: ReturnType<typeof useScanState>,
  selectionState: ReturnType<typeof useSelectionState>,
  elementTokens: ReturnType<typeof useElementTokens>,
) {
  const { setNativeFallback } = scanState;
  const { defaultTokensRef, pendingDefaultRef, setSelectedSelectorText, setSelectedTokens, setStateKey, tokenIdentityRef, typedClassRef } = selectionState;
  const { tokens } = elementTokens;

  const identity = tokens.map((token) => token.name).join('|');
  if (identity !== tokenIdentityRef.current) {
    applyTokenDefault();
  }
  function applyTokenDefault(): void {
    tokenIdentityRef.current = identity;
    const typedClass = typedClassRef.current;
    if (typedClass !== undefined) {
      if (tokens.some((token) => token.name === `class:${typedClass}`)) {
        typedClassRef.current = undefined;
        return;
      }
    }
    const next = defaultSelectorTokens(tokens);
    setSelectedTokens(next);
    setSelectedSelectorText(undefined);
    defaultTokensRef.current = next;
    pendingDefaultRef.current = true;
    setStateKey('');
    setNativeFallback(undefined);
  }

  const elementIdentity = useMemo(() => tokens.map((token) => token.name).join('|'), [tokens]);
  return { elementIdentity };
}

export function useCachedNative(nativeState: ReturnType<typeof useNativeState>) {
  const { nativeIdentityRef, nativeModelRef, setNativeModel } = nativeState;

  const serveCachedNative = useCallback(
    (identity: string) => {
      const cached = nativeModelCache.get(identity);
      if (!cached && nativeModelRef.current) {
        nativeModelRef.current = undefined;
        nativeIdentityRef.current = '';
        setNativeModel(undefined);
      }
      if (cached) {
        nativeModelRef.current = cached;
        setNativeModel(cached);
      }
      return cached;
    },
    [nativeIdentityRef, nativeModelRef, setNativeModel],
  );
  return { serveCachedNative };
}

export function useNativeRead(
  editorRefs: ReturnType<typeof useEditorRefs>,
  nativeState: ReturnType<typeof useNativeState>,
  tokenDefault: ReturnType<typeof useTokenDefault>,
  cachedNative: ReturnType<typeof useCachedNative>,
) {
  const { selectedRef } = editorRefs;
  const { nativeIdentityRef, nativeModelRef, setNativeModel } = nativeState;
  const { elementIdentity } = tokenDefault;
  const { serveCachedNative } = cachedNative;

  useEffect(() => {
    const selectedElement = selectedRef.current;
    if (!selectedElement) {
      setNativeModel(undefined);
      nativeModelRef.current = undefined;
      nativeIdentityRef.current = '';
      return;
    }
    const cached = serveCachedNative(elementIdentity);
    let cancelled = false;
    const onPartial = cached
      ? undefined
      : (partial: NativeModel) => {
          if (cancelled) {
            return;
          }
          nativeModelRef.current = partial;
          setNativeModel(partial);
        };
    void resolveIdentityElement(selectedElement)
      .then((identity) => readNativeStyles(identity, STATES, onPartial))
      .then((model) => {
        if (cancelled) {
          return;
        }
        nativeModelCache.set(elementIdentity, model);
        nativeModelRef.current = model;
        nativeIdentityRef.current = elementIdentity;
        setNativeModel(model);
      });
    return () => {
      cancelled = true;
    };
  }, [elementIdentity, serveCachedNative, nativeIdentityRef, nativeModelRef, selectedRef, setNativeModel]);
}

export function useActiveSelector(
  scanState: ReturnType<typeof useScanState>,
  selectionState: ReturnType<typeof useSelectionState>,
  nativeState: ReturnType<typeof useNativeState>,
  elementTokens: ReturnType<typeof useElementTokens>,
) {
  const { phase } = scanState;
  const { selectedSelectorText, selectedTokens } = selectionState;
  const { activeSelectorRef, nativeIdentityRef, nativeModelRef, setNativeModel } = nativeState;
  const { tokens } = elementTokens;

  const selectedSelector = useMemo(() => tokensToSelector(selectedTokens, tokens), [selectedTokens, tokens]);
  const activeSelector = selectedSelectorText ?? selectedSelector;
  useEffect(() => {
    activeSelectorRef.current = activeSelector;
  }, [activeSelector, activeSelectorRef]);

  const standaloneClass = phase === 'no-selection' ? standaloneNativeClass(activeSelector) : undefined;
  useEffect(() => {
    if (phase !== 'no-selection') {
      return;
    }
    if (!standaloneClass) {
      nativeModelRef.current = undefined;
      nativeIdentityRef.current = '';
      setNativeModel(undefined);
      return;
    }
    let cancelled = false;
    void readNativeStyleByName(standaloneClass, STATES).then((next) => {
      if (cancelled) {
        return;
      }
      nativeModelRef.current = next;
      nativeIdentityRef.current = `standalone:${standaloneClass}`;
      setNativeModel(next);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, standaloneClass, nativeIdentityRef, nativeModelRef, setNativeModel]);
  return { activeSelector };
}

export function useSelectorPick(
  editorRefs: ReturnType<typeof useEditorRefs>,
  selectionState: ReturnType<typeof useSelectionState>,
  elementTokens: ReturnType<typeof useElementTokens>,
) {
  const { selectedRef } = editorRefs;
  const { pendingDefaultRef, setContext, setSelectedSelectorText, setSelectedTokens, setStateKey } = selectionState;
  const { tokens } = elementTokens;

  const [typedContexts, setTypedContexts] = useState<string[]>([]);
  const typedPathsRef = useRef<TypedPaths>(new Map());
  const [typedLabels, setTypedLabels] = useState<TypedLabels>(new Map());
  const selectActiveSelector = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      pendingDefaultRef.current = false;
      setSelectedSelectorText(trimmed);
      const simple = canonicalCompound(trimmed).simple;
      const matchedTokens = simple ? selectorToClassTokens(trimmed, tokens) : undefined;
      const standalone = !selectedRef.current ? standaloneNativeClass(trimmed) : undefined;
      setSelectedTokens(matchedTokens ?? (standalone ? [`class:${standalone}`] : []));
      setStateKey(stateForSelector(trimmed));
    },
    [tokens, pendingDefaultRef, selectedRef, setSelectedSelectorText, setSelectedTokens, setStateKey],
  );
  const selectNested = useCallback(
    (parsed: NestedInput, typed: string) => {
      const atContextKey = parsed.atContext.join(' › ');
      const contextKey = atContextKey ? placedContextKey(atContextKey, placementOfPath(parsed.path)) : '';
      if (contextKey) {
        setTypedContexts((previous) => (previous.includes(contextKey) ? previous : [...previous, contextKey]));
        setContext(contextKey);
      } else {
        setContext('');
      }
      selectActiveSelector(parsed.selector);
      if (parsed.path.length >= 2) {
        rememberTypedPath(typedPathsRef.current, parsed.selector, atContextKey, parsed.path);
        setTypedLabels((previous) => withTypedLabel(previous, parsed.selector, typed));
      }
    },
    [selectActiveSelector, setContext],
  );
  return { selectActiveSelector, selectNested, setTypedContexts, typedContexts, typedLabels, typedPathsRef };
}

export function useTypedSelector(
  editorRefs: ReturnType<typeof useEditorRefs>,
  selectionState: ReturnType<typeof useSelectionState>,
  applyEditHook: ReturnType<typeof useApplyEdit>,
  selectorPick: ReturnType<typeof useSelectorPick>,
) {
  const { primedRef } = editorRefs;
  const { pendingDefaultRef, setSelectedSelectorText, setSelectedTokens, setStateKey, typedClassRef } = selectionState;
  const { classGatesRef } = applyEditHook;
  const { selectActiveSelector, selectNested } = selectorPick;

  const addTypedSelector = useCallback(
    (input: string, placement: ClassPlacement) => {
      const trimmed = input.trim();
      if (!trimmed) {
        return;
      }
      if (trimmed.includes('{')) {
        const parsed = parseNestedInput(trimmed);
        if (parsed) {
          selectNested(parsed, trimmed);
          return;
        }
      }
      const loneClass = loneTypedClass(trimmed);
      if (loneClass !== undefined) {
        typedClassRef.current = loneClass;
        const gate = getHost().addClass?.(loneClass, placement);
        if (gate) {
          classGatesRef.current.set(trimmed, gate);
        }
        primedRef.current = undefined;
      }
      selectActiveSelector(trimmed);
    },
    [selectActiveSelector, selectNested, classGatesRef, primedRef, typedClassRef],
  );
  const deselect = useCallback(() => {
    if (readPseudoTarget() !== undefined) {
      return;
    }
    pendingDefaultRef.current = false;
    setSelectedTokens([]);
    setSelectedSelectorText(undefined);
    setStateKey('');
  }, [pendingDefaultRef, setSelectedSelectorText, setSelectedTokens, setStateKey]);
  return { addTypedSelector, deselect };
}

export function useFocusProp(editorRefs: ReturnType<typeof useEditorRefs>, selectorPick: ReturnType<typeof useSelectorPick>) {
  const { rootRef } = editorRefs;
  const { selectActiveSelector } = selectorPick;

  const [focusProp, setFocusProp] = useState<string | undefined>(undefined);
  const onSelectSelector = useCallback(
    (selectorText: string, prop?: string) => {
      selectActiveSelector(selectorText);
      if (prop) {
        setFocusProp(prop);
      }
    },
    [selectActiveSelector],
  );
  useEffect(() => {
    if (!focusProp) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      const field = rootRef.current?.querySelector<HTMLElement>(`[data-prop="${focusProp}"]`);
      const editor = field?.parentElement?.querySelector<HTMLElement>(':scope > .embed-editor_varconnect-editor');
      if (editor) {
        editor.focus();
        editor.ownerDocument.getSelection()?.selectAllChildren(editor);
      } else {
        field?.focus();
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.select();
        }
      }
      setFocusProp(undefined);
    });
    return () => cancelAnimationFrame(raf);
  }, [focusProp, rootRef]);
  return { onSelectSelector };
}

export function useSourceDocument(nativeState: ReturnType<typeof useNativeState>, pendingWrites: ReturnType<typeof usePendingWrites>) {
  const { sourceSelection } = nativeState;
  const { documentByKey } = pendingWrites;

  const sourceDocument = useMemo<EmbedDocument | undefined>(() => {
    if (sourceSelection && documentByKey.has(sourceSelection)) {
      return documentByKey.get(sourceSelection);
    }
    return [...documentByKey.values()].sort((left, right) => left.source.order - right.source.order)[0];
  }, [sourceSelection, documentByKey]);
  const queryUses = useMemo(() => {
    const uses = new Map<string, number>();
    if (!sourceDocument) {
      return uses;
    }
    for (const region of sourceDocument.regions) {
      region.root?.walkAtRules((at) => {
        const name = at.name.toLowerCase();
        if (name !== 'media' && name !== 'supports' && name !== 'container') {
          return;
        }
        const text = queryKey(atRuleQueryText(at));
        uses.set(text, (uses.get(text) ?? 0) + 1);
      });
    }
    return uses;
  }, [sourceDocument]);
  return { queryUses, sourceDocument };
}

export function useRenameQuery(
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  selectionState: ReturnType<typeof useSelectionState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  refreshDerivedHook: ReturnType<typeof useRefreshDerived>,
  selectorPick: ReturnType<typeof useSelectorPick>,
  sourceDocumentHook: ReturnType<typeof useSourceDocument>,
) {
  const { setBusyBoth } = busyState;
  const { setStatus } = scanState;
  const { setContext } = selectionState;
  const { settleEmbedWrite } = pendingWrites;
  const { refreshDerived } = refreshDerivedHook;
  const { setTypedContexts } = selectorPick;
  const { sourceDocument } = sourceDocumentHook;

  const onRenameQuery = (from: string, to: string) => {
    const embedDocument = sourceDocument;
    if (!embedDocument) {
      return;
    }
    const next = asQuery(to);
    if (!splitQuery(next)) {
      setStatus('A query starts with @ — @media, @container or @supports.');
      return;
    }
    if (next === from) {
      return;
    }
    void (async () => {
      setBusyBoth(true);
      setStatus('Renaming query…');
      try {
        let count = 0;
        for (const region of embedDocument.regions) {
          count += renameAtRuleQuery(region, from, next);
        }
        if (!count) {
          setStatus('That query isn’t in this file any more.');
          return;
        }
        await refreshDerived();
        const result = await writeEmbedDocument(embedDocument);
        if (!settleEmbedWrite(embedDocument, result, 'query')) {
          return;
        }
        const swap = (key: ContextKey) => renameQueryInContextKey(key, from, next);
        setTypedContexts((previous) => previous.map(swap));
        setContext((previous) => swap(previous));
        setStatus(count === 1 ? `Renamed to ${next}.` : `Renamed ${count} blocks to ${next}.`);
      } finally {
        setBusyBoth(false);
      }
    })();
  };
  return { onRenameQuery };
}

export function useContextKeys(
  pendingWrites: ReturnType<typeof usePendingWrites>,
  elementTokens: ReturnType<typeof useElementTokens>,
  selectorPick: ReturnType<typeof useSelectorPick>,
  sourceDocumentHook: ReturnType<typeof useSourceDocument>,
) {
  const { documentByKey } = pendingWrites;
  const { model } = elementTokens;
  const { typedContexts } = selectorPick;
  const { sourceDocument } = sourceDocumentHook;

  const allContextKeys = useMemo<ContextKey[]>(() => {
    const keys: ContextKey[] = [''];
    const seen = new Set<ContextKey>(['']);
    const take = (embedDocument: EmbedDocument) => {
      for (const region of embedDocument.regions) {
        for (const block of listAtRuleBlocks(region)) {
          const contextLabel = sourcedContextKey(placedContextKey(block.atContext.join(' › '), block.placement), embedDocument.source.key);
          if (!seen.has(contextLabel)) {
            seen.add(contextLabel);
            keys.push(contextLabel);
          }
        }
      }
    };
    if (model) {
      const matchedDocumentKeys = new Set([...model.base, ...model.conditional].map((matched) => matched.rule.embedKey));
      for (const [key, embedDocument] of documentByKey) {
        if (!matchedDocumentKeys.has(key)) {
          continue;
        }
        take(embedDocument);
      }
    }
    if (sourceDocument) {
      take(sourceDocument);
    }
    const placedListed = new Set(keys.map((key) => splitSourcedKey(key).placed));
    for (const typedContext of typedContexts) {
      if (!seen.has(typedContext) && !placedListed.has(typedContext)) {
        seen.add(typedContext);
        keys.push(typedContext);
      }
    }
    return keys;
  }, [model, documentByKey, typedContexts, sourceDocument]);
  return { allContextKeys };
}

export function useQuerySuggestions(pendingWrites: ReturnType<typeof usePendingWrites>) {
  const { documentByKey } = pendingWrites;

  const querySuggestions = useMemo<QuerySuggestion[]>(() => {
    const seen = new Set<string>();
    const out: QuerySuggestion[] = [];
    const add = (query: string, kind: string) => {
      const norm = query.trim();
      const key = norm.replace(/\s+/g, ' ').toLowerCase();
      if (!norm || seen.has(key)) {
        return;
      }
      seen.add(key);
      out.push({ query: norm, kind });
    };
    for (const embedDocument of documentByKey.values()) {
      for (const region of embedDocument.regions) {
        for (const block of listAtRuleBlocks(region)) {
          for (const part of block.atContext) {
            add(part, 'used');
          }
        }
      }
    }
    for (const common of COMMON_QUERIES) {
      add(common.query, common.kind);
    }
    const bySize = (query: string) => (/@container\b/.test(query) || /\b(width|height)\b/.test(query) ? 0 : 1);
    return out.sort((left, right) => bySize(left.query) - bySize(right.query));
  }, [documentByKey]);
  return { querySuggestions };
}

export function usePseudoRequest(
  typedSelector: ReturnType<typeof useTypedSelector>,
  selectorPick: ReturnType<typeof useSelectorPick>,
  elementTokens: ReturnType<typeof useElementTokens>,
  selectionState: ReturnType<typeof useSelectionState>,
) {
  const { addTypedSelector } = typedSelector;
  const { selectActiveSelector } = selectorPick;
  const { model, snapshot } = elementTokens;
  const { defaultTokensRef, pendingDefaultRef, setSelectedSelectorText, setSelectedTokens } = selectionState;
  const [request, setRequest] = useState(() => getHost().pseudoRequest);
  useEffect(() => onHostChange(() => setRequest(getHost().pseudoRequest)), []);
  const handledRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (request === undefined || handledRef.current === request.serial) {
      return;
    }
    const host = getHost();
    if (host.selectedId !== request.nodeId) {
      return;
    }
    const pick = pseudoPickFor(findNode(host.nodes, request.nodeId), request.pseudo, { snapshot, model });
    if (pick?.kind === 'wait') {
      return;
    }
    handledRef.current = request.serial;
    if (pick?.kind === 'existing') {
      selectActiveSelector(pick.selector);
    } else if (pick?.kind === 'typed') {
      addTypedSelector(pick.input, PLACEMENT_END);
    }
  }, [request, snapshot, model, addTypedSelector, selectActiveSelector]);

  const target = usePseudoTarget();
  const heldTargetRef = useRef(target);
  useEffect(() => {
    const held = heldTargetRef.current;
    heldTargetRef.current = target;
    if (held === undefined) {
      return;
    }
    if (target !== undefined) {
      return;
    }
    assert(held !== target, 'usePseudoRequest: the layer changed');
    setSelectedTokens(defaultTokensRef.current);
    setSelectedSelectorText(undefined);
    pendingDefaultRef.current = true;
  }, [target, defaultTokensRef, pendingDefaultRef, setSelectedSelectorText, setSelectedTokens]);
}
