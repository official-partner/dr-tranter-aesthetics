
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import Dropdown from '../../ui/Dropdown';
import { ChevronDownIcon, CodeIcon, RepeatIcon } from '../../ui/Icons';
import {
  astroComparatorCode,
  LOOP_QUERY_LIMITS,
  sortOrderFor,
  sortOrdersFor,
  type LoopQuery,
  type LoopSort,
  type LoopSortOrder,
  type LoopSourceKind,
} from '../../editor/loopQuery';
import { type CatalogField, type LoopCatalog } from './loopCatalog';
import { FieldPicker, type FieldExtra } from './LoopFieldPicker';
import { TypedFieldForm, type TypedFieldSupport } from './LoopTypedFieldForm';
import { useCollectionSample } from './loopSettingsData';
import { customSortProblem, fieldNamed, limitReset, orderLabels, sortParts, sortReset, wholeNumberOf } from './loopSettingsModel';
import { AppliedLabel, CodeBox, EditorRow, ListRow, SectionHeader } from './LoopRows';
import type { SectionProps } from './LoopFilters';
import { SettingDot, type BindingContext, type DraftEditor } from './LoopBinding';
import { moved, staysPut } from './LoopItems';
import useListReorder from '../../ui/useListReorder';
import { LinkedSetting } from './LoopLinked';
import { useTranslate } from '../../lib/i18n/useTranslate';

const RANDOM_FIELD = '__random';
const CUSTOM_FIELD = '__custom';
const LIMIT_DEFAULT = 6;


type SortSectionProps = SectionProps & {
  readonly randomOrder: 'available' | 'unavailable';
  readonly catalog?: LoopCatalog | undefined;
  readonly projectPath?: string | undefined;
  readonly binding?: BindingContext | undefined;
  readonly label?: ReactNode;
  readonly toggle?: ReactNode;
};

export function SortSection(props: SortSectionProps) {
  const { binding } = props;
  return binding?.settings.sort.kind === 'prop' ? (
    <LinkedSetting setting="sort" binding={binding} editor={<SortEditor {...props} binding={undefined} />} draft={sortDraft(props)} />
  ) : (
    <SortEditor {...props} />
  );
}

function sortDraft(props: SortSectionProps): DraftEditor {
  return {
    query: props.query,
    render: (query, onChange) => <SortEditor {...props} query={query} binding={undefined} label={undefined} toggle={undefined} onChange={onChange} />,
  };
}

