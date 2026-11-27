
import { useTranslate, useTranslateDescribed } from '../../../lib/i18n/useTranslate';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { snapshotTokens } from '../model/elementTokens';
import { groupMemberToSplit } from '../model/resolved';
import type { Declaration } from 'postcss';
import { addDeclaration, appendDecl, directDecls, removeRule, removeRuleIfEmpty, replaceRuleCss, splitRuleSelectorAt } from '../model/css';
import { parseSelectorList } from '../model/selectors';
import { clearPaddingSides, isPaddingProperty, setPaddingDeclaration } from '../model/spacingShorthand';
import { getHost, type ClassOutcome } from '../model/host';
import { liveRules, liveRuleTargetOf, type LiveRulePreview } from '../model/liveRuleEdits';
import type { LiveRuleEdit, LiveRuleTarget } from '../../../../shared/properties/liveRules';
import { selectedComponentMarkup, selectedInstanceClasses } from '../model/webflowElement';
import { type EmbedDocument, navigateToEmbed, writeEmbedDocument } from '../model/webflow';
import type { ParsedDeclaration, ParsedRule } from '../model/styleTypes';
import { declsFor, lastDeclFor, editorSession, withoutClasses } from './editorModel';
import { type SelectorSuggestion } from './LayoutRows';
import { useEditorRefs, useBusyState, useScanState, useNativeState, usePendingWrites } from './useEditorFoundation';
import { useRefreshDerived } from './useEditorScanning';

export function useSplitForEdit(nativeState: ReturnType<typeof useNativeState>) {
  const { activeSelectorRef } = nativeState;

  const isGroupedSplittable = useCallback(
    (rule: ParsedRule): boolean => groupMemberToSplit(rule, activeSelectorRef.current) !== undefined,
    [activeSelectorRef],
  );
  const splitForEdit = useCallback(
    (
      rule: ParsedRule,
    ): {
      rule: ParsedRule;
      remap: (decl: ParsedDeclaration) => ParsedDeclaration;
    } => {
      const identity = { rule, remap: (declaration: ParsedDeclaration) => declaration };
      const index = groupMemberToSplit(rule, activeSelectorRef.current);
      if (index === undefined) {
        return identity;
      }
      const origNodes = directDecls(rule.node);
      const clone = splitRuleSelectorAt(rule.node, index);
      if (!clone) {
        return identity;
      }
      const cloneNodes = directDecls(clone);
      const editRule: ParsedRule = {
        ...rule,
        node: clone,
        selectorText: clone.selector,
        selectors: parseSelectorList(clone.selector),
        declarations: rule.declarations.map((declaration, i) => ({
          ...declaration,
          node: cloneNodes[i] ?? declaration.node,
        })),
      };
      const remap = (decl: ParsedDeclaration): ParsedDeclaration => {
        const i = origNodes.indexOf(decl.node);
        return i >= 0 ? (editRule.declarations[i] ?? decl) : decl;
      };
      return { rule: editRule, remap };
    },
    [activeSelectorRef],
  );
  return { isGroupedSplittable, splitForEdit };
}

