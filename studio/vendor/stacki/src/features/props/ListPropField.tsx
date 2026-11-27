
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { emptyQuery, type LoopFieldKind, type LoopQuery } from '../../editor/loopQuery';
import type { ListProp } from '../../editor/listProps';
import { curatedText, filterValueText, readCuratedValue, readFilterValue, readSortValue, sortValueText } from '../../editor/optionsQuery';
import type { Attr } from '../../../shared/page/pageNode';
import { assert } from '../../../shared/core/assert';
import { FilterSection } from './LoopFilters';
import { SortSection } from './LoopOrder';
import { useCatalogFields, useLoopCatalog } from './loopSettingsData';
import { fieldNamed } from './loopSettingsModel';
import { ResetLabel } from '../../ui/ResetLabel';
import { ItemsSection } from './LoopItems';
import { settingIcon } from './LoopBinding';
import type { ValueChange } from './bindingTypes';
import './loopSettings.css';

export function ListPropField(props: {
  readonly name: string;
  readonly listProp: ListProp;
  readonly value: Attr | undefined;
  readonly projectPath: string | undefined;
  readonly fallback: ReactNode;
  readonly onChange: ValueChange;
}) {
  const { listProp, value } = props;
  const catalog = useLoopCatalog(props.projectPath);
  const fields = useCatalogFields(props.projectPath, catalog, listProp.source);
  const own = value?.type === 'expr' ? value.value : undefined;
  const query = useMemo(
    () => queryOf(listProp, own ?? listProp.defaultCode, (path: string): LoopFieldKind | undefined => fieldNamed(fields, path)?.kind),
    [listProp, own, fields],
  );
  const foreign = value !== undefined && value.type !== 'expr';
  if (foreign || query === undefined) {
    return props.fallback;
  }
  const write = (next: LoopQuery): void => {
    const text =
      listProp.setting === 'filter' ? filterValueText(next) : listProp.setting === 'curated' ? curatedText(next.selection ?? []) : sortValueText(next.sorts);
    props.onChange({ type: 'expr', value: text }, true);
  };
  const label = (
    <ResetLabel
      label={
        <span className="list-prop-label">
          {settingIcon(listProp.setting)}
          {props.name}
        </span>
      }
      active={own !== undefined}
      onReset={() => props.onChange(undefined, true)}
    />
  );
  return (
    <div className="props-field list-prop-field">
      {listProp.setting === 'filter' && (
        <FilterSection query={query} fields={fields} catalog={catalog} projectPath={props.projectPath} operatorSet="data" label={label} onChange={write} />
      )}
      {listProp.setting === 'sort' && <SortSection query={query} fields={fields} randomOrder="unavailable" label={label} onChange={write} />}
      {listProp.setting === 'curated' && (
        <ItemsSection query={query} catalog={catalog} projectPath={props.projectPath} ids="export" label={label} onChange={write} />
      )}
    </div>
  );
}

function queryOf(listProp: ListProp, text: string, kind: (path: string) => LoopFieldKind | undefined): LoopQuery | undefined {
  assert(listProp.setting === 'filter' || listProp.setting === 'sort' || listProp.setting === 'curated', 'Only filters, sorts and picks are edited as lists');
  const base = emptyQuery(listProp.source);
  if (listProp.setting === 'curated') {
    const selection = readCuratedValue(text);
    return selection === undefined ? undefined : { ...base, selection };
  }
  if (listProp.setting === 'filter') {
    const filter = readFilterValue(text, kind);
    return filter === undefined ? undefined : { ...base, match: filter.match, conditions: filter.conditions };
  }
  const sorts = readSortValue(text, kind);
  return sorts === undefined ? undefined : { ...base, sorts };
}
