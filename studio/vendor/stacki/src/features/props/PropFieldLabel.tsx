
import { createPortal } from 'react-dom';
import { provenanceResets, usePropFieldExtra } from './propFieldExtras';
import FittedTooltip from '../../ui/FittedTooltip';
import { useDelayedTooltip } from '../../ui/delayedTooltip';
import { useTranslate } from '../../lib/i18n/useTranslate';
import React, { useRef, useState } from 'react';
import { dataPickerPosition } from './dataPickerPosition';
import { ResetMenu } from '../../ui/ResetLabel';
import { valueFromParts } from '../../editor/bindings';
import { BindHandle, FieldDataPicker } from './propBindings';
import PropTip from './PropTip';
import { BracesIcon } from '../../ui/Icons';
import { FieldTypeIcon } from './FieldTypeIcon';
import { controlLabel, type PropState } from './propFieldModel';
import { defaultForConnectedValue, fitOfFieldType, type NewPropSeed } from './newPropModel';
import { fieldTooltip } from '../../editor/propDocumentation';
import { isMediaName } from '../../editor/fieldNames';
import { arrayItems } from './arrayValue';
import { itemShapeOf } from './listItemShape';
import { ConditionalEditor, useConditionCatalog } from './ConditionalValue';
import { startingConditional, valueLanguageOf } from './conditionalModel';
import { CAPTION_LABEL_FOR } from '../../ui/captionLabel';

export const noLabelActivation = (event: React.MouseEvent<HTMLLabelElement>) => event.preventDefault();
export function PropFieldPill({ state }: { readonly state: PropState }) {
  const translate = useTranslate();
  const { name, type, isSet, showExpr, onLabelClick, onLabelContextMenu, required, missingRequired, deprecated } = state;
  const extra = usePropFieldExtra(state.field.name);
  const provenance = extra?.provenance;
  const inherited = provenance?.tone === 'inherited';
  const classes = ['prop-label', ...(inherited ? ['inherited'] : isSet ? ['set'] : []), ...(deprecated === undefined ? [] : ['deprecated'])];
  const ownTitle = isSet ? translate('props.field.overridden') : showExpr ? translate('props.field.clickForOptions') : undefined;
  const resets = provenanceResets(provenance) || extra?.reset !== undefined;

  return (
    <span
      className={classes.join(' ')}
      title={provenance?.tip ?? ownTitle}
      onClick={resets ? onLabelClick : undefined}
      onContextMenu={resets ? onLabelContextMenu : undefined}
    >
      <FieldTypeIcon type={type} name={name} />
      {name}
      {required && (
        <span
          className={`prop-required${missingRequired ? ' missing' : ''}`}
          role="img"
          aria-label={missingRequired ? translate('props.field.requiredNotSet') : translate('props.sections.required')}
          title={missingRequired ? translate('props.field.requiredNeeds') : translate('props.sections.required')}
        />
      )}
    </span>
  );
}

export function PropFieldMenu({ state }: { readonly state: PropState }) {
  const { menuPosition, setMenuPosition, reset, resetRefusal } = state;

  return (
    menuPosition && (
      <ResetMenu
        position={menuPosition}
        onReset={reset}
        unbindLabel=""
        resetDisabledReason={resetRefusal}
        onClose={() => setMenuPosition(undefined)}
      />
    )
  );
}
export function PropFieldLabelRow({ state }: { readonly state: PropState }) {
  const translate = useTranslate();
  const hasExtra = usePropFieldExtra(state.field.name)?.action !== undefined;
  const {
    field,

    setCustom,
    insertAt,
    setInsertAt,
    bindable,
    showExpr,
    reason,
    fromCustom,
    normalBlockedText,
  } = state;
  const pill = <PropFieldPill state={state} />;
  const menu = <PropFieldMenu state={state} />;
  return (
    <label htmlFor={CAPTION_LABEL_FOR} onClick={noLabelActivation}>
      {pill}
      {}
      <PropTip text={fieldTooltip(field.doc, state.deprecated, translate)} />
      {state.deprecated !== undefined && (
        <span
          className="prop-deprecated"
          title={state.deprecated === '' ? translate('props.field.deprecated') : translate('props.field.deprecatedNote', { note: state.deprecated })}
        >
          {translate('props.field.deprecated')}
        </span>
      )}
      {reason && (
        <span className="prop-inert" title={reason}>
          {translate('props.field.ignored')}
        </span>
      )}
      {}
      <PropFieldActions extra={<PropFieldExtraAction name={field.name} />} hasExtra={hasExtra}>
        {bindable && (
          <button
            type="button"
            className={`prop-expr-toggle${showExpr ? ' on' : ''}`}
            title={showExpr ? (normalBlockedText ?? controlLabel(field, translate)) : translate('props.field.writeExpression')}
            aria-disabled={showExpr && normalBlockedText !== undefined}
            aria-pressed={showExpr}
            aria-label={translate('props.field.writeExpression')}
            onClick={() => (showExpr ? fromCustom() : setCustom(true))}
          >
            <BracesIcon size={12} />
          </button>
        )}
      </PropFieldActions>
      {bindable && (
        <BindHandle
          active={!!insertAt}
          onOpen={(host, focus) => {
            if (insertAt) {
              setInsertAt(undefined);
              return;
            }
            const bounds = host?.getBoundingClientRect();
            if (!bounds) {
              return;
            }
            setInsertAt({ ...dataPickerPosition(bounds), focus });
          }}
        />
      )}
      {menu}
    </label>
  );
}
function PropFieldActions({ hasExtra, extra, children }: { readonly hasExtra: boolean; readonly extra: React.ReactNode; readonly children: React.ReactNode }) {
  if (!hasExtra) {
    return children;
  }
  return (
    <span className="prop-field-actions">
      {children}
      {extra}
    </span>
  );
}

