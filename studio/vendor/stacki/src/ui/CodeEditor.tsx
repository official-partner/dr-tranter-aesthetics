import { useCodeAccess, ManagedValue } from './CodeAccess';
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { basicSetup, EditorView, minimalSetup } from 'codemirror';
import type { MutableRefObject } from 'react';
import { LanguageSupport } from '@codemirror/language';
import { assert } from '../../shared/core/assert';
import { Annotation, EditorState, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, HighlightStyle, indentOnInput, LanguageDescription, StreamLanguage } from '@codemirror/language';
import { search } from '@codemirror/search';
import { astroHighlight } from './astroHighlight';
import { codeIndentExtensions } from './codeEditorIndent';
import { codeSourceOffset, codeViewOffset, editCodeView, openCodeView, sourceCodeView, type CodeExtent, type CodeView } from './codeIndentView';
import { codeLineClassifier } from './codeLineRoles';
import { CODE_TOKEN_RULES } from './codeHighlight';
import { codeStickyScroll } from './codeStickyScroll';
import { tomlLanguage } from './tomlSyntax';


const externalValue = Annotation.define<boolean>();

export const appTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontSize: '11.5px',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'var(--mono)',
      lineHeight: '1.55',
    },
    '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
    '.cm-line': { paddingRight: '16px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused': { outline: 'none' },
    ['&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ' + '.cm-selectionBackground']: { backgroundColor: 'var(--selection)' },
    '.cm-content ::selection': {
      backgroundColor: 'var(--selection)',
      color: 'var(--selection-text)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(0, 153, 255, 0.22)',
      borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(255, 214, 10, 0.16)',
      outline: '1px solid rgba(255, 214, 10, 0.9)',
      outlineOffset: '-1px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-panel)',
      color: 'var(--text-faint)',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--text-dim)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(0, 153, 255, 0.2)',
      outline: 'none',
    },
    '.cm-tooltip': {
      backgroundColor: '#232323',
      border: '1px solid var(--border-strong)',
      borderRadius: '6px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent)',
    },
  },
  { dark: true },
);

const fieldTheme = EditorView.theme({ '.cm-content': { padding: '10px 0' }, '.cm-line': { padding: '0 12px' } });

export const appHighlight = syntaxHighlighting(
  HighlightStyle.define(
    CODE_TOKEN_RULES.map(({ tag, style }) => ({ tag, ...style })),
    { themeType: 'dark' },
  ),
);

export interface CodeEditorProps {
  readonly value?: string | undefined;
  readonly language?: string | undefined;
  readonly indentation?: CodeEditorIndentation | undefined;
  readonly stickyHeaders?: boolean | undefined;
  readonly onChange?: ((text: string, position: number) => void) | undefined;
  readonly revealLine?: number | undefined;
  readonly revealSerial?: number | undefined;
  readonly activeRange?: CodeEditorRange | undefined;
  readonly componentRanges?: readonly CodeEditorComponentRange[] | undefined;
  readonly onPositionChange?: ((position: number) => void) | undefined;
  readonly onOpenComponent?: ((name: string, id: string) => void) | undefined;
  readonly extensions?: Extension | undefined;
  readonly chrome?: 'full' | 'minimal' | undefined;
}

export type CodeEditorIndentation = CodeExtent | 'spaces';

export interface CodeEditorRange {
  readonly from: number;
  readonly to: number;
}

export interface CodeEditorComponentRange extends CodeEditorRange {
  readonly id: string;
  readonly name: string;
}

interface CodeDecorations {
  readonly active: CodeEditorRange | undefined;
  readonly components: readonly CodeEditorComponentRange[];
}

