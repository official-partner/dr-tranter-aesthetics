
import { ErrorToast } from '../../ui/ErrorToast';
import { useRef, type ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../../shared/properties/i18n/messageRef';
import {
  BracesIcon,
  CalendarIcon,
  DropletIcon,
  FieldNumberIcon,
  FieldSwitchIcon,
  MailIcon,
  PaperclipIcon,
  ParagraphIcon,
  PhoneCallIcon,
  PlusIcon,
  TextIcon,
  TrashIcon,
} from '../../ui/Icons';
import { BoldIcon } from '../../ui/richTextIcons';
import { ElementDivIcon, ElementImageIcon, ElementLinkIcon, ElementListDefaultIcon, ElementSelectIcon, ElementVideoIcon } from '../../ui/ElementIcons';
import Dropdown, { type DropdownOption } from '../../ui/Dropdown';
import ExprInput from '../../ui/ExprInput';
import { assert } from '../../../shared/core/assert';
import { PROPERTY_LIMITS } from '../../../shared/properties/propertyEditing';
import {
  fieldNameProblem,
  fieldsOf,
  fieldsProblem,
  ITEM_FIELD_KINDS,
  ITEM_FIELD_LIMITS,
  itemFieldTitle,
  type ItemFieldDeclaration,
  type ItemFieldKind,
} from '../../editor/itemFields';
import type { Attr } from '../../../shared/page/pageNode';
import { arrayItems, arrayText, type Item } from './arrayValue';
import { addedField, fieldAtPath, optionsAtPath, removedFieldAt, renamedFieldAt, retypedFieldAt, type FieldPath, type ListShape } from './itemFieldEdits';
import { shapeMembersOf } from './listItemShape';
import ListField from './ListField';
import PropField from './PropField';
import type { FieldDefinition } from './propRules';
import './loopSettings.css';

export type { ListShape };

export type EditPace = 'typing' | 'at-once';

export interface PropertyFlags {
  readonly required: boolean;
  readonly readonly: boolean;
}

export function PropertyFlagsFields(props: PropertyFlags & { readonly onChange: (flags: PropertyFlags) => void }) {
  const translate = useTranslate();
  const { required, readonly, onChange } = props;
  return (
    <div className="property-flags" role="group" aria-label={translate('props.sections.flags')}>
      <label>
        <input
          type="checkbox"
          aria-label={translate('props.sections.required')}
          checked={required}
          onChange={(event) => onChange({ required: event.target.checked, readonly })}
        />
        {translate('props.sections.required')}
      </label>
    </div>
  );
}

export function CodeTypeToggle(props: { readonly open: boolean; readonly onToggle: () => void }) {
  const translate = useTranslate();
  const action = props.open ? translate('props.sections.useControls') : translate('props.sections.editCodeType');
  return (
    <button
      type="button"
      className={`prop-expr-toggle property-code-toggle${props.open ? ' on' : ''}`}
      aria-pressed={props.open}
      aria-label={action}
      title={action}
      onClick={props.onToggle}
    >
      <BracesIcon size={12} />
    </button>
  );
}

export function CodeTypeEditor(props: { readonly type: string; readonly placeholder: string; readonly onChange: (type: string) => void }) {
  const translate = useTranslate();
  return (
    <ExprInput
      ariaLabel={translate('props.sections.codeType')}
      className="property-code"
      language="typescript"
      value={props.type}
      syncValue={props.type}
      placeholder={props.placeholder}
      onChange={(type) => {
        if (type.length <= PROPERTY_LIMITS.textCharsMax) {
          props.onChange(type);
        }
      }}
    />
  );
}

export function CodeTypeField(props: {
  readonly type: string;
  readonly placeholder: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onChange: (type: string) => void;
}) {
  const translate = useTranslate();
  return (
    <>
      <div className="property-code-heading">
        <span>{translate('props.sections.codeType')}</span>
        <CodeTypeToggle open={props.open} onToggle={props.onToggle} />
      </div>
      {props.open && <CodeTypeEditor type={props.type} placeholder={props.placeholder} onChange={props.onChange} />}
    </>
  );
}

const ITEM_KIND_ICONS: Readonly<Record<ItemFieldKind, ReactNode>> = {
  text: <TextIcon size={14} />,
  longText: <ParagraphIcon size={14} />,
  richText: <BoldIcon size={14} />,
  number: <FieldNumberIcon size={14} />,
  switch: <FieldSwitchIcon size={14} />,
  image: <ElementImageIcon size={14} />,
  video: <ElementVideoIcon size={14} />,
  file: <PaperclipIcon size={14} />,
  link: <ElementLinkIcon size={14} />,
  email: <MailIcon size={14} />,
  phone: <PhoneCallIcon size={14} />,
  color: <DropletIcon size={14} />,
  date: <CalendarIcon size={14} />,
  option: <ElementSelectIcon size={14} />,
  list: <ElementListDefaultIcon size={14} />,
  group: <ElementDivIcon size={14} />,
};

const ITEM_KIND_GROUPS: Readonly<Record<ItemFieldKind, MessageKey>> = {
  text: 'props.itemKinds.group.text',
  longText: 'props.itemKinds.group.text',
  richText: 'props.itemKinds.group.text',
  number: 'props.itemKinds.group.values',
  switch: 'props.itemKinds.group.values',
  color: 'props.itemKinds.group.values',
  date: 'props.itemKinds.group.values',
  option: 'props.itemKinds.group.values',
  image: 'props.itemKinds.group.media',
  video: 'props.itemKinds.group.media',
  file: 'props.itemKinds.group.media',
  link: 'props.itemKinds.group.contact',
  email: 'props.itemKinds.group.contact',
  phone: 'props.itemKinds.group.contact',
  list: 'props.itemKinds.group.structure',
  group: 'props.itemKinds.group.structure',
};

export function itemKindOptions(kinds: readonly ItemFieldKind[], translate: Translator = ENGLISH_TRANSLATE): readonly DropdownOption<ItemFieldKind>[] {
  return kinds.map((kind) => ({ value: kind, label: itemFieldTitle(kind, translate), group: translate(ITEM_KIND_GROUPS[kind]), icon: ITEM_KIND_ICONS[kind] }));
}

export const ITEM_KIND_OPTIONS = itemKindOptions(ITEM_FIELD_KINDS);
const PLAIN_KINDS = ITEM_FIELD_KINDS.filter((kind) => kind !== 'list' && kind !== 'group');
export const ITEM_KIND_OPTIONS_PLAIN = itemKindOptions(PLAIN_KINDS);

const ITEM_FIELD_MENU_WIDTH_PX_MIN = 148;

type ShapeChange = (shape: ListShape, pace: EditPace) => void;

export function ItemFieldsEditor(props: ListShape & { readonly onChange: ShapeChange }) {
  const translate = useTranslate();
  const { fields, itemsText, onChange } = props;
  const heldKeys = useRef(new Map<string, string>());
  const problem = fieldsProblem(fields, 1, translate);
  return (
    <div className="new-prop-settings property-item-fields" role="group" aria-label={translate('props.sections.itemFields')}>
      <div className="loop-bind-title">{translate('props.sections.itemFields')}</div>
      <ItemFieldRows shape={{ fields, itemsText }} parent={[]} heldKeys={heldKeys.current} onChange={onChange} />
      <ErrorToast message={problem} />
    </div>
  );
}

interface RowsProps {
  readonly shape: ListShape;
  readonly parent: FieldPath;
  readonly heldKeys: Map<string, string>;
  readonly onChange: ShapeChange;
}

function ItemFieldRows({ shape, parent, heldKeys, onChange }: RowsProps) {
  const translate = useTranslate();
  assert(parent.length < ITEM_FIELD_LIMITS.depthMax, 'ItemFieldRows: the fields nest within their bound');
  const owner = parent.length === 0 ? undefined : fieldAtPath(shape.fields, parent);
  const siblings = owner === undefined ? shape.fields : fieldsOf(owner);
  return (
    <>
      {siblings.map((field, index) => (
        <ItemFieldRow
          key={index}
          field={field}
          path={[...parent, index]}
          siblingCount={siblings.length}
          shape={shape}
          heldKeys={heldKeys}
          onChange={onChange}
        />
      ))}
      <button
        type="button"
        className="loop-bind-button new-prop-add"
        disabled={siblings.length >= ITEM_FIELD_LIMITS.fieldsPerLevelMax}
        onClick={() => onChange(addedField(shape, parent), 'at-once')}
      >
        <PlusIcon size={11} /> {translate('props.sections.addField')}
      </button>
    </>
  );
}

function ItemFieldRow(props: Omit<RowsProps, 'parent'> & { readonly field: ItemFieldDeclaration; readonly path: FieldPath; readonly siblingCount: number }) {
  const translate = useTranslate();
  const { field, path, siblingCount, shape, heldKeys, onChange } = props;
  const heldAt = path.join('.');
  const rename = (name: string): void => {
    const key = fieldNameProblem(field.name) === undefined ? field.name : (heldKeys.get(heldAt) ?? field.name);
    if (fieldNameProblem(name) === undefined) {
      heldKeys.delete(heldAt);
    } else {
      heldKeys.set(heldAt, key);
    }
    onChange(renamedFieldAt(shape, path, name, key), 'typing');
  };
  const remove = (): void => {
    heldKeys.clear();
    onChange(removedFieldAt(shape, path), 'at-once');
  };
  return (
    <>
      <div className="new-prop-list-field">
        <input
          className="new-prop-input"
          aria-label={translate('props.sections.fieldName')}
          placeholder={translate('props.newProp.form.attributeNameHint')}
          spellCheck={false}
          value={field.name}
          onChange={(event) => rename(event.target.value.replace(/[^\w$]/g, ''))}
        />
        <Dropdown
          ariaLabel={translate('props.sections.fieldType')}
          value={field.kind}
          options={itemKindOptions(path.length < ITEM_FIELD_LIMITS.depthMax ? ITEM_FIELD_KINDS : PLAIN_KINDS, translate)}
          livePreview={false}
          menuWidthMin={ITEM_FIELD_MENU_WIDTH_PX_MIN}
          onChange={(kind) => onChange(retypedFieldAt(shape, path, kind), 'at-once')}
        />
        <button
          type="button"
          className="loop-settings-remove"
          aria-label={translate('props.sections.removeField')}
          title={translate('ui.remove')}
          disabled={siblingCount <= 1}
          onClick={remove}
        >
          <TrashIcon size={12} />
        </button>
      </div>
      {field.kind === 'option' && <OptionChoices field={field} onChange={(options) => onChange(optionsAtPath(shape, path, options), 'at-once')} />}
      {(field.kind === 'list' || field.kind === 'group') && (
        <div className="property-nested-fields" role="group" aria-label={translate('props.sections.fieldsOf', { name: field.name })}>
          <div className="property-nested-title">
            {field.kind === 'list' ? translate('props.sections.eachItemHas', { name: field.name }) : translate('props.sections.groupHas', { name: field.name })}
          </div>
          <ItemFieldRows shape={shape} parent={path} heldKeys={heldKeys} onChange={onChange} />
        </div>
      )}
    </>
  );
}

function OptionChoices(props: { readonly field: Extract<ItemFieldDeclaration, { kind: 'option' }>; readonly onChange: (options: readonly string[]) => void }) {
  const translate = useTranslate();
  const items: readonly Item[] = props.field.options.map((option) => ({ text: option, quote: '"' }));
  return (
    <div className="property-nested-fields property-option-choices" role="group" aria-label={translate('props.sections.optionsOf', { name: props.field.name })}>
      <div className="property-nested-title">{translate('props.newProp.form.options')}</div>
      <ListField
        value={arrayText(items)}
        itemsMin={2}
        itemsMax={ITEM_FIELD_LIMITS.optionsMax}
        valueCharsMax={ITEM_FIELD_LIMITS.optionsMax * ITEM_FIELD_LIMITS.optionCharsMax}
        onChange={(text) => props.onChange(optionWords(text))}
      />
    </div>
  );
}

function optionWords(text: string): readonly string[] {
  return (arrayItems(text) ?? []).map((item) => item.text ?? '').slice(0, ITEM_FIELD_LIMITS.optionsMax);
}

export function ListDefaultField(props: {
  readonly fields: readonly ItemFieldDeclaration[];
  readonly code: string;
  readonly projectPath: string | undefined;
  readonly onChange: (code: string, pace: EditPace) => void;
}) {
  const translate = useTranslate();
  const field = listDefaultField(props.fields, translate);
  const shapeKey = JSON.stringify(props.fields);
  return (
    <div className="property-default property-list-default" role="group" aria-label={translate('props.sections.defaultItems')}>
      <PropField
        key={shapeKey}
        nodeKey="default-items"
        field={field}
        value={defaultAttr(props.code)}
        assetContext={props.projectPath === undefined ? undefined : { projectPath: props.projectPath }}
        onChange={(next, immediate) => props.onChange(defaultCodeOf(next), immediate === true ? 'at-once' : 'typing')}
      />
    </div>
  );
}

export function listDefaultField(fields: readonly ItemFieldDeclaration[], translate: Translator = ENGLISH_TRANSLATE): FieldDefinition {
  assert(fields.length <= ITEM_FIELD_LIMITS.fieldsPerLevelMax, 'listDefaultField: the fields are bounded');
  return {
    name: translate('props.sections.defaultItems'),
    type: 'code',
    optional: true,
    shape: shapeMembersOf(fields),
    shapeIsList: true,
  };
}

export function defaultAttr(code: string): Attr | undefined {
  const text = code.trim();
  return text === '' ? undefined : { type: 'expr', value: text };
}

export function defaultCodeOf(value: Attr | undefined): string {
  if (value === undefined) {
    return '';
  }
  switch (value.type) {
    case 'expr':
      return value.value;
    case 'string':
      return JSON.stringify(value.value);
    case 'bare':
      return 'true';
    case 'spread':
      assert(false, 'defaultCodeOf: a default is not a spread');
      return '';
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}
