
import type { Attr, ValueNode } from '../../../shared/page/pageNode';
import type { FieldDefinition, PropValues } from './propRules';
import type { SetProp } from './propAttributes';
import type { FieldPickerAt } from './propBindings';
import type { RichInsertAPI } from './RichContent';
import type { AssetDimensions } from '../../ui/AssetThumb';
import type { AltPick, AssetReference, PickedAsset } from '../../ui/AssetField';
import { createPropRules } from './propRules';
import { visibleAttributeNames } from '../../../shared/core/internalAttributes';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { VOID_TAGS } from '../../editor/elementSchemas';

const NO_TEXT_TAGS: ReadonlySet<string> = new Set(['html', 'head']);
import { isInlineOnly } from './RichContent';
import { type ElementPropsPanelProps } from './propsPanelTypes';
import { sourceKind, useSourceDimensions } from './SourcePanels';
import { useLayoutMetadata } from './useLayoutMetadata';
import { useLayoutText } from './useLayoutText';

const SETTINGS_GROUP_OPEN_KEY = 'stacki.props.settingsOpen';
export let settingsGroupOpen = readSettingsGroupOpen();

function readSettingsGroupOpen(): boolean {
  try {
    return localStorage.getItem(SETTINGS_GROUP_OPEN_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function storeSettingsGroupOpen(state: { readonly open: boolean }): void {
  try {
    localStorage.setItem(SETTINGS_GROUP_OPEN_KEY, state.open ? 'open' : 'closed');
  } catch {
  }
}

export function useElementProps(props: ElementPropsPanelProps) {
  const schema = props.schema ?? [];
  const layouts = props.layouts ?? [];
  assert(schema.length <= LIMITS.propSchemaFieldsMax, 'PropsPanel: schema limit exceeded');
  assert(Object.keys(props.node.props ?? {}).length <= LIMITS.attrsPerNodeMax, 'PropsPanel: attribute limit exceeded');
  assert(layouts.length <= LIMITS.scanEntriesMax, 'PropsPanel: layout limit exceeded');
  const layout = elementFieldLayout(props);
  const assets = useElementAssets(props);
  const rules = elementRules(props);
  const focus = useElementFocus(props);
  const settings = elementSettings(props, layout, rules.appliesNow);
  const dimensions = elementDimensionAction(props);
  const layoutMetadata = useLayoutMetadata(props);
  const layoutText = useLayoutText(props);
  const assetContext = {
    projectPath: props.projectPath,
    filePath: props.filePath,
    nodeName: props.node.name,
    layoutImage: layoutMetadata?.image,
    layoutType: layoutMetadata?.type,
    layoutText,
    onPickDimensions: dimensions.onPickDimensions,
    srcDims: assets.sourceDimensions,
    onSrcDimensions: assets.setSourceDimensions,
    siblingProps: props.node.props,
    srcKind: assets.sourceKind,
    nodeId: props.node.id,
    onPickWithAlt: altPickWriter(props, schema),
    onPickAsset: props.onSetAssetProp
      ? (name: string, picked: PickedAsset) => props.onSetAssetProp?.(props.node.id, name, picked, assetReferenceFor(props.node.kind, schema, name))
      : undefined,
  };
  return {
    ...props,
    schema,
    layouts,
    ...layout,
    ...assets,
    ...rules,
    ...focus,
    ...settings,
    ...dimensions,
    assetContext,
  };
}
export type ElementState = ReturnType<typeof useElementProps>;

export function assetReferenceFor(kind: ElementPropsPanelProps['node']['kind'], schema: readonly FieldDefinition[], name: string): AssetReference {
  if (kind === 'element') {
    return 'url';
  }
  const field = schema.find((candidate) => candidate.name === name);
  if (field === undefined) {
    return 'module';
  }
  return field.type === 'string' ? 'url' : 'module';
}

export function elementFieldLayout(props: ElementPropsPanelProps) {
  const { node, schema = [], slotOptions, takesSlotText, allowAttrs } = props;
  assert((node.children?.length ?? 0) <= LIMITS.treeNodesMax, 'PropsPanel: child limit exceeded');
  const schemaNames = new Set(schema.map((entry) => entry.name));
  const allowsFreeformAttrs = allowAttrs || node.name === 'Fragment';

  const showSlotField = Array.isArray(slotOptions) && slotOptions.some((slot) => slot !== 'default') && !schemaNames.has('slot');
  let extraProps = visibleAttributeNames(Object.keys(node.props || {})).filter((key) => !schemaNames.has(key) && !(showSlotField && key === 'slot'));
  let attrNames: string[] = [];
  if (allowsFreeformAttrs) {
    attrNames = extraProps.filter((key) => key !== 'class' && key !== 'style' && key !== 'slot');
    extraProps = extraProps.filter((key) => key === 'class' || key === 'slot').sort((left, right) => (left === 'slot' ? 1 : right === 'slot' ? -1 : 0));
  }

  const isEmpty = node.children === undefined || node.children.length === 0;
  const canHoldText =
    (node.kind === 'element' && !VOID_TAGS.has(String(node.name).toLowerCase()) && !NO_TEXT_TAGS.has(String(node.name).toLowerCase())) || !!takesSlotText;
  const showContentField = isInlineOnly(node.children) || (isEmpty && canHoldText);
  const looseText = !isEmpty && (node.children || []).find((child): child is ValueNode => child.kind === 'text');
  const showLooseTextField = !showContentField && canHoldText && !isEmpty;
  const isSlot = node.kind === 'element' && node.name === 'slot';


  return {
    allowAttrs: allowsFreeformAttrs,
    showSlotField,
    extraProps,
    attrNames,
    showContentField,
    showLooseTextField,
    looseText,
    isSlot,
  };
}

export function useElementAssets(props: ElementPropsPanelProps) {
  const { node, projectPath, filePath, dataContext } = props;
  const dimensionsKey = `${filePath ?? ''}\u0000${node.id}`;
  const [dimensions, setDimensions] = useState<{ readonly key: string; readonly value: AssetDimensions | undefined }>({ key: dimensionsKey, value: undefined });
  const sourceDimensions = dimensions.key === dimensionsKey ? dimensions.value : undefined;
  const setSourceDimensions = useCallback((value: AssetDimensions) => setDimensions({ key: dimensionsKey, value }), [dimensionsKey]);

  const source = node.props?.['src'];
  const kind = sourceKind(source, dataContext.imports);
  useSourceDimensions({
    source,
    projectPath,
    filePath,
    imports: dataContext.imports,
    setSourceDimensions,
  });

  return { sourceDimensions, setSourceDimensions, sourceKind: kind };
}

export function elementRules(props: ElementPropsPanelProps) {
  const { node, schema = [], onSetProp, onSetProps, stashRef } = props;
  const { appliesNow, branchDefault, narrowOptions, cascade } = createPropRules(schema, node.props || {});
  const setPropCascading: SetProp = (fieldName, value, immediate) => {
    const held = stashRef.current.get(node.id);
    if (!held) {
      assert(stashRef.current.size < LIMITS.treeNodesMax, 'PropsPanel: stash node limit exceeded');
    }
    const { patch, stash } = cascade({ fieldName, value, stash: held || {} });
    stashRef.current.set(node.id, stash);
    if (Object.keys(patch).length === 1 || !onSetProps) {
      onSetProp(fieldName, value, immediate);
      return;
    }
    onSetProps(node.id, patch);
  };
  return { appliesNow, branchDefault, narrowOptions, setPropCascading };
}
export function useElementFocus(props: ElementPropsPanelProps) {
  const { focusClass, focusContent } = props;
  const [contentPicker, setContentPicker] = useState<FieldPickerAt | undefined>(undefined);
  const contentInsertRef = useRef<RichInsertAPI | undefined>(undefined);

  const [settingsOpen, setSettingsOpenState] = useState(settingsGroupOpen);
  const setSettingsOpen = (next: React.SetStateAction<boolean>) => {
    settingsGroupOpen = typeof next === 'function' ? next(settingsGroupOpen) : next;
    storeSettingsGroupOpen({ open: settingsGroupOpen });
    setSettingsOpenState(settingsGroupOpen);
  };

  const [wantClassFocus, setWantClassFocus] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusClass) {
      return;
    }
    setSettingsOpen(true);
    setWantClassFocus(true);
  }, [focusClass]);
  useEffect(() => {
    if (!wantClassFocus || !settingsOpen) {
      return;
    }
    setWantClassFocus(false);
    const input = rootRef.current?.querySelector<HTMLElement>('.class-input-field');
    if (!input) {
      return;
    }
    input.focus();
    input.closest('.props-field')?.scrollIntoView({ block: 'nearest' });
  }, [wantClassFocus, settingsOpen]);

  useEffect(() => {
    if (!focusContent) {
      return;
    }
    const field = rootRef.current?.querySelector<HTMLElement>('.rich-content');
    if (!field) {
      return;
    }
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    field.closest('.props-field')?.scrollIntoView({ block: 'nearest' });
  }, [focusContent]);

  return {
    contentPicker,
    setContentPicker,
    contentInsertRef,
    settingsOpen,
    setSettingsOpen,
    rootRef,
  };
}