export function useApplyEdit(
  busyState: ReturnType<typeof useBusyState>,
  scanState: ReturnType<typeof useScanState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  refreshDerivedHook: ReturnType<typeof useRefreshDerived>,
) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const { setBusyBoth, setSaveError } = busyState;
  const { setStatus } = scanState;
  const { documentByKey, settleEmbedWrite } = pendingWrites;
  const { refreshDerived } = refreshDerivedHook;

  const classGatesRef = useRef(new Map<string, Promise<ClassOutcome>>());

  const passesClassGate = useCallback(
    async (rule: ParsedRule): Promise<boolean> => {
      const gate = classGatesRef.current.get(rule.selectorText);
      if (!gate) {
        return true;
      }
      const outcome = await gate;
      classGatesRef.current.delete(rule.selectorText);
      if (outcome.tag !== 'refused') {
        return true;
      }
      setSaveError(translate('styleModel.embed.hook.classNotOnElement', { selector: rule.selectorText, reason: translateDescribed(outcome) }));
      return false;
    },
    [setSaveError, translate, translateDescribed],
  );

  const applyEdit = useCallback(
    async (rule: ParsedRule, mutate: () => boolean | void): Promise<boolean> => {
      const embedDocument = documentByKey.get(rule.embedKey);
      if (!embedDocument) {
        setStatus('Lost track of the source embed — try Rescan.');
        return false;
      }
      if (!(await passesClassGate(rule))) {
        return false;
      }
      setBusyBoth(true);
      setStatus('Saving…');
      try {
        const result = mutate();
        if (result === false) {
          setStatus('Nothing to save.');
          return false;
        }
        const writeResult = await writeEmbedDocument(embedDocument);
        await refreshDerived();
        if (!settleEmbedWrite(embedDocument, writeResult, 'rule')) {
          return false;
        }
        setStatus(rule.fromComponent ? 'Saved. This embed is shared by every instance of ' + `${rule.componentName ?? 'the component'}.` : 'Saved to embed.');
        return true;
      } finally {
        setBusyBoth(false);
      }
    },
    [documentByKey, passesClassGate, refreshDerived, setBusyBoth, settleEmbedWrite, setStatus],
  );
  const liveTargetOf = useCallback(
    (rule: ParsedRule, prop: string): LiveRuleTarget | undefined => {
      const embedDocument = documentByKey.get(rule.embedKey);
      if (!embedDocument) {
        return undefined;
      }
      return liveRuleTargetOf(rule, embedDocument.source, prop, getHost().projectPath);
    },
    [documentByKey],
  );
  return { applyEdit, classGatesRef, liveTargetOf };
}

export function usePropEdits(splitForEditHook: ReturnType<typeof useSplitForEdit>, applyEditHook: ReturnType<typeof useApplyEdit>) {
  const { isGroupedSplittable, splitForEdit } = splitForEditHook;
  const { applyEdit, liveTargetOf } = applyEditHook;

  const previewEdit = useCallback(
    (rule: ParsedRule, prop: string, edit: LiveRuleEdit): LiveRulePreview | undefined => {
      if (isGroupedSplittable(rule)) {
        return undefined;
      }
      const target = liveTargetOf(rule, prop);
      return target === undefined ? undefined : liveRules.show(target, edit);
    },
    [isGroupedSplittable, liveTargetOf],
  );

  const onSetProp = useCallback(
    (rule: ParsedRule, prop: string, value: string, important: boolean) => {
      const edit: LiveRuleEdit = { kind: 'value', value, important };
      const preview = previewEdit(rule, prop, edit);
      const saving = applyEdit(rule, () => {
        const { rule: editRule } = splitForEdit(rule);
        if (isPaddingProperty(prop)) {
          setPaddingDeclaration(editRule.node, prop, { value, important });
          return;
        }
        const target = lastDeclFor(editRule, prop);
        if (target) {
          target.value = value;
          target.important = important;
          return;
        }
        return addDeclaration(editRule, prop, { value, important });
      });
      settlePreviews(saving, preview === undefined ? [] : [{ preview, edit }]);
      return saving;
    },
    [applyEdit, previewEdit, splitForEdit],
  );
  const onClearProp = useCallback(
    (rule: ParsedRule, prop: string | string[]) => {
      const props = Array.isArray(prop) ? prop : [prop];
      const removed: LiveRuleEdit = { kind: 'removed' };
      const previews = props.filter((name) => !isPaddingProperty(name)).map((name) => previewEdit(rule, name, removed));
      const saving = applyEdit(rule, () => {
        const { rule: editRule } = splitForEdit(rule);
        const clearedPadding = clearPaddingSides(editRule.node, props);
        const targets: Declaration[] = [];
        directDecls(editRule.node).forEach((decl) => {
          if (props.includes(decl.prop)) {
            targets.push(decl);
          }
        });
        if (!targets.length && !clearedPadding) {
          return false;
        }
        targets.forEach((decl) => decl.remove());
        removeRuleIfEmpty(editRule);
        return;
      });
      settlePreviews(
        saving,
        previews.filter((preview) => preview !== undefined).map((preview) => ({ preview, edit: removed })),
      );
      return saving;
    },
    [applyEdit, previewEdit, splitForEdit],
  );
  return { onClearProp, onSetProp };
}

