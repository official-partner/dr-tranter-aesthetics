import { useTranslate } from '../../lib/i18n/useTranslate';
import Popup from '../../ui/Popup';
import { dataPickerPosition } from './dataPickerPosition';
import { useEffect, useRef, useState } from 'react';
import { useCodeAccess, ManagedValue } from '../../ui/CodeAccess';
import type { BindInputHandle } from './BindInput';
import type { ExprInputAPI } from '../../ui/ExprInput';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { definedFields } from '../../../shared/core/boundary';
import { dataTree, scopeChips, scopeCompletions } from '../../editor/dataSuggest';
import { partsFromValue, resolvePick, templateHoles, valueFromParts, valueModeOf, type PickNeed } from '../../editor/bindings';
import BindInput from './BindInput';
import CodeBindInput, { partsHoldHoles } from './CodeBindInput';
import { attributeLanguageOf, type AttributeLanguage } from '../../ui/attributeLanguage';
import DataPicker from './DataPicker';
import { BindOverrideWaiting, pickerPaths, useBindOverride } from './bindOverride';
import ExprInput from '../../ui/ExprInput';
import { type FieldPosition, type Chip, type BindFieldProps } from './bindingTypes';
import { referencedName, symbolTarget, VarSourceEditor } from './BindingEditors';
export { default as CodeTextField } from './CodeTextField';
export { ComputedDefault, ConditionalDefaultField, ConditionalDefaultStart, useDefaultConditionContext } from './ConditionalDefaultField';
export {
  conditionalOfDefault,
  conditionSchema,
  defaultOfConditional,
  optionDefaultStart,
  tooltipConditional,
  tooltipEntries,
  type OptionTooltip,
  tableConditional,
  tableEntries,
  type TableDefault,
} from './conditionalDefault';
export { stateOf, tooltipCode, visibilityCode, visibilityConditional, visibilityRules, type VisibilityController, type VisibilityProblem } from './visibility';
export { conditionWords, conditionProps } from './conditionalModel';
export { ValueChoiceSwitch, type ValueChoice } from './ValueChoices';
export { dataPickerPosition } from './dataPickerPosition';
export {
  referencedName,
  SourceEditButton,
  ExprValueField,
  ConditionField,
  ExpressionBindingField,
  BindHandle,
  FieldDataPicker,
  ValueCodeEditor,
} from './BindingEditors';

export {
  CodeTypeEditor,
  CodeTypeField,
  CodeTypeToggle,
  ItemFieldsEditor,
  ListDefaultField,
  PropertyFlagsFields,
  defaultAttr,
  defaultCodeOf,
  listDefaultField,
  type EditPace,
  type ListShape,
  type PropertyFlags,
} from './PropertySections';

export { type FieldPosition, type FieldPickerAt, type SourceContext, type ValueChange, type InsertAPI } from './bindingTypes';

function chipExpr(chip: Chip | undefined) {
  if (!chip) {
    return '';
  }
  if ('path' in chip) {
    return chip.path;
  }
  if ('getAttribute' in chip) {
    return chip.getAttribute('data-expr') || '';
  }
  return '';
}

function chipPath(chip: Chip | undefined) {
  if (chip && 'getAttribute' in chip) {
    return chip.getAttribute('data-full') || chip.getAttribute('data-expr') || '';
  }
  return chipExpr(chip);
}

