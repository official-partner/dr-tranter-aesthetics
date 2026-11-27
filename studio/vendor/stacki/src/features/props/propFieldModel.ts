
import { PropValuePolicyContext } from './propValuePolicy';
import { usePropFieldExtra } from './propFieldExtras';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import React, { useContext, useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import type { Attr } from '../../../shared/page/pageNode';
import type { PageText } from '../../../shared/properties/pageText';
import type { FieldDefinition, PropValues } from './propRules';
import type { RichContext } from './RichContent';
import type { ClassListOffer } from './classListProp';
import type { SourceContext, ValueChange, FieldPosition, FieldPickerAt, InsertAPI } from './propBindings';
import type { AssetDimensions } from '../../ui/AssetThumb';
import type { AltPick, PickedAsset } from '../../ui/AssetField';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { findImportOf } from '../../editor/dataSuggest';
import { isHrefName, isMediaName } from '../../editor/fieldNames';
import { arrayItems, objectFields } from './arrayValue';
import { optionAttr } from './propKinds';
import { decideNormalField, planReset, type ResetPlan } from './normalFieldDecision';
import { reportBindingRemoved } from './codeCleared';
import { deprecationOf, readPropDocumentation } from '../../editor/propDocumentation';
import LinkField from './LinkField';
import { plainTextOf, textValue } from './propLiteral';

export interface AssetContext {
  readonly layoutText?: PageText | undefined;
  readonly layoutImage?: string | undefined;
  readonly layoutType?: string | undefined;
  readonly projectPath?: string | undefined;
  readonly filePath?: string | undefined;
  readonly nodeName?: string | undefined;
  readonly srcDims?: AssetDimensions | undefined;
  readonly siblingProps?: PropValues | undefined;
  readonly srcKind?: 'svg' | 'public' | 'asset' | 'remote' | undefined;
  readonly onPickAsset?: ((name: string, picked: PickedAsset) => void) | false | undefined;
  readonly onPickDimensions?: ((name: string, dimensions: AssetDimensions) => void) | undefined;
  readonly onSrcDimensions?: ((dimensions: AssetDimensions) => void) | undefined;
  readonly nodeId?: string | undefined;
  readonly onPickWithAlt?: ((name: string, pick: AltPick, alt: string) => void) | undefined;
}
export interface AssetBinding {
  readonly ident: string;
  readonly spec: string;
}
export interface AssetImportFieldProps {
  readonly binding: AssetBinding;
  readonly name: string;
  readonly assetContext: AssetContext;
  readonly onChange: ValueChange;
}
export interface PropFieldProps {
  readonly field: FieldDefinition;
  readonly branchDefault?: string | number | undefined;
  readonly value?: Attr | undefined;
  readonly nodeKey?: string | undefined;
  readonly bindContext?: RichContext | undefined;
  readonly slotOptions?: readonly string[] | undefined;
  readonly projectClasses?: readonly string[] | undefined;
  readonly assetContext?: AssetContext | undefined;
  readonly linkContext?: ComponentProps<typeof LinkField>['context'] | undefined;
  readonly dataContext?: SourceContext | undefined;
  readonly classList?: ClassListOffer | undefined;
  readonly onChange: ValueChange;
}
export function attrText(value: Attr | undefined): string | undefined {
  return value?.type === 'bare' ? undefined : value?.value;
}

export { isHrefName, isMediaName, MEDIA_WORDS, mediaWord } from '../../editor/fieldNames';

export const MEDIA_IMPORT_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|webm|mov|m4v|ogg|mp3|wav)(\?.*)?$/i;

export function assetImportOf(expr: unknown, frontmatter: unknown) {
  const match = String(expr ?? '')
    .trim()
    .match(/^([A-Za-z_$][\w$]*)(?:\.src)?$/);
  if (!match || !frontmatter) {
    return undefined;
  }
  const imported = findImportOf(frontmatter, match[1]);
  if (!imported || !MEDIA_IMPORT_RE.test(imported.spec)) {
    return undefined;
  }
  return { ident: match[1] ?? '', spec: imported.spec };
}