export function useLiveEdits(
  editorRefs: ReturnType<typeof useEditorRefs>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  splitForEditHook: ReturnType<typeof useSplitForEdit>,
) {
  const { inComponentRef } = editorRefs;
  const { documentByKey, markPending } = pendingWrites;
  const { isGroupedSplittable } = splitForEditHook;

  const liveOriginRef = useRef(new Map<string, { value: string; important: boolean } | undefined>());
  const onLiveSetProps = useCallback(
    (
      writes: readonly {
        readonly rule: ParsedRule;
        readonly prop: string;
        readonly value: string;
        readonly important: boolean;
      }[],
    ) => {
      const documents = new Map<EmbedDocument, { preview: LiveRulePreview; edit: LiveRuleEdit }[]>();
      for (const { rule, prop, value, important } of writes) {
        if (isGroupedSplittable(rule)) {
          continue;
        }
        const embedDocument = documentByKey.get(rule.embedKey);
        if (!embedDocument) {
          continue;
        }
        const edit: LiveRuleEdit = { kind: 'value', value, important };
        const target = liveRuleTargetOf(rule, embedDocument.source, prop, getHost().projectPath);
        const previews = documents.get(embedDocument) ?? [];
        if (target !== undefined) {
          previews.push({ preview: liveRules.show(target, edit), edit });
        }
        const matches = declsFor(rule, prop);
        const last = matches[matches.length - 1];
        if (!liveOriginRef.current.has(prop)) {
          liveOriginRef.current.set(prop, last ? { value: last.value, important: !!last.important } : undefined);
        }
        if (last) {
          last.value = value;
          last.important = important;
        } else {
          appendDecl(rule.node, prop, { value, important });
        }
        documents.set(embedDocument, previews);
      }
      for (const [embedDocument, previews] of documents) {
        const saving = writeEmbedDocument(embedDocument, true).then((result) => {
          if (!result.ok && inComponentRef.current && !embedDocument.source.fromComponent) {
            markPending(embedDocument.source.key);
          }
          return result.ok;
        });
        settlePreviews(saving, previews);
      }
    },
    [documentByKey, markPending, isGroupedSplittable, inComponentRef],
  );
  return { liveOriginRef, onLiveSetProps };
}

export function useRuleActions(
  editorRefs: ReturnType<typeof useEditorRefs>,
  busyState: ReturnType<typeof useBusyState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
  splitForEditHook: ReturnType<typeof useSplitForEdit>,
  applyEditHook: ReturnType<typeof useApplyEdit>,
  liveEdits: ReturnType<typeof useLiveEdits>,
) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const { inComponentRef } = editorRefs;
  const { setSaveError } = busyState;
  const { documentByKey, markPending } = pendingWrites;
  const { splitForEdit } = splitForEditHook;
  const { applyEdit } = applyEditHook;
  const { liveOriginRef } = liveEdits;

  const onRevertProp = useCallback(
    (rule: ParsedRule, prop: string) => {
      if (!liveOriginRef.current.has(prop)) {
        return;
      }
      const origin = liveOriginRef.current.get(prop);
      liveOriginRef.current.delete(prop);
      const embedDocument = documentByKey.get(rule.embedKey);
      if (!embedDocument) {
        return;
      }
      const edit: LiveRuleEdit = origin ? { kind: 'value', value: origin.value, important: origin.important } : { kind: 'removed' };
      const liveTarget = liveRuleTargetOf(rule, embedDocument.source, prop, getHost().projectPath);
      const preview = liveTarget === undefined ? undefined : liveRules.show(liveTarget, edit);
      const matches = declsFor(rule, prop);
      const last = matches[matches.length - 1];
      if (origin) {
        if (last) {
          last.value = origin.value;
          last.important = origin.important;
        } else {
          appendDecl(rule.node, prop, { value: origin.value, important: origin.important });
        }
      } else if (last) {
        last.remove();
      }
      const saving = writeEmbedDocument(embedDocument, true).then((result) => {
        if (!result.ok && inComponentRef.current && !embedDocument.source.fromComponent) {
          markPending(embedDocument.source.key);
        }
        return result.ok;
      });
      settlePreviews(saving, preview === undefined ? [] : [{ preview, edit }]);
    },
    [documentByKey, markPending, inComponentRef, liveOriginRef],
  );
  const onRemoveRule = useCallback(
    (rule: ParsedRule) => {
      void applyEdit(rule, () => removeRule(splitForEdit(rule).rule));
    },
    [applyEdit, splitForEdit],
  );
  const onSaveCssRule = useCallback(
    (rule: ParsedRule, css: string) => {
      void applyEdit(rule, () => {
        const result = replaceRuleCss(rule, css);
        if (!result.ok) {
          setSaveError(translate('styleModel.embed.hook.invalidCss', { reason: translateDescribed({ message: result.error, messageRef: result.errorRef }) }));
          return false;
        }
        return true;
      });
    },
    [applyEdit, setSaveError, translate, translateDescribed],
  );
  return { onRemoveRule, onRevertProp, onSaveCssRule };
}

