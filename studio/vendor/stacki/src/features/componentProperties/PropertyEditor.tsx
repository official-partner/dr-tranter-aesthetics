import { useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import { ErrorToast } from '../../ui/ErrorToast';
import { NoticeToast } from '../../ui/NoticeToast';
import { PropertyConditions, PropertyDeclarationInfo } from './PropertyDeclarationInfo';
import { fallbackEdit, optionListEdit, useVariantHost, useVariantRun, variantRoleOf } from './PropertyVariants';
import type { VariantHost } from './PropertyVariants';
import { PropertyTooltipField, PropertyVisibilityField } from './PropertyVisibility';
import type { VariantDefault, VariantGroup } from '../../../shared/properties/variantRules';
import { variantDefaultOf } from '../../../shared/properties/variantRules';
import { CloseIcon, TrashIcon } from '../../ui/Icons';
import { PropertyOptions } from './PropertyOptions';
import { PropertyShareNotice, shareRenameFiles } from './PropertyShareNotice';
import type { PropertyOptionChange } from './PropertyOptions';
import { PropertyType, opensOnCode, type CodeMode } from './PropertyType';
import { PropertyDefault, propertyDefaultText } from './PropertyDefault';
import { PropertyDefaultNote, PropertyKindSettings } from './PropertySettings';
import { PropertyEditingSettings } from './PropertyEditingSettings';
import { literalOptions } from '../../../shared/properties/propertyOptions';
export { literalOptions };
import { useRef, useState, type ReactNode } from 'react';
import Popup from '../../ui/Popup';
import { assert } from '../../../shared/core/assert';
import type { ComponentProperty, PropertyChange, PropertyOptionRename } from '../../../shared/properties/propertyEditing';
import { PROPERTY_LIMITS } from '../../../shared/properties/propertyEditing';
import { listPropsOf, type ListProp } from '../../editor/listProps';
import { SETTING_PROP_TYPES } from '../../editor/optionsBinding';
import { fieldsProblem, type ItemFieldDeclaration } from '../../editor/itemFields';
import { listFieldsOfType, listTypeText } from '../../editor/listPropType';
import { ItemFieldsEditor, ListDefaultField, PropertyFlagsFields, type EditPace } from '../props/propBindings';
import { propertyProblem, usePropertyAutosave, type PropertySaveHost } from './propertyAutosave';
import { propertyKind } from './propertyKinds';

interface PropertyEditorProps {
  readonly property: ComponentProperty;
  readonly originalName: string;
  readonly frontmatter: string;
  readonly access: 'editable' | 'saving';
  readonly onClose: () => void;
  readonly onSave: (change: PropertyChange, after: 'edit' | 'close') => Promise<boolean>;
  readonly saveHost: PropertySaveHost;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly variantGroups?: readonly VariantGroup[] | undefined;
  readonly variantDefaults?: readonly VariantDefault[] | undefined;
  readonly properties?: readonly ComponentProperty[] | undefined;
}
const NO_PROPERTIES: readonly ComponentProperty[] = [];
const LOOSE_TYPES = new Set(['', 'unknown', 'any', 'object', 'Record<string, unknown>']);

export function withListSettingType(property: ComponentProperty, listProps: ReadonlyMap<string, ListProp>): ComponentProperty {
  if (!LOOSE_TYPES.has(property.type.trim())) {
    return property;
  }
  const listProp = listProps.get(property.name);
  return listProp === undefined ? property : { ...property, type: SETTING_PROP_TYPES[listProp.setting] };
}

export function PropertyEditor(props: PropertyEditorProps) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const editorRef = useRef<HTMLDivElement>(null);
  const draft = usePropertyEditorDraft(props);
  const variants = useVariantHost(props.variantGroups, { saveHost: props.saveHost, name: draft.savedName, rebase: draft.rebase });
  return (
    <Popup
      mode="popover"
      portal={false}
      className="property-editor"
      ref={editorRef}
      onClose={() => {
        draft.close();
        if (props.originalName === '' && draft.ready()) {
          draft.submit('close');
        }
        props.onClose();
      }}
      dismissible={props.access !== 'saving'}
    >
      {({ close }) => (
        <>
          <header>
            <div className="property-editor-title">
              <strong>{draft.exists ? translate('componentProps.dialog.title') : translate('componentProps.editor.newProperty')}</strong>
              <PropertyDeclarationInfo property={props.property} />
            </div>
            <button aria-label={translate('componentProps.dialog.close')} disabled={props.access === 'saving'} onClick={close}>
              <CloseIcon size={12} />
            </button>
          </header>
          {}
          {variantRoleOf(variants?.groups, draft.exists ? draft.savedName : '').kind === 'none' && <PropertyConditions property={props.property} />}
          <PropertyShareNotice property={props.property} onOpenFile={props.onOpenFile} />
          {props.property.editing?.kind === 'override' && (
            <p className="property-help">{translateDescribed({ message: props.property.editing.reason, messageRef: props.property.editing.reasonRef })}</p>
          )}
          <PropertyEditorFields
            form={draft}
            creating={!draft.exists}
            frontmatter={props.frontmatter}
            access={props.access}
            projectPath={undefined}
            variants={draft.exists ? variants : undefined}
            defaults={draft.exists ? { computed: props.variantDefaults, properties: props.properties ?? [] } : undefined}
            actions={
              <>
                {}
                <PropertyEditingSettings field={draft.exists ? draft.savedName : undefined} />
                <PropertyActions
                  name={draft.exists ? draft.savedName : ''}
                  removable={props.property.editing?.kind !== 'override' && props.property.shared === undefined}
                  onRemove={(name) => {
                    draft.discard();
                    void props.onSave({ kind: 'remove', name }, 'close');
                  }}
                />
              </>
            }
          />
        </>
      )}
    </Popup>
  );
}

