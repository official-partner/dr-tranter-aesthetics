import { useTranslate } from '../../../lib/i18n/useTranslate';
import { useRef, useState } from 'react';
import type { MutableRefObject, ReactNode, RefObject } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { assert } from '../../../../shared/core/assert';
import type { ValueSlot } from '../../../../shared/properties/valueSlot';
import { codeSlotAt, type CodeTypedVariable, type CodeVariableScope } from '../model/codeVariableScope';
import { useSharedVars } from '../sharedVars';
import { rootSwatchScope, SwatchScopeContext } from '../model/computedColor';
import { declaredPropertyAt } from '../model/panelVariableList';
import { usePanelListing } from '../usePanelListing';
import { ConnectDot } from '../VariableConnect';
import { VariablePicker, type PickerNavigation } from '../VariablePicker';
import { bindInView, codeVariableExtension, completeInView, type CodeVariableHandlers, type CodeVariableKey } from './codeVariableExtension';
import '../embedEditor.css';


export interface CodeVariables {
  readonly extension: Extension;
  readonly frameRef: RefObject<HTMLDivElement>;
  readonly overlay: ReactNode;
}

type ChooserState = { readonly kind: 'closed' } | { readonly kind: 'typing'; readonly typed: CodeTypedVariable } | { readonly kind: 'bind' };

const CLOSED: ChooserState = { kind: 'closed' };

export function useCodeVariables(scope: CodeVariableScope, access: { readonly readOnly: boolean }): CodeVariables {
  const translate = useTranslate();
  const frameRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const navigationRef = useRef<PickerNavigation | undefined>(undefined);
  const [chooser, setChooser] = useState<ChooserState>(CLOSED);
  const chooserRef = useRef(chooser);
  chooserRef.current = chooser;
  const readOnlyRef = useRef(access.readOnly);
  readOnlyRef.current = access.readOnly;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const { vars, loading } = useSharedVars({ active: chooser.kind !== 'closed' });
  const customValue = chooser.kind === 'typing' && chooser.typed.prop === undefined && scope.kind === 'declarations';
  const self =
    customValue && chooser.kind === 'typing' && viewRef.current !== undefined
      ? declaredPropertyAt(viewRef.current.state.doc.toString(), chooser.typed.typed.start)
      : undefined;
  const listing = usePanelListing({ active: customValue }, self, vars);
  const handlersRef = useRef<CodeVariableHandlers>(codeVariableHandlers({ scopeRef, viewRef, chooserRef, readOnlyRef, navigationRef, setChooser }));
  const [extension] = useState(() => codeVariableExtension(handlersRef));
  const pickTyped = (binding: string): void => {
    const view = viewRef.current;
    const current = chooserRef.current;
    setChooser(CLOSED);
    if (view === undefined || current.kind !== 'typing') {
      return;
    }
    completeInView(view, current.typed, binding);
  };
  const pickBind = (binding: string): void => {
    const view = viewRef.current;
    setChooser(CLOSED);
    if (view !== undefined) {
      bindInView(view, binding);
    }
  };
  const frame = frameRef.current ?? undefined;
  const overlay = (
    <>
      {scope.kind === 'value' && !access.readOnly ? (
        <ConnectDot
          dotRef={dotRef}
          disabled={false}
          ariaLabel={translate('styleModel.shared.connectVariable', { label: scope.prop })}
          open={chooser.kind === 'bind'}
          onPress={() => undefined}
          onToggle={() => setChooser(chooserRef.current.kind === 'bind' ? CLOSED : { kind: 'bind' })}
        />
      ) : undefined}
      {frame !== undefined && chooser.kind !== 'closed' ? (
        <SwatchScopeContext.Provider value={rootSwatchScope(vars)}>
          <VariablePicker
            anchor={frame}
            vars={listing === undefined ? vars : [...listing.variables]}
            loading={loading}
            {...(listing === undefined ? {} : { panel: { blocks: listing.blocks } })}
            {...pickerProp(scope, chooser)}
            {...pickerSlot(scope, chooser, viewRef.current)}
            {...(chooser.kind === 'typing' ? { typing: { query: chooser.typed.typed.query, navigationRef } } : bindSelection(viewRef.current))}
            onPick={chooser.kind === 'typing' ? pickTyped : pickBind}
            onClose={() => setChooser(CLOSED)}
          />
        </SwatchScopeContext.Provider>
      ) : undefined}
    </>
  );
  return { extension, frameRef, overlay };
}

function codeVariableHandlers({
  scopeRef,
  viewRef,
  chooserRef,
  readOnlyRef,
  navigationRef,
  setChooser,
}: {
  readonly scopeRef: { readonly current: CodeVariableScope };
  readonly viewRef: MutableRefObject<EditorView | undefined>;
  readonly chooserRef: { readonly current: ChooserState };
  readonly readOnlyRef: { readonly current: boolean };
  readonly navigationRef: { readonly current: PickerNavigation | undefined };
  readonly setChooser: (next: ChooserState) => void;
}): CodeVariableHandlers {
  return {
    scope: () => scopeRef.current,
    onView: (view) => {
      viewRef.current = view;
    },
    onTyped: (typed, cause) => {
      const current = chooserRef.current;
      if (current.kind === 'bind') {
        return;
      }
      if (cause === 'selection' && current.kind === 'closed') {
        return;
      }
      if (typed === undefined || readOnlyRef.current) {
        if (current.kind !== 'closed') {
          setChooser(CLOSED);
        }
        return;
      }
      setChooser({ kind: 'typing', typed });
    },
    onKey: (key) => chooserKey(key, chooserRef.current, navigationRef.current, () => setChooser(CLOSED)),
  };
}

function chooserKey(key: CodeVariableKey, chooser: ChooserState, navigation: PickerNavigation | undefined, dismiss: () => void): boolean {
  if (chooser.kind !== 'typing') {
    return false;
  }
  if (navigation === undefined) {
    return false;
  }
  switch (key) {
    case 'ArrowDown':
      navigation.move(1);
      return true;
    case 'ArrowUp':
      navigation.move(-1);
      return true;
    case 'Enter':
    case 'Tab':
      if (navigation.pick()) {
        return true;
      }
      dismiss();
      return false;
    case 'Escape':
      dismiss();
      return true;
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

function pickerProp(scope: CodeVariableScope, chooser: ChooserState): { readonly prop?: string } {
  assert(chooser.kind !== 'closed', 'pickerProp: only an open chooser filters');
  if (chooser.kind === 'typing') {
    return chooser.typed.prop === undefined ? {} : { prop: chooser.typed.prop };
  }
  return scope.kind === 'value' ? { prop: scope.prop } : {};
}

function bindSelection(view: EditorView | undefined): { readonly selectedBinding?: string } {
  const text = view?.state.doc.toString().trim() ?? '';
  return /^var\(\s*--[A-Za-z0-9_-]+[^)]*\)$/i.test(text) ? { selectedBinding: text } : {};
}

function pickerSlot(scope: CodeVariableScope, chooser: ChooserState, view: EditorView | undefined): { readonly slot?: ValueSlot } {
  if (chooser.kind !== 'typing' || view === undefined) {
    return {};
  }
  const slot = codeSlotAt(view.state.doc.toString(), chooser.typed, scope);
  return slot === undefined ? {} : { slot };
}
