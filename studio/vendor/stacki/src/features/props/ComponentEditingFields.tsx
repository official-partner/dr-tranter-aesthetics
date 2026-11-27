import { useEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { MessageKey } from '../../lib/i18n/localeContext';
import TipAnchor from '../../ui/TipAnchor';
import Popup from '../../ui/Popup';
import HtmlField from '../../ui/HtmlField';
import CodeEditor from '../../ui/CodeEditor';
import { BracesIcon } from '../../ui/Icons';
import type { InlineNode } from './richContentModel';
import { richTextNodes, richTextView, sameRichContent, withoutLayoutSpace, type RichTextCodeReason } from './richTextContent';
import { CAPTION_LABEL_FOR } from '../../ui/captionLabel';
import { ResetLabel } from '../../ui/ResetLabel';
import { provenanceResets, type PropFieldProvenance } from './propFieldExtras';
import './propFieldExtras.css';

export { sameRichContent } from './richTextContent';

const RECENT_WRITES_MAX = 32;

const WRAPPED = [EditorView.lineWrapping];

const CODE_REASON_TIPS: Readonly<Record<RichTextCodeReason, MessageKey>> = {
  expression: 'props.richText.codeExpression',
  component: 'props.richText.codeComponent',
  markup: 'props.richText.codeMarkup',
  size: 'props.richText.codeSize',
};

export function RichTextContentField(props: {
  readonly label: string;
  readonly provenance?: PropFieldProvenance | undefined;
  readonly own?: boolean | undefined;
  readonly onReset?: (() => void) | undefined;
  readonly source: string | undefined;
  readonly shown?: string | undefined;
  readonly onSetNodes?: ((nodes: readonly InlineNode[]) => void) | undefined;
  readonly onSetHTML?: ((html: string) => void) | undefined;
  readonly onSetSource: ((source: string) => void) | undefined;
}) {
  const translate = useTranslate();
  const decision = richTextView(props.shown ?? props.source, document);
  const [chosen, setChosen] = useState<'rich' | 'code'>('rich');
  const [open, setOpen] = useState(false);
  const view = decision.view === 'code' ? 'code' : chosen;
  const tip =
    decision.view === 'code'
      ? translate(CODE_REASON_TIPS[decision.reason])
      : view === 'code'
        ? translate('props.richText.useEditor')
        : translate('props.richText.viewCode');
  return (
    <div className="props-field props-rich-text" key="content">
      {}
      <label htmlFor={CAPTION_LABEL_FOR} onClick={(event) => event.preventDefault()}>
        {props.onReset === undefined ? (
          <span className="prop-label">{props.label}</span>
        ) : (
          <span className={props.provenance?.tone === 'inherited' ? 'prop-label-holder inherited' : 'prop-label-holder'} title={props.provenance?.tip}>
            {provenanceResets(props.provenance) ? (
              <ResetLabel label={props.label} active={props.own === true} onReset={props.onReset} />
            ) : (
              <span className={`prop-label${props.provenance?.tone === 'given' ? ' set' : ''}`}>{props.label}</span>
            )}
          </span>
        )}
        <TipAnchor text={tip}>
          <button
            type="button"
            className={`prop-expr-toggle${view === 'code' ? ' on' : ''}`}
            aria-pressed={view === 'code'}
            aria-disabled={decision.view === 'code'}
            aria-label={translate('props.richText.asCode')}
            onClick={() => {
              if (decision.view === 'rich') {
                setChosen(view === 'code' ? 'rich' : 'code');
              }
            }}
          >
            <BracesIcon size={12} />
          </button>
        </TipAnchor>
      </label>
      {view === 'code' ? (
        <RichTextCode source={props.source ?? ''} onSetSource={props.onSetSource} />
      ) : (
        <button type="button" className="props-rich-text-edit" onClick={() => setOpen(true)}>
          {translate('props.richText.edit')}
        </button>
      )}
      {open && decision.view === 'rich' && (
        <RichTextDialog
          label={props.label}
          html={decision.html}
          onWrite={(html) => {
            props.onSetHTML?.(html);
            props.onSetNodes?.(withoutLayoutSpace(richTextNodes(html, document)));
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function RichTextDialog(props: { readonly label: string; readonly html: string; readonly onWrite: (html: string) => void; readonly onClose: () => void }) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(props.html);
  const written = useRef<readonly string[]>([props.html]);
  useEffect(() => {
    if (!written.current.some((html) => sameRichContent(props.html, html, document))) {
      written.current = [props.html];
      setDraft(props.html);
    }
  }, [props.html]);
  return (
    <Popup className="modal props-rich-text-dialog" label={translate('props.richText.title')} onClose={props.onClose} dismissible={true}>
      {({ close }) => (
        <>
          <div className="modal-header">{props.label}</div>
          <div className="modal-body">
            <HtmlField
              value={draft}
              label={props.label}
              blocks="insert"
              onChange={(html) => {
                written.current = [...written.current.slice(1 - RECENT_WRITES_MAX), html];
                setDraft(html);
                props.onWrite(html);
              }}
            />
          </div>
          {}
          <div className="modal-footer">
            <button type="button" className="primary" onClick={close}>
              {translate('ui.close')}
            </button>
          </div>
        </>
      )}
    </Popup>
  );
}

function RichTextCode(props: { readonly source: string; readonly onSetSource: ((source: string) => void) | undefined }) {
  const [draft, setDraft] = useState(props.source);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) {
      setDraft(props.source);
    }
  }, [props.source]);
  const { onSetSource } = props;
  return (
    <div
      className="props-rich-text-code expr-input"
      onFocus={() => {
        typing.current = true;
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) {
          return;
        }
        typing.current = false;
        if (onSetSource !== undefined && draft !== props.source) {
          onSetSource(draft);
        }
      }}
    >
      {}
      <CodeEditor
        value={draft}
        language="astro"
        chrome="minimal"
        indentation="block"
        extensions={WRAPPED}
        {...(onSetSource === undefined ? {} : { onChange: (text: string) => setDraft(text) })}
      />
    </div>
  );
}