export function BindField(props: BindFieldProps) {
  return useCodeAccess() ? <EditableBindField {...props} /> : <ClientBindField {...props} />;
}
function ClientBindField({ value, onChange, placeholder }: BindFieldProps) {
  if (value && value.type !== 'string') {
    return <ManagedValue />;
  }
  return <input value={value?.value ?? ''} placeholder={placeholder ?? ''} onChange={(event) => onChange({ type: 'string', value: event.target.value })} />;
}
function EditableBindField(props: BindFieldProps) {
  const state = useBindFieldModel(props);
  const actions = useBindFieldActions(state);
  useBindFieldAPI(state);
  return <BindFieldView state={{ ...state, ...actions }} />;
}
function useBindFieldModel(props: BindFieldProps) {
  const { value, field, bindContext } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<BindInputHandle>(null);
  const [menu, setMenu] = useState<(FieldPosition & { readonly chip: Chip | undefined }) | undefined>(undefined);
  const [source, setSource] = useState<(FieldPosition & { readonly name: string }) | undefined>(undefined);
  const exprApiRef = useRef<ExprInputAPI | undefined>(undefined);
  const [raw, setRaw] = useState(false);
  const scopeNames = new Set(scopeCompletions(bindContext || {}).map((completion) => completion.label.split('.')[0] ?? ''));
  const codeChips = (text: string) => {
    const holes = templateHoles(text);
    const taken = (from: number, to: number) => holes.some((hole) => from < hole.to && to > hole.from);
    return [...holes, ...scopeChips(text, scopeNames).filter((chip) => !taken(chip.from, chip.to))].sort((left, right) => left.from - right.from);
  };
  const [editing, setEditing] = useState(false);
  const text = value && value.type !== 'bare' ? value.value : '';
  assert(text.length <= LIMITS.attrCharsMax, 'BindField: value limit exceeded');
  const parts = partsFromValue(value ?? undefined);
  assert((parts?.length ?? 0) <= LIMITS.attrCharsMax, 'BindField: parts limit exceeded');
  const expr = value?.type === 'expr' ? String(value.value ?? '').trim() : '';
  const showInput = !raw && (parts !== undefined || editing);
  const mode = valueModeOf(value ?? undefined);
  const language = useValueLanguage({ name: props.attributeName ?? field?.name, element: props.elementName, text, mode, parts });
  const numeric = !!(field?.type === 'number' || field?.type === 'boolean' || field?.type === 'code' || (field?.type === 'enum' && field?.numeric));

  return {
    ...props,
    wrapRef,
    inputRef,
    menu,
    setMenu,
    source,
    setSource,
    exprApiRef,
    setRaw,
    codeChips,
    setEditing,
    parts,
    expr,
    showInput,
    mode,
    numeric,
    language,
  };
}

function useValueLanguage(input: {
  readonly name: string | undefined;
  readonly element: string | undefined;
  readonly text: string;
  readonly mode: 'text' | 'code';
  readonly parts: ReturnType<typeof partsFromValue>;
}): AttributeLanguage | undefined {
  const { name, element, text, mode, parts } = input;
  const decided = useRef<{ readonly key: string; readonly language: AttributeLanguage | undefined } | undefined>(undefined);
  const key = `${element ?? ''}.${name ?? ''}`;
  if (decided.current?.key !== key) {
    const named = name === undefined || mode !== 'text' || !partsHoldHoles(parts) ? undefined : attributeLanguageOf(name, text, element);
    decided.current = { key, language: named };
  }
  return decided.current.language;
}
type BindingState = ReturnType<typeof useBindFieldModel>;
function useBindFieldActions(state: BindingState) {
  const { menu, wrapRef, setMenu, dataContext, setSource, bindContext, showInput, exprApiRef, onChange, setRaw, inputRef } = state;
  const open = (chip: Chip | undefined) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setMenu({
      ...dataPickerPosition(rect),
      chip: chip || undefined,
    });
  };

  const editName = referencedName(chipExpr(menu?.chip));
  const editTarget = symbolTarget(editName, dataContext);
  const editChip = () => {
    setMenu(undefined);
    if (editTarget === 'file') {
      dataContext?.onOpenSymbol?.(editName);
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    const width = Math.max(rect?.width ?? 240, 260);
    setSource({
      name: editName,
      top: Math.min((rect?.bottom ?? 200) + 6, Math.max(60, window.innerHeight - 240)),
      left: Math.min(rect?.left ?? 0, window.innerWidth - width - 12),
      width,
    });
  };

  const pick = (rawPath: string, need: PickNeed | undefined) => {
    const chip = menu?.chip;
    const path = resolvePick(rawPath, need, bindContext ?? undefined);
    setMenu(undefined);
    if (!showInput) {
      if (chip && 'from' in chip) {
        const next = exprApiRef.current?.replaceRange(chip.from, chip.to, `\${${path}}`);
        if (next !== undefined) {
          onChange({ type: 'expr', value: next }, true);
        }
        return;
      }
      setRaw(false);
      onChange({ type: 'expr', value: path }, true);
      return;
    }
    if (chip) {
      inputRef.current?.replace(chip, path);
    } else {
      inputRef.current?.insert(path);
    }
  };

  return { open, editName, editTarget, editChip, pick };
}

