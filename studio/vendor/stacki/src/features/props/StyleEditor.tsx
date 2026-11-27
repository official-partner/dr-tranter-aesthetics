import { useCodeAccess, ManagedValue } from '../../ui/CodeAccess';
import React, { useEffect, useRef, useState } from 'react';
import { EditorView, keymap, highlightSpecialChars, drawSelection, placeholder as cmPlaceholder } from '@codemirror/view';
import { Annotation, EditorState, Transaction } from '@codemirror/state';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { StreamLanguage, StringStream } from '@codemirror/language';
import type { Tag } from '@lezer/highlight';
import { CODE_TOKEN_RULES, type CodeLine, type CodeToken } from '../../ui/codeHighlight';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';
import { appTheme, appHighlight } from '../../ui/CodeEditor';
import { codeIndentExtensions } from '../../ui/codeEditorIndent';
import { useCssFieldChips } from '../../ui/cssFieldChips';

interface StyleState {
  readonly inValue: boolean;
  readonly depth: number;
}
interface StyleStep extends StyleState {
  readonly style: string | undefined;
}

const DECLARATION_TAGS: Readonly<Record<string, Tag>> = {
  prop: t.propertyName,
  val: t.variableName,
  num: t.number,
  str: t.string,
  fn: t.function(t.variableName),
  punct: t.punctuation,
  important: t.modifier,
  comment: t.comment,
};

const styleMode = StreamLanguage.define<{ inValue: boolean; depth: number }>({
  name: 'css-declarations',
  startState: () => ({ inValue: false, depth: 0 }),
  token(stream, state) {
    const step = styleStep(stream, state);
    // eslint-disable-next-line no-param-reassign -- StreamParser advances its state in place.
    state.inValue = step.inValue;
    // eslint-disable-next-line no-param-reassign -- StreamParser advances its state in place.
    state.depth = step.depth;
    // eslint-disable-next-line stacki/no-null -- StreamParser spells "no style" as null.
    return step.style ?? null;
  },
  tokenTable: DECLARATION_TAGS,
});

export const styleDeclarations = styleMode;

export function declarationTokens(text: string): CodeLine {
  assert(text.length <= LIMITS.attrCharsMax, 'declarationTokens: style value limit exceeded');
  const tokens: CodeToken[] = [];
  const stream = new StringStream(text, 2, 2);
  let state: StyleState = { inValue: false, depth: 0 };
  for (let round = 0; round <= text.length && stream.pos < text.length; round += 1) {
    stream.start = stream.pos;
    const step = styleStep(stream, state);
    assert(stream.pos > stream.start, 'declarationTokens: every token moves forward');
    state = step;
    const tag = step.style === undefined ? undefined : DECLARATION_TAGS[step.style];
    const style = tag === undefined ? undefined : CODE_TOKEN_RULES.find((rule) => tagsOf(rule.tag).includes(tag))?.style;
    tokens.push(style === undefined ? { text: stream.current() } : { text: stream.current(), style });
  }
  assert(tokens.map((token) => token.text).join('') === text, 'declarationTokens: the tokens are the text');
  return tokens;
}

function tagsOf(tag: Tag | readonly Tag[]): readonly Tag[] {
  return isTagList(tag) ? tag : [tag];
}

function isTagList(tag: Tag | readonly Tag[]): tag is readonly Tag[] {
  return Array.isArray(tag);
}

function styleStep(stream: StringStream, state: StyleState): StyleStep {
  const inValue = stream.sol() && state.depth === 0 ? false : state.inValue;
  const depth = state.depth;
  if (stream.eatSpace()) {
    return { style: undefined, inValue, depth };
  }

  const literal = styleLiteral(stream);
  if (literal !== undefined) {
    return { style: literal, inValue, depth };
  }
  const ch = stream.peek();
  if (ch === ':') {
    stream.next();
    return { style: 'punct', inValue: true, depth };
  }
  if (ch === ';') {
    stream.next();
    return { style: 'punct', inValue: false, depth };
  }
  if (/[(),/]/.test(ch ?? '')) {
    stream.next();
    if (ch === '(') {
      return { style: 'punct', inValue, depth: depth + 1 };
    }
    if (ch === ')') {
      return { style: 'punct', inValue, depth: Math.max(0, depth - 1) };
    }
    return { style: 'punct', inValue, depth };
  }
  if (ch === '#') {
    stream.next();
    stream.eatWhile(/[\da-fA-F]/);
    return { style: 'num', inValue, depth };
  }
  if (stream.match(/^[-+]?(\d*\.\d+|\d+)([eE][-+]?\d+)?(%|[a-zA-Z]+)?/)) {
    return { style: 'num', inValue, depth };
  }
  if (stream.match(/^[-\w\\]+/)) {
    if (stream.peek() === '(') {
      return { style: 'fn', inValue, depth };
    }
    return { style: inValue ? 'val' : 'prop', inValue, depth };
  }
  stream.next();
  return { style: undefined, inValue, depth };
}