export function elementSettings(
  props: ElementPropsPanelProps,
  layout: ReturnType<typeof elementFieldLayout>,
  appliesNow: ReturnType<typeof createPropRules>['appliesNow'],
) {
  const { node, isLayout, layouts = [], onChangeLayout, schema = [], allowAttrs, comment, onSetComment, onChangeTag } = props;
  const { isSlot, showSlotField, attrNames } = layout;
  const classField: FieldDefinition | undefined =
    schema.find((field) => field.name === 'class' && appliesNow(field)) ||
    (node.props?.['class'] !== undefined ? { name: 'class', type: 'string' } : undefined);
  const styleField: FieldDefinition | undefined =
    allowAttrs || props.offersStyle === true || node.props?.['style'] !== undefined
      ? { ...(schema.find((field) => field.name === 'style') || {}), name: 'style', type: 'style' }
      : undefined;
  const layoutTag = isLayout && !!onChangeLayout && layouts.length > 0;
  const changeToLayout = (name: string) => {
    if (!layouts.some((layout) => layout.name === name)) {
      return false;
    }
    onChangeLayout?.(name);
    return true;
  };
  const showTagField = !isSlot && (layoutTag || (!!onChangeTag && !isLayout && (node.kind === 'element' || node.kind === 'component')));
  const hasSettings =
    showTagField || !!classField || !!styleField || allowAttrs || showSlotField || !!(onSetComment && (node.kind === 'element' || node.kind === 'component'));
  const settingsCount =
    (node.props?.['class'] !== undefined ? 1 : 0) +
    (node.props?.['style'] !== undefined ? 1 : 0) +
    attrNames.length +
    (comment ? 1 : 0) +
    (node.props?.['slot'] !== undefined ? 1 : 0);
  return {
    classField,
    styleField,
    layoutTag,
    changeToLayout,
    showTagField,
    hasSettings,
    settingsCount,
  };
}
export function altPickWriter(
  props: ElementPropsPanelProps,
  schema: readonly FieldDefinition[],
): ((name: string, pick: AltPick, alt: string) => void) | undefined {
  const { node, onSetProps, onSetAssetProp } = props;
  if (onSetProps === undefined) {
    return undefined;
  }
  if (node.name !== 'img') {
    if (!schema.some((field) => field.name === 'alt')) {
      return undefined;
    }
  }
  return (name, pick, alt) => {
    assert(name !== 'alt', 'The alt is written beside the picked field, not as it');
    const altProps: PropValues = { alt: { type: 'string', value: alt } };
    switch (pick.kind) {
      case 'value':
        onSetProps(node.id, { [name]: { type: 'string', value: pick.value }, ...altProps });
        return;
      case 'entry':
        assert(onSetAssetProp !== undefined, 'A picked project file has an asset write');
        onSetAssetProp(node.id, name, pick.entry, assetReferenceFor(node.kind, schema, name), altProps);
        return;
      default: {
        const exhaustive: never = pick;
        return exhaustive;
      }
    }
  };
}

export function elementDimensionAction(props: ElementPropsPanelProps) {
  const { node, schema = [], onSetProps } = props;
  const onPickDimensions = (fieldName: string, dims: AssetDimensions) => {
    if (!onSetProps || !node || !dims?.w || !dims?.h) {
      return;
    }
    if (!/^(src|poster)$/i.test(fieldName)) {
      return;
    }
    const takes = (propName: string) => (schema || []).some((field) => field.name === propName);
    const patch: Record<string, Attr> = {};
    if (takes('width')) {
      patch['width'] = { type: 'expr', value: String(dims.w) };
    }
    if (takes('height')) {
      patch['height'] = { type: 'expr', value: String(dims.h) };
    }
    if (Object.keys(patch).length) {
      onSetProps(node.id, patch);
    }
  };

  return { onPickDimensions };
}