export function PropertySettingsFields(props: {
  readonly property: ComponentProperty;
  readonly frontmatter: string;
  readonly projectPath: string | undefined;
  readonly saveHost: PropertySaveHost;
  readonly variantGroups?: readonly VariantGroup[] | undefined;
  readonly refreshVariantGroups?: () => Promise<readonly VariantGroup[] | undefined>;
  readonly variantDefaults?: readonly VariantDefault[] | undefined;
  readonly properties?: readonly ComponentProperty[] | undefined;
}) {
  const { property, frontmatter, projectPath, saveHost } = props;
  const draft = usePropertyEditorDraft({ property, originalName: property.name, frontmatter, onSave: async () => false, saveHost });
  const variants = useVariantHost(props.variantGroups, { saveHost, name: draft.savedName, rebase: draft.rebase }, props.refreshVariantGroups);
  assert(property.name !== '', 'PropertySettingsFields: the prop exists');
  return (
    <>
      {variantRoleOf(variants?.groups, draft.savedName).kind === 'none' && <PropertyConditions property={property} />}
      <PropertyEditorFields
        form={draft}
        creating={false}
        frontmatter={frontmatter}
        access="editable"
        projectPath={projectPath}
        variants={variants}
        defaults={{ computed: props.variantDefaults, properties: props.properties ?? [] }}
        actions={undefined}
      />
    </>
  );
}

