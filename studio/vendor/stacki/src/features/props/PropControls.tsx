import { useTranslate } from '../../lib/i18n/useTranslate';
import { PropHoverPreviewContext, PropValuePolicyContext } from './propValuePolicy';
import { PropPreviewContext } from './propPreviewContext';

import React, { useContext, useEffect, useRef, useState } from 'react';
import { CodeInline } from '../../ui/CodeBlock';
import { assert } from '../../../shared/core/assert';
import { definedFields } from '../../../shared/core/boundary';
import { resolveAssetImport } from '../../ipc/assetBridge';
import { BindField, ExprValueField } from './propBindings';
import { ObjectAttrsField, parseObjectLiteral, serializeObjectLiteral } from './propAttributes';
import { looksLikeAssetPath, mediaKindFor } from '../../ui/AssetThumb';
import AssetField, { type AssetFieldProps } from '../../ui/AssetField';
import LinkField from './LinkField';
import ListField from './ListField';
import ObjectField from './ObjectField';
import ClassInput from './ClassInput';
import Dropdown from '../../ui/Dropdown';
import AutoTextarea from '../../ui/AutoTextarea';
import CodeTextField from './CodeTextField';
import { attributeLanguage } from '../../ui/attributeLanguage';
import HtmlField from '../../ui/HtmlField';
import DateField from '../../ui/DateField';
import { containsHTML } from '../../ui/htmlFieldModel';
import { calendarValue } from '../../ui/dateFieldModel';
import SegSwitch from './SegSwitch';
import StyleEditor from './StyleEditor';
import { ChevronDownIcon } from '../../ui/Icons';
import {
  type AssetContext,
  type AssetImportFieldProps,
  attrText,
  mediaWord,
  boundsHint,
  type PropControlState,
  numberCommitted,
  numberStepped,
  numberTyped,
  isColorText,
  hexOfColor,
} from './propFieldModel';
import { codeRowValue, objectSeed, optionAttr, optionValue, previewsOptions } from './propKinds';
import { itemShapeOf } from './listItemShape';
import { declaredItemTypeOf } from './listItemType';
import { readPropDocumentation } from '../../editor/propDocumentation';

