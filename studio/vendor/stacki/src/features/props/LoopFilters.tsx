
import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import Dropdown from '../../ui/Dropdown';
import { useLocale, useTranslate } from '../../lib/i18n/useTranslate';
import {
  astroConditionCode,
  groqConditionCode,
  LOOP_QUERY_LIMITS,
  operatorsFor,
  type LoopCondition,
  type LoopFieldKind,
  type LoopOperator,
  type LoopQuery,
  type LoopSourceKind,
} from '../../editor/loopQuery';
import { CodeIcon } from '../../ui/Icons';
import { type CatalogField, type LoopCatalog } from './loopCatalog';
import {
  conditionOf,
  conditionParts,
  customFilterProblem,
  draftFor,
  draftOf,
  fieldNamed,
  filtersReset,
  operatorLabel,
  type ConditionDraft,
} from './loopSettingsModel';
import { CodeBox, EditorRow, ListRow, SectionHeader } from './LoopRows';
import { useCollectionSample, useReferenceChoices } from './loopSettingsData';
import { FieldPicker } from './LoopFieldPicker';
import { TypedFieldForm, type TypedFieldSupport } from './LoopTypedFieldForm';
import { SettingDot, type BindingContext, type DraftEditor } from './LoopBinding';
import { LinkedSetting } from './LoopLinked';
import { moved, staysPut } from './LoopItems';
import useListReorder from '../../ui/useListReorder';

export interface SectionProps {
  readonly query: LoopQuery;
  readonly fields: readonly CatalogField[] | undefined;
  readonly itemPath?: readonly string[] | undefined;
  readonly typed?: TypedFieldSupport | undefined;
  readonly onChange: (query: LoopQuery) => void;
}

const CUSTOM_FIELD = '__custom';

function conditionCodeOf(condition: LoopCondition, query: LoopQuery, itemPath: readonly string[] | undefined): string {
  if (condition.kind === 'custom') {
    return condition.code;
  }
  if (query.source.kind === 'sanity') {
    return groqConditionCode(condition);
  }
  const name = query.parameter.kind === 'entry' ? query.parameter.name : 'entry';
  const base = itemPath !== undefined ? [name, ...itemPath].join('.') : query.parameter.kind === 'entry' ? `${name}.data` : 'data';
  return astroConditionCode(condition, base);
}

type FilterSectionProps = SectionProps & {
  readonly catalog: LoopCatalog | undefined;
  readonly projectPath: string | undefined;
  readonly operatorSet: OperatorSet;
  readonly binding?: BindingContext | undefined;
  readonly label?: ReactNode;
  readonly toggle?: ReactNode;
};

export function FilterSection(props: FilterSectionProps) {
  const { binding } = props;
  return binding?.settings.filter.kind === 'prop' ? (
    <LinkedSetting setting="filter" binding={binding} editor={<FilterEditor {...props} binding={undefined} />} draft={filterDraft(props)} />
  ) : (
    <FilterEditor {...props} />
  );
}

function filterDraft(props: FilterSectionProps): DraftEditor {
  return {
    query: props.query,
    render: (query, onChange) => <FilterEditor {...props} query={query} binding={undefined} label={undefined} toggle={undefined} onChange={onChange} />,
  };
}

