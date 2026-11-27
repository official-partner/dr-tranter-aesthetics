import { useCodeAccess, ManagedValue } from './CodeAccess';
import React, { useEffect, useRef, useState } from 'react';
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder, Decoration, WidgetType } from '@codemirror/view';
import type { MutableRefObject } from 'react';
import type { DecorationSet, KeyBinding } from '@codemirror/view';
import type { Extension, Range } from '@codemirror/state';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { TemplateHole } from '../editor/bindings';
import { assert } from '../../shared/core/assert';
import { codeIndentExtensions, codeIndentSettings } from './codeEditorIndent';
import { editCodeView, openCodeView, sourceCodeView, type CodeView } from './codeIndentView';
import { codeLineClassifier } from './codeLineRoles';
import { LIMITS } from '../../shared/core/limits';
import { Annotation, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { appTheme, appHighlight } from './CodeEditor';

export type ChipsOf = (text: string) => readonly TemplateHole[] | undefined;
const setChips = StateEffect.define<ChipsOf | undefined>();

const syncedValue = Annotation.define<true>();
const typedHere = (transaction: Transaction): boolean => transaction.docChanged && transaction.annotation(syncedValue) !== true;

const chipMark = Decoration.mark({ class: 'cm-chip' });

class ChipWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }
  override eq(other: ChipWidget) {
    return other.label === this.label;
  }
  override toDOM() {
    const span = document.createElement('span');
    span.className = 'expr-chip';
    span.textContent = this.label;
    return span;
  }
  override ignoreEvent() {
    return false;
  }
}

const chipsOfField = StateField.define<ChipsOf | undefined>({
  create: () => undefined,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setChips)) {
        return effect.value || undefined;
      }
    }
    return value;
  },
});

function chipSets(state: EditorState): {
  readonly deco: DecorationSet;
  readonly atomic: DecorationSet;
} {
  const ranges = state.field(chipsOfField);
  if (!ranges) {
    return { deco: Decoration.none, atomic: Decoration.none };
  }
  const document = state.doc.toString();
  const deco: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const chips = ranges(document) || [];
  assert(chips.length <= LIMITS.treeNodesMax, 'ExprInput: chip limit exceeded');
  for (const range of chips) {
    const { from, to, path } = range;
    if (!(from >= 0 && to > from && to <= document.length)) {
      continue;
    }
    if (document.slice(from, to) === path) {
      deco.push(chipMark.range(from, to));
      continue;
    }
    const replace = Decoration.replace({ widget: new ChipWidget(path) });
    deco.push(replace.range(from, to));
    atomic.push(replace.range(from, to));
  }
  return { deco: Decoration.set(deco, true), atomic: Decoration.set(atomic, true) };
}