export function boundsHint(field: FieldDefinition, translate: Translator = ENGLISH_TRANSLATE) {
  const { min, max, step, minExclusive, maxExclusive } = field;
  const parts = [];
  if (min !== undefined && max !== undefined) {
    parts.push(`${minExclusive ? '>' : ''}${min}–${maxExclusive ? '<' : ''}${max}`);
  } else if (min !== undefined) {
    parts.push(minExclusive ? translate('props.bounds.greaterThan', { min }) : translate('props.bounds.orMore', { min }));
  } else if (max !== undefined) {
    parts.push(maxExclusive ? translate('props.bounds.lessThan', { max }) : translate('props.bounds.orLess', { max }));
  }
  if (step === 1) {
    parts.push(translate('props.bounds.wholeNumbers'));
  } else if (step !== undefined) {
    parts.push(translate('props.bounds.steps', { step }));
  }
  return parts.length ? translate('props.bounds.accepts', { parts: parts.join(', ') }) : undefined;
}

export function isBoundValue(field: FieldDefinition, value: Attr | undefined) {
  if (!value || value.type !== 'expr') {
    return false;
  }
  const source = String(value.value).trim();
  if (field.type === 'boolean') {
    return !/^(true|false)$/.test(source);
  }
  if (field.type === 'number') {
    return !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(source);
  }
  if (field.type === 'enum') {
    return !(field.options || []).includes(source);
  }
  if (field.type === 'code' && field.codeKind === 'object') {
    return objectFields(source) === undefined;
  }
  if (field.type === 'code') {
    return arrayItems(source, 0, 'bindable') === undefined;
  }
  return true;
}

export function valueFromExpr(field: FieldDefinition, raw: string): Attr | undefined {
  const source = String(raw ?? '').trim();
  const text = plainTextOf(source);
  if (text !== undefined) {
    return textValue(field, text);
  }
  if (field.type === 'boolean') {
    return /^(true|false)$/.test(source) ? { type: 'expr', value: source } : undefined;
  }
  if (field.type === 'number') {
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(source) ? { type: 'expr', value: source } : undefined;
  }
  if (field.type === 'enum') {
    return (field.options || []).includes(source) ? optionAttr(field, source) : undefined;
  }
  if (field.type === 'code' && field.codeKind === 'object') {
    return objectFields(source) ? { type: 'expr', value: source } : undefined;
  }
  if (field.type === 'code' && arrayItems(source, 0, 'bindable')) {
    return { type: 'expr', value: source };
  }
  return undefined;
}

export function controlKind(field: FieldDefinition) {
  if (field.type === 'boolean') {
    return 'toggle';
  }
  if (field.type === 'code' && field.codeKind === 'object') {
    return 'fields';
  }
  if (field.type === 'code') {
    return 'list';
  }
  if (field.type === 'enum' && field.options?.length) {
    return 'optionsList';
  }
  if (field.type === 'style') {
    return 'cssEditor';
  }
  if (isMediaName(field.name)) {
    return 'assetPicker';
  }
  if (isHrefName(field.name)) {
    return 'linkSettings';
  }
  return 'normal';
}
export function controlLabel(field: FieldDefinition, translate: Translator = ENGLISH_TRANSLATE): string {
  const word = controlKind(field);
  switch (word) {
    case 'toggle':
      return translate('props.control.toggle');
    case 'fields':
      return translate('props.control.fields');
    case 'list':
      return translate('props.control.list');
    case 'optionsList':
      return translate('props.control.optionsList');
    case 'cssEditor':
      return translate('props.control.cssEditor');
    case 'assetPicker':
      return translate('props.control.assetPicker');
    case 'linkSettings':
      return translate('props.control.linkSettings');
    case 'normal':
      return translate('props.control.normal');
    default: {
      const exhaustive: never = word;
      return exhaustive;
    }
  }
}

export function normalFieldBlocked(input: { readonly field: FieldDefinition; readonly value: Attr | undefined; readonly required: boolean }): boolean {
  const { field, value, required } = input;
  return value?.type === 'expr' && decideNormalField({ field, source: value.value, required }).kind === 'blocked';
}

