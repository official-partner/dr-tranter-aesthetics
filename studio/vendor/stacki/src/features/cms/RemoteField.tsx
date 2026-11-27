import { useContext } from 'react';
import {
  isLocked,
  remoteObject,
  type RemoteOption,
  type RemoteSchemaField,
  type RemoteType,
  type RemoteValue,
} from '../../../shared/properties/cmsRemoteSchema';
import { CmsFieldFrame, CmsPropField, type CmsScalar, type CmsScalarKind } from './CmsPropField';
import type { Translator } from '../../lib/i18n/localeContext';
import { fieldTypeOf } from './remoteFieldTypes';
import { problemsOf, requiredMessage } from './remoteValidation';
import { fieldTitle, isEmptyValue } from './remoteValues';
import { RemoteValueEditor, type RemoteEditContext } from './RemoteValueEditor';
import { useLocale, useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import AssetField from '../../ui/AssetField';
import MarkdownField from '../../ui/MarkdownField';
import Dropdown from '../../ui/Dropdown';
import { hasOptionImage, OPTION_IMAGE_MENU, OptionImage } from './projectImages';
import { ReferenceIcon, referenceTitle, useReferenceOptions } from './RemoteReferenceInput';
import { typeIcons } from './SanityTypeIcon';
import { FieldChecksContext } from './remoteCmsShared';
import { NoticeToast } from '../../ui/NoticeToast';

export function RemoteField(props: {
  readonly field: RemoteSchemaField;
  readonly value: RemoteValue | undefined;
  readonly context: RemoteEditContext;
  readonly requiredShown?: boolean | undefined;
  readonly onChange: (value: RemoteValue | undefined) => void;
}) {
  const { field, value } = props;
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const checks = useContext(FieldChecksContext);
  const missing = checks === 'shown' && props.requiredShown === true && field.required && isEmptyValue(value);
  const problems = checks === 'shown' ? problemsOf(field, value, translate) : [];
  const name = field.titleRef === undefined ? fieldTitle(field) : translateDescribed({ message: field.title, messageRef: field.titleRef });
  const help = field.descriptionRef === undefined ? field.description : translateDescribed({ message: field.description, messageRef: field.descriptionRef });
  const invalid = missing || problems.some((problem) => problem.level === 'error');
  const scalar = scalarOf(field.type);
  const { icon: Icon } = fieldTypeOf(field.type);
  return (
    <div className={`remote-cms-field${field.required ? ' is-required' : ''}${invalid ? ' is-invalid' : ''}`} data-kind={field.type.kind}>
      {isLocked(field, value) ? (
        <CmsFieldFrame name={name} help={lockedHelp(field, translate)} icon={<Icon size={12} />} set={!isEmptyValue(value)}>
          <LockedValue type={field.type} value={value} context={props.context} />
        </CmsFieldFrame>
      ) : isImagePath(field.type) ? (
        <CmsFieldFrame name={name} help={help} icon={<Icon size={12} />} set={!isEmptyValue(value)}>
          <ImagePathField value={value} context={props.context} onChange={props.onChange} />
        </CmsFieldFrame>
      ) : isMarkdown(field.type) ? (
        <CmsFieldFrame name={name} help={help} icon={<Icon size={12} />} set={!isEmptyValue(value)}>
          <MarkdownField value={typeof value === 'string' ? value : ''} label={name} onChange={(next) => props.onChange(next === '' ? undefined : next)} />
        </CmsFieldFrame>
      ) : titledOptions(field.type) ? (
        <CmsFieldFrame name={name} help={help} icon={<Icon size={12} />} set={!isEmptyValue(value)}>
          <TitledChoice label={name} options={titledOptions(field.type) ?? []} value={value} onChange={props.onChange} />
        </CmsFieldFrame>
      ) : scalar ? (
        <CmsPropField
          name={name}
          help={help}
          kind={scalar.kind}
          options={scalar.options}
          value={scalar.read(value)}
          onChange={(next) => props.onChange(scalar.write(next))}
        />
      ) : (
        <CmsFieldFrame name={name} help={help} icon={<Icon size={12} />} set={!isEmptyValue(value)}>
          <RemoteValueEditor type={field.type} label={name} value={value} context={props.context} onChange={props.onChange} />
        </CmsFieldFrame>
      )}
      {}
      {missing && <NoticeToast message={requiredMessage(field, translate)} kind="error" />}
      {problems
        .filter((problem) => problem.rule !== 'required')
        .map((problem) => (
          <NoticeToast key={problem.message} message={problem.message} kind={problem.level === 'error' ? 'error' : 'warning'} />
        ))}
    </div>
  );
}

function lockedHelp(field: RemoteSchemaField, translate: Translator): string {
  const why = translate(field.readOnly === 'when-set' ? 'cmsRemote.field.lockedOnce' : 'cmsRemote.field.readOnly');
  return field.description === '' ? why : `${field.description} ${why}`;
}

function LockedValue(props: { readonly type: RemoteType; readonly value: RemoteValue | undefined; readonly context: RemoteEditContext }) {
  const { type, value } = props;
  const translate = useTranslate();
  if (type.kind === 'reference') {
    return <LockedReference to={type.to} value={value} context={props.context} />;
  }
  const scalar = scalarOf(type);
  if (scalar !== undefined) {
    const read = scalar.read(value);
    const option = type.kind === 'string' ? type.options.find((entry) => entry.value === read) : undefined;
    const text = option?.title ?? (typeof read === 'boolean' ? translate(read ? 'cmsRemote.common.yes' : 'cmsRemote.common.no') : String(read ?? ''));
    return (
      <div className="remote-cms-locked">{text === '' ? <span className="remote-cms-locked-empty">{translate('cmsRemote.field.empty')}</span> : text}</div>
    );
  }
  return (
    <fieldset className="remote-cms-locked-control" disabled>
      <RemoteValueEditor type={type} label="" value={value} context={props.context} onChange={() => undefined} />
    </fieldset>
  );
}

function LockedReference(props: { readonly to: readonly string[]; readonly value: RemoteValue | undefined; readonly context: RemoteEditContext }) {
  const translate = useTranslate();
  const options = useReferenceOptions(props.context, props.to);
  const id = remoteObject(props.value)?.['_ref'];
  const option = options.find((entry) => entry.id === id);
  return (
    <div className="remote-cms-locked">
      {option && <ReferenceIcon option={option} sanity={typeIcons(props.context.connectionId).get(option.type)} placeholder={false} />}
      {referenceTitle(props.value, options, translate)}
    </div>
  );
}

function titledOptions(type: RemoteType): readonly RemoteOption[] | undefined {
  if (type.kind !== 'string') {
    return undefined;
  }
  return type.options.some((option) => option.title !== option.value) ? type.options : undefined;
}

function TitledChoice(props: {
  readonly label: string;
  readonly options: readonly RemoteOption[];
  readonly value: RemoteValue | undefined;
  readonly onChange: (value: RemoteValue | undefined) => void;
}) {
  const translate = useTranslate();
  const { locale } = useLocale();
  const current = typeof props.value === 'string' ? props.value : '';
  const known = props.options.some((option) => option.value === current);
  const pictures = hasOptionImage(props.options);
  const options = [
    { value: '', label: translate('cmsRemote.common.none') },
    ...(known || current === '' ? [] : [{ value: current, label: current, dim: true }]),
    ...props.options.map((option) => ({
      value: option.value,
      label: option.title,
      icon: <OptionImage file={option.imageFile} placeholder={pictures} />,
    })),
  ];
  return (
    <Dropdown
      value={current}
      livePreview={false}
      ariaLabel={props.label}
      placeholder={translate('cmsRemote.field.choose', { field: props.label.toLocaleLowerCase(locale) })}
      searchable={props.options.length > 8}
      searchPlaceholder={translate('ui.search')}
      menuClassName={pictures ? OPTION_IMAGE_MENU : ''}
      options={options}
      onChange={(next) => props.onChange(next === '' ? undefined : next)}
    />
  );
}

function isImagePath(type: RemoteType): boolean {
  return type.kind === 'string' && type.asset === 'image';
}

function ImagePathField(props: {
  readonly value: RemoteValue | undefined;
  readonly context: RemoteEditContext;
  readonly onChange: (value: RemoteValue | undefined) => void;
}) {
  return (
    <AssetField
      value={typeof props.value === 'string' ? props.value : ''}
      mediaKind="image"
      showModeToggle={false}
      pickPresentation="overlay"
      projectPath={props.context.projectPath}
      baseDir={props.context.folder}
      onChange={(next) => props.onChange(next === '' ? undefined : next)}
    />
  );
}

export function RemoteObjectEditor(props: {
  readonly fields: readonly RemoteSchemaField[];
  readonly typeName: string | undefined;
  readonly columns?: number | undefined;
  readonly value: RemoteValue | undefined;
  readonly context: RemoteEditContext;
  readonly onChange: (value: RemoteValue | undefined) => void;
}) {
  const object = remoteObject(props.value) ?? {};
  const context = { ...props.context, depth: props.context.depth + 1 };
  const change = (name: string, next: RemoteValue | undefined) => {
    const rest = Object.fromEntries(Object.entries(object).filter(([key]) => key !== name));
    const typed = props.typeName && props.typeName !== 'object' ? { _type: props.typeName } : {};
    props.onChange({ ...typed, ...rest, ...(next === undefined ? {} : { [name]: next }) });
  };
  return (
    <div className="remote-cms-group" style={props.columns ? { gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` } : undefined}>
      {props.fields.map((field) => (
        <RemoteField key={field.name} field={field} value={object[field.name]} context={context} onChange={(next) => change(field.name, next)} />
      ))}
    </div>
  );
}

interface Scalar {
  readonly kind: CmsScalarKind;
  readonly options: readonly string[];
  readonly read: (value: RemoteValue | undefined) => CmsScalar | undefined;
  readonly write: (value: CmsScalar | undefined) => RemoteValue | undefined;
}

const asText = (value: RemoteValue | undefined) => (typeof value === 'string' ? value : undefined);
const same = (value: CmsScalar | undefined): RemoteValue | undefined => value;

function isMarkdown(type: RemoteType): boolean {
  return type.kind === 'text' && type.format === 'markdown';
}

function scalarOf(type: RemoteType): Scalar | undefined {
  switch (type.kind) {
    case 'string':
    case 'url':
    case 'email':
      return {
        kind: 'string',
        options: type.options.map((option) => option.value),
        read: asText,
        write: same,
      };
    case 'text':
      return { kind: 'text', options: [], read: asText, write: same };
    case 'number':
      return {
        kind: 'number',
        options: [],
        read: (value) => (typeof value === 'number' ? value : undefined),
        write: same,
      };
    case 'boolean':
      return {
        kind: 'boolean',
        options: [],
        read: (value) => (typeof value === 'boolean' ? value : undefined),
        write: same,
      };
    case 'slug':
      return {
        kind: 'string',
        options: [],
        read: (value) => asText(remoteObject(value)?.['current']),
        write: (value) => (value === undefined ? undefined : { _type: 'slug', current: String(value) }),
      };
    case 'date':
    case 'datetime':
    case 'geopoint':
    case 'object':
    case 'image':
    case 'file':
    case 'reference':
    case 'array':
    case 'richText':
      return undefined;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}