function PropFieldExtraAction({ name }: { readonly name: string }) {
  const action = usePropFieldExtra(name)?.action;
  const tip = useDelayedTooltip();
  if (action === undefined) {
    return undefined;
  }
  return (
    <>
      <button
        type="button"
        className={`prop-expr-toggle prop-field-extra${action.pressed ? ' on' : ''}`}
        aria-pressed={action.pressed}
        aria-disabled={action.refused}
        aria-label={action.label}
        onMouseEnter={tip.show}
        onMouseLeave={tip.hide}
        onBlur={tip.hide}
        onClick={(event) => {
          event.preventDefault();
          tip.hide();
          action.onPress();
        }}
      >
        {action.icon}
      </button>
      {tip.value !== undefined &&
        createPortal(
          <FittedTooltip anchor={tip.value} role="tooltip">
            {action.label}
          </FittedTooltip>,
          document.body,
        )}
    </>
  );
}

export function PropFieldPicker({ state }: { readonly state: PropState }) {
  const { field, value, bindContext, onChange, type, setCustom, insertAt, setInsertAt, bindApiRef } = state;
  const [conditional, setConditional] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const catalog = useConditionCatalog(bindContext);
  const seed = seedOf(field, value, importsText(state.dataContext));
  const wordy = seed?.fit === 'text' || seed?.fit === 'content';
  const start = bindContext?.newProp !== undefined && wordy ? startingConditional(value, catalog) : undefined;

  return (
    <>
      {}
      {conditional && <span ref={anchorRef} className="conditional-anchor" />}
      {conditional && start !== undefined && (
        <ConditionalEditor
          anchorRef={anchorRef}
          start={start}
          model={undefined}
          value={value}
          bindContext={bindContext}
          language={valueLanguageOf(type === 'style' ? 'style' : field.name)}
          shapes="rich"
          onApply={(next) => onChange(next, true)}
          onClose={() => setConditional(false)}
        />
      )}
      {insertAt && (
        <FieldDataPicker
          pos={insertAt}
          bindContext={bindContext}
          seed={seed}
          classList={state.classList}
          onBindNew={(path) => {
            setInsertAt(undefined);
            setCustom(true);
            const numeric = !!(type === 'number' || type === 'boolean' || (type === 'enum' && field.numeric));
            onChange(valueFromParts([{ expr: path }], { numeric }), true);
          }}
          onPick={(path) => {
            setInsertAt(undefined);
            if (insertAt.focus.kind === 'focused' && bindApiRef.current?.insert) {
              bindApiRef.current.insert(path);
              return;
            }
            setCustom(true);
            const numeric = !!(type === 'number' || type === 'boolean' || (type === 'enum' && field.numeric));
            onChange(valueFromParts([{ expr: path }], { numeric }), true);
          }}
          onConditional={
            start === undefined
              ? undefined
              : () => {
                  setInsertAt(undefined);
                  setConditional(true);
                }
          }
          onClose={() => setInsertAt(undefined)}
        />
      )}
    </>
  );
}

function importsText(context: PropState['dataContext']): string {
  const imports = context?.imports;
  return typeof imports === 'string' ? imports : (context?.frontmatter ?? '');
}

function seedOf(field: PropState['field'], value: PropState['value'], frontmatter: string): NewPropSeed | undefined {
  const list = field.shapeIsList === true;
  const fit = fitOfFieldType(field.type, { numeric: field.numeric, media: isMediaName(field.name), list });
  if (fit === undefined) {
    return undefined;
  }
  const reference = field.type === 'string' ? 'url' : 'module';
  if (fit === 'list') {
    const items = value?.type === 'expr' && arrayItems(value.value) !== undefined ? value.value : '';
    return { fit, label: field.name, value: items, reference, itemFields: itemShapeOf(field.shape) };
  }
  return { fit, label: field.name, value: defaultForConnectedValue(value, fit, frontmatter), reference };
}