export function usePropField(props: PropFieldProps) {
  const state = usePropFieldModel(props);
  return { ...state, ...propFieldActions(state) };
}
export function usePropFieldModel(props: PropFieldProps) {
  const translate = useTranslate();
  const policy = useContext(PropValuePolicyContext);
  const showsFallback = ['boolean', 'enum'].includes(props.field.type);
  const field = policy === 'defaults' && !showsFallback ? { ...props.field, default: undefined, hint: '' } : props.field;
  const {
    branchDefault,
    value,
    nodeKey,

    assetContext,

    dataContext,
  } = props;
  const extra = usePropFieldExtra(props.field.name);
  const mixed = extra?.mixed;
  const hostReset = extra?.reset;
  const placeholderFor = (target: FieldDefinition) =>
    mixed !== undefined && target.name === props.field.name
      ? mixed
      : policy === 'defaults' && !showsFallback
        ? ''
        : propFieldPlaceholder(target, assetContext, branchDefault);
  const { name, type } = field;
  const isSet = value !== undefined;
  const [menuPosition, setMenuPosition] = useState<FieldPosition | undefined>(undefined);
  const [custom, setCustom] = useState(false);
  const [insertAt, setInsertAt] = useState<FieldPickerAt | undefined>(undefined);
  const bindApiRef = useRef<InsertAPI | undefined>(undefined);
  useEffect(() => {
    setCustom(false);
  }, [nodeKey, name]);
  const bindable = type !== 'attrs' && name !== 'slot' && field.codeKind !== 'function';
  const valueText = attrText(value) ?? '';
  const assetBinding = assetImportOf(valueText, dataContext?.imports);
  const shownAsAsset = value?.type === 'expr' && assetBinding && assetContext?.projectPath && assetContext?.filePath;
  const showExpr = bindable && (custom || (isBoundValue(field, value) && !shownAsAsset));
  const reason =
    !/^(quality|format|formats|fallbackFormat|densities|widths|sizes)$/i.test(name) || !assetContext?.srcKind
      ? undefined
      : assetContext.srcKind === 'svg'
        ? translate('props.field.svgNoEffect')
        : assetContext.srcKind === 'public'
          ? translate('props.field.publicAsIs')
          : undefined;
  assert(valueText.length <= LIMITS.attrCharsMax, 'PropField: value limit exceeded');
  assert((field.options?.length ?? 0) <= LIMITS.propOptionsMax, 'PropField: option limit exceeded');
  const isExpr = value?.type === 'expr' || (type === 'code' && value?.type !== 'string');
  const format = readPropDocumentation(field.doc).format;
  const isMediaAttr =
    format === undefined ? isMediaName(name) || field.defaultAsset !== undefined : MEDIA_FORMATS.has(format) || field.defaultAsset !== undefined;
  const required = policy === 'instance' && isRequiredField(props.field, branchDefault);
  const missingRequired = required && !isSet && !spreadsProps(assetContext?.siblingProps);
  const deprecated = fieldDeprecation(props.field);
  const normalBlockedText = normalFieldBlocked({ field, value, required }) ? translate('props.control.normalRequired') : undefined;
  const resetPlan: ResetPlan = planReset({ field, value, required: required && !spreadsProps(assetContext?.siblingProps) });
  const resetRefusal =
    policy === 'preview' || resetPlan.kind !== 'disabled'
      ? undefined
      : translate(resetPlan.reason === 'already-default' ? 'props.control.resetAlready' : 'props.control.resetNoEmpty');
  const isColor = isColorField(props.field);
  return {
    ...props,
    policy,
    field,
    name,
    type,
    isSet,
    menuPosition,
    setMenuPosition,
    custom,
    setCustom,
    insertAt,
    setInsertAt,
    bindApiRef,
    bindable,
    valueText,
    assetBinding,
    shownAsAsset,
    showExpr,
    reason,
    translate,
    placeholderFor,
    isExpr,
    isMediaAttr,
    required,
    missingRequired,
    deprecated,
    normalBlockedText,
    resetPlan,
    resetRefusal,
    isColor,
    mixed,
    hostReset,
  };
}

export function isRequiredField(field: FieldDefinition, branchDefault: string | number | undefined): boolean {
  if (field.optional !== false) {
    return false;
  }
  if (field.default !== undefined) {
    return false;
  }
  if (field.defaultExpr === true) {
    return false;
  }
  return branchDefault === undefined;
}

