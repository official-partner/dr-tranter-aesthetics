import { arrayItems, objectFields } from './arrayValue';
import { looksLikeAssetPath } from '../../ui/AssetThumb';
import { type PropFieldProps, usePropField, type PropState, type PropControlState } from './propFieldModel';
import { codeRowKind, isLinkProp, objectSeed } from './propKinds';
import {
  BindingControl,
  StyleControl,
  AttributeControl,
  ClassControl,
  SlotControl,
  EnumControl,
  BooleanControl,
  NumberControl,
  LinkControl,
  MediaControl,
  ImportedAssetControl,
  ObjectControl,
  ListControl,
  ExpressionControl,
  CodeControl,
  ColorControl,
  TextControl,
} from './PropControls';
import { PropFieldPill, PropFieldMenu, PropFieldLabelRow, PropFieldPicker } from './PropFieldLabel';
import { ConditionalField } from './ConditionalValue';
import { conditionalOfAttr, valueLanguageOf } from './conditionalModel';
import { usePropFieldExtra } from './propFieldExtras';
import './propFieldExtras.css';

export { type AssetContext, type PropFieldProps, assetImportOf } from './propFieldModel';

export default function PropField(props: PropFieldProps) {
  const state = usePropField(props);
  const extra = usePropFieldExtra(props.field.name);
  if (state.reason && !state.isSet) {
    return undefined;
  }
  if (extra?.lockedReason === undefined) {
    return <PropFieldControls state={state} />;
  }
  return (
    <div
      className="prop-field-locked"
      aria-disabled="true"
      onKeyDownCapture={(event) => {
        const target = event.target instanceof Element ? event.target : undefined;
        if (event.key !== 'Tab' && target?.closest('.prop-field-extra') === null) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <PropFieldControls state={state} />
    </div>
  );
}
function PropFieldControls({ state }: { readonly state: PropState }) {
  const pill = <PropFieldPill state={state} />;
  const menu = <PropFieldMenu state={state} />;
  const label = (
    <>
      <PropFieldLabelRow state={state} />
      <PropFieldPicker state={state} />
    </>
  );
  const view = { ...state, pill, menu, label };
  return propFieldControl(view);
}
function propFieldControl(view: PropControlState) {
  const { field, value, slotOptions, assetContext, linkContext, name, type, isSet, valueText, assetBinding, showExpr, isExpr, isMediaAttr } = view;
  const codeRow = codeRowKind(field, value);
  if (codeRow === 'action') {
    return <CodeControl state={view} />;
  }
  const conditional = view.custom ? undefined : conditionalOfAttr(value);
  if (conditional !== undefined) {
    return (
      <div className="props-field">
        {view.label}
        <ConditionalField
          model={conditional}
          value={value}
          bindContext={view.bindContext}
          language={valueLanguageOf(type === 'style' ? 'style' : name)}
          onApply={(next) => view.onChange(next, true)}
        />
      </div>
    );
  }
  if (showExpr) {
    return <BindingControl state={view} />;
  }
  if (codeRow === 'code') {
    return <CodeControl state={view} />;
  }
  if (type === 'code' && field.codeKind === 'object') {
    return objectSeed(field, valueText) === undefined ? <CodeControl state={view} /> : <ObjectControl state={view} />;
  }
  if (type === 'style' && (!isSet || value?.type === 'string')) {
    return <StyleControl state={view} />;
  }
  if (type === 'attrs') {
    const control = AttributeControl({ state: view });
    if (control !== undefined) {
      return control;
    }
  }
  if (/class(es)?$/i.test(name) && name !== 'slot' && (type === 'string' || type === 'other') && value?.type !== 'expr') {
    return <ClassControl state={view} />;
  }
  if (name === 'slot' && slotOptions?.length) {
    return <SlotControl state={view} />;
  }
  if (type === 'enum' && field.options?.length) {
    return <EnumControl state={view} />;
  }
  if (type === 'boolean') {
    return <BooleanControl state={view} />;
  }
  if (type === 'number') {
    return <NumberControl state={view} />;
  }
  if (view.isColor && !isExpr) {
    return <ColorControl state={view} />;
  }
  if (isLinkProp(field) && !isExpr && linkContext) {
    return <LinkControl state={view} />;
  }
  if (!isExpr && assetContext?.projectPath && (isMediaAttr || looksLikeAssetPath(valueText))) {
    return <MediaControl state={view} />;
  }
  if (isExpr && assetBinding && assetContext?.projectPath && assetContext?.filePath) {
    return <ImportedAssetControl state={view} />;
  }
  if (type === 'code' && !showExpr && valueText && objectFields(valueText)) {
    return <ObjectControl state={view} />;
  }
  if (type === 'code' && !showExpr && (value === undefined || arrayItems(valueText, 0, 'bindable'))) {
    return <ListControl state={view} />;
  }
  if (isExpr) {
    return <ExpressionControl state={view} />;
  }
  return <TextControl state={view} />;
}