function usePropertyEditorDraft(props: Pick<PropertyEditorProps, 'property' | 'originalName' | 'frontmatter' | 'onSave' | 'saveHost'>) {
  const translate = useTranslate();
  const [initial] = useState(() => ({ property: withListSettingType(props.property, listPropsOf(props.frontmatter)), optionRenames: [] }));
  const [exists, setExists] = useState(props.originalName !== '');
  const autosave = usePropertyAutosave(initial, exists ? props.saveHost : undefined);
  const { change, report } = autosave;
  const property = autosave.draft.property;
  const edit = (pace: EditPace, next: (current: ComponentProperty) => ComponentProperty): void => {
    change(pace, (current) => ({ ...current, property: next(current.property) }));
  };
  const update = <Key extends keyof ComponentProperty>(key: Key, value: ComponentProperty[Key], pace: EditPace = 'typing') => {
    change(pace, (current) => ({
      property: { ...current.property, [key]: value },
      optionRenames: key === 'type' ? [] : current.optionRenames,
    }));
  };
  const creating = useRef<'new' | 'sending' | 'created'>(props.originalName === '' ? 'new' : 'created');
  const ready = (): boolean => creating.current === 'new' && property.name.trim() !== '' && propertyProblem(property, translate) === undefined;
  const submit = (after: 'edit' | 'close'): void => {
    assert(props.originalName === '', 'submit: only a new prop is created');
    if (creating.current !== 'new') {
      return;
    }
    const problem = propertyProblem(property, translate);
    if (problem !== undefined) {
      report({ error: problem, notice: '' });
      return;
    }
    creating.current = 'sending';
    const sent = property;
    void props.onSave({ kind: 'save', originalName: '', property: sent }, after).then((done) => {
      if (!done) {
        creating.current = 'new';
        return;
      }
      creating.current = 'created';
      if (after === 'edit') {
        setExists(true);
        autosave.adopt({ ...sent, editing: { kind: 'editable' } }, props.saveHost);
      }
    });
  };
  const changeOptions = (optionChange: PropertyOptionChange): void => {
    const rename = optionChange.kind === 'draft' ? optionChange.rename : undefined;
    change(rename === undefined ? 'at-once' : 'typing', (current) => ({
      property: changePropertyOptions(current.property, optionChange.type, rename),
      optionRenames: changePropertyOptionRenames(current.optionRenames, optionChange),
    }));
  };
  return { ...autosave, property, exists, edit, update, ready, submit, changeOptions };
}

type PropertyForm = ReturnType<typeof usePropertyEditorDraft>;