function FilterEditor(props: FilterSectionProps) {
  const translate = useTranslate();
  const { query, fields } = props;
  const sample = useCollectionSample(props.projectPath, props.catalog, query.source);
  const context: ChoiceContext = { ...props, sample };
  const [open, setOpen] = useState<number | 'new' | undefined>(undefined);
  const filterable = (fields ?? []).filter((field) => operatorsFor(field.kind).length > 0);
  const full = query.conditions.length >= LOOP_QUERY_LIMITS.conditionsMax;
  const reorder = useListReorder({
    count: query.conditions.length,
    onMove: (source, target) => {
      if (staysPut(source, target)) {
        return;
      }
      setOpen(undefined);
      props.onChange({ ...query, conditions: moved(query.conditions, source, target) });
    },
  });
  const replace = (index: number, condition: LoopCondition | undefined): void => {
    const conditions =
      condition === undefined
        ? query.conditions.filter((_, at) => at !== index)
        : query.conditions.map((existing, at) => (at === index ? condition : existing));
    props.onChange({ ...query, conditions });
  };
  return (
    <div className="loop-settings-section">
      <SectionHeader
        title={translate('props.loop.filters.title')}
        label={props.label}
        dot={<SettingDot setting="filter" binding={props.binding} draft={filterDraft(props)} />}
        toggle={props.toggle}
        reset={{ applied: query.conditions.length > 0, onReset: () => props.onChange(filtersReset(query)) }}
        addable={!full && (filterable.length > 0 || props.operatorSet === 'code')}
        extra={query.conditions.length > 1 ? <MatchMenu query={query} onChange={props.onChange} /> : undefined}
        onAdd={() => setOpen('new')}
      />
      {(query.conditions.length > 0 || open === 'new') && (
        <div className="loop-settings-list">
          {query.conditions.map((condition, index) => (
            <div
              key={`${index}:${condition.kind === 'custom' ? condition.code : condition.field}`}
              {...reorder.rowProps(index)}
              className={`loop-settings-sortable ${reorder.rowClass(index)}`}
            >
              <FilterChip
                condition={condition}
                fields={fields}
                itemPath={props.itemPath}
                context={context}
                open={open === index}
                onToggle={() => setOpen(open === index ? undefined : index)}
                onChange={(next) => replace(index, next)}
              />
            </div>
          ))}
          {open === 'new' && (
            <NewFilterRow
              first={filterable[0]}
              fields={filterable}
              context={context}
              onCommit={(condition) => {
                props.onChange({ ...query, conditions: [...query.conditions, condition] });
                setOpen(query.conditions.length);
              }}
              onClose={() => setOpen(undefined)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MatchMenu(props: { readonly query: LoopQuery; readonly onChange: (query: LoopQuery) => void }) {
  const translate = useTranslate();
  return (
    <Dropdown<'all' | 'any'>
      livePreview={false}
      value={props.query.match}
      ariaLabel={translate('props.loop.filters.match')}
      className="loop-settings-match"
      menuWidthMin={140}
      options={[
        { value: 'all', label: translate('props.loop.filters.matchAll') },
        { value: 'any', label: translate('props.loop.filters.matchAny') },
      ]}
      onChange={(match) => props.onChange({ ...props.query, match })}
    />
  );
}

function NewFilterRow(props: {
  readonly first: CatalogField | undefined;
  readonly fields: readonly CatalogField[];
  readonly context: ChoiceContext;
  readonly onCommit: (condition: LoopCondition) => void;
  readonly onClose: () => void;
}) {
  const translate = useTranslate();
  const { typed } = props.context;
  const [custom, setCustom] = useState(props.first === undefined && typed === undefined);
  const [picked, setPicked] = useState<CatalogField | undefined>(undefined);
  const first = picked ?? props.first;
  const fields = picked !== undefined && !props.fields.some((field) => field.path === picked.path) ? [...props.fields, picked] : props.fields;
  return (
    <ListRow
      parts={{
        lead: custom ? translate('props.loop.customCode') : first === undefined ? translate('props.loop.field') : first.title,
        rest: translate('props.loop.filters.new'),
      }}
      open={true}
      removeLabel={translate('props.loop.filters.discard')}
      editor={
        first === undefined && !custom && typed !== undefined ? (
          <>
            <TypedFieldForm item={typed.item} onUse={setPicked} />
            <button type="button" className="loop-quiet-row" onClick={() => setCustom(true)}>
              {translate('props.loop.customCode')}
            </button>
          </>
        ) : custom || first === undefined ? (
          <CustomConditionEditor
            code=""
            fields={fields}
            context={props.context}
            onField={(path, field) => {
              setPicked(field ?? fieldNamed(fields, path));
              setCustom(false);
            }}
            onCommit={props.onCommit}
          />
        ) : (
          <ConditionEditor
            key={first.path}
            draft={draftFor(first)}
            fields={fields}
            context={props.context}
            onCustom={() => setCustom(true)}
            onCommit={props.onCommit}
          />
        )
      }
      onToggle={props.onClose}
      onRemove={props.onClose}
    />
  );
}

function CustomConditionEditor(props: {
  readonly code: string;
  readonly fields: readonly CatalogField[];
  readonly context: ChoiceContext;
  readonly onField: ((path: string, typed?: CatalogField) => void) | undefined;
  readonly onCommit: (condition: LoopCondition) => void;
}) {
  const translate = useTranslate();
  const source = props.context.query.source.kind;
  return (
    <div className="loop-settings-editor">
      <EditorRow label={translate('props.loop.field')}>
        <FieldMenu
          value={CUSTOM_FIELD}
          fields={props.fields}
          custom={true}
          sample={props.context.sample}
          typed={props.context.typed}
          onChange={(path, typed) => (path === CUSTOM_FIELD ? undefined : props.onField?.(path, typed))}
        />
      </EditorRow>
      <CodeBox
        value={props.code}
        label={translate('props.loop.filters.code')}
        placeholder={customFilterPlaceholder(source)}
        check={(code) => customFilterProblem(code, source, translate)}
        onCommit={(code) => props.onCommit({ kind: 'custom', code })}
      />
    </div>
  );
}

function customFilterPlaceholder(source: LoopSourceKind): string {
  switch (source) {
    case 'astro':
      return 'data.title.startsWith("Pastor")';
    case 'sanity':
      return 'count(serviceTimes) > 1';
    case 'list':
      return 'item.title.startsWith("Pastor")';
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function FieldMenu(props: {
  readonly value: string;
  readonly fields: readonly CatalogField[];
  readonly custom: boolean;
  readonly sample: unknown;
  readonly typed?: TypedFieldSupport | undefined;
  readonly onChange: (path: string, typed?: CatalogField) => void;
}) {
  const translate = useTranslate();
  return (
    <FieldPicker
      value={props.value}
      fields={props.fields}
      sample={props.sample}
      typed={props.typed}
      extras={props.custom ? [{ value: CUSTOM_FIELD, label: translate('props.loop.customCode'), icon: <CodeIcon size={13} /> }] : []}
      usable={(field) => operatorsFor(field.kind).length > 0}
      onChange={props.onChange}
    />
  );
}

export interface ChoiceContext {
  readonly catalog: LoopCatalog | undefined;
  readonly projectPath: string | undefined;
  readonly query: LoopQuery;
  readonly operatorSet: OperatorSet;
  readonly sample?: unknown;
  readonly typed?: TypedFieldSupport | undefined;
}

export type OperatorSet = 'code' | 'data';

function operatorsIn(kind: LoopFieldKind, set: OperatorSet): readonly LoopOperator[] {
  const operators = operatorsFor(kind);
  return set === 'code' ? operators : operators.filter((operator) => operator !== 'inPast' && operator !== 'inFuture');
}

function FilterChip(props: {
  readonly condition: LoopCondition;
  readonly fields: readonly CatalogField[] | undefined;
  readonly itemPath: readonly string[] | undefined;
  readonly context: ChoiceContext;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onChange: (condition: LoopCondition | undefined) => void;
}) {
  const translate = useTranslate();
  const { locale } = useLocale();
  const { condition, fields } = props;
  const field = condition.kind === 'test' ? fieldNamed(fields, condition.field) : undefined;
  const choices = useReferenceChoices(props.context, field);
  const filterable = (fields ?? []).filter((candidate) => operatorsFor(candidate.kind).length > 0);
  const codeAllowed = props.context.operatorSet === 'code';
  const [shown, setShown] = useState<'code' | 'field' | undefined>(undefined);
  const [picked, setPicked] = useState<CatalogField | undefined>(undefined);
  const mode = shown ?? (condition.kind === 'custom' || field === undefined ? 'code' : 'field');
  const commit = (next: LoopCondition): void => {
    setShown(undefined);
    setPicked(undefined);
    props.onChange(next);
  };
  const editor = (): ReactNode => {
    const first = picked ?? field ?? filterable[0];
    if (mode === 'code') {
      return codeAllowed ? (
        <CustomConditionEditor
          code={conditionCodeOf(condition, props.context.query, props.itemPath)}
          fields={filterable}
          context={props.context}
          onField={
            first === undefined
              ? undefined
              : (path, typed) => {
                  setPicked(typed ?? fieldNamed(filterable, path));
                  setShown('field');
                }
          }
          onCommit={commit}
        />
      ) : undefined;
    }
    if (first === undefined) {
      return undefined;
    }
    return (
      <ConditionEditor
        key={first.path}
        draft={condition.kind === 'test' && picked === undefined ? draftOf(condition) : draftFor(first)}
        fields={picked !== undefined && !filterable.some((candidate) => candidate.path === picked.path) ? [...filterable, picked] : filterable}
        context={props.context}
        onCustom={codeAllowed ? () => setShown('code') : undefined}
        onCommit={commit}
      />
    );
  };
  return (
    <>
      <ListRow
        dragThrough={true}
        parts={conditionParts(condition, fields, choices, translate, locale)}
        open={props.open}
        locked={condition.kind === 'custom' && !codeAllowed}
        removeLabel={translate('props.loop.filters.remove')}
        editor={editor()}
        onToggle={props.onToggle}
        onRemove={() => props.onChange(undefined)}
      />
    </>
  );
}

function ConditionEditor(props: {
  readonly draft: ConditionDraft;
  readonly fields: readonly CatalogField[];
  readonly context: ChoiceContext;
  readonly onCustom?: (() => void) | undefined;
  readonly onCommit: (condition: LoopCondition) => void;
}) {
  const translate = useTranslate();
  const [draft, setDraft] = useState(props.draft);
  const [typedField, setTypedField] = useState<CatalogField | undefined>(undefined);
  const field = fieldNamed(props.fields, draft.field) ?? (typedField?.path === draft.field ? typedField : undefined);
  const kind: LoopFieldKind = field?.kind ?? 'other';
  const choices = useReferenceChoices(props.context, field);
  const commit = (next: ConditionDraft): void => {
    setDraft(next);
    const condition = conditionOf(next, kind);
    if (condition !== undefined) {
      props.onCommit(condition);
    }
  };
  const changeField = (path: string, typed?: CatalogField): void => {
    if (path === CUSTOM_FIELD) {
      props.onCustom?.();
      return;
    }
    const picked = typed ?? fieldNamed(props.fields, path);
    if (picked !== undefined) {
      setTypedField(typed);
      commit(draftFor(picked));
    }
  };
  return (
    <div className="loop-settings-editor">
      <EditorRow label={translate('props.loop.field')}>
        <FieldMenu
          value={draft.field}
          fields={props.fields}
          custom={props.onCustom !== undefined}
          sample={props.context.sample}
          typed={props.context.typed}
          onChange={changeField}
        />
      </EditorRow>
      <EditorRow label={translate('props.loop.when')}>
        <Dropdown
          livePreview={false}
          value={draft.operator}
          ariaLabel={translate('props.loop.when')}
          options={operatorsIn(kind, props.context.operatorSet).map((operator) => ({ value: operator, label: operatorLabel(operator, translate) }))}
          onChange={(operator) => commit({ ...draft, operator })}
        />
      </EditorRow>
      <ValueRow
        draft={draft}
        kind={kind}
        field={field}
        choices={choices}
        onChange={(value) => setDraft({ ...draft, value })}
        onCommit={(value) => commit({ ...draft, value })}
      />
    </div>
  );
}

function ValueRow(props: {
  readonly draft: ConditionDraft;
  readonly kind: LoopFieldKind;
  readonly field: CatalogField | undefined;
  readonly choices: readonly { readonly title: string; readonly value: string }[];
  readonly onChange: (value: string) => void;
  readonly onCommit: (value: string) => void;
}) {
  const translate = useTranslate();
  const { draft, kind } = props;
  const operator = draft.operator;
  const valueless =
    conditionOf({ ...draft, value: '' }, kind)?.kind === 'test' && ['isSet', 'isEmpty', 'isTrue', 'isFalse', 'inPast', 'inFuture'].includes(operator);
  if (valueless) {
    return undefined;
  }
  const options = [...(props.field?.options ?? []), ...props.choices];
  const usesChoices = (operator === 'is' || operator === 'isNot' || operator === 'has') && options.length > 0;
  const enter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      props.onCommit(event.currentTarget.value);
    }
  };
  let control: ReactNode;
  if (usesChoices) {
    control = (
      <Dropdown<string>
        livePreview={false}
        value={draft.value}
        ariaLabel={translate('props.loop.value')}
        placeholder={translate('ui.choose')}
        searchable={options.length > 10}
        options={options.map((option) => ({ value: option.value, label: option.title }))}
        onChange={props.onCommit}
      />
    );
  } else if (operator === 'before' || operator === 'after') {
    control = <input type="date" value={draft.value} onChange={(event) => props.onCommit(event.target.value)} />;
  } else {
    const numeric = kind === 'number' || operator === 'greater' || operator === 'less' || operator === 'atLeast' || operator === 'atMost';
    control = (
      <input
        type={numeric ? 'number' : 'text'}
        value={draft.value}
        placeholder={numeric ? '0' : translate('props.loop.value')}
        maxLength={LOOP_QUERY_LIMITS.valueCharsMax}
        spellCheck={false}
        onChange={(event) => props.onChange(event.target.value)}
        onBlur={(event) => props.onCommit(event.target.value)}
        onKeyDown={enter}
      />
    );
  }
  return <EditorRow label={translate('props.loop.value')}>{control}</EditorRow>;
}