const codeDecorations = StateEffect.define<CodeDecorations>();
const codeDecorationField = StateField.define({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    const changed = transaction.effects.find((effect) => effect.is(codeDecorations));
    return changed ? codeEditorDecorations(transaction.state.doc.length, changed.value) : decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export default function CodeEditor(props: CodeEditorProps) {
  return useCodeAccess() ? <EditableCodeEditor {...props} /> : <ManagedValue />;
}
function EditableCodeEditor(props: CodeEditorProps) {
  const { value, language, indentation, revealLine, revealSerial } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;
  const codeViewRef = useRef<CodeView | undefined>(undefined);
  if (codeViewRef.current?.source !== (value ?? '')) {
    codeViewRef.current = codeViewOf(value ?? '', language, indentation);
  }
  const codeView = codeViewRef.current;
  const activeRange = useShownRange(props.activeRange, codeView);
  const componentRanges = useShownRanges(props.componentRanges, codeView);
  useLayoutEffect(() => {
    const parent = hostRef.current;
    assert(parent !== null, 'CodeEditor: mounted host exists');
    assert(viewRef.current === undefined, 'CodeEditor: only one editor owns the host');
    const view = codeEditorCreate(parent, language, { latest, codeViewRef });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
  }, [language]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const change = externalChange(view.state.doc.toString(), codeView.text);
    if (change !== undefined) {
      view.dispatch({
        changes: change,
        annotations: [externalValue.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [codeView]);
  useCodeDecorations(viewRef, activeRange, componentRanges);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !revealLine) {
      return;
    }
    assert(Number.isSafeInteger(revealLine), 'CodeEditor: reveal line is a safe integer');
    const shownLine = revealLine - (codeViewRef.current?.headLineCount ?? 0);
    const line = view.state.doc.line(Math.max(1, Math.min(shownLine, view.state.doc.lines)));
    const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
    assert(indent <= line.length, 'CodeEditor: the indent is inside its line');
    view.dispatch({
      selection: { anchor: line.from + indent, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }, [revealLine, revealSerial, language]);
  return <div ref={hostRef} className="cm-host" />;
}

export function externalChange(current: string, next: string): { readonly from: number; readonly to: number; readonly insert: string } | undefined {
  if (current === next) {
    return undefined;
  }
  const shorter = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < shorter && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < shorter - prefix && current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) {
    suffix++;
  }
  const change = {
    from: prefix,
    to: current.length - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
  assert(change.from <= change.to, 'The changed region keeps its order');
  assert(current.slice(0, change.from) + change.insert + current.slice(change.to) === next, 'The change turns the document into the value');
  return change;
}

function useCodeDecorations(
  viewRef: MutableRefObject<EditorView | undefined>,
  activeRange: CodeEditorRange | undefined,
  componentRanges: readonly CodeEditorComponentRange[] | undefined,
): void {
  const initialSelectionPending = useRef(true);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: codeDecorations.of({
        active: activeRange ?? undefined,
        components: componentRanges ?? [],
      }),
    });
  }, [activeRange, componentRanges, viewRef]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    const range = codeEditorRangeWithin(activeRange, view?.state.doc.length ?? 0);
    if (!view || !range) {
      return;
    }
    if (!initialSelectionPending.current) {
      view.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: 'nearest' }) });
      return;
    }
    initialSelectionPending.current = false;
    view.requestMeasure({
      read: (editor) => {
        const start = editor.lineBlockAt(range.from);
        const end = editor.lineBlockAt(Math.max(range.from, range.to - 1));
        return selectedCodeScrollTop(start.top, end.top + end.height, editor.scrollDOM.clientHeight);
      },
      write: (top, editor) => {
        if (top !== undefined) {
          const scrollContainer = editor.scrollDOM;
          scrollContainer.scrollTop = top;
        }
      },
    });
  }, [activeRange, viewRef]);
}

export function selectedCodeScrollTop(startTop: number, endBottom: number, viewportHeight: number): number | undefined {
  if (viewportHeight <= 0 || !Number.isFinite(viewportHeight)) {
    return undefined;
  }
  assert(Number.isFinite(startTop), 'Selected code start is finite');
  assert(Number.isFinite(endBottom), 'Selected code end is finite');
  assert(endBottom >= startTop, 'Selected code range keeps its order');
  const offset = endBottom - startTop <= viewportHeight / 2 ? viewportHeight / 2 : 0;
  return Math.max(0, startTop - offset);
}

function codeViewOf(source: string, language: string | undefined, indentation: CodeEditorIndentation | undefined): CodeView {
  if (indentation === 'spaces') {
    return sourceCodeView(source);
  }
  return openCodeView(source, { extent: indentation ?? 'document', classify: codeLineClassifier(language) });
}

function useShownRange(range: CodeEditorRange | undefined, codeView: CodeView): CodeEditorRange | undefined {
  return useMemo(() => (range === undefined ? undefined : shownRange(range, codeView)), [range, codeView]);
}

function useShownRanges(ranges: readonly CodeEditorComponentRange[] | undefined, codeView: CodeView): readonly CodeEditorComponentRange[] | undefined {
  return useMemo(() => ranges?.map((range) => ({ ...range, ...shownRange(range, codeView) })), [ranges, codeView]);
}

function shownRange(range: CodeEditorRange, codeView: CodeView): CodeEditorRange {
  const shown = { from: codeViewOffset(codeView, range.from), to: codeViewOffset(codeView, range.to) };
  assert(shown.from <= shown.to, 'shownRange: the shown range keeps its order');
  return shown;
}

interface CodeEditorRefs {
  readonly latest: MutableRefObject<CodeEditorProps>;
  readonly codeViewRef: MutableRefObject<CodeView | undefined>;
}