export function useOpenEmbed(
  editorRefs: ReturnType<typeof useEditorRefs>,
  scanState: ReturnType<typeof useScanState>,
  pendingWrites: ReturnType<typeof usePendingWrites>,
) {
  const { pageInstancesRef, selectedElementKeyRef } = editorRefs;
  const { quickSnapshot, scan, setStatus } = scanState;
  const { documentByKey } = pendingWrites;

  const openEmbedByKey = useCallback(
    (embedKey: string) => {
      const embedDocument = documentByKey.get(embedKey);
      if (!embedDocument) {
        setStatus('Lost track of the source embed — try Rescan.');
        return;
      }
      void navigateToEmbed(embedDocument.source, pageInstancesRef.current).then((result) => {
        if (!result.ok) {
          setStatus(`Couldn't open it on the canvas: ${result.error}`);
        }
      });
    },
    [documentByKey, pageInstancesRef, setStatus],
  );

  useEffect(() => {
    const host = getHost();
    if (!host.selectedId || !scan) {
      return;
    }
    editorSession.view = {
      hostId: host.selectedId,
      filePath: host.openFilePath,
      elementKey: selectedElementKeyRef.current,
      scan,
      quick: quickSnapshot,
    };
  }, [scan, quickSnapshot, selectedElementKeyRef]);
  return { openEmbedByKey };
}

export function useElementTokens(scanState: ReturnType<typeof useScanState>) {
  const { quickSnapshot, removedClasses, scan } = scanState;

  const snapshot = useMemo(() => withoutClasses(scan?.rootSnapshot ?? quickSnapshot ?? undefined, removedClasses), [scan, quickSnapshot, removedClasses]);

  const model = scan?.model;
  const tokens = useMemo(() => snapshotTokens(snapshot), [snapshot]);

  const selectorSuggestions = useMemo<SelectorSuggestion[]>(() => {
    const out: SelectorSuggestion[] = [];
    const tagTok = tokens.find((token) => token.kind === 'tag');
    if (tagTok) {
      out.push({ selector: tagTok.label ?? tagTok.name, kind: 'tag' });
    }
    const classNames = tokens.filter((token) => token.kind === 'class').map((token) => token.label ?? token.name.slice('class:'.length));
    for (const cls of classNames) {
      out.push({ selector: `.${cls}`, kind: 'class' });
    }
    const attrNames = tokens.filter((token) => token.kind === 'attribute').map((token) => token.label ?? token.name.slice('attr:'.length));
    for (const name of attrNames) {
      out.push({ selector: `[${name}]`, kind: 'attribute' });
    }
    for (const name of attrNames) {
      const value = snapshot?.attributes?.[name];
      if (value) {
        out.push({ selector: `[${name}="${value}"]`, kind: 'attribute-value' });
      }
    }
    for (let i = 2; i <= classNames.length; i += 1) {
      out.push({
        selector: classNames
          .slice(0, i)
          .map((name) => `.${name}`)
          .join(''),
        kind: 'combo',
      });
    }
    return out;
  }, [tokens, snapshot]);
  const instanceClasses = useMemo(() => selectedInstanceClasses(snapshot?.classList ?? []), [snapshot]);
  const componentMarkup = useMemo(() => (snapshot === undefined ? undefined : selectedComponentMarkup()), [snapshot]);
  return { componentMarkup, instanceClasses, model, scan, selectorSuggestions, snapshot, tokens };
}

function settlePreviews(saving: Promise<boolean>, previews: readonly { readonly preview: LiveRulePreview; readonly edit: LiveRuleEdit }[]): void {
  if (previews.length === 0) {
    void saving;
    return;
  }
  let landed = false;
  void saving
    .then((outcome) => {
      landed = outcome;
    })
    .finally(() => {
      for (const { preview, edit } of previews) {
        if (landed) {
          liveRules.landed(preview, edit);
        } else {
          liveRules.failed(preview);
        }
      }
    });
}