const chipField = StateField.define({
  create: (state) => chipSets(state),
  update(value, tr) {
    if (!tr.docChanged && !tr.effects.some((effect) => effect.is(setChips))) {
      return value;
    }
    return chipSets(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (sets) => sets.deco),
});

const chipsAreAtomic = EditorView.atomicRanges.of((view) => view.state.field(chipField).atomic);

const findOne =
  (text: string): ChipsOf =>
  (document) => {
    const at = text ? document.indexOf(text) : -1;
    return at < 0 ? [] : [{ from: at, to: at + text.length, path: text }];
  };

export interface ExprInputAPI {
  readonly replaceRange: (from: number, to: number, text: string) => string | undefined;
  readonly insert: (text: string) => string | undefined;
}
export interface ExprInputProps {
  readonly value?: string | undefined;
  readonly onChange?: ((text: string) => void) | undefined;
  readonly onCommit?: ((text: string) => void) | undefined;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly syncValue?: string | undefined;
  readonly invalid?: boolean;
  readonly multiline?: boolean;
  readonly wrap?: boolean;
  readonly singleLine?: boolean;
  readonly className?: string;
  readonly chip?: string;
  readonly chipsOf?: ChipsOf | undefined;
  readonly onChipClick?: (range: TemplateHole | undefined) => void;
  readonly apiRef?: MutableRefObject<ExprInputAPI | undefined>;
  readonly completions?: readonly Completion[];
  readonly language?: 'html' | 'javascript' | 'typescript';
  readonly syntax?: Extension | undefined;
  readonly extensions?: Extension | undefined;
  readonly ariaLabel?: string;
}
interface ExprRefs {
  readonly latest: MutableRefObject<ExprInputProps>;
  readonly view: MutableRefObject<EditorView | undefined>;
  readonly touched: MutableRefObject<boolean>;
  readonly codeView: MutableRefObject<CodeView>;
}

export default function ExprInput(props: ExprInputProps) {
  return useCodeAccess() ? <EditableExprInput {...props} /> : <ManagedValue />;
}
function EditableExprInput(props: ExprInputProps) {
  const { syncValue, chip = '', chipsOf, invalid, className = '' } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const touched = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const [initial] = useState(() => props);
  const codeView = useRef(exprCodeView(initial, initial.value ?? ''));
  useEffect(() => {
    const parent = hostRef.current;
    assert(parent !== null, 'ExprInput: mounted host exists');
    assert(view.current === undefined, 'ExprInput: only one editor owns the host');
    const editor = exprCreate(parent, initial, { latest, view, touched, codeView });
    view.current = editor;
    if (initial.autoFocus) {
      editor.focus();
    }
    return () => {
      editor.destroy();
      view.current = undefined;
    };
  }, [initial]);
  useExprAPI(props.apiRef, { latest, view, touched, codeView });
  useEffect(() => {
    view.current?.dispatch({ effects: setChips.of(chipsOf || (chip ? findOne(chip) : undefined)) });
  }, [chip, chipsOf, syncValue]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || syncValue === undefined) {
      return;
    }
    if (syncValue !== codeView.current.source) {
      codeView.current = exprCodeView(initial, syncValue);
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: codeView.current.text },
        annotations: [syncedValue.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [initial, syncValue]);
  return <div ref={hostRef} className={`expr-input ${invalid ? 'invalid' : ''} ${className}`} />;
}

function exprCodeView(initial: ExprInputProps, value: string): CodeView {
  const addressed = initial.chipsOf !== undefined || initial.apiRef !== undefined;
  const plain = initial.chip !== undefined || ((!initial.multiline || addressed) && !value.includes('\n'));
  const extent = value.includes('\n') ? 'block' : 'document';
  return plain ? sourceCodeView(value) : openCodeView(value, { extent, classify: codeLineClassifier(initial.language) });
}

function exprCreate(parent: HTMLElement, initial: ExprInputProps, refs: ExprRefs): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: refs.codeView.current.text,
      extensions: [
        history(),
        drawSelection(),
        initial.multiline ? codeIndentExtensions() : codeIndentSettings(),
        keymap.of(exprKeys(initial, refs)),
        initial.syntax ?? (initial.language === 'html' ? html() : javascript({ typescript: initial.language === 'typescript' })),
        ...(initial.ariaLabel === undefined ? [] : [EditorView.contentAttributes.of({ 'aria-label': initial.ariaLabel })]),
        autocompletion({
          override: [(context) => exprCompletionSource(context, refs.latest.current)],
          icons: false,
          defaultKeymap: false,
        }),
        keymap.of(completionKeymap),
        chipsOfField,
        chipField,
        chipsAreAtomic,
        initial.extensions ?? [],
        appTheme,
        appHighlight,
        ...((initial.wrap ?? true) ? [EditorView.lineWrapping] : []),
        cmPlaceholder(initial.placeholder ?? ''),
        exprEvents(refs),
        ...(initial.singleLine === true ? [singleLinePaste] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            if (!update.transactions.some(typedHere)) {
              return;
            }
            const codeViewRef = refs.codeView;
            codeViewRef.current = editCodeView(codeViewRef.current, update.state.doc.toString());
            refs.latest.current.onChange?.(codeViewRef.current.source);
          }
        }),
      ],
    }),
  });
}

const singleLinePaste = EditorView.domEventHandlers({
  paste: (event, view) => {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!/[\r\n]/.test(text)) {
      return false;
    }
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(text.replace(/\s*[\r\n]+\s*/g, ' ')), { userEvent: 'input.paste', scrollIntoView: true });
    return true;
  },
});