function codeEditorCreate(parent: HTMLDivElement, language: string | undefined, refs: CodeEditorRefs): EditorView {
  const { latest, codeViewRef } = refs;
  const opened = codeViewRef.current;
  assert(opened !== undefined, 'codeEditorCreate: the code view opens before the editor');
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opened.text,
      extensions: [
        latest.current.chrome === 'minimal' ? [minimalSetup, indentOnInput(), fieldTheme] : basicSetup,
        codeIndentExtensions(latest.current.indentation === 'spaces' ? 'spaces' : 'tabs'),
        latest.current.chrome === 'minimal' ? [] : search({ top: true }),
        codeEditorLanguage(language),
        appTheme,
        language === 'astro' ? astroHighlight : appHighlight,
        codeDecorationField,
        latest.current.stickyHeaders === true ? codeStickyScroll() : [],
        codeEditorInteractions(refs),
        latest.current.extensions ?? [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            if (!update.transactions.some((transaction) => transaction.annotation(externalValue))) {
              const current = codeViewRef.current;
              assert(current !== undefined, 'CodeEditor: an edit has a code view');
              const next = editCodeView(current, update.state.doc.toString());
              codeViewRef.current = next;
              latest.current.onChange?.(next.source, codeSourceOffset(next, update.state.selection.main.head));
            }
          }
        }),
      ],
    }),
  });
  view.dispatch({
    effects: codeDecorations.of({
      active: latest.current.activeRange ?? undefined,
      components: latest.current.componentRanges ?? [],
    }),
  });
  return view;
}

function codeEditorInteractions(refs: CodeEditorRefs) {
  return EditorView.domEventHandlers({
    click: (event, view) => codeEditorClick(event, view, refs),
    keydown: (event, view) => codeEditorModifier(view, { metaHeld: event.metaKey }),
    keyup: (event, view) => codeEditorModifier(view, { metaHeld: event.metaKey }),
    mousemove: (event, view) => codeEditorModifier(view, { metaHeld: event.metaKey }),
    blur: (_event, view) => codeEditorModifier(view, { metaHeld: false }),
  });
}

function codeEditorClick(event: MouseEvent, view: EditorView, refs: CodeEditorRefs): boolean {
  const { latest, codeViewRef } = refs;
  const shownPosition = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (shownPosition === null) {
    return false;
  }
  const current = codeViewRef.current;
  assert(current !== undefined, 'CodeEditor: a click has a code view');
  const position = codeSourceOffset(current, shownPosition);
  const component = latest.current.componentRanges?.find((range) => range.from <= position && position <= range.to);
  if (event.metaKey && component) {
    event.preventDefault();
    latest.current.onOpenComponent?.(component.name, component.id);
    return true;
  }
  latest.current.onPositionChange?.(position);
  return false;
}

function codeEditorModifier(view: EditorView, { metaHeld }: { readonly metaHeld: boolean }): false {
  view.dom.classList.toggle('cm-meta-held', metaHeld);
  return false;
}

function codeEditorDecorations(length: number, state: CodeDecorations) {
  const ranges = [];
  const active = codeEditorRangeWithin(state.active, length);
  if (active) {
    if (active.from > 0) {
      ranges.push(Decoration.mark({ class: 'cm-code-muted' }).range(0, active.from));
    }
    if (active.to < length) {
      ranges.push(Decoration.mark({ class: 'cm-code-muted' }).range(active.to, length));
    }
  }
  for (const component of state.components) {
    const range = codeEditorRangeWithin(component, length);
    if (range && range.from < range.to) {
      ranges.push(Decoration.mark({ class: 'cm-component-link' }).range(range.from, range.to));
    }
  }
  return Decoration.set(ranges, true);
}

function codeEditorRangeWithin(range: CodeEditorRange | undefined, length: number): CodeEditorRange | undefined {
  if (!range || range.from < 0 || range.to < range.from || range.to > length) {
    return undefined;
  }
  return range;
}

const plainTextLanguage = StreamLanguage.define<undefined>({
  name: 'plaintext',
  startState: () => undefined,
  token: (stream) => {
    stream.skipToEnd();
    // eslint-disable-next-line stacki/no-null -- CodeMirror's stream parser says "no style" with null.
    return null;
  },
});

export function codeEditorLanguage(language: string | undefined): LanguageSupport {
  if (language === 'astro' || language === 'html') {
    return html();
  }
  if (language === 'css') {
    return css();
  }
  if (language === 'toml') {
    return new LanguageSupport(tomlLanguage);
  }
  if (language === 'plaintext') {
    return new LanguageSupport(plainTextLanguage);
  }
  if (language === 'markdown') {
    return markdown({
      base: markdownLanguage,
      codeLanguages: [
        LanguageDescription.of({
          name: 'css',
          extensions: ['css'],
          support: css(),
        }),
        LanguageDescription.of({
          name: 'javascript',
          alias: ['js', 'jsx', 'ts', 'tsx', 'typescript'],
          extensions: ['js', 'ts'],
          support: javascript({ typescript: true, jsx: true }),
        }),
      ],
    });
  }
  return javascript({ typescript: true });
}