export function AssetImportField({ binding, name, assetContext, onChange }: AssetImportFieldProps) {
  const [rel, setRel] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setRel(undefined);
    if (!assetContext.projectPath || !assetContext.filePath) {
      return undefined;
    }
    void resolveAssetImport(assetContext.projectPath, assetContext.filePath, binding.spec).then((result) => {
      if (live) {
        setRel(result.ok ? result.rel : undefined);
      }
    });
    return () => {
      live = false;
    };
  }, [binding.spec, assetContext.projectPath, assetContext.filePath]);

  return (
    <AssetField
      value=""
      srcRel={rel}
      mediaKind={/\.(mp4|webm|mov|m4v)$/i.test(binding.spec) ? 'video' : 'image'}
      initialMode="asset"
      plainLabel="URL"
      projectPath={assetContext.projectPath ?? ''}
      onChange={(next, immediate) => (next === '' ? onChange(undefined, immediate) : onChange({ type: 'string', value: next }, immediate))}
      onPickEntry={assetContext.onPickAsset && ((picked) => assetContext.onPickAsset && assetContext.onPickAsset(name, picked))}
      onDimensions={(dimensions) => assetContext.onPickDimensions?.(name, dimensions)}
      onCurrentDimensions={(dimensions) => /^src$/i.test(name) && assetContext.onSrcDimensions?.(dimensions)}
      pickTarget={{ nodeId: assetContext.nodeId, field: name }}
      onPickWithAlt={altPickFor(name, assetContext)}
    />
  );
}
export function BindingControl({ state }: { readonly state: PropControlState }) {
  const { field, value, bindContext, dataContext, onChange, setCustom, bindApiRef, placeholderFor, label } = state;

  return (
    <div className="props-field">
      {label}
      <BindField
        value={value}
        field={field}
        apiRef={bindApiRef}
        placeholder={placeholderFor(field)}
        bindContext={bindContext}
        dataContext={dataContext}
        onChange={(next, immediate) => {
          setCustom(true);
          onChange(next, immediate);
        }}
      />
    </div>
  );
}
export function StyleControl({ state }: { readonly state: PropControlState }) {
  const { value, onChange, label } = state;

  return (
    <div className="props-field">
      {label}
      <StyleEditor
        value={attrText(value) || ''}
        placeholder="color: red;"
        onChange={(next) => {
          if (!next) {
            onChange(undefined, true);
          } else {
            onChange({ type: 'string', value: next }, false);
          }
        }}
      />
    </div>
  );
}
export function AttributeControl({ state }: { readonly state: PropControlState }) {
  const { field, value, bindContext, assetContext, onChange, pill, menu } = state;

  const source = value?.type === 'expr' ? value.value : undefined;
  const entries = source !== undefined ? parseObjectLiteral(source) : (parseObjectLiteral(typeof field.default === 'string' ? field.default : '{}') ?? []);
  if (entries) {
    return (
      <ObjectAttrsField
        pill={pill}
        menu={menu}
        entries={entries}
        bindContext={bindContext}
        projectPath={assetContext?.projectPath}
        onCommit={(next) => (next.length ? onChange({ type: 'expr', value: serializeObjectLiteral(next) }, true) : onChange(undefined, true))}
      />
    );
  }

  return undefined;
}
export function ClassControl({ state }: { readonly state: PropControlState }) {
  const { value, projectClasses, onChange, label } = state;

  return (
    <div className="props-field">
      {label}
      <ClassInput
        value={attrText(value) || ''}
        suggestions={projectClasses || []}
        onChange={(next, immediate) => (next.trim() ? onChange({ type: 'string', value: next }, immediate) : onChange(undefined, true))}
      />
    </div>
  );
}
export function SlotControl({ state }: { readonly state: PropControlState }) {
  const hoverPreview = useContext(PropHoverPreviewContext);
  const { value, slotOptions, onChange, label } = state;
  assert(slotOptions?.length, 'Slot control: slots exist');

  const raw = attrText(value);
  const named = slotOptions.filter((slot) => slot !== 'default');
  const choices = [
    { value: '', label: 'default', dim: true },
    ...(raw && raw !== 'default' && !named.includes(raw) ? [{ value: raw, label: raw }] : []),
    ...named.map((slot) => ({ value: slot, label: slot })),
  ];
  return (
    <div className="props-field">
      {label}
      <Dropdown
        value={raw && raw !== 'default' ? raw : ''}
        livePreview={hoverPreview}
        options={choices}
        onChange={(next) => (next === '' ? onChange(undefined, true) : onChange({ type: 'string', value: next }, true))}
      />
    </div>
  );
}
export function EnumControl({ state }: { readonly state: PropControlState }) {
  const translate = useTranslate();
  const preview = useContext(PropPreviewContext);
  const policy = useContext(PropValuePolicyContext);
  const hoverPreview = useContext(PropHoverPreviewContext);
  const { field, value, onChange, placeholderFor, label } = state;
  assert(field.options?.length, 'Enum control: options exist');

  const renderedDefault = value === undefined && field.name === 'type' ? state.assetContext?.layoutType : undefined;
  const defaultText = renderedDefault ?? (field.default !== undefined ? String(field.default) : undefined);
  const raw = attrText(value);
  const mixed = state.mixed !== undefined && raw === undefined;
  if (
    field.options.length === 2 &&
    (policy === 'defaults' || (defaultText !== undefined && field.options.includes(defaultText))) &&
    (raw === undefined || field.options.includes(raw))
  ) {
    const current = mixed ? undefined : (raw ?? defaultText);
    return (
      <div className="props-field">
        {label}
        <SegSwitch
          options={field.options.map((option) => ({ value: option, label: option }))}
          current={current}
          onPick={(next) =>
            policy === 'instance' && next === defaultText && !mixed ? onChange(undefined, true) : onChange(optionAttr(field, next), true)
          }
        />
      </div>
    );
  }
  const omittedDefault = policy === 'instance' && !mixed ? defaultText : undefined;
  const selected = raw ?? (policy === 'defaults' || mixed ? '' : (defaultText ?? ''));
  const selectedOption = selected === omittedDefault ? '' : selected;
  const choices = raw === undefined || field.options.includes(raw) ? field.options : [raw, ...field.options];
  return (
    <div className="props-field">
      {label}
      <Dropdown
        value={selectedOption}
        livePreview={hoverPreview}
        searchable={choices.length > 12}
        {...enumPreview(preview, { field, choices, omittedDefault })}
        placeholder={renderedDefault ?? (placeholderFor(field) || translate('props.field.notSet'))}
        options={choices.map((option) => ({
          value: option === omittedDefault ? '' : option,
          label: option,
        }))}
        onChange={(next) => (next === '' ? onChange(undefined, true) : onChange(optionAttr(field, next), true))}
      />
    </div>
  );
}
function enumPreview(
  preview: React.ContextType<typeof PropPreviewContext>,
  enumField: {
    readonly field: { readonly name: string; readonly numeric?: boolean | undefined; readonly expressionOptions?: readonly string[] | undefined };
    readonly choices: readonly string[];
    readonly omittedDefault: string | undefined;
  },
) {
  const { field, choices, omittedDefault } = enumField;
  if (!preview || !previewsOptions(field)) {
    return {};
  }
  return {
    onPrepare: () =>
      preview.prepare(
        field.name,
        choices.map((option) => (option === omittedDefault ? undefined : optionValue(field, option))),
      ),
    onPreview: (next: string) => preview.hover(next === '' ? undefined : optionValue(field, next)),
    onCancelPreview: preview.cancel,
    onCommitPreview: preview.commit,
  };
}