function exprKeys(initial: ExprInputProps, refs: ExprRefs): readonly KeyBinding[] {
  if (initial.multiline) {
    return [...defaultKeymap, ...historyKeymap];
  }
  return [
    {
      key: 'Enter',
      run: () => {
        refs.latest.current.onCommit?.(refs.view.current?.state.doc.toString() ?? '');
        return true;
      },
    },
    ...defaultKeymap.filter((binding) => binding.key !== 'Enter'),
    ...historyKeymap,
  ];
}

function exprCompletionSource(context: CompletionContext, props: ExprInputProps) {
  // eslint-disable-next-line stacki/no-null -- CodeMirror reads null as "no completions".
  return exprCompletions(context, props) ?? null;
}

function exprCompletions(context: CompletionContext, props: ExprInputProps) {
  const list = props.completions;
  if (!list?.length) {
    return undefined;
  }
  assert(list.length <= LIMITS.treeNodesMax, 'ExprInput: completion limit exceeded');
  const before = context.matchBefore(/[\w$.]*/);
  if (!before || (before.from === before.to && !context.explicit)) {
    return undefined;
  }
  const dot = before.text.lastIndexOf('.');
  const prefix = dot >= 0 ? before.text.slice(0, dot + 1) : '';
  const options = list
    .filter((entry) => entry.label.startsWith(prefix) && entry.label !== prefix)
    .map((entry) => ({
      label: entry.label.slice(prefix.length),
      ...(entry.detail ? { detail: entry.detail } : {}),
      ...(entry.info ? { info: entry.info } : {}),
      type: entry.type || 'variable',
    }));
  if (!options.length) {
    return undefined;
  }
  return { from: before.from + prefix.length, options, validFor: /^[\w$]*$/ };
}

function chipPosition(view: EditorView, chip: Element): number | undefined {
  try {
    return view.posAtDOM(chip);
  } catch (error: unknown) {
    void error;
    return undefined;
  }
}

function exprEvents(refs: ExprRefs): Extension {
  const touchedRef = refs.touched;
  return EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const ElementType = view.dom.ownerDocument.defaultView?.Element;
      if (!ElementType || !(event.target instanceof ElementType)) {
        return false;
      }
      const chip = event.target.closest('.cm-chip, .expr-chip');
      if (!chip) {
        return false;
      }
      event.preventDefault();
      const position = chipPosition(view, chip) ?? view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
      const ranges = view.state.field(chipsOfField)?.(view.state.doc.toString()) || [];
      assert(ranges.length <= LIMITS.treeNodesMax, 'ExprInput: chip limit exceeded');
      const hit = position === undefined ? undefined : ranges.find((range) => position >= range.from && position <= range.to);
      refs.latest.current.onChipClick?.(hit || undefined);
      return true;
    },
    focus: () => {
      touchedRef.current = true;
      return false;
    },
    blur: () => {
      refs.latest.current.onCommit?.(refs.codeView.current.source);
      return false;
    },
  });
}

function useExprAPI(apiRef: ExprInputProps['apiRef'], refs: ExprRefs): void {
  useEffect(() => {
    if (!apiRef) {
      return;
    }
    apiRef.current = {
      replaceRange: (from, to, text) => (exprReplace(refs.view.current, from, to, text) === undefined ? undefined : refs.codeView.current.source),
      insert: (text) => {
        const view = refs.view.current;
        if (!view) {
          return undefined;
        }
        const end = view.state.doc.length;
        const { from, to } = refs.touched.current ? view.state.selection.main : { from: end, to: end };
        exprReplace(view, from, to, text);
        view.focus();
        return refs.codeView.current.source;
      },
    };
    return () => {
      apiRef.current = undefined;
    };
  });
}

function exprReplace(view: EditorView | undefined, from: number, to: number, text: string): string | undefined {
  if (!view) {
    return undefined;
  }
  assert(Number.isSafeInteger(from), 'ExprInput: range start is an integer');
  assert(Number.isSafeInteger(to), 'ExprInput: range end is an integer');
  assert(from >= 0, 'ExprInput: range starts inside the document');
  assert(to >= from, 'ExprInput: range is ordered');
  assert(to <= view.state.doc.length, 'ExprInput: range ends inside the document');
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  return view.state.doc.toString();
}