export function splitDeclarations(text: string): string[] {
  return declarationPieces(text)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

function declarationPieces(text: string): string[] {
  assert(text.length <= LIMITS.attrCharsMax, 'StyleEditor: style value limit exceeded');
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const character = text.charAt(i);
    if (quote) {
      if (character === quote && text[i - 1] !== '\\') {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
    } else if (character === ';' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  assert(out.join(';') === text, 'StyleEditor: the pieces are the text');
  return out;
}

export const expandDeclarations = (value: string | undefined) =>
  splitDeclarations(value || '')
    .map((declaration) => declaration + ';')
    .join('\n');

export const collapseDeclarations = (text: string): string => {
  const declarations = splitDeclarations(text);
  return declarations.join('; ') + (declarations.length ? ';' : '');
};

export function rewriteDeclarations(previous: string, text: string): string {
  const next = splitDeclarations(text);
  const pieces = declarationPieces(previous);
  const written = pieces.filter((piece) => piece.trim() !== '');
  if (next.length === 0 || written.length === 0) {
    return collapseDeclarations(text);
  }
  const same = (at: number, from: number): boolean => written[from]?.trim() === next[at];
  const shared = Math.min(next.length, written.length);
  let head = 0;
  while (head < shared && same(head, head)) {
    head += 1;
  }
  let tail = 0;
  while (tail < shared - head && same(next.length - 1 - tail, written.length - 1 - tail)) {
    tail += 1;
  }
  const lender = (at: number): number | undefined => {
    if (at >= next.length - tail) {
      return written.length - (next.length - at);
    }
    return at < head || at < written.length - tail ? at : undefined;
  };
  const body = next.map((declaration, at) => {
    const from = lender(at);
    const old = from === undefined ? undefined : written[from];
    if (old === undefined) {
      return at === 0 ? declaration : ` ${declaration}`;
    }
    const lead = old.slice(0, old.length - old.trimStart().length);
    const trail = old.slice(old.trimEnd().length);
    return `${at > 0 && from === 0 && lead === '' ? ' ' : lead}${declaration}${trail}`;
  });
  const end = pieces.at(-1) ?? '';
  const closed = pieces.length > 1 && end.trim() === '';
  const result = `${body.join(';')}${closed ? `;${end}` : ''}`;
  assert(splitDeclarations(result).join(';') === next.join(';'), 'StyleEditor: the attribute holds the edited declarations');
  return result;
}

interface StyleEditorProps {
  readonly value?: string | undefined;
  readonly onChange?: (value: string) => void;
  readonly autoFocus?: boolean;
  readonly placeholder?: string;
}

const outsideValue = Annotation.define<true>();

export default function StyleEditor(props: StyleEditorProps) {
  return useCodeAccess() ? <EditableStyleEditor {...props} /> : <ManagedValue />;
}
function EditableStyleEditor({ value, onChange, autoFocus, placeholder = '' }: StyleEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const sourceRef = useRef(value || '');
  const codeChips = useCssFieldChips();
  const chipExtension = codeChips.extension;
  const [initial] = useState(() => ({ text: expandDeclarations(value), placeholder, autoFocus }));

  useEffect(() => {
    const parent = hostRef.current;
    assert(parent !== null, 'StyleEditor: mounted host exists');
    assert(viewRef.current === undefined, 'StyleEditor: only one editor owns the host');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial.text,
        extensions: [
          history(),
          codeIndentExtensions(),
          highlightSpecialChars(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          styleMode,
          chipExtension,
          cmPlaceholder(initial.placeholder),
          appTheme,
          appHighlight,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              if (!update.transactions.some((transaction) => transaction.docChanged && transaction.annotation(outsideValue) !== true)) {
                return;
              }
              sourceRef.current = rewriteDeclarations(sourceRef.current, update.state.doc.toString());
              onChangeRef.current?.(sourceRef.current);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (initial.autoFocus) {
      view.focus();
    }
    return () => {
      viewRef.current = undefined;
      view.destroy();
    };
  }, [initial, chipExtension]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const next = value || '';
    if (collapseDeclarations(view.state.doc.toString()) === collapseDeclarations(next)) {
      sourceRef.current = next;
      return;
    }
    sourceRef.current = next;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: expandDeclarations(next) },
      annotations: [outsideValue.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  return (
    <>
      <div ref={hostRef} className="style-editor" />
      {codeChips.overlay}
    </>
  );
}

function styleLiteral(stream: StringStream): string | undefined {
  if (stream.match('/*')) {
    while (!stream.eol()) {
      if (stream.match('*/')) {
        break;
      }
      stream.next();
    }
    return 'comment';
  }
  if (stream.match(/^!\s*important\b/i)) {
    return 'important';
  }

  const ch = stream.peek();
  if (ch === '"' || ch === "'") {
    stream.next();
    let escaped = false;
    while (!stream.eol()) {
      const character = stream.next();
      if (!escaped && character === ch) {
        break;
      }
      escaped = !escaped && character === '\\';
    }
    return 'str';
  }
  return undefined;
}
