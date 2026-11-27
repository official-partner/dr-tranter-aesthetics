import { Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { assert } from '../../../../shared/core/assert';
import { codeTypedVariableAt, type CodeTypedVariable, type CodeVariableScope } from '../model/codeVariableScope';


export type CodeVariableCause = 'input' | 'selection';

export type CodeVariableKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Tab' | 'Escape';
const CHOOSER_KEYS: ReadonlyArray<CodeVariableKey> = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'];

export interface CodeVariableHandlers {
  readonly scope: () => CodeVariableScope;
  readonly onView: (view: EditorView | undefined) => void;
  readonly onTyped: (typed: CodeTypedVariable | undefined, cause: CodeVariableCause) => void;
  readonly onKey: (key: CodeVariableKey) => boolean;
}

export function codeVariableExtension(handlersRef: { readonly current: CodeVariableHandlers }): Extension {
  const viewTracker = ViewPlugin.define((view) => {
    handlersRef.current.onView(view);
    return {
      destroy: () => handlersRef.current.onView(undefined),
    };
  });
  const typingListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) {
      return;
    }
    const typedByHand = update.transactions.some((transaction) => transaction.isUserEvent('input') || transaction.isUserEvent('delete'));
    const cause: CodeVariableCause = update.docChanged && typedByHand ? 'input' : 'selection';
    const handlers = handlersRef.current;
    handlers.onTyped(typedAtCaret(update.state.doc.toString(), update.state.selection.main, handlers.scope()), cause);
  });
  const chooserKeys = Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event) => {
        const key = CHOOSER_KEYS.find((candidate) => candidate === event.key);
        if (key === undefined) {
          return false;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (!handlersRef.current.onKey(key)) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    }),
  );
  return [viewTracker, typingListener, chooserKeys];
}

export function typedAtCaret(text: string, selection: { readonly from: number; readonly to: number }, scope: CodeVariableScope): CodeTypedVariable | undefined {
  assert(selection.from <= selection.to, 'typedAtCaret: a selection does not end before it starts');
  assert(selection.to <= text.length, 'typedAtCaret: the selection lies inside the text');
  if (selection.from === selection.to) {
    return codeTypedVariableAt(text, selection.to, scope);
  }
  return undefined;
}

export function completeInView(view: EditorView, typed: CodeTypedVariable, binding: string): void {
  const length = view.state.doc.length;
  assert(typed.typed.end <= length, 'completeInView: the fragment lies inside the document');
  assert(binding.length > 0, 'completeInView: a pick is never empty');
  view.dispatch({
    changes: { from: typed.typed.start, to: typed.typed.end, insert: binding },
    selection: { anchor: typed.typed.start + binding.length },
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  view.focus();
}

export function bindInView(view: EditorView, binding: string): void {
  assert(binding.length > 0, 'bindInView: a pick is never empty');
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: binding },
    selection: { anchor: binding.length },
    userEvent: 'input.complete',
  });
  assert(view.state.doc.toString() === binding, 'bindInView: the value is the binding');
  view.focus();
}