export function BooleanControl({ state }: { readonly state: PropControlState }) {
  const translate = useTranslate();
  const policy = useContext(PropValuePolicyContext);
  const { field, value, onChange, label } = state;

  const fallback = !!field.default;
  const mixed = state.mixed !== undefined && value === undefined;
  const current = mixed ? undefined : value ? value.type !== 'expr' || value.value === 'true' : fallback;
  return (
    <div className="props-field">
      {label}
      <SegSwitch
        options={[
          { value: true, label: translate('props.newProp.form.true') },
          { value: false, label: translate('props.newProp.form.false') },
        ]}
        current={current}
        onPick={(next) =>
          policy === 'instance' && next === fallback && !mixed ? onChange(undefined, true) : onChange({ type: 'expr', value: next ? 'true' : 'false' }, true)
        }
      />
    </div>
  );
}
export function NumberControl({ state }: { readonly state: PropControlState }) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const preview = useContext(PropPreviewContext);
  const model = numberControlState(livePreviewed(state, preview), { draft, setDraft });
  return <NumberControlView state={model} />;
}
function livePreviewed(state: PropControlState, preview: React.ContextType<typeof PropPreviewContext>): PropControlState {
  const live = preview?.live;
  if (live === undefined) {
    return state;
  }
  const { field, onChange } = state;
  return {
    ...state,
    onChange: (next, commit) => {
      const number = next?.type === 'expr' ? Number(next.value) : Number.NaN;
      if (Number.isFinite(number)) {
        live(field.name, number);
      }
      onChange(next, commit);
    },
  };
}
export function numberControlState(
  state: PropControlState,
  held: { readonly draft: string | undefined; readonly setDraft: (draft: string | undefined) => void },
) {
  const { field, value, onChange, placeholderFor } = state;
  const { draft, setDraft } = held;
  const sourceText = value?.type === 'expr' ? value.value : (attrText(value) ?? '');
  const numberText = draft ?? sourceText;
  const onType = (text: string) => {
    const typed = numberTyped(field, text);
    switch (typed.kind) {
      case 'clear':
        setDraft(undefined);
        onChange(undefined);
        return;
      case 'write':
        setDraft(undefined);
        onChange({ type: 'expr', value: typed.text });
        return;
      case 'hold':
        setDraft(typed.text);
        return;
      default: {
        const exhaustive: never = typed;
        return exhaustive;
      }
    }
  };
  const commit = () => {
    if (draft === undefined) {
      return;
    }
    setDraft(undefined);
    const committed = numberCommitted(field, draft);
    if (committed === undefined) {
      return;
    }
    onChange({ type: 'expr', value: committed }, true);
  };
  const step = (direction: 1 | -1, mods: { readonly shiftKey: boolean; readonly altKey: boolean }, from: string) => {
    const current = parseFloat(from);
    const shown = parseFloat(placeholderFor(field));
    const base = Number.isFinite(current) ? current : Number.isFinite(shown) ? shown : parseFloat(String(field.default)) || 0;
    setDraft(undefined);
    onChange({ type: 'expr', value: numberStepped(field, base, direction, mods) });
  };
  const onStepKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    step(event.key === 'ArrowUp' ? 1 : -1, event, event.currentTarget.value);
  };
  return { ...state, numberText, commit, onType, onStepKey, step };
}
export function NumberControlView({ state }: { readonly state: ReturnType<typeof numberControlState> }) {
  const translate = useTranslate();
  const { label, numberText, placeholderFor, field, onStepKey, commit, onType, step } = state;

  return (
    <div className="props-field">
      {label}
      {}
      <div className="num-field">
        <input
          type="text"
          inputMode="decimal"
          value={numberText}
          placeholder={placeholderFor(field)}
          onKeyDown={onStepKey}
          onBlur={commit}
          title={boundsHint(field, translate)}
          aria-label={boundsHint(field, translate)}
          onChange={(event) => onType(event.target.value)}
        />
        <span className="num-steppers">
          {([1, -1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              tabIndex={-1}
              aria-label={direction > 0 ? translate('props.number.increase') : translate('props.number.decrease')}
              title={direction > 0 ? translate('props.number.increaseTitle') : translate('props.number.decreaseTitle')}
              onClick={(event) => step(direction, event, numberText)}
            >
              <ChevronDownIcon size={11} style={direction > 0 ? { transform: 'rotate(180deg)' } : undefined} />
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
export function LinkControl({ state }: { readonly state: PropControlState }) {
  const { value, assetContext, linkContext, onChange, label } = state;
  assert(linkContext, 'Link control: context exists');

  return (
    <div className="props-field">
      {label}
      <LinkField
        {...(value === undefined ? {} : { value })}
        context={{ ...linkContext, projectPath: assetContext?.projectPath ?? '' }}
        placeholder={state.placeholderFor(state.field)}
        onChange={onChange}
      />
    </div>
  );
}
export function MediaControl({ state }: { readonly state: PropControlState }) {
  const policy = useContext(PropValuePolicyContext);
  const { assetContext, onChange, name, valueText, isMediaAttr, label } = state;
  assert(assetContext?.projectPath, 'Media control: project exists');
  const fallback = state.field.default ?? state.branchDefault;
  const defaultPreview = state.field.defaultExpr ? state.field.defaultAsset : typeof fallback === 'string' ? fallback : undefined;
  const fallbackValue = policy === 'defaults' ? undefined : defaultPreview;
  const renderedFallback = name === 'image' ? assetContext.layoutImage : undefined;

  const nodeName = String(assetContext.nodeName || '').toLowerCase();
  const declaredKind = declaredMediaKind(readPropDocumentation(state.field.doc).format);
  const mediaKind = looksLikeAssetPath(valueText)
    ? mediaKindFor(valueText)
    : declaredKind !== undefined
      ? declaredKind
      : /^(poster|image|logo|icon|avatar|thumb|thumbnail|photo|banner|cover)$/.test(mediaWord(name))
        ? 'image'
        : mediaWord(name) === 'video'
          ? 'video'
          : mediaWord(name) === 'audio'
            ? 'audio'
            : nodeName === 'video'
              ? 'video'
              : nodeName === 'audio'
                ? 'audio'
                : ['img', 'source', 'picture', 'image'].includes(nodeName)
                  ? 'image'
                  : 'asset';
  const poster = /^src$/i.test(name) ? assetContext.siblingProps?.['poster'] : undefined;
  return (
    <div className="props-field">
      {label}
      <AssetField
        value={state.isSet ? valueText : undefined}
        posterValue={poster?.type === 'string' ? poster.value : undefined}
        fallbackValue={renderedFallback ?? fallbackValue}
        mediaKind={mediaKind}
        {...definedFields({ initialMode: isMediaAttr ? undefined : ('asset' as const) })}
        plainLabel={isMediaAttr ? 'URL' : 'Text'}
        projectPath={assetContext.projectPath ?? ''}
        onChange={(next, immediate) => (next === '' ? onChange(undefined, immediate) : onChange({ type: 'string', value: next }, immediate))}
        onPickEntry={assetContext.onPickAsset && ((picked) => assetContext.onPickAsset && assetContext.onPickAsset(name, picked))}
        onDimensions={(dimensions) => assetContext.onPickDimensions?.(name, dimensions)}
        onCurrentDimensions={(dimensions) => /^src$/i.test(name) && assetContext.onSrcDimensions?.(dimensions)}
        pickTarget={{ nodeId: assetContext.nodeId, field: name }}
        onPickWithAlt={altPickFor(name, assetContext)}
      />
    </div>
  );
}
function declaredMediaKind(format: string | undefined): 'image' | 'video' | 'asset' | undefined {
  if (format === 'image' || format === 'video') {
    return format;
  }
  return format === 'file' ? 'asset' : undefined;
}
export function ImportedAssetControl({ state }: { readonly state: PropControlState }) {
  const { assetContext, onChange, name, assetBinding, label } = state;
  assert(assetContext, 'Imported asset: context exists');
  assert(assetBinding, 'Imported asset: binding exists');

  return (
    <div className="props-field">
      {label}
      <AssetImportField binding={assetBinding} name={name} assetContext={assetContext} onChange={onChange} />
    </div>
  );
}
export function ObjectControl({ state }: { readonly state: PropControlState }) {
  const { field, onChange, valueText, label } = state;
  const seed = objectSeed(field, valueText) ?? valueText;

  return (
    <div className="props-field">
      {label}
      <ObjectField value={seed} onChange={(text, immediate) => onChange({ type: 'expr', value: text }, immediate)} />
    </div>
  );
}
export function ListControl({ state }: { readonly state: PropControlState }) {
  const { field, onChange, valueText, placeholderFor, label } = state;
  const itemShape = field.shapeIsList === true ? itemShapeOf(field.shape) : undefined;
  const fallback = !state.isSet && typeof field.default === 'string' ? field.default : undefined;

  return (
    <div className="props-field">
      {label}
      <ListField
        value={valueText}
        placeholder={placeholderFor(field)}
        itemShape={itemShape}
        itemType={declaredItemTypeOf(field)}
        fallback={fallback}
        projectPath={state.assetContext?.projectPath}
        bindContext={state.bindContext}
        dataContext={state.dataContext}
        onChange={(text, immediate) => onChange({ type: 'expr', value: text }, immediate)}
      />
    </div>
  );
}
export function ExpressionControl({ state }: { readonly state: PropControlState }) {
  const { field, dataContext, onChange, valueText, placeholderFor, label } = state;

  return (
    <div className="props-field">
      {label}
      <ExprValueField value={valueText} placeholder={placeholderFor(field)} dataContext={dataContext} onChange={onChange} />
    </div>
  );
}
export function CodeControl({ state }: { readonly state: PropControlState }) {
  const translate = useTranslate();
  const { field, value, label } = state;
  const action = field.codeKind === 'function';
  const shown = codeRowValue(field, value);
  const note = action ? translate('props.field.actionInCode') : translate('props.field.setInCode');
  return (
    <div className="props-field">
      {label}
      <div className="props-code-row" title={field.typeText === undefined ? note : translate('props.field.noteWithType', { note, type: field.typeText })}>
        <span className="props-code-row-note">{note}</span>
        {field.typeText !== undefined && <CodeInline className="props-code-row-type" language="typescript" text={field.typeText} />}
        {shown !== undefined && <CodeInline className="props-code-row-value" language="typescript" text={shown} />}
      </div>
    </div>
  );
}
export function ColorControl({ state }: { readonly state: PropControlState }) {
  const translate = useTranslate();
  const { field, value, onChange, name, placeholderFor, label } = state;
  const text = attrText(value) ?? '';
  const fallback = placeholderFor(field);
  const shown = text === '' ? fallback : text;
  const paint = isColorText(shown) && !shown.trim().startsWith('var(') ? shown.trim() : undefined;
  const committed = useColorCommit((color) => onChange({ type: 'string', value: color }, true));
  return (
    <div className="props-field">
      {label}
      <div className={`prop-color${text === '' ? ' is-default' : ''}`}>
        <span className={`prop-color-swatch${paint === undefined ? ' is-unknown' : ''}`}>
          <span className="prop-color-fill" style={paint === undefined ? undefined : { background: paint }} />
          <input
            ref={committed}
            type="color"
            aria-label={translate('props.field.chooseColor', { name })}
            value={hexOfColor(shown) ?? '#000000'}
            onChange={(event) => onChange({ type: 'string', value: event.target.value })}
          />
        </span>
        <input
          value={text}
          placeholder={fallback || '#000000'}
          spellCheck={false}
          aria-label={name}
          onChange={(event) => (event.target.value === '' ? onChange(undefined) : onChange({ type: 'string', value: event.target.value }))}
        />
      </div>
    </div>
  );
}

function useColorCommit(commit: (color: string) => void): React.RefObject<HTMLInputElement> {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => {
    const element = input.current;
    if (element === null) {
      return undefined;
    }
    const settle = (): void => latest.current(element.value);
    element.addEventListener('change', settle);
    return () => element.removeEventListener('change', settle);
  }, []);
  return input;
}

export function TextControl({ state }: { readonly state: PropControlState }) {
  const { field, onChange, name, valueText, placeholderFor, label } = state;
  const text = state.value?.type === 'bare' ? undefined : valueText;
  const content = text ?? '';
  const format = readPropDocumentation(field.doc).format;
  if (containsHTML(content) || format === 'richtext') {
    return (
      <div className="props-field">
        {label}
        <HtmlField value={content} label={name} onChange={(next) => onChange({ type: 'string', value: next })} />
      </div>
    );
  }
  if (calendarValue(content) || format === 'date') {
    return (
      <div className="props-field">
        {label}
        <DateField value={content} label={name} onChange={(next) => onChange({ type: 'string', value: next })} />
      </div>
    );
  }
  const language = attributeLanguage(name);
  if (language !== undefined) {
    return (
      <div className="props-field">
        {label}
        <CodeTextField
          value={content}
          language={language}
          ariaLabel={name}
          placeholder={placeholderFor(field)}
          onChange={(next) => onChange({ type: 'string', value: next })}
        />
      </div>
    );
  }
  const oneLine = format === 'email' || format === 'phone' || format === 'text';
  const long =
    format === 'longtext' || (!oneLine && (field.type === 'text' || String(valueText).length > 48 || /text|description|content|body|paragraph/i.test(name)));
  return (
    <div className="props-field">
      {label}
      {long ? (
        <AutoTextarea value={text} placeholder={placeholderFor(field)} onChange={(event) => onChange({ type: 'string', value: event.target.value })} />
      ) : (
        <input
          type={format === 'email' ? 'email' : format === 'phone' ? 'tel' : 'text'}
          value={text}
          placeholder={placeholderFor(field)}
          onChange={(event) => onChange({ type: 'string', value: event.target.value })}
        />
      )}
    </div>
  );
}

function altPickFor(name: string, assetContext: AssetContext): AssetFieldProps['onPickWithAlt'] {
  const write = assetContext.onPickWithAlt;
  if (write === undefined) {
    return undefined;
  }
  if (/^src$/i.test(name)) {
    return (pick, alt) => write(name, pick, alt);
  }
  return undefined;
}
