import { Prec, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { assert } from '../../../../shared/core/assert';
import { codeTypedVariableAt, type CodeTypedVariable } from '../model/codeVariableScope';
import type { ProjectVariable } from '../model/webflow';
import { styleBlocks, type CssChipRange, type CssChipText, type CssValueChip } from './cssValueChips';


export type ChipTypingCause = 'input' | 'selection';

export type ChipTypingKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Tab' | 'Escape';
const CHOOSER_KEYS: ReadonlyArray<ChipTypingKey> = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'];

export interface ChipTypingHandlers {
  readonly text: () => CssChipText | undefined;
  readonly onTyped: (view: EditorView, typed: CodeTypedVariable | undefined, cause: ChipTypingCause) => void;
  readonly onKey: (view: EditorView, key: ChipTypingKey) => boolean;
}

export function chipTypingExtension(handlersRef: { readonly current: ChipTypingHandlers }): Extension {
  const listener = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) {
      return;
    }
    const handlers = handlersRef.current;
    const kind = handlers.text();
    const typedByHand = update.transactions.some((transaction) => transaction.isUserEvent('input.type') || transaction.isUserEvent('delete'));
    const cause: ChipTypingCause = update.docChanged && typedByHand ? 'input' : 'selection';
    const { main } = update.state.selection;
    const typed =
      kind === undefined || update.state.readOnly || main.from !== main.to ? undefined : chipTypedVariableAt(update.state.doc.toString(), kind, main.head);
    handlers.onTyped(update.view, typed, cause);
  });
  const keys = Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        const key = CHOOSER_KEYS.find((candidate) => candidate === event.key);
        if (key === undefined) {
          return false;
        }
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
          return false;
        }
        if (!handlersRef.current.onKey(view, key)) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    }),
  );
  const closer = ViewPlugin.define((view) => ({ destroy: () => handlersRef.current.onTyped(view, undefined, 'input') }));
  return [listener, keys, closer];
}

export function chipTypedVariableAt(text: string, kind: CssChipText, caret: number): CodeTypedVariable | undefined {
  assert(Number.isSafeInteger(caret), 'chipTypedVariableAt: the caret is a whole offset');
  assert(caret >= 0, 'chipTypedVariableAt: the caret is not before the text');
  if (caret > text.length) {
    return undefined;
  }
  const region = kind === 'stylesheet' ? { from: 0, to: text.length } : styleBlocks(text).find((block) => block.from <= caret && caret <= block.to);
  if (region === undefined) {
    return undefined;
  }
  if (insideCommentOrString(text, { from: region.from, to: caret })) {
    return undefined;
  }
  const typed = codeTypedVariableAt(text, caret, { kind: 'declarations' });
  if (typed === undefined) {
    return undefined;
  }
  assert(typed.typed.start <= caret, 'chipTypedVariableAt: the fragment starts before the caret');
  if (typed.typed.start < region.from) {
    return undefined;
  }
  const lineStart = text.lastIndexOf('\n', typed.typed.start - 1) + 1;
  if (text.startsWith('--', typed.typed.start) && text.slice(lineStart, typed.typed.start).trim() === '') {
    return undefined;
  }
  return typed;
}

export function chipTypedCompletion(
  text: string,
  typed: CodeTypedVariable,
  binding: string,
): { readonly from: number; readonly to: number; readonly insert: string; readonly caret: number } {
  const { start, end } = typed.typed;
  assert(start <= end, 'chipTypedCompletion: the fragment keeps its order');
  assert(end <= text.length, 'chipTypedCompletion: the fragment lies in the text');
  assert(binding.length > 0, 'chipTypedCompletion: a pick is never empty');
  const reference = /^var\(/i.test(text.slice(start, end));
  const fallback = reference && /^\s*,/.test(text.slice(end, end + 64)) && binding.endsWith(')');
  const insert = fallback ? binding.slice(0, -1) : binding;
  return { from: start, to: end, insert, caret: start + insert.length };
}

function insideCommentOrString(text: string, range: CssChipRange): boolean {
  assert(range.from <= range.to, 'insideCommentOrString: the range keeps its order');
  let index = range.from;
  for (let step = 0; index < range.to; step++) {
    assert(step <= range.to - range.from, 'insideCommentOrString: the scan moves forward');
    const character = text.charAt(index);
    if (character === '/' && text.charAt(index + 1) === '*') {
      const close = text.indexOf('*/', index + 2);
      if (close < 0 || close + 2 > range.to) {
        return true;
      }
      index = close + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const close = stringEnd(text, index, range.to);
      if (close === undefined) {
        return true;
      }
      index = close;
      continue;
    }
    index += 1;
  }
  return false;
}

function stringEnd(text: string, open: number, limit: number): number | undefined {
  const quote = text.charAt(open);
  for (let index = open + 1; index < limit; index++) {
    const character = text.charAt(index);
    if (character === '\\') {
      index += 1;
    } else if (character === quote || character === '\n') {
      return index + 1;
    }
  }
  return undefined;
}

export interface ChipFollowing<View> {
  readonly view: View;
  readonly typed: CodeTypedVariable;
}

export interface ChipDismissed<View> {
  readonly view: View;
  readonly start: number;
}

export function nextFollowing<View>(
  report: { readonly view: View; readonly typed: CodeTypedVariable | undefined; readonly cause: ChipTypingCause },
  current: ChipFollowing<View> | undefined,
  dismissedRef: { current: ChipDismissed<View> | undefined },
): ChipFollowing<View> | undefined {
  const { view, typed, cause } = report;
  if (typed === undefined) {
    if (dismissedRef.current?.view === view) {
      dismissedRef.current = undefined;
    }
    return current?.view === view ? undefined : current;
  }
  const dismissed = dismissedRef.current;
  if (dismissed !== undefined && dismissed.view === view) {
    if (dismissed.start === typed.typed.start) {
      return undefined;
    }
    dismissedRef.current = undefined;
  }
  if (current === undefined) {
    return cause === 'input' ? { view, typed } : undefined;
  }
  return { view, typed };
}


const REFERENCE_NAME = /^var\(\s*(--[A-Za-z0-9_-]+)/i;
const CUSTOM_PROPERTY = /--[A-Za-z0-9_-]+/;

export function variableNames(variables: readonly ProjectVariable[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const variable of variables) {
    const name = CUSTOM_PROPERTY.exec(variable.binding)?.[0];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

export function variableChipShown(chip: Extract<CssValueChip, { kind: 'variable' }>, names: ReadonlySet<string>, caret: number | undefined): boolean {
  assert(chip.from < chip.to, 'variableChipShown: a reference covers its text');
  assert(chip.value.endsWith(')'), 'variableChipShown: a reference is complete');
  const name = REFERENCE_NAME.exec(chip.value)?.[1];
  if (name === undefined) {
    return false;
  }
  if (!names.has(name)) {
    return false;
  }
  if (caret === undefined) {
    return true;
  }
  return caret <= chip.from || caret >= chip.to;
}