function spreadsProps(siblings: PropValues | undefined): boolean {
  const values = Object.values(siblings ?? {});
  assert(values.length <= LIMITS.attrsPerNodeMax, 'spreadsProps: attribute limit exceeded');
  return values.some((sibling) => sibling?.type === 'spread');
}

export function fieldDeprecation(field: FieldDefinition): string | undefined {
  return field.deprecated ?? deprecationOf(field.doc);
}

const MEDIA_FORMATS: ReadonlySet<string> = new Set(['image', 'video', 'file']);

const COLOR_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)$/i;
const COLOR_VARIABLE = /^var\(--[\w-]+(?:\s*,[^()]*)?\)$/;
const COLOR_NAME = /(?:^|[a-z])colou?r$/i;

export function isColorText(text: string): boolean {
  const value = text.trim();
  assert(value.length <= LIMITS.attrCharsMax, 'isColorText: value limit exceeded');
  return COLOR_HEX.test(value) || COLOR_FUNCTION.test(value) || COLOR_VARIABLE.test(value);
}

export function isColorField(field: FieldDefinition): boolean {
  if (field.type !== 'string' && field.type !== 'other') {
    return false;
  }
  if (readPropDocumentation(field.doc).format === 'color') {
    return true;
  }
  if (!COLOR_NAME.test(field.name)) {
    return false;
  }
  return typeof field.default === 'string' && isColorText(field.default);
}
export function propFieldActions(state: ReturnType<typeof usePropFieldModel>) {
  const { translate, setMenuPosition, onChange, setCustom, value, field, isSet, showExpr, required, resetPlan } = state;
  const reset = () => {
    setMenuPosition(undefined);
    if (state.hostReset !== undefined) {
      state.hostReset();
      return;
    }
    if (state.policy === 'preview') {
      onChange(undefined, true);
      return;
    }
    if (resetPlan.kind === 'disabled') {
      return;
    }
    onChange(resetPlan.kind === 'write' ? resetPlan.value : undefined, true);
  };
  const fromCustom = () => {
    setMenuPosition(undefined);
    if (value?.type !== 'expr') {
      setCustom(false);
      return;
    }
    const decision = decideNormalField({ field, source: value.value, required });
    if (decision.kind === 'blocked') {
      return;
    }
    const code = value;
    setCustom(false);
    onChange(decision.value, true);
    if (decision.kind === 'replace') {
      reportBindingRemoved(translate, () => {
        setCustom(true);
        onChange(code, true);
      });
    }
  };
  const onLabelClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (!isSet && !showExpr && state.hostReset === undefined) {
      return;
    }
    if (event.altKey) {
      reset();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ left: rect.left, top: rect.bottom + 4 });
  };
  const onLabelContextMenu = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (!isSet && !showExpr && state.hostReset === undefined) {
      return;
    }
    event.preventDefault();
    setMenuPosition({ left: event.clientX, top: event.clientY });
  };
  return { reset, fromCustom, onLabelClick, onLabelContextMenu };
}
export type PropState = ReturnType<typeof usePropField>;
export type PropControlState = PropState & {
  readonly label: React.ReactNode;
  readonly pill: React.ReactNode;
  readonly menu: React.ReactNode;
};
export function propFieldPlaceholder(field: FieldDefinition, assetContext: AssetContext | undefined, branchDefault: string | number | undefined): string {
  if (field.name === 'title' || field.name === 'description') {
    const rendered = assetContext?.layoutText?.[field.name];
    if (rendered !== undefined) {
      return rendered;
    }
  }
  const siblingNumber = (propName: string) => {
    const sibling = assetContext?.siblingProps?.[propName];
    if (!sibling) {
      return undefined;
    }
    const parsed = parseFloat(attrText(sibling) ?? '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  if (field.computedDefault !== undefined) {
    return branchDefault === undefined ? '' : String(branchDefault);
  }
  if (field.default !== undefined) {
    return String(field.default);
  }
  if (branchDefault !== undefined) {
    return String(branchDefault);
  }
  const dimensions = assetContext?.srcDims;
  if (dimensions) {
    const isWidth = /^width$/i.test(field.name);
    const isHeight = /^height$/i.test(field.name);
    if ((isWidth || isHeight) && dimensions.w && dimensions.h) {
      const other = siblingNumber(isWidth ? 'height' : 'width');
      if (other) {
        const ratio = isWidth ? dimensions.w / dimensions.h : dimensions.h / dimensions.w;
        return String(Math.round(other * ratio));
      }
    }
    if (isWidth && dimensions.w) {
      return String(dimensions.w);
    }
    if (isHeight && dimensions.h) {
      return String(dimensions.h);
    }
  }
  return field.hint || '';
}

export function numberControlBounds(field: FieldDefinition) {
  const { min, max, step: grain, minExclusive, maxExclusive } = field;
  const bounded = min !== undefined || max !== undefined || grain !== undefined;
  const allows = (candidate: number) => {
    if (!Number.isFinite(candidate)) {
      return false;
    }
    if (min !== undefined && (minExclusive ? candidate <= min : candidate < min)) {
      return false;
    }
    if (max !== undefined && (maxExclusive ? candidate >= max : candidate > max)) {
      return false;
    }
    if (grain !== undefined && Math.abs(Math.round(candidate / grain) * grain - candidate) > 1e-9) {
      return false;
    }
    return true;
  };
  const clamp = (input: number) => {
    let clamped = input;
    if (grain !== undefined) {
      clamped = Math.round(clamped / grain) * grain;
    }
    if (min !== undefined) {
      clamped = Math.max(clamped, minExclusive ? min + (grain ?? 1e-6) : min);
    }
    if (max !== undefined) {
      clamped = Math.min(clamped, maxExclusive ? max - (grain ?? 1e-6) : max);
    }
    return Math.round(clamped * 1e6) / 1e6;
  };
  return { bounded, allows, clamp };
}

const NUMBER_LITERAL = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

export type NumberTyped = { readonly kind: 'clear' } | { readonly kind: 'write'; readonly text: string } | { readonly kind: 'hold'; readonly text: string };
export function numberTyped(field: FieldDefinition, text: string): NumberTyped {
  assert(text.length <= LIMITS.attrCharsMax, 'numberTyped: typed text is bounded');
  if (text === '') {
    return { kind: 'clear' };
  }
  const { bounded, allows } = numberControlBounds(field);
  if (!bounded) {
    return { kind: 'write', text };
  }
  const trimmed = text.trim();
  if (NUMBER_LITERAL.test(trimmed)) {
    if (allows(Number(trimmed))) {
      return { kind: 'write', text: trimmed };
    }
    return { kind: 'hold', text };
  }
  return { kind: 'hold', text };
}

export function numberCommitted(field: FieldDefinition, draft: string): string | undefined {
  assert(draft.length <= LIMITS.attrCharsMax, 'numberCommitted: the draft is bounded');
  const parsed = Number.parseFloat(draft);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const { bounded, allows, clamp } = numberControlBounds(field);
  const next = bounded ? clamp(parsed) : parsed;
  assert(!bounded || allows(next), 'numberCommitted: a clamped value is one the field accepts');
  return String(next);
}

export function numberStepped(field: FieldDefinition, base: number, direction: 1 | -1, mods: { readonly shiftKey: boolean; readonly altKey: boolean }): string {
  assert(Number.isFinite(base), 'numberStepped: steps from a number');
  const grain = field.step;
  const unit = grain ?? 1;
  let size = unit;
  if (mods.shiftKey) {
    size = unit * 10;
  } else if (mods.altKey) {
    size = grain === undefined ? 0.1 : grain;
  }
  const next = Math.round((base + direction * size) * 1e6) / 1e6;
  const { bounded, allows, clamp } = numberControlBounds(field);
  const stepped = bounded ? clamp(next) : next;
  assert(!bounded || allows(stepped), 'numberStepped: a step lands inside the range');
  return String(stepped);
}

export function hexOfColor(text: string): string | undefined {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text.trim()) ?? undefined;
  const digits = match?.[1];
  if (digits === undefined) {
    return undefined;
  }
  const full = digits.length <= 4 ? [...digits.slice(0, 3)].map((digit) => digit + digit).join('') : digits.slice(0, 6);
  assert(full.length === 6, 'hexOfColor: six digits');
  return `#${full.toLowerCase()}`;
}
