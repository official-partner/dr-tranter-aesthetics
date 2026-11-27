import { useTranslate } from '../../lib/i18n/useTranslate';
import { PropValuePolicyContext } from './propValuePolicy';
import type { PropValues } from './propRules';
import { isFragmentNode } from '../../editor/liveClasses';
import React, { useRef } from 'react';
import { elementIcon } from '../../ui/Icons';
import { clickNote } from '../../ui/sound';
import { SoundHere } from '../../ui/soundScope';
import { CustomElementIcon, ElementComponentIcon, astroAssetIcon } from '../../ui/Icons';
import { type PropsPanelProps, type ElementPropsPanelProps } from './propsPanelTypes';
import {
  panelDataContext,
  EmptyPanel,
  FrontmatterPanel,
  ExprPanel,
  RawLinePanel,
  MapPanel,
  CondPanel,
  BranchPanel,
  CommentPanel,
  RawPanel,
  TextPanel,
} from './SourcePanels';
import { useElementProps, type ElementState } from './elementState';
import { isTextConnection } from './TextConnectField';
import { ElementContent, ElementLooseText, ElementSchemaFields, ElementExtraFields, ElementSettingsHeader, ElementSettings } from './ElementFields';

export { type PropsPanelProps } from './propsPanelTypes';

export { BindField } from './propBindings';

export default function PropsPanel(props: PropsPanelProps) {
  const stashRef = useRef(new Map<string, PropValues>());
  return <PropValuePolicyContext.Provider value={props.valuePolicy ?? 'instance'}>{renderPropsPanel(props, stashRef)}</PropValuePolicyContext.Provider>;
}
function renderPropsPanel(props: PropsPanelProps, stashRef: React.MutableRefObject<Map<string, PropValues>>) {
  const { node } = props;
  if (!node) {
    return <EmptyPanel {...props} />;
  }
  switch (node.kind) {
    case 'frontmatter':
      return <FrontmatterPanel {...props} node={node} />;
    case 'expr':
      return props.onSetTextPieces !== undefined && isTextConnection(node.value, props.bindContext || props.loopContext) ? (
        <TextPanel {...props} node={{ kind: 'expr', id: node.id, value: node.value }} />
      ) : (
        <ExprPanel {...props} node={node} />
      );
    case 'raw-line':
      return <RawLinePanel {...props} node={node} />;
    case 'map':
      return <MapPanel {...props} node={node} />;
    case 'cond':
      return <CondPanel {...props} node={node} />;
    case 'branch':
      return <BranchPanel {...props} node={node} />;
    case 'comment':
      return <CommentPanel {...props} node={node} />;
    case 'raw':
      return <RawPanel {...props} node={node} />;
    case 'text':
      return <TextPanel {...props} node={{ kind: 'text', id: node.id, value: node.value }} />;
    case 'element':
    case 'component':
    case 'chunk-group':
      return <ElementPropsPanel {...props} node={node} dataContext={panelDataContext(props)} stashRef={stashRef} />;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}
export function InstancePropFields(props: Omit<PropsPanelProps, 'node'> & { readonly node: ElementPropsPanelProps['node'] }) {
  const stashRef = useRef(new Map<string, PropValues>());
  return (
    <PropValuePolicyContext.Provider value={props.valuePolicy ?? 'instance'}>
      <InstancePropFieldsView {...props} dataContext={panelDataContext(props)} stashRef={stashRef} />
    </PropValuePolicyContext.Provider>
  );
}
function InstancePropFieldsView(props: ElementPropsPanelProps) {
  const state = useElementProps(props);
  return (
    <SoundHere>
      <div className="panel-section" ref={state.rootRef}>
        <div className="panel-body" style={{ padding: 0 }}>
          <ElementSchemaFields state={state} />
          <ElementExtraFields state={state} />
        </div>
      </div>
    </SoundHere>
  );
}
function ElementPropsPanel(props: ElementPropsPanelProps) {
  const state = useElementProps(props);
  return <ElementPanelView state={state} />;
}
function ElementPanelView({ state }: { readonly state: ElementState }) {
  const translate = useTranslate();
  const { node, isLayout, currentLayoutName, schema, allowAttrs, extraProps, showContentField, rootRef } = state;

  return (
    <SoundHere>
      <div
        className="panel-section grow"
        ref={rootRef}
        style={{ flex: '1 1 50%', overflow: 'hidden' }}
        onClick={(event) => {
          const button = event.target instanceof Element ? event.target.closest('button') : undefined;
          if (button && !button.disabled) {
            clickNote();
          }
        }}
      >
        <div className="props-title">
          {isFragmentNode(node) ? (
            <CustomElementIcon size={16} className="props-title-icon" />
          ) : node.kind === 'element' ? (
            elementIcon(node.name, 16, 'props-title-icon')
          ) : 'astroAsset' in node && node.astroAsset ? (
            astroAssetIcon(node.name, 16, 'props-title-icon')
          ) : (
            <ElementComponentIcon size={16} className="props-title-icon" />
          )}
          {isLayout ? currentLayoutName || node.name : node.name}
          {isLayout && <span className="badge">layout</span>}
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {}

          <ElementContent state={state} />
          <ElementLooseText state={state} />
          <ElementSchemaFields state={state} />
          <ElementExtraFields state={state} />
          {}
          <ElementSettingsHeader state={state} />
          <ElementSettings state={state} />
          {!isLayout && !allowAttrs && schema.length === 0 && extraProps.length === 0 && !showContentField && (
            <div className="props-empty">{node.kind === 'element' ? translate('props.panel.noAttributes') : translate('props.panel.noProps')}</div>
          )}
        </div>
      </div>
    </SoundHere>
  );
}