interface PropertyEditorFieldsProps {
  readonly form: PropertyForm;
  readonly creating: boolean;
  readonly frontmatter: string;
  readonly access: 'editable' | 'saving';
  readonly projectPath: string | undefined;
  readonly actions: ReactNode;
  readonly variants: VariantHost | undefined;
  readonly defaults: { readonly computed: readonly VariantDefault[] | undefined; readonly properties: readonly ComponentProperty[] } | undefined;
}
function PropertyEditorFields({ form, creating, frontmatter, access, projectPath, actions, variants, defaults }: PropertyEditorFieldsProps) {
  const { property, update, error, notice } = form;
  const role = variantRoleOf(variants?.groups, creating ? '' : form.savedName);
  const report = (message: string): void => form.report({ error: message, notice: '' });
  const variantRun = useVariantRun(variants, report);
  const [optionDraft, setOptionDraft] = useState<string | undefined>(undefined);
  const inherited = property.editing?.kind === 'override';
  const listFields = usePropertyListFields(property, frontmatter);
  const code = usePropertyCodeMode(property);
  return (
    <fieldset disabled={access === 'saving'}>
      <PropertyIdentity form={form} creating={creating} inherited={inherited} />
      <PropertyType
        property={property}
        frontmatter={frontmatter}
        code={code.mode}
        optionsHoldCode={code.optionsHoldCode}
        locked={role.kind === 'controller'}
        onChange={(change, pace) => {
          if (change.type === property.type) {
            form.edit(pace, (current) => ({ ...current, ...change }));
          } else {
            form.change(pace, (current) => ({ property: { ...current.property, ...change }, optionRenames: [] }));
          }
        }}
      />
      {role.kind === 'controller' ? (
        <PropertyOptions
          type={optionDraft ?? property.type}
          disabled={access === 'saving' || variantRun.pending || role.group.editing.kind !== 'editable'}
          code={code.mode}
          onChange={() => undefined}
          onTypeChange={() => undefined}
          onListChange={(change, _options, next, commit) => {
            const edit = optionListEdit(role.group.controller, literalOptions(property.type) ?? [], next, change, commit);
            setOptionDraft(edit === undefined && commit === 'immediate' ? undefined : next.join(' | '));
            if (edit !== undefined) {
              void variantRun.run(edit).then(() => setOptionDraft(undefined));
            }
          }}
        />
      ) : (
        code.optionsHoldCode && (
          <PropertyOptions
            type={property.type}
            disabled={access === 'saving'}
            code={code.mode}
            onChange={form.changeOptions}
            onTypeChange={(type) => form.change('typing', (current) => ({ property: { ...current.property, type }, optionRenames: [] }))}
          />
        )
      )}
      <PropertyKindSettings key={`${property.type} settings`} property={property} onChange={(description) => update('description', description)} />
      {listFields !== undefined && <PropertyItemFields form={form} frontmatter={frontmatter} fields={listFields} />}
      {}
      {role.kind !== 'controller' &&
        (variants !== undefined && defaults !== undefined ? (
          <PropertyVisibilityField
            name={form.savedName}
            property={property}
            properties={defaults.properties}
            groups={variants.groups}
            pending={variantRun.pending}
            onRequired={(required) => form.edit('at-once', (current) => ({ ...current, required }))}
            run={variantRun.run}
            onProblem={report}
          />
        ) : (
          <PropertyFlagsFields
            required={property.required}
            readonly={property.readonly}
            onChange={(flags) => form.edit('at-once', (current) => ({ ...current, ...flags }))}
          />
        ))}
      {listFields === undefined ? (
        <PropertyDefault
          key={property.type}
          property={property}
          frontmatter={frontmatter}
          conditions={
            defaults === undefined || role.kind === 'controller'
              ? undefined
              : {
                  properties: defaults.properties,
                  computed: variantDefaultOf(defaults.computed, form.savedName),
                  onProblem: report,
                  onTable: (table, entries) => void variantRun.run({ kind: 'setDefaultTable', controller: table.controller, prop: table.prop, entries }),
                }
          }
          onChange={(value, pace) => {
            const fallback = role.kind === 'controller' ? fallbackEdit(role.group, value) : undefined;
            if (fallback === undefined) {
              update('defaultValue', value, pace);
            } else {
              void variantRun.run(fallback);
            }
          }}
        />
      ) : (
        <ListDefaultField
          fields={listFields.fields}
          code={property.defaultValue}
          projectPath={projectPath}
          onChange={(code, pace) => update('defaultValue', code, pace)}
        />
      )}
      <PropertyDefaultNote property={property} />
      {}
      <PropertyTooltipField
        name={form.savedName}
        property={property}
        properties={defaults?.properties ?? NO_PROPERTIES}
        groups={variants !== undefined && defaults !== undefined ? variants.groups : undefined}
        onChange={(description) => update('description', description)}
        run={variantRun.run}
        onProblem={report}
      />
      <ErrorToast message={error || undefined} />
      <NoticeToast message={notice || undefined} kind="info" />
      {actions}
    </fieldset>
  );
}

function usePropertyCodeMode(property: ComponentProperty): { readonly mode: CodeMode; readonly optionsHoldCode: boolean } {
  const [state, setState] = useState(() => ({ open: opensOnCode(property), place: placeOf(property.type) }));
  const optionsHoldCode = state.open ? state.place === 'options' : placeOf(property.type) === 'options';
  return {
    mode: { open: state.open, setOpen: (open) => setState({ open, place: placeOf(property.type) }) },
    optionsHoldCode,
  };
}

function placeOf(type: string): 'kind' | 'options' {
  return literalOptions(type) === undefined ? 'kind' : 'options';
}

function PropertyActions({ name, removable, onRemove }: { readonly name: string; readonly removable: boolean; readonly onRemove: (name: string) => void }) {
  const translate = useTranslate();
  if (name === '' || !removable) {
    return undefined;
  }
  return (
    <div className="property-actions">
      <button
        className="danger"
        aria-label={translate('componentProps.editor.deleteNamed', { name })}
        title={translate('componentProps.editor.delete')}
        onClick={() => onRemove(name)}
      >
        <TrashIcon size={14} />
      </button>
    </div>
  );
}

