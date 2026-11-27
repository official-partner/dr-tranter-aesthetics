import { useLayoutEffect, useRef } from 'react';
import { minimalSetup } from 'codemirror';
import { EditorView } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { assert } from '../../shared/core/assert';
import { BOUNDARY_LIMITS } from '../../shared/core/boundary';
import { appHighlight, appTheme } from './CodeEditor';
import { codeIndentExtensions } from './codeEditorIndent';
import { formatHTML } from './richTextModel';
import { useTranslate } from '../lib/i18n/useTranslate';

export function sourceText(value: string): string {
  return value.length <= BOUNDARY_LIMITS.textLengthMax ? formatHTML(value, document) : value;
}

export function HtmlSourceEditor(props: {
  readonly value: string;
  readonly label: string;
  readonly formatCount: number;
  readonly onChange: (value: string) => void;
}) {
  const translate = useTranslate();
  const translateRef = useRef(translate);
  translateRef.current = translate;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const opened = useRef(sourceText(props.value));
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    const parent = hostRef.current;
    assert(parent !== null, 'HTML view: mounted host exists');
    const commit = (view: EditorView): void => {
      const text = view.state.doc.toString();
      if (text !== opened.current && text !== latest.current.value) {
        latest.current.onChange(text);
      }
    };
    const view = new EditorView({
      parent,
      doc: opened.current,
      extensions: [
        minimalSetup,
        codeIndentExtensions(),
        html(),
        appTheme,
        appHighlight,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': translateRef.current('ui.htmlSource.ariaLabel', { label: latest.current.label }) }),
        EditorView.domEventHandlers({ blur: (_event, current) => commit(current) }),
      ],
    });
    viewRef.current = view;
    return () => {
      commit(view);
      view.destroy();
      viewRef.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === undefined || props.formatCount === 0) {
      return;
    }
    const text = view.state.doc.toString();
    const formatted = sourceText(text);
    if (formatted !== text) {
      view.dispatch({ changes: { from: 0, to: text.length, insert: formatted } });
      latest.current.onChange(formatted);
    }
  }, [props.formatCount]);
  return <div ref={hostRef} className="html-source" />;
}