function useBindFieldAPI({ apiRef, showInput, inputRef }: BindingState) {
  useEffect(() => {
    if (!apiRef) {
      return undefined;
    }
    apiRef.current = showInput ? { insert: (path) => inputRef.current?.insert(path) } : undefined;
    return () => {
      apiRef.current = undefined;
    };
  });
}
type BindingViewState = BindingState & ReturnType<typeof useBindFieldActions>;
function BindFieldMenu({ state }: { readonly state: BindingViewState }) {
  return state.menu && <BindFieldMenuPopup state={state} menu={state.menu} />;
}
function BindFieldMenuPopup({ state, menu }: { readonly state: BindingViewState; readonly menu: NonNullable<BindingViewState['menu']> }) {
  const { bindContext, showInput, expr, pick, editTarget, editChip, editName, setMenu, setRaw } = state;
  const current = menu.chip ? chipPath(menu.chip) : showInput ? undefined : expr;
  const override = useBindOverride({
    ask: () => ({ purpose: 'field', current: current === '' ? undefined : current, paths: pickerPaths(dataTree(bindContext || {})) }),
    onPicked: (path) => pick(path, undefined),
    onCancel: () => setMenu(undefined),
  });
  return (
    <Popup
      mode="popover"
      portal={false}
      onClose={() => setMenu(undefined)}
      className="dd-popup bind-menu"
      style={{ left: menu.left, top: menu.top, width: menu.width }}
    >
      {override.kind === 'waiting' ? (
        <BindOverrideWaiting owner={override.owner} onStacki={override.useStacki} />
      ) : (
        <DataPicker
          tree={dataTree(bindContext || {})}
          current={current}
          entries={bindContext?.entryNav ?? undefined}
          {...definedFields({ onStepItem: bindContext?.onStepItem })}
          onPick={pick}
          onExpand={(node, index) => node.query && bindContext?.onNeedSample?.(node.query.collection, index)}
          origin={bindContext?.origin}
          onEdit={editTarget ? editChip : undefined}
          editLabel={editTarget === 'file' ? `Open where ${editName} is defined` : `Edit ${editName}`}
          propSettings={bindContext?.newProp?.propSettings}
          onWrite={() => {
            setMenu(undefined);
            setRaw(true);
          }}
        />
      )}
    </Popup>
  );
}
function BindFieldSource({ state }: { readonly state: BindingState }) {
  const { source, dataContext, setSource } = state;
  return (
    source && (
      <VarSourceEditor
        pos={source}
        name={source.name}
        code={dataContext?.frontmatter || ''}
        onChangeCode={dataContext?.onSetFrontmatter}
        onRename={dataContext?.onRenameVariable}
        filePath={dataContext?.filePath}
        onClose={() => setSource(undefined)}
      />
    )
  );
}
function BindFieldView({ state }: { readonly state: BindingViewState }) {
  const translate = useTranslate();
  const {
    showInput,
    wrapRef,
    inputRef,
    parts,
    placeholder,
    onChange,
    numeric,
    field,
    mode,
    open,
    setEditing,
    expr,
    exprApiRef,
    codeChips,
    wrapCode,
    language,
  } = state;
  const list = <BindFieldMenu state={state} />;
  const sourceEditor = <BindFieldSource state={state} />;
  if (showInput) {
    return (
      <div className="prop-expr-row bind-row" ref={wrapRef}>
        {language === undefined ? (
          <BindInput
            ref={inputRef}
            parts={parts}
            placeholder={placeholder || translate('props.attributes.typeOrInsert')}
            onChange={(next) => onChange(valueFromParts(next, { numeric, mode: field?.type === 'code' ? 'code' : mode }))}
            onChipClick={(chip) => open(chip)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <CodeBindInput
            ref={inputRef}
            parts={parts}
            language={language}
            placeholder={placeholder || translate('props.attributes.typeOrInsert')}
            onChange={(next) => onChange(valueFromParts(next, { numeric, mode: field?.type === 'code' ? 'code' : mode }))}
            onChipClick={(chip) => open(chip)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
          />
        )}
        {list}
        {sourceEditor}
      </div>
    );
  }

  return (
    <div className="prop-expr-row" ref={wrapRef}>
      {}
      <ExprInput
        value={expr}
        syncValue={expr}
        placeholder={placeholder || ''}
        apiRef={exprApiRef}
        chipsOf={codeChips}
        onChipClick={(hit) => open(hit)}
        wrap={wrapCode ?? false}
        onChange={(draft) => onChange({ type: 'expr', value: draft })}
        onCommit={(committed) => committed !== expr && onChange({ type: 'expr', value: committed }, true)}
      />
      {list}
      {sourceEditor}
    </div>
  );
}