function PropertyIdentity({ form, creating, inherited }: { readonly form: PropertyForm; readonly creating: boolean; readonly inherited: boolean }) {
  const translate = useTranslate();
  return (
    <>
      <label>
        {translate('componentProps.editor.name')}
        <input
          value={form.nameText}
          aria-invalid={form.nameError !== '' ? true : undefined}
          maxLength={PROPERTY_LIMITS.nameCharsMax}
          autoFocus={!inherited}
          disabled={inherited}
          onChange={(event) => form.setName(event.target.value)}
          onBlur={() => commit(form, { creating })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(form, { creating });
            }
          }}
        />
      </label>
      <ErrorToast message={form.nameError || undefined} />
      {!creating && form.nameError === '' && form.savedName !== form.nameText && <RenameHelp property={form.property} />}
    </>
  );
}
function commit(form: PropertyForm, { creating }: { readonly creating: boolean }): void {
  if (!creating) {
    form.commitName();
    return;
  }
  if (form.property.name.trim() === '') {
    return;
  }
  form.submit('edit');
}

function RenameHelp({ property }: { readonly property: ComponentProperty }) {
  const translate = useTranslate();
  const share = property.shared;
  if (share === undefined) {
    return <p className="property-help">{translate('componentProps.editor.renameHelp')}</p>;
  }
  return (
    <div className="property-help" role="status">
      {translate('componentProps.editor.renameShared', { typeName: share.typeName })}
      <ul className="property-rename-files">
        {shareRenameFiles(share).map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

interface ListFieldsDraft {
  readonly type: string;
  readonly fields: readonly ItemFieldDeclaration[];
}

function usePropertyListFields(
  property: ComponentProperty,
  frontmatter: string,
): (ListFieldsDraft & { readonly set: (draft: ListFieldsDraft) => void }) | undefined {
  const [draft, setDraft] = useState<ListFieldsDraft | undefined>(undefined);
  if (propertyKind(property) !== 'list') {
    return undefined;
  }
  if (draft !== undefined && draft.type === property.type) {
    return { ...draft, set: setDraft };
  }
  const fields = listFieldsOfType(property.type, frontmatter);
  return fields === undefined ? undefined : { type: property.type, fields, set: setDraft };
}

function PropertyItemFields({
  form,
  frontmatter,
  fields,
}: {
  readonly form: PropertyForm;
  readonly frontmatter: string;
  readonly fields: NonNullable<ReturnType<typeof usePropertyListFields>>;
}) {
  const { property } = form;
  return (
    <ItemFieldsEditor
      fields={fields.fields}
      itemsText={property.defaultValue.trim() === '' ? '[]' : property.defaultValue}
      onChange={(shape, pace) => {
        const valid = fieldsProblem(shape.fields) === undefined;
        const type = valid ? listTypeText(frontmatter, shape.fields) : property.type;
        fields.set({ type, fields: shape.fields });
        form.hold(valid ? 'free' : 'held');
        form.edit(pace, (current) => ({ ...current, type, defaultValue: shape.itemsText }));
      }}
    />
  );
}

function changePropertyOptions(property: ComponentProperty, type: string, rename?: PropertyOptionRename): ComponentProperty {
  if (rename && property.defaultValue.trim()) {
    const current = propertyDefaultText(property.defaultValue);
    const same = property.defaultValue.trim() === rename.from || (current !== undefined && current === propertyDefaultText(rename.from));
    if (same) {
      return { ...property, type, defaultValue: rename.to };
    }
  }
  return { ...property, type };
}

function changePropertyOptionRenames(current: readonly PropertyOptionRename[], change: PropertyOptionChange): readonly PropertyOptionRename[] {
  const options = literalOptions(change.type);
  assert(options !== undefined, 'Edited property options remain a literal union');
  const retained = current.filter((rename) => options.includes(rename.to));
  const rename = change.kind === 'draft' ? change.rename : undefined;
  if (!rename) {
    return retained;
  }
  const previous = retained.find((item) => item.to === rename.from);
  const from = previous?.from ?? rename.from;
  const withoutPrevious = retained.filter((rename) => rename !== previous);
  if (from === rename.to) {
    return withoutPrevious;
  }
  assert(withoutPrevious.length < PROPERTY_LIMITS.fieldsMax, 'Option rename count is bounded');
  return [...withoutPrevious, { from, to: rename.to }];
}