function SortEditor(props: SortSectionProps) {
  const translate = useTranslate();
  const { query, fields } = props;
  const [open, setOpen] = useState<number | undefined>(undefined);
  const [naming, setNaming] = useState(false);
  const source = query.source.kind;
  const sortable = (fields ?? []).filter((field) => sortOrderFor(field.kind, source) !== undefined);
  const first = sortable[0];
  const custom = query.customSort;
  const codeAllowed = props.randomOrder === 'available';
  const addable =
    !query.random &&
    custom === undefined &&
    query.sorts.length < LOOP_QUERY_LIMITS.sortsMax &&
    (first !== undefined || codeAllowed || props.typed !== undefined);
  const toCustom = (): void => {
    const itemPath = source === 'sanity' ? [] : (props.itemPath ?? ['data']);
    const seed = query.sorts.length > 0 ? astroComparatorCode(query.sorts, itemPath) : '(a, b) => 0';
    setOpen(undefined);
    props.onChange({ ...query, sorts: [], random: false, customSort: seed });
  };
  const add = (): void => {
    if (first === undefined && props.typed !== undefined) {
      setNaming(true);
      return;
    }
    if (first === undefined) {
      toCustom();
      setOpen(0);
      return;
    }
    const order = sortOrderFor(first.kind, source);
    if (order === undefined) {
      return;
    }
    props.onChange({ ...query, sorts: [...query.sorts, { field: first.path, direction: 'ascending', order }] });
    setOpen(query.sorts.length);
  };
  const reorder = useListReorder({
    count: query.sorts.length,
    onMove: (source, target) => {
      if (staysPut(source, target)) {
        return;
      }
      setOpen(undefined);
      props.onChange({ ...query, sorts: moved(query.sorts, source, target) });
    },
  });
  const replace = (index: number, sort: LoopSort | undefined): void => {
    const sorts = sort === undefined ? query.sorts.filter((_, at) => at !== index) : query.sorts.map((existing, at) => (at === index ? sort : existing));
    props.onChange({ ...query, sorts });
  };
  const extras: readonly FieldExtra[] = codeAllowed
    ? [
        { value: RANDOM_FIELD, label: translate('props.loop.sort.random'), icon: <RepeatIcon size={13} /> },
        { value: CUSTOM_FIELD, label: translate('props.loop.customCode'), icon: <CodeIcon size={13} /> },
      ]
    : [];
  const sample = useCollectionSample(props.projectPath, props.catalog, query.source);
  return (
    <div className="loop-settings-section">
      <SectionHeader
        title={translate('props.loop.sort.title')}
        label={props.label}
        dot={<SettingDot setting="sort" binding={props.binding} draft={sortDraft(props)} />}
        toggle={props.toggle}
        reset={{ applied: query.random || query.sorts.length > 0 || custom !== undefined, onReset: () => props.onChange(sortReset(query)) }}
        addable={addable}
        onAdd={add}
      />
      {(query.random || query.sorts.length > 0 || custom !== undefined || naming) && (
        <div className="loop-settings-list">
          {naming && props.typed !== undefined && (
            <ListRow
              parts={{ lead: translate('props.loop.field'), rest: translate('props.loop.sort.title') }}
              open={true}
              removeLabel={translate('props.loop.sort.remove')}
              editor={
                <TypedFieldForm
                  item={props.typed.item}
                  onUse={(field) => {
                    const order = sortOrderFor(field.kind, source);
                    setNaming(false);
                    if (order !== undefined) {
                      props.onChange({ ...query, sorts: [...query.sorts, { field: field.path, direction: 'ascending', order }] });
                    }
                  }}
                />
              }
              onToggle={() => setNaming(false)}
              onRemove={() => setNaming(false)}
            />
          )}
          {query.random && <RandomRow onRemove={() => props.onChange({ ...query, random: false })} />}
          {custom !== undefined && (
            <CustomSortRow
              code={custom}
              source={source}
              open={open === 0}
              onToggle={() => setOpen(open === 0 ? undefined : 0)}
              onChange={(customSort) => props.onChange({ ...query, customSort })}
            />
          )}
          {!query.random &&
            query.sorts.map((sort, index) => (
              <div key={`${index}:${sort.field}`} {...reorder.rowProps(index)} className={`loop-settings-sortable ${reorder.rowClass(index)}`}>
                <SortChip
                  sort={sort}
                  source={source}
                  fields={fields}
                  extras={extras}
                  typed={props.typed}
                  sample={sample}
                  open={open === index}
                  onToggle={() => setOpen(open === index ? undefined : index)}
                  onRandom={() => props.onChange({ ...query, random: true, sorts: [] })}
                  onCustom={toCustom}
                  onChange={(next) => replace(index, next)}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function CustomSortRow(props: {
  readonly code: string;
  readonly source: LoopSourceKind;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onChange: (code: string | undefined) => void;
}) {
  const translate = useTranslate();
  const firstLine = props.code.split('\n')[0] ?? props.code;
  return (
    <ListRow
      parts={{ lead: translate('props.loop.customCode'), rest: firstLine }}
      open={props.open}
      removeLabel={translate('props.loop.sort.remove')}
      editor={
        <div className="loop-settings-editor">
          <CodeBox
            value={props.code}
            label={translate('props.loop.sort.code')}
            placeholder={props.source === 'list' ? '(a, b) => a.order - b.order' : '(a, b) => a.data.order - b.data.order'}
            check={(code) => customSortProblem(code, translate)}
            onCommit={props.onChange}
          />
        </div>
      }
      onToggle={props.onToggle}
      onRemove={() => props.onChange(undefined)}
    />
  );
}

function RandomRow(props: { readonly onRemove: () => void }) {
  const translate = useTranslate();
  return (
    <ListRow
      parts={{ lead: translate('props.loop.sort.random'), rest: translate('props.loop.sort.shuffled') }}
      open={false}
      locked={true}
      removeLabel={translate('props.loop.sort.remove')}
      onToggle={() => undefined}
      onRemove={props.onRemove}
    />
  );
}

function SortChip(props: {
  readonly sort: LoopSort;
  readonly source: LoopSourceKind;
  readonly fields: readonly CatalogField[] | undefined;
  readonly extras: readonly FieldExtra[];
  readonly typed: TypedFieldSupport | undefined;
  readonly sample: unknown;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onRandom: () => void;
  readonly onCustom: () => void;
  readonly onChange: (sort: LoopSort | undefined) => void;
}) {
  const translate = useTranslate();
  const { sort } = props;
  const changeField = (path: string, typed?: CatalogField): void => {
    if (path === RANDOM_FIELD) {
      props.onRandom();
      return;
    }
    if (path === CUSTOM_FIELD) {
      props.onCustom();
      return;
    }
    const field = typed ?? fieldNamed(props.fields, path);
    const orders = field === undefined ? [] : sortOrdersFor(field.kind, props.source);
    const order = orders.includes(sort.order) ? sort.order : orders[0];
    if (order !== undefined) {
      props.onChange({ field: path, direction: sort.direction, order });
    }
  };
  const field = fieldNamed(props.fields, sort.field);
  const offered = field === undefined ? [] : sortOrdersFor(field.kind, props.source);
  const orders: readonly LoopSortOrder[] = offered.includes(sort.order) ? offered : [sort.order, ...offered];
  const orderOptions = orders.flatMap((order) => {
    const labels = orderLabels(order, translate);
    return [
      { value: orderKey(order, 'ascending'), label: labels.ascending },
      { value: orderKey(order, 'descending'), label: labels.descending },
    ];
  });
  return (
    <>
      <ListRow
        dragThrough={true}
        parts={sortParts(sort, props.fields, translate)}
        open={props.open}
        removeLabel={translate('props.loop.sort.remove')}
        editor={
          <div className="loop-settings-editor">
            <EditorRow label={translate('props.loop.field')}>
              <FieldPicker
                value={sort.field}
                fields={props.fields ?? []}
                sample={props.sample}
                extras={props.extras}
                typed={props.typed}
                usable={(field) => sortOrdersFor(field.kind, props.source).length > 0}
                onChange={changeField}
              />
            </EditorRow>
            <EditorRow label={translate('props.loop.sort.order')}>
              <Dropdown<OrderKey>
                livePreview={false}
                value={orderKey(sort.order, sort.direction)}
                ariaLabel={translate('props.loop.sort.order')}
                options={orderOptions}
                onChange={(key) => props.onChange({ ...sort, ...orderOf(key, orders) })}
              />
            </EditorRow>
          </div>
        }
        onToggle={props.onToggle}
        onRemove={() => props.onChange(undefined)}
      />
    </>
  );
}

type OrderKey = `${LoopSortOrder}:${LoopSort['direction']}`;

function orderKey(order: LoopSortOrder, direction: LoopSort['direction']): OrderKey {
  return `${order}:${direction}`;
}

function orderOf(key: OrderKey, orders: readonly LoopSortOrder[]): Pick<LoopSort, 'order' | 'direction'> {
  const found = orders.find((order) => key === orderKey(order, 'ascending') || key === orderKey(order, 'descending'));
  assert(found !== undefined, 'An order choice names an offered order');
  return { order: found, direction: key.endsWith(':descending') ? 'descending' : 'ascending' };
}


export function LimitSection(props: Omit<SectionProps, 'fields'> & { readonly binding?: BindingContext | undefined; readonly toggle?: ReactNode }) {
  const translate = useTranslate();
  const { query } = props;
  const linked = props.binding?.settings.limit.kind === 'prop' || props.binding?.settings.offset.kind === 'prop';
  const on = linked || query.limit !== undefined || query.offset > 0;
  const toggle = (): void => {
    props.onChange(on ? limitReset(query) : { ...query, limit: LIMIT_DEFAULT });
  };
  return (
    <div className="loop-settings-section">
      <div className="loop-settings-header">
        <span className="loop-settings-label">
          <AppliedLabel
            title={translate('props.loop.limit.title')}
            reset={{ applied: query.limit !== undefined || query.offset > 0, onReset: () => props.onChange(limitReset(query)) }}
          />
          {props.toggle}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={translate('props.loop.limit.title')}
          className={`cms-toggle ${on ? 'on' : ''}`}
          onClick={toggle}
        >
          <span className="cms-toggle-knob" />
        </button>
      </div>
      {on && (
        <div className="loop-settings-editor">
          <LimitRow
            setting="limit"
            binding={props.binding}
            query={query}
            onChange={props.onChange}
            row={(dot, value, onChange) => (
              <NumberRow
                label={translate('props.loop.limit.show')}
                dot={dot}
                value={value.limit}
                placeholder={translate('props.loop.limit.all')}
                bounds={{ min: 1, max: LOOP_QUERY_LIMITS.limitMax }}
                onCommit={(limit) => onChange({ ...value, limit })}
              />
            )}
          />
          <LimitRow
            setting="offset"
            binding={props.binding}
            query={query}
            onChange={props.onChange}
            row={(dot, value, onChange) => (
              <NumberRow
                label={translate('props.loop.limit.skip')}
                dot={dot}
                value={value.offset}
                placeholder="0"
                bounds={{ min: 0, max: LOOP_QUERY_LIMITS.offsetMax }}
                onCommit={(offset) => onChange({ ...value, offset: offset ?? 0 })}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}

function LimitRow(props: {
  readonly setting: 'limit' | 'offset';
  readonly binding: BindingContext | undefined;
  readonly query: LoopQuery;
  readonly onChange: (query: LoopQuery) => void;
  readonly row: (dot: ReactNode, query: LoopQuery, onChange: (query: LoopQuery) => void) => ReactNode;
}) {
  const { binding } = props;
  const draft: DraftEditor = { query: props.query, render: (query, onChange) => props.row(undefined, query, onChange) };
  return binding?.settings[props.setting].kind === 'prop' ? (
    <LinkedSetting setting={props.setting} binding={binding} editor={props.row(undefined, props.query, props.onChange)} draft={draft} />
  ) : (
    props.row(<SettingDot setting={props.setting} binding={binding} draft={draft} />, props.query, props.onChange)
  );
}

function Steppers(props: { readonly onStep: (direction: 1 | -1, size: { readonly large: boolean }) => void }) {
  const translate = useTranslate();
  return (
    <span className="num-steppers">
      {([1, -1] as const).map((direction) => (
        <button
          key={direction}
          type="button"
          tabIndex={-1}
          aria-label={direction > 0 ? translate('props.loop.limit.increase') : translate('props.loop.limit.decrease')}
          title={direction > 0 ? translate('props.loop.limit.increaseTitle') : translate('props.loop.limit.decreaseTitle')}
          onClick={(event) => props.onStep(direction, { large: event.shiftKey })}
        >
          <ChevronDownIcon size={11} style={direction > 0 ? { transform: 'rotate(180deg)' } : undefined} />
        </button>
      ))}
    </span>
  );
}

function NumberRow(props: {
  readonly label: string;
  readonly dot: ReactNode;
  readonly value: number | undefined;
  readonly placeholder: string;
  readonly bounds: { readonly min: number; readonly max: number };
  readonly onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(props.value === undefined ? '' : String(props.value));
  const committed = useRef(props.value);
  useEffect(() => {
    committed.current = props.value;
    setDraft(props.value === undefined ? '' : String(props.value));
  }, [props.value]);
  const commit = (): void => {
    const value = draft.trim() === '' ? undefined : wholeNumberOf(draft, props.bounds);
    if (draft.trim() !== '' && value === undefined) {
      setDraft(committed.current === undefined ? '' : String(committed.current));
      return;
    }
    if (value !== committed.current) {
      props.onCommit(value);
    }
  };
  const step = (direction: 1 | -1, size: { readonly large: boolean }): void => {
    const current = wholeNumberOf(draft, props.bounds) ?? committed.current ?? props.bounds.min;
    const next = Math.min(props.bounds.max, Math.max(props.bounds.min, current + direction * (size.large ? 10 : 1)));
    assert(Number.isSafeInteger(next), 'A stepped value is whole');
    setDraft(String(next));
    if (next !== committed.current) {
      props.onCommit(next);
    }
  };
  return (
    <EditorRow label={props.label} dot={props.dot}>
      {}
      <div className="num-field">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          placeholder={props.placeholder}
          aria-label={props.label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              step(event.key === 'ArrowUp' ? 1 : -1, { large: event.shiftKey });
            }
          }}
        />
        <Steppers onStep={step} />
      </div>
    </EditorRow>
  );
}
