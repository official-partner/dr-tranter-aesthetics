
import { ErrorToast } from '../../ui/ErrorToast';
import { useState } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { CloseIcon, PlusIcon, TrashIcon } from '../../ui/Icons';
import AutoTextarea from '../../ui/AutoTextarea';
import CodeTextField from './CodeTextField';
import { attributeLanguage } from '../../ui/attributeLanguage';
import AssetField from '../../ui/AssetField';
import Dropdown from '../../ui/Dropdown';
import { ResetLabel } from '../../ui/ResetLabel';
import { assert } from '../../../shared/core/assert';
import ListField from './ListField';
import { CodeTypeField, ItemFieldsEditor, ListDefaultField, PropertyFlagsFields, type PropertyFlags } from './PropertySections';
import { arrayItems, arrayText, itemsHoldCode } from './arrayValue';
import type { ItemFieldDeclaration } from '../../editor/itemFields';
import { LIST_STARTER_FIELDS, listSettingsProblem } from '../../editor/listPropType';
import { imageDefaultChoice, imageDefaultOf } from '../../editor/imagePropDefault';
import { itemValuesOf } from './listItemShape';
import {
  attributeDefaultsProblem,
  DECLARATION_LIMITS,
  defaultCode,
  numberSettingsProblem,
  optionsProblem,
  typeText,
  type AttributeDefault,
  type NewPropKind,
  type PropDeclaration,
} from '../../editor/propDeclaration';
import { type NumberSettings } from '../../editor/propDocumentation';
import {
  boundPath,
  FIT_KINDS,
  KIND_TITLE_KEYS,
  propNameProblem,
  seedName,
  suggestedPropName,
  suggestedRestName,
  type NewPropHost,
  type NewPropSeed,
} from './newPropModel';
import SegSwitch from './SegSwitch';
import { classListLocal } from './classListProp';
import './loopSettings.css';

export interface NewPropFormProps {
  readonly host: NewPropHost;
  readonly seed: NewPropSeed;
  readonly onCreated: (path: string, declaration: PropDeclaration) => void;
  readonly onCancel: () => void;
}

export default function NewPropForm(props: NewPropFormProps) {
  const translate = useTranslate();
  const form = useNewPropForm(props);
  const { name, setName, problem, kind, created } = form;
  return (
    <div className="loop-bind-dialog loop-property-settings new-prop-form" role="dialog" aria-label={translate('props.newProp.form.settings')}>
      <div className="loop-property-head">
        <span className="loop-bind-title">{translate('props.newProp.form.settings')}</span>
        <button type="button" className="loop-settings-remove" aria-label={translate('ui.close')} title={translate('ui.close')} onClick={props.onCancel}>
          <CloseIcon size={12} />
        </button>
      </div>
      <label className="loop-bind-name">
        <span className="loop-settings-editor-label">{translate('props.newProp.form.name')}</span>
        <input
          value={name}
          spellCheck={false}
          autoFocus={true}
          aria-label={translate('props.newProp.form.name')}
          aria-invalid={form.nameProblem !== undefined}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              form.create();
            }
          }}
        />
      </label>
      <ErrorToast message={name.trim() === '' ? undefined : form.nameProblem} />
      <label className="loop-bind-name top">
        <span className="loop-settings-editor-label">{translate('props.newProp.form.tooltip')}</span>
        <AutoTextarea
          value={form.tooltip}
          aria-label={translate('props.newProp.form.tooltip')}
          placeholder={translate('props.newProp.form.tooltipPlaceholder')}
          onChange={(event) => form.setTooltip(event.target.value)}
        />
      </label>
      {form.kinds.length > 1 && (
        <div className="loop-bind-name">
          <span className="loop-settings-editor-label">{translate('props.newProp.form.type')}</span>
          <SegSwitch options={form.kinds.map((value) => ({ value, label: translate(KIND_TITLE_KEYS[value]) }))} current={kind} onPick={form.setKind} />
        </div>
      )}
      <KindSettings form={form} />
      {}
      <PropertyFlagsFields required={form.flags.required} readonly={form.flags.readonly} onChange={form.setFlags} />
      <div className="new-prop-code-type">
        <CodeTypeField
          type={form.codeType}
          placeholder={form.kindType}
          open={form.codeOpen}
          onToggle={() => form.setCodeOpen(!form.codeOpen)}
          onChange={form.setCodeType}
        />
      </div>
      {kind === 'list' ? (
        <ListDefaultField fields={form.listFields} code={form.listItems} projectPath={props.host.projectPath} onChange={form.setListItems} />
      ) : (
        <div className="loop-property-default">
          <DefaultTitle form={form} label={translate('props.newProp.form.defaultKind', { kind: translate(KIND_TITLE_KEYS[kind]) })} />
          <DefaultEditor form={form} host={props.host} />
        </div>
      )}
      <ErrorToast message={form.nameProblem === undefined && name.trim() !== '' ? problem : undefined} />
      <div className="loop-bind-actions">
        <button type="button" className="loop-bind-button" onClick={props.onCancel}>
          {translate('ui.cancel')}
        </button>
        <button type="button" className="loop-bind-button primary" disabled={problem !== undefined || created} title={problem} onClick={form.create}>
          {translate('props.newProp.form.create')}
        </button>
      </div>
    </div>
  );
}

