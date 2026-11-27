
import { useMemo, useRef, useState } from 'react';
import type { ComponentProperty } from '../../../shared/properties/propertyEditing';
import type { Attr } from '../../../shared/page/pageNode';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { CodeInline } from '../../ui/CodeBlock';
import { BranchIcon } from '../../ui/Icons';
import type { ValueChoice } from './ValueChoices';
import { emitConditionalExpression, readConditionalExpression, type ConditionalValue } from '../../editor/conditionalValue';
import { ConditionalEditor } from './ConditionalValue';
import { draftOf, newGroup, resultOfAttr, resultWords, conditionProps } from './conditionalModel';
import { conditionSchema } from './conditionalDefault';
import type { RichContext } from './RichContent';
import './conditionalValue.css';

const SUMMARY_VALUES_MAX = 6;

export function useDefaultConditionContext(frontmatter: string, properties: readonly ComponentProperty[]): RichContext {
  return useMemo(() => ({ frontmatter, propsSchema: conditionSchema(properties) }), [frontmatter, properties]);
}

export function ConditionalDefaultField(props: {
  readonly model: ConditionalValue;
  readonly context: RichContext;
  readonly quote: '"' | "'";
  readonly start?: ConditionalValue | undefined;
  readonly onStarted?: (() => void) | undefined;
  readonly onApply: (model: ConditionalValue) => void;
  readonly valueChoices?: readonly ValueChoice[] | undefined;
  readonly summary?: string | undefined;
  readonly title?: string | undefined;
  readonly readonlyWord?: string | undefined;
}) {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const value: Attr = { type: 'expr', value: emitConditionalExpression(props.model, { quote: props.quote }) };
  const words = [
    ...new Set([...props.model.groups.map((group) => group.value), props.model.otherwise].filter((result) => result.kind !== 'none').map(resultWords)),
  ];
  const summary = props.summary ?? words.slice(0, SUMMARY_VALUES_MAX).join(', ') + (words.length > SUMMARY_VALUES_MAX ? '…' : '');
  const showing = props.readonlyWord === undefined && (open || props.start !== undefined);
  return (
    <div className="conditional-default" ref={anchorRef}>
      <button
        type="button"
        className="conditional-chip conditional-default-chip"
        aria-haspopup="dialog"
        aria-expanded={showing}
        title={summary === '' ? translate('props.conditional.edit') : summary}
        disabled={props.readonlyWord !== undefined}
        onClick={() => setOpen(!open)}
      >
        <BranchIcon size={11} />
        <span className="conditional-default-word">{props.readonlyWord ?? translate('props.conditional.chip')}</span>
        {summary !== '' && <span className="conditional-default-summary">{summary}</span>}
      </button>
      {showing && (
        <ConditionalEditor
          anchorRef={anchorRef}
          start={props.start === undefined ? undefined : draftOf(props.start)}
          model={props.model}
          value={value}
          bindContext={props.context}
          language="text"
          valueChoices={props.valueChoices}
          title={props.title}
          onApply={(next) => props.onApply(modelOfAttr(next))}
          onClose={() => {
            setOpen(false);
            props.onStarted?.();
          }}
        />
      )}
    </div>
  );
}

export function ConditionalDefaultStart(props: {
  readonly defaultResult: Attr | undefined;
  readonly context: RichContext;
  readonly start?: ConditionalValue | undefined;
  readonly onApply: (model: ConditionalValue) => void;
  readonly onClose: () => void;
  readonly valueChoices?: readonly ValueChoice[] | undefined;
  readonly title?: string | undefined;
  readonly firstValue?: ConditionalValue['otherwise'] | undefined;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const catalog = useMemo(() => conditionProps(props.context.frontmatter ?? '', props.context.propsSchema ?? []), [props.context]);
  const otherwise = resultOfAttr(props.defaultResult) ?? { kind: 'none', word: 'undefined' };
  const fresh = newGroup([...catalog.filter((prop) => prop.kind === 'option'), ...catalog.filter((prop) => prop.kind !== 'option')]);
  const first = props.firstValue === undefined ? fresh : { ...fresh, value: props.firstValue };
  return (
    <>
      <span ref={anchorRef} className="conditional-anchor" />
      <ConditionalEditor
        anchorRef={anchorRef}
        start={props.start === undefined ? { groups: [first], otherwise } : draftOf({ ...props.start, otherwise })}
        model={undefined}
        value={props.defaultResult}
        bindContext={props.context}
        language="text"
        valueChoices={props.valueChoices}
        title={props.title}
        onApply={(next) => props.onApply(modelOfAttr(next))}
        onClose={props.onClose}
      />
    </>
  );
}

export function ComputedDefault({ code }: { readonly code: string }) {
  const translate = useTranslate();
  return (
    <div className="conditional-computed" role="group" aria-label={translate('componentProps.defaults.computed')}>
      <span className="conditional-badge">{translate('componentProps.defaults.computed')}</span>
      <CodeInline text={code} language="typescript" className="conditional-computed-code" />
    </div>
  );
}

function modelOfAttr(attr: Attr | undefined): ConditionalValue {
  if (attr?.type === 'expr') {
    const chain = readConditionalExpression(attr.value);
    if (chain !== undefined) {
      return chain;
    }
  }
  return { groups: [], otherwise: resultOfAttr(attr) ?? { kind: 'none', word: 'undefined' } };
}