function DefaultTitle({ form, label }: { readonly form: FormState; readonly label: string }) {
  if (form.kind !== 'image') {
    return <div className="loop-bind-title">{label}</div>;
  }
  return (
    <div className="loop-bind-title">
      <ResetLabel label={label} active={form.image.trim() !== ''} onReset={() => form.setImage('')} />
    </div>
  );
}

function useNewPropForm({ host, seed, onCreated }: NewPropFormProps) {
  const translate = useTranslate();
  const kinds = FIT_KINDS[seed.fit];
  const first = kinds[0];
  assert(first !== undefined, 'NewPropForm: a field offers at least one kind');
  const [kind, setKindState] = useState<NewPropKind>(first);
  const [name, setName] = useState(() => (first === 'attributes' ? suggestedRestName(host) : suggestedPropName(seedName(seed), host)));
  const [tooltip, setTooltip] = useState('');
  const [defaultText, setDefaultText] = useState(() => initialDefault(first, seed.value));
  const [options, setOptions] = useState<readonly string[]>(() => [seed.value.trim() === '' ? 'Option 1' : seed.value]);
  const [number, setNumber] = useState<NumberSettings>({ min: undefined, max: undefined, decimals: undefined });
  const [attributes, setAttributes] = useState<readonly AttributeDefault[]>([]);
  const [listFields, setListFields] = useState<readonly ItemFieldDeclaration[]>(() => (seed.itemFields?.length ? seed.itemFields : LIST_STARTER_FIELDS));
  const [listItems, setListItems] = useState(() => (seed.fit === 'list' && arrayItems(seed.value) !== undefined ? seed.value.trim() : '[]'));
  const [image, setImage] = useState(() => (seed.fit === 'image' && imageDefaultOf(seed.value, translate).ok ? seed.value.trim() : ''));
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [created, setCreated] = useState(false);
  const [flags, setFlags] = useState<PropertyFlags>({ required: false, readonly: false });
  const [codeType, setCodeType] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const key = name.trim();
  const nameProblem = propNameProblem(key, host, translate);
  const parsedItems = arrayItems(listItems);
  const listAsItems = parsedItems !== undefined && !itemsHoldCode(parsedItems) ? parsedItems : undefined;
  const list = { fields: listFields, items: itemValuesOf(listAsItems ?? []) };
  const listExpression = kind === 'list' && listAsItems === undefined ? listItems : '';
  const declaration: PropDeclaration = {
    key,
    tooltip,
    kind,
    defaultText,
    options,
    number,
    attributes,
    tag: seed.tag ?? '',
    list,
    image,
    typing: { required: flags.required, readonly: flags.readonly, codeType },
    defaultExpression: listExpression,
    local: classListLocal(seed, key),
  };
  const kindTyped = typeText(declaration, '', translate);
  const problem = nameProblem ?? settingsProblem(declaration, translate) ?? refusal;
  const setKind = (next: NewPropKind): void => {
    setKindState(next);
    setDefaultText(initialDefault(next, seed.value));
    setRefusal(undefined);
  };
  const create = (): void => {
    if (problem !== undefined || created) {
      return;
    }
    const answer = host.create(declaration);
    if (answer.ok) {
      setCreated(true);
      const picked = kind === 'image' ? imageDefaultOf(image, translate) : undefined;
      onCreated(boundPath(answer.value, picked?.ok === true ? picked.value.kind : undefined, seed.reference), declaration);
    } else {
      setRefusal(answer.error);
    }
  };
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T): void => {
      set(value);
      setRefusal(undefined);
    };
  return {
    kinds,
    kind,
    setKind,
    flags,
    setFlags: edit(setFlags),
    codeType,
    setCodeType: edit(setCodeType),
    codeOpen,
    setCodeOpen,
    kindType: kindTyped.ok ? kindTyped.value : '',
    name,
    setName: edit(setName),
    nameProblem: key === '' ? undefined : nameProblem,
    tooltip,
    setTooltip,
    defaultText,
    setDefaultText: edit(setDefaultText),
    options,
    setOptions: edit(setOptions),
    number,
    setNumber: edit(setNumber),
    attributes,
    setAttributes: edit(setAttributes),
    listFields,
    setListFields: edit(setListFields),
    listItems,
    setListItems: edit(setListItems),
    image,
    setImage: edit(setImage),
    problem: key === '' ? translate('props.newProp.name.empty') : problem,
    created,
    create,
  };
}
type FormState = ReturnType<typeof useNewPropForm>;

function initialDefault(kind: NewPropKind, value: string): string {
  switch (kind) {
    case 'string':
    case 'option':
      return value;
    case 'number':
      return Number.isFinite(Number(value.trim())) && value.trim() !== '' ? value.trim() : '';
    case 'boolean':
      return value === 'true' ? 'true' : 'false';
    case 'attributes':
    case 'list':
    case 'image':
      return '';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function settingsProblem(declaration: PropDeclaration, translate: Translator): string | undefined {
  switch (declaration.kind) {
    case 'number':
      return numberSettingsProblem(declaration.number, translate) ?? defaultProblem(declaration, translate);
    case 'option':
      return optionsProblem(declaration.options, translate) ?? defaultProblem(declaration, translate);
    case 'attributes':
      return attributeDefaultsProblem(declaration.attributes, translate);
    case 'list':
      return listSettingsProblem(declaration.list, translate);
    case 'image': {
      const image = imageDefaultChoice(declaration.image, translate);
      return image.ok ? undefined : image.error;
    }
    case 'boolean':
    case 'string':
      return undefined;
    default: {
      const exhaustive: never = declaration.kind;
      return exhaustive;
    }
  }
}

function defaultProblem(declaration: PropDeclaration, translate: Translator): string | undefined {
  const code = defaultCode(declaration, translate);
  return code.ok ? undefined : code.error;
}

function KindSettings({ form }: { readonly form: FormState }) {
  const translate = useTranslate();
  switch (form.kind) {
    case 'number':
      return <NumberSettingsEditor settings={form.number} onChange={form.setNumber} />;
    case 'option':
      return (
        <div className="property-options props-field">
          <span>{translate('props.newProp.form.options')}</span>
          <ListField
            value={arrayText(form.options.map((option) => ({ text: option, quote: '"' })))}
            itemsMin={1}
            itemsMax={DECLARATION_LIMITS.optionsMax}
            valueCharsMax={DECLARATION_LIMITS.optionsMax * DECLARATION_LIMITS.optionCharsMax}
            onChange={(text) => form.setOptions(optionWords(text))}
          />
        </div>
      );
    case 'list':
      return (
        <ItemFieldsEditor
          fields={form.listFields}
          itemsText={form.listItems}
          onChange={(shape) => {
            form.setListFields(shape.fields);
            form.setListItems(shape.itemsText);
          }}
        />
      );
    case 'boolean':
    case 'string':
    case 'attributes':
    case 'image':
      return undefined;
    default: {
      const exhaustive: never = form.kind;
      return exhaustive;
    }
  }
}

function optionWords(text: string): readonly string[] {
  return (arrayItems(text) ?? []).filter((item) => item.fields === undefined).map((item) => item.text);
}

function DefaultEditor({ form, host }: { readonly form: FormState; readonly host: NewPropHost }) {
  const translate = useTranslate();
  switch (form.kind) {
    case 'string':
      return (
        <AutoTextarea
          value={form.defaultText}
          aria-label={translate('props.newProp.form.default')}
          placeholder={translate('props.newProp.form.none')}
          onChange={(event) => form.setDefaultText(event.target.value)}
        />
      );
    case 'number':
      return (
        <input
          className="new-prop-input"
          inputMode="decimal"
          aria-label={translate('props.newProp.form.default')}
          placeholder={translate('props.newProp.form.none')}
          value={form.defaultText}
          onChange={(event) => form.setDefaultText(event.target.value)}
        />
      );
    case 'boolean':
      return (
        <SegSwitch
          options={[
            { value: 'true', label: translate('props.newProp.form.true') },
            { value: 'false', label: translate('props.newProp.form.false') },
          ]}
          current={form.defaultText}
          onPick={form.setDefaultText}
        />
      );
    case 'option':
      return (
        <Dropdown
          ariaLabel={translate('props.newProp.form.default')}
          value={form.defaultText}
          options={[{ value: '', label: translate('props.newProp.form.none') }, ...form.options.map((option) => ({ value: option, label: option }))]}
          livePreview={false}
          onChange={form.setDefaultText}
        />
      );
    case 'attributes':
      return <AttributeDefaultsEditor defaults={form.attributes} onChange={form.setAttributes} />;
    case 'list':
      return undefined;
    case 'image':
      return host.projectPath === undefined ? (
        <input
          className="new-prop-input"
          aria-label={translate('props.newProp.form.default')}
          placeholder={translate('props.newProp.form.imagePlaceholder')}
          value={form.image}
          onChange={(event) => form.setImage(event.target.value)}
        />
      ) : (
        <AssetField
          value={form.image === '' ? undefined : form.image}
          mediaKind="image"
          projectPath={host.projectPath}
          baseDir={host.fileDirectory}
          pickPresentation="overlay"
          onChange={(value) => form.setImage(value)}
        />
      );
    default: {
      const exhaustive: never = form.kind;
      return exhaustive;
    }
  }
}

export function NumberSettingsEditor(props: { readonly settings: NumberSettings; readonly onChange: (settings: NumberSettings) => void }) {
  const translate = useTranslate();
  const field = (label: string, key: keyof NumberSettings, placeholder: string) => (
    <label className="loop-bind-name">
      <span className="loop-settings-editor-label">{label}</span>
      <input
        className="new-prop-input"
        inputMode="decimal"
        aria-label={label}
        placeholder={placeholder}
        value={props.settings[key] === undefined ? '' : String(props.settings[key])}
        onChange={(event) => {
          const text = event.target.value.trim();
          props.onChange({ ...props.settings, [key]: text === '' ? undefined : Number(text) });
        }}
      />
    </label>
  );
  return (
    <div className="new-prop-settings">
      <div className="loop-bind-title">{translate('props.newProp.form.numberSettings')}</div>
      {field(translate('props.newProp.form.min'), 'min', translate('props.newProp.form.none'))}
      {field(translate('props.newProp.form.max'), 'max', translate('props.newProp.form.none'))}
      {field(translate('props.newProp.form.decimals'), 'decimals', translate('props.newProp.form.auto'))}
    </div>
  );
}

function AttributeDefaultValue(props: {
  readonly name: string;
  readonly value: string;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}) {
  const language = attributeLanguage(props.name);
  if (language !== undefined) {
    return <CodeTextField value={props.value} language={language} ariaLabel={props.ariaLabel} placeholder={props.placeholder} onChange={props.onChange} />;
  }
  return (
    <input
      className="new-prop-input"
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      spellCheck={false}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

export function AttributeDefaultsEditor(props: {
  readonly defaults: readonly AttributeDefault[];
  readonly onChange: (defaults: readonly AttributeDefault[]) => void;
}) {
  const translate = useTranslate();
  const { defaults, onChange } = props;
  const set = (index: number, entry: AttributeDefault): void => onChange(defaults.map((current, at) => (at === index ? entry : current)));
  return (
    <div className="new-prop-attributes">
      {defaults.map((entry, index) => (
        <div className="new-prop-attribute" key={index}>
          <input
            className="new-prop-input"
            aria-label={translate('props.newProp.form.attributeName')}
            placeholder={translate('props.newProp.form.attributeNameHint')}
            spellCheck={false}
            value={entry.name}
            onChange={(event) => set(index, { ...entry, name: event.target.value.replace(/[^\w@:.-]/g, '') })}
          />
          <span className="attr-eq">=</span>
          <AttributeDefaultValue
            name={entry.name}
            value={entry.value}
            ariaLabel={translate('props.newProp.form.attributeValue')}
            placeholder={translate('props.newProp.form.attributeValueHint')}
            onChange={(value) => set(index, { ...entry, value })}
          />
          <button
            type="button"
            className="loop-settings-remove"
            aria-label={translate('props.newProp.form.removeAttribute')}
            title={translate('ui.remove')}
            onClick={() => onChange(defaults.filter((_, at) => at !== index))}
          >
            <TrashIcon size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="loop-bind-button new-prop-add" onClick={() => onChange([...defaults, { name: '', value: '' }])}>
        <PlusIcon size={11} /> {translate('props.attributes.add')}
      </button>
    </div>
  );
}
