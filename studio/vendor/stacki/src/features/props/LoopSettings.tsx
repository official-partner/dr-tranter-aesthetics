
import { useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { type DropdownOption } from '../../ui/Dropdown';
import type { DescribedTranslator } from '../../lib/i18n/localeContext';
import { useFormat, useTranslate, useTranslateDescribed } from '../../lib/i18n/useTranslate';
import { ENGLISH_TRANSLATE } from '../../../shared/properties/i18n/englishTranslator';
import type { Described, Translator } from '../../../shared/properties/i18n/messageRef';
import { AstroIcon, SanityIcon, CmsIcon, TextIcon } from '../../ui/Icons';
import type { TreeNode } from '../../editor/dataSample';
import { treeListFields } from './loopProjectData';
import { assert } from '../../../shared/core/assert';
import { emptyQuery, type LoopFieldKind, type LoopQuery, type LoopSource } from '../../editor/loopQuery';
import { readLoop, readingChain, type LoopReadInput, type LoopReading, type QueryHome } from '../../editor/loopQueryRead';
import type { LoopTarget } from '../../editor/loopQueryPlan';
import { isArrayLiteral, literalCode, literalItems, literalListFields, STARTER_ITEMS, writtenListFields } from '../../editor/loopLiteral';
import { LiteralItemsSection } from './LoopLiteralItems';
import { fieldListOf, type FieldList } from '../../editor/loopFieldList';
import { fieldListPath, SourcePicker, sourcePath, type NewListOffer, type SourcePick, type SourcePickerData } from './LoopSourcePicker';
import { listItemFields, loadFields, LOOP_CATALOG_LIMITS, titled, type CatalogField, type LoopCatalog } from './loopCatalog';
import { fieldNamed, itemsModeQuery, readingKey, sectionFieldPaths, sectionPlaceholder, sourceKey } from './loopSettingsModel';
import {
  changedSection,
  groqSectionProblem,
  groqSectionQuery,
  LOOP_SECTIONS,
  readSections,
  sectionCodeOf,
  sectionCodeProblem,
  sectionRefusal,
  type LoopSection,
  type LoopSections,
} from '../../editor/loopSections';
import { useSectionCode, type SectionCodeContext } from './LoopSectionCode';
import { connectableProps, propNameProblem, settingTitle } from '../../editor/optionsBinding';
import { propTooltip } from '../../editor/loopProps';
import { listPropOf } from '../../editor/propDeclaration';
import type { BindingContext } from './LoopBinding';
import { LOOP_SETTINGS, type LoopSetting, type SettingHome } from '../../editor/optionsQuery';
import { reportActionToast } from '../../ui/errorNotices';
import PropTip from './PropTip';
import { LoopLineage, tracedCollection, useLoopTrace, type TracedCollection } from './LoopLineage';
import { FilterSection } from './LoopFilters';
import { itemSamples, type ItemSamples } from '../../editor/loopRemove';
import { listItemsModeQuery, listPicks, type ListPicks, type PickRefusal } from './loopPickModel';
import { withTypedFields } from './loopTypedField';
import type { TypedFieldSupport } from './LoopTypedFieldForm';
import { LimitSection, SortSection } from './LoopOrder';
import { editableTrace, loadSanitySample, useCatalogFields, useLoopCatalog, writeTracedQuery } from './loopSettingsData';
import { ItemsSection } from './LoopItems';
import { LoopDetails, LoopDetailsTip } from './LoopRows';
import SegSwitch from './SegSwitch';
import { err, ok, type Result } from '../../../shared/core/result';
import type { PropDeclaration } from '../../editor/propDeclaration';
import type { NewPropHost } from './newPropModel';
import './loopSettings.css';

export type LoopApplyResult =
  | {
      readonly ok: true;
      readonly unbound: number;
      readonly lost: readonly string[];
      readonly restored: boolean;
      readonly removed?: { readonly replaced: number; readonly emptied: number } | undefined;
    }
  | ({ readonly ok: false } & Described);

export interface LoopListOption {
  readonly path: string;
  readonly label: string;
  readonly hint: string;
}

export interface LoopSettingsProps {
  readonly input: Omit<LoopReadInput, 'fieldKind'>;
  readonly projectPath: string | undefined;
  readonly filePath: string | undefined;
  readonly lists: readonly LoopListOption[];
  readonly onApply: (target: LoopTarget, sanityClient: 'available' | 'unavailable', declaration?: PropDeclaration) => LoopApplyResult;
  readonly onEditProperty?: ((key: string, edit: { readonly name: string; readonly description: string }) => Promise<string | undefined>) | undefined;
  readonly sourceButton?: ((name: string, anchorRef: RefObject<HTMLElement>) => ReactNode) | undefined;
  readonly item?: string | undefined;
  readonly pickerData?: SourcePickerData | undefined;
  readonly newProp?: NewPropHost | undefined;
  readonly children?: ReactNode;
}

interface SourceRowProps {
  readonly reading: LoopReading;
  readonly data: string;
  readonly literal: readonly string[] | undefined;
  readonly fieldList: FieldList | undefined;
  readonly pickerData: SourcePickerData | undefined;
  readonly projectPath: string | undefined;
  readonly lists: readonly LoopListOption[];
  readonly sourceButton: ((anchorRef: RefObject<HTMLElement>) => ReactNode) | undefined;
  readonly catalog: LoopCatalog | undefined;
  readonly traced: TracedCollection | undefined;
  readonly onChoose: (target: LoopTarget) => void;
  readonly onNotice: (text: string) => void;
  readonly newList: NewListOffer | undefined;
  readonly samples: ItemSamples;
}

interface Notice {
  readonly tone: 'info' | 'warning' | 'error';
  readonly text: string;
}

function unlinkWarning(count: number, lost: readonly string[], before: string | undefined, translate: Translator): string {
  const names = lost.length === 0 ? '' : ` (${lost.map((field) => titled(field)).join(', ')})`;
  const unlinked = translate('props.loop.notice.unlinked', { count, names });
  return before === undefined ? unlinked : `${unlinked} ${translate('props.loop.notice.switchBack', { count, name: before })}`;
}

function readingLabel(reading: LoopReading, data: string, catalog: LoopCatalog | undefined): string | undefined {
  if (reading.kind === 'query' || reading.kind === 'partial') {
    const source = reading.kind === 'query' ? reading.query.source : reading.source;
    return catalog?.collections.find((collection) => sourceKey(collection.source) === sourceKey(source))?.title ?? titled(source.collection);
  }
  return reading.kind === 'value' ? data.trim() : undefined;
}

function isListReading(reading: LoopReading): boolean {
  const source = reading.kind === 'query' ? reading.query.source : reading.kind === 'partial' ? reading.source : undefined;
  return source?.kind === 'list';
}

function removedNotice(removed: { readonly replaced: number; readonly emptied: number }, translate: Translator): string {
  const parts = [translate('props.loop.removed.title'), translate('props.loop.removed.replaced', { count: removed.replaced })];
  if (removed.emptied > 0) {
    parts.push(translate('props.loop.removed.emptied', { count: removed.emptied }));
  }
  return parts.join(' · ');
}

export default function LoopSettings(props: LoopSettingsProps) {
  const catalog = useLoopCatalog(props.projectPath);
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const setNotice = sayNotice;
  const tree = props.pickerData?.tree;
  const asCalled = useLoopReading(props.input, props.projectPath, catalog, tree, 'traced');
  const traced = useTracedEditing(asCalled.reading, { projectPath: props.projectPath, filePath: props.filePath, catalog }, setNotice);
  const calledList = asCalled.reading.kind === 'value' && asCalled.reading.origin.kind === 'call' && traced.editable === undefined;
  const asList = useLoopReading(props.input, props.projectPath, catalog, tree, 'list');
  const { reading, fields, kept } = calledList ? asList : asCalled;
  const sections = kept || calledList ? undefined : asCalled.sections;
  const holder = readingChain(reading)[0];
  const samples = useMemo(
    () =>
      itemSamples(
        tree,
        [
          ...(reading.kind === 'query' && reading.query.source.kind === 'list' ? [reading.query.source.collection] : []),
          ...readingChain(reading),
          props.input.data.trim(),
        ],
        props.item ?? 'item',
      ),
    [tree, reading, props.input.data, props.item],
  );
  const listSource = reading.kind === 'query' ? reading.query.source : undefined;
  const picks = useMemo(
    () => (listSource?.kind === 'list' ? listPicks({ frontmatter: props.input.frontmatter, expression: listSource.collection, tree }) : undefined),
    [listSource, props.input.frontmatter, tree],
  );
  const apply = (target: LoopTarget): void => {
    const client = catalog?.sanity.kind === 'connected' ? catalog.sanity.client : 'unavailable';
    const before = readingLabel(reading, props.input.data, catalog);
    setNotice(noticeFor(props.onApply(target, client), before, translate, translateDescribed));
  };
  const shared = { catalog, projectPath: props.projectPath };
  const applySection = (section: LoopSection, code: string): string | undefined => {
    const client = catalog?.sanity.kind === 'connected' ? catalog.sanity.client : 'unavailable';
    const result = props.onApply({ kind: 'section', section, code }, client);
    return result.ok ? undefined : translateDescribed(result);
  };
  const applyItemsCode = (data: string): string | undefined => {
    const client = catalog?.sanity.kind === 'connected' ? catalog.sanity.client : 'unavailable';
    const result = props.onApply({ kind: 'value', data }, client);
    return result.ok ? undefined : translateDescribed(result);
  };
  const code = sections === undefined ? undefined : sectionCodeContext(sections, { input: props.input, fields, applySection, applyQuery: apply }, translate);
  const literal = reading.kind === 'empty' ? undefined : literalItems(props.input.data);
  const arrayLiteral = reading.kind !== 'empty' && isArrayLiteral(props.input.data);
  const readerOf = (path: string, exported: string): string | undefined =>
    props.input.imports.find((entry) => entry.path === path && (entry.imported ?? entry.name) === exported)?.name;
  const readers = { astro: readerOf('astro:content', 'getCollection'), sanity: readerOf('sanity:client', 'sanityClient') };
  const fieldList = reading.kind === 'code' || isListReading(reading) ? fieldListOf(props.input.frontmatter, props.input.data, readers) : undefined;
  const binding = bindingFor(
    reading,
    { frontmatter: props.input.frontmatter, filePath: props.filePath },
    { onChange: (change) => apply({ kind: 'binding', change }), onEditProperty: props.onEditProperty },
    translate,
  );
  return (
    <div className="loop-settings">
      <SourceRow
        reading={reading}
        data={props.input.data}
        literal={literal}
        fieldList={fieldList}
        pickerData={props.pickerData}
        projectPath={props.projectPath}
        lists={props.lists}
        sourceButton={holder === undefined ? undefined : (anchorRef) => props.sourceButton?.(holder, anchorRef)}
        catalog={catalog}
        traced={traced.collection}
        onChoose={apply}
        onNotice={(text) => setNotice({ tone: 'error', text })}
        newList={newListOffer(props, catalog, translate, translateDescribed, setNotice)}
        samples={samples}
      />
      <ReadingSettings
        {...shared}
        reading={reading}
        traced={traced}
        fields={fields}
        binding={binding}
        literal={literal}
        arrayLiteral={arrayLiteral}
        data={props.input.data}
        onItemsCode={applyItemsCode}
        code={code}
        item={props.item}
        picks={picks}
        kept={kept}
        onApply={apply}
      />
      {props.children}
      <ReadingDetails reading={reading} data={props.input.data} traced={traced} catalog={catalog} split={sections !== undefined} />
    </div>
  );
}

function sectionCodeContext(
  sections: LoopSections,
  actions: {
    readonly input: LoopSettingsProps['input'];
    readonly fields: readonly CatalogField[] | undefined;
    readonly applySection: SectionCodeContext['write'];
    readonly applyQuery: (target: LoopTarget) => void;
  },
  translate: Translator,
): SectionCodeContext {
  const { query } = sections;
  const groq = sections.store === 'groq';
  return {
    sections,
    problemOf: (section, code) => (groq ? groqSectionProblem(section, code, query, translate) : sectionCodeProblem(section, code, translate)),
    refusalOf: (section, code) => (groq ? undefined : sectionRefusal(actions.input, section, code, translate)),
    write: (section, code) => {
      if (!groq) {
        return actions.applySection(section, code);
      }
      const next = groqSectionQuery(section, code, query);
      assert(next !== undefined, 'GROQ a section accepted reads as a query');
      actions.applyQuery({ kind: 'query', query: next, fields: actions.fields ?? [] });
      return undefined;
    },
    completions: (section) => sectionFieldPaths(section, sections, actions.fields).map((label) => ({ label, type: 'property' })),
    placeholder: (section) => sectionPlaceholder(section, query.source.kind),
  };
}

function newListOffer(
  props: Pick<LoopSettingsProps, 'newProp' | 'onApply'>,
  catalog: LoopCatalog | undefined,
  translate: Translator,
  translateDescribed: DescribedTranslator,
  setNotice: (notice: Notice | undefined) => void,
): NewListOffer | undefined {
  const host = props.newProp;
  if (host === undefined) {
    return undefined;
  }
  const client = catalog?.sanity.kind === 'connected' ? catalog.sanity.client : 'unavailable';
  const create = (declaration: PropDeclaration): Result<string, string> => {
    const result = props.onApply({ kind: 'value', data: declaration.key }, client, declaration);
    if (!result.ok) {
      return err(translateDescribed(result));
    }
    setNotice(noticeFor(result, undefined, translate, translateDescribed));
    return ok(declaration.key);
  };
  return { host: { ...host, create }, seed: { fit: 'list', label: translate('props.loop.source.itemsSeed'), value: '' } };
}

function bindingFor(
  reading: LoopReading,
  file: { readonly frontmatter: string; readonly filePath: string | undefined },
  actions: Pick<BindingContext, 'onChange' | 'onEditProperty'>,
  translate: Translator,
): BindingContext | undefined {
  if (file.filePath === undefined) {
    return undefined;
  }
  if (/(^|[\\/])src[\\/]pages[\\/]/.test(file.filePath)) {
    return undefined;
  }
  if (reading.kind !== 'query') {
    return undefined;
  }
  const base = {
    ...actions,
    componentName: titled(
      file.filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.astro$/, '') ?? translate('props.loop.binding.component'),
    ),
    problemOf: (key: string): string | undefined => propNameProblem(file.frontmatter, key, translate),
    connectable: (setting: LoopSetting): readonly string[] => connectableProps(file.frontmatter, setting),
    tooltipOf: (key: string): string => propTooltip(file.frontmatter, key),
  };
  if (reading.home?.kind === 'options') {
    return { ...base, settings: reading.home.settings };
  }
  return reading.home === undefined && reading.query.source.kind === 'astro' ? { ...base, settings: UNLINKED } : undefined;
}

const UNLINKED: Readonly<Record<LoopSetting, SettingHome>> = {
  filter: { kind: 'inline' },
  sort: { kind: 'inline' },
  limit: { kind: 'inline' },
  offset: { kind: 'inline' },
  curated: { kind: 'inline' },
};

function ReadingSettings(props: {
  readonly reading: LoopReading;
  readonly traced: ReturnType<typeof useTracedEditing>;
  readonly fields: readonly CatalogField[] | undefined;
  readonly binding: BindingContext | undefined;
  readonly literal: readonly string[] | undefined;
  readonly arrayLiteral: boolean;
  readonly data: string;
  readonly onItemsCode: (data: string) => string | undefined;
  readonly catalog: LoopCatalog | undefined;
  readonly projectPath: string | undefined;
  readonly code: SectionCodeContext | undefined;
  readonly item: string | undefined;
  readonly picks: ListPicks | undefined;
  readonly kept: boolean;
  readonly onApply: (target: LoopTarget) => void;
}) {
  const { reading, fields, literal, onApply, code } = props;
  const translate = useTranslate();
  const shared = { catalog: props.catalog, projectPath: props.projectPath };
  return (
    <>
      {reading.kind === 'value' && reading.origin.kind === 'call' && <TracedSettings {...shared} traced={props.traced} />}
      {reading.kind === 'partial' && code === undefined && (
        <PartialNotice onReplace={() => onApply({ kind: 'query', query: emptyQuery(reading.source), fields: fields ?? [] })} />
      )}
      {}
      {reading.kind === 'partial' && code !== undefined && (
        <ItemsSwitch
          current="dynamic"
          selectedReason={refusalText('custom', translate)}
          tip={listTip({ kept: props.kept, fields, source: reading.source }, translate)}
          onPick={() => undefined}
        />
      )}
      {reading.kind === 'partial' && code !== undefined && (
        <QuerySections
          {...shared}
          query={code.sections.query}
          item={props.item}
          fields={fields}
          stored="code"
          itemPath={code.sections.itemPath}
          code={code}
          onChange={(query) => onApply({ kind: 'query', query, fields: fields ?? [] })}
        />
      )}
      {reading.kind === 'query' && reading.query.source.kind === 'list' && (
        <ListSettings
          {...shared}
          query={reading.query}
          fields={fields}
          item={props.item}
          code={code}
          picks={props.picks}
          kept={props.kept}
          onChange={(query) => onApply({ kind: 'query', query, fields: [] })}
        />
      )}
      {reading.kind === 'query' && reading.query.source.kind !== 'list' && (
        <CollectionSettings
          {...shared}
          query={reading.query}
          home={reading.home}
          fields={fields}
          binding={props.binding}
          code={code}
          onChange={(query) => onApply({ kind: 'query', query, fields: fields ?? [] })}
        />
      )}
      {props.arrayLiteral && (
        <LiteralItemsSection
          items={literal}
          data={props.data}
          onChange={(items) => onApply({ kind: 'value', data: literalCode(items) })}
          onCode={props.onItemsCode}
        />
      )}
    </>
  );
}

function ReadingDetails(props: {
  readonly reading: LoopReading;
  readonly data: string;
  readonly traced: ReturnType<typeof useTracedEditing>;
  readonly catalog: LoopCatalog | undefined;
  readonly split: boolean;
}) {
  const translate = useTranslate();
  const translateDescribed = useTranslateDescribed();
  const { reading, traced } = props;
  if (reading.kind === 'value' && reading.origin.kind === 'call') {
    return (
      <LoopDetails>
        <LoopLineage
          names={reading.chain.length > 0 ? reading.chain : [props.data.trim()]}
          trace={traced.trace}
          catalog={props.catalog}
          fields={traced.fields}
          editable={traced.editable !== undefined}
        />
      </LoopDetails>
    );
  }
  if (reading.kind === 'partial') {
    return props.split ? undefined : (
      <LoopDetailsTip
        text={`${translateDescribed({
          message: reading.reason,
          ...(reading.reasonIssue === undefined ? {} : { messageRef: reading.reasonIssue.messageRef }),
        })} ${translate('props.loop.details.stillWorks')}`}
      />
    );
  }
  return reading.kind === 'query' && reading.home !== undefined ? <OptionsDetails home={reading.home} /> : undefined;
}

function CollectionSettings(props: {
  readonly query: LoopQuery;
  readonly binding: BindingContext | undefined;
  readonly home: QueryHome | undefined;
  readonly fields: readonly CatalogField[] | undefined;
  readonly catalog: LoopCatalog | undefined;
  readonly projectPath: string | undefined;
  readonly code: SectionCodeContext | undefined;
  readonly onChange: (query: LoopQuery) => void;
}) {
  const { home } = props;
  const ids = home?.kind === 'options' || (home?.kind === 'chain' && home.itemPath[0] === 'fields') ? 'export' : 'entry';
  const query = props.query;
  const switchTo = (mode: 'dynamic' | 'selected'): void => {
    const next = itemsModeQuery(query, mode);
    if (next !== undefined) {
      props.onChange(next);
    }
  };
  return (
    <>
      <ItemsSwitch current={query.selection === undefined ? 'dynamic' : 'selected'} selectedReason={undefined} onPick={switchTo} />
      {query.selection === undefined ? (
        <QuerySections
          {...props}
          query={query}
          stored={home?.kind === 'options' ? 'data' : 'code'}
          itemPath={home?.kind === 'chain' ? home.itemPath : undefined}
        />
      ) : (
        <ItemsSection query={query} catalog={props.catalog} projectPath={props.projectPath} ids={ids} binding={props.binding} onChange={props.onChange} />
      )}
    </>
  );
}

function ItemsSwitch(props: {
  readonly current: 'dynamic' | 'selected';
  readonly selectedReason: string | undefined;
  readonly tip?: string | undefined;
  readonly onPick: (mode: 'dynamic' | 'selected') => void;
}) {
  const translate = useTranslate();
  return (
    <div className="props-field loop-settings-row loop-settings-mode">
      <label>
        <span className="prop-label">{translate('props.loop.settings.items')}</span>
        <PropTip text={props.tip} />
      </label>
      <SegSwitch
        options={[
          { value: 'dynamic', label: translate('props.loop.settings.dynamic') },
          { value: 'selected', label: translate('props.loop.settings.selected'), disabledReason: props.selectedReason },
        ]}
        current={props.current}
        onPick={props.onPick}
      />
    </div>
  );
}

function listTip(
  list: { readonly kept: boolean; readonly fields: readonly CatalogField[] | undefined; readonly source: LoopSource },
  translate: Translator,
): string | undefined {
  const notes = [
    ...(list.kept ? [translate('props.loop.note.kept')] : []),
    ...(list.source.kind === 'list' && (list.fields === undefined || list.fields.length === 0) ? [translate('props.loop.note.unknownShape')] : []),
  ];
  return notes.length === 0 ? undefined : notes.join(' ');
}

function refusalText(reason: PickRefusal, translate: Translator): string {
  switch (reason) {
    case 'unknown':
      return translate('props.loop.settings.selectedUnknown');
    case 'custom':
      return translate('props.loop.settings.selectedCustom');
    case 'traced':
      return translate('props.loop.settings.selectedTraced');
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function ListSettings(props: {
  readonly query: LoopQuery;
  readonly fields: readonly CatalogField[] | undefined;
  readonly catalog: LoopCatalog | undefined;
  readonly projectPath: string | undefined;
  readonly code: SectionCodeContext | undefined;
  readonly item: string | undefined;
  readonly picks: ListPicks | undefined;
  readonly kept: boolean;
  readonly onChange: (query: LoopQuery) => void;
}) {
  const translate = useTranslate();
  const { query } = props;
  const switchTo = (mode: 'dynamic' | 'selected'): void => {
    const next = listItemsModeQuery(query, mode, props.picks);
    if (next !== undefined) {
      props.onChange(next);
    }
  };
  const selected = query.selection !== undefined;
  return (
    <>
      <ItemsSwitch
        current={selected ? 'selected' : 'dynamic'}
        selectedReason={props.picks === undefined && !selected ? refusalText('unknown', translate) : undefined}
        tip={listTip({ kept: props.kept, fields: props.fields, source: query.source }, translate)}
        onPick={switchTo}
      />
      {selected ? (
        <ItemsSection
          query={query}
          catalog={props.catalog}
          projectPath={props.projectPath}
          ids="entry"
          items={props.picks?.items ?? []}
          onChange={props.onChange}
        />
      ) : (
        <QuerySections
          catalog={props.catalog}
          projectPath={props.projectPath}
          query={query}
          item={props.item}
          fields={props.fields}
          stored="code"
          itemPath={[]}
          code={props.code}
          onChange={props.onChange}
        />
      )}
    </>
  );
}

function TracedSettings(props: {
  readonly traced: ReturnType<typeof useTracedEditing>;
  readonly catalog: LoopCatalog | undefined;
  readonly projectPath: string | undefined;
}) {
  const editable = props.traced.editable;
  const translate = useTranslate();
  return editable === undefined ? undefined : (
    <>
      <ItemsSwitch current="dynamic" selectedReason={refusalText('traced', translate)} onPick={() => undefined} />
      <QuerySections
        catalog={props.catalog}
        projectPath={props.projectPath}
        query={editable.query}
        fields={props.traced.fields}
        stored="traced"
        onChange={props.traced.apply}
      />
    </>
  );
}

function QuerySections(props: {
  readonly query: LoopQuery;
  readonly fields: readonly CatalogField[] | undefined;
  readonly catalog: LoopCatalog | undefined;
  readonly projectPath: string | undefined;
  readonly stored: 'code' | 'data' | 'traced';
  readonly itemPath?: readonly string[] | undefined;
  readonly binding?: BindingContext | undefined;
  readonly item?: string | undefined;
  readonly code?: SectionCodeContext | undefined;
  readonly onChange: (query: LoopQuery) => void;
}) {
  const { code } = props;
  const filterCode = useSectionCode('filter', code);
  const sortCode = useSectionCode('sort', code);
  const limitCode = useSectionCode('limit', code);
  const onChange = (query: LoopQuery): void => {
    const custom = code !== undefined && LOOP_SECTIONS.some((section) => code.sections[section].custom !== undefined);
    if (!custom) {
      props.onChange(query);
      return;
    }
    const section = changedSection(props.query, query);
    if (section !== undefined) {
      code.write(section, sectionCodeOf(query, section, code.sections.itemPath));
    }
  };
  const operatorSet = props.stored === 'data' ? 'data' : 'code';
  const randomOrder = props.stored === 'code' ? 'available' : 'unavailable';
  const typed: TypedFieldSupport | undefined = props.query.source.kind === 'list' ? { item: props.item } : undefined;
  const fields = withTypedFields(props.fields, props.query);
  return (
    <>
      {filterCode.editor ?? (
        <FilterSection
          typed={typed}
          query={props.query}
          fields={fields}
          catalog={props.catalog}
          projectPath={props.projectPath}
          operatorSet={operatorSet}
          itemPath={props.itemPath}
          binding={props.binding}
          toggle={filterCode.toggle}
          onChange={onChange}
        />
      )}
      {sortCode.editor ?? (
        <SortSection
          typed={typed}
          query={props.query}
          fields={fields}
          catalog={props.catalog}
          projectPath={props.projectPath}
          itemPath={props.itemPath}
          randomOrder={randomOrder}
          binding={props.binding}
          toggle={sortCode.toggle}
          onChange={onChange}
        />
      )}
      {limitCode.editor ?? <LimitSection query={props.query} binding={props.binding} toggle={limitCode.toggle} onChange={onChange} />}
    </>
  );
}

function noticeFor(result: LoopApplyResult, before: string | undefined, translate: Translator, translateDescribed: DescribedTranslator): Notice | undefined {
  if (!result.ok) {
    return { tone: 'error', text: translateDescribed(result) };
  }
  if (result.removed !== undefined) {
    return { tone: result.removed.emptied > 0 ? 'warning' : 'info', text: removedNotice(result.removed, translate) };
  }
  if (result.unbound > 0) {
    return { tone: 'warning', text: unlinkWarning(result.unbound, result.lost, before, translate) };
  }
  return result.restored ? { tone: 'info', text: translate('props.loop.notice.relinked') } : undefined;
}

function sayNotice(notice: Notice | undefined): void {
  if (notice !== undefined) {
    reportActionToast(notice.text, notice.tone, []);
  }
}

function useLoopReading(
  given: Omit<LoopReadInput, 'fieldKind'>,
  projectPath: string | undefined,
  catalog: LoopCatalog | undefined,
  tree: readonly TreeNode[] | undefined,
  calls: 'traced' | 'list',
) {
  const { input, kept } = useMemo(() => {
    const plain = { ...given, calls, unreadSteps: 'partial' as const };
    const reading = readLoop(plain);
    const split = reading.kind === 'partial' && readSections(plain) === undefined;
    return { input: split ? { ...plain, unreadSteps: 'kept' as const } : plain, kept: split };
  }, [given, calls]);
  const first = useMemo(() => readLoop(input), [input]);
  const firstSource = first.kind === 'query' ? first.query.source : first.kind === 'partial' ? first.source : undefined;
  const catalogFields = useCatalogFields(projectPath, catalog, firstSource);
  const listFields = useMemo(
    () => (firstSource?.kind === 'list' ? listSourceFields(input.frontmatter, firstSource.collection, tree) : undefined),
    [firstSource, input.frontmatter, tree],
  );
  const fields = listFields ?? catalogFields;
  const reading = useMemo(() => {
    if (fields === undefined || firstSource === undefined) {
      return first;
    }
    const fieldKind = (_source: LoopSource, path: string): LoopFieldKind | undefined => fieldNamed(fields, path)?.kind;
    return readLoop({ ...input, fieldKind });
  }, [first, fields, firstSource, input]);
  const sections = useMemo(() => {
    const fieldKind = (_source: LoopSource, path: string): LoopFieldKind | undefined => fieldNamed(fields, path)?.kind;
    return readSections({ ...input, fieldKind });
  }, [fields, input]);
  return { reading, fields, sections, kept };
}

function listSourceFields(frontmatter: string, name: string, tree: readonly TreeNode[] | undefined): readonly CatalogField[] | undefined {
  const prop = listPropOf(frontmatter, name);
  if (prop !== undefined) {
    return prop.fields === undefined ? undefined : listItemFields(prop.fields);
  }
  const written = writtenListFields(frontmatter, name) ?? literalListFields(name) ?? treeListFields(tree, name);
  return written?.map((field) => ({ path: field.path, title: titled(field.path), kind: field.kind, options: [], references: [] }));
}

function useTracedEditing(
  reading: LoopReading,
  location: { readonly projectPath: string | undefined; readonly filePath: string | undefined; readonly catalog: LoopCatalog | undefined },
  setNotice: (notice: Notice | undefined) => void,
) {
  const origin = reading.kind === 'value' ? reading.origin : undefined;
  const [version, setVersion] = useState(0);
  const trace = useLoopTrace(origin, { projectPath: location.projectPath, filePath: location.filePath, version });
  const collection = tracedCollection(trace);
  const fields = useCatalogFields(location.projectPath, location.catalog, collection?.source);
  const editable = collection === undefined ? undefined : editableTrace(collection);
  const apply = (query: LoopQuery): void => {
    const projectPath = location.projectPath;
    if (projectPath === undefined || editable === undefined) {
      return;
    }
    void writeTracedQuery(projectPath, editable.literal, { file: editable.file, query }).then((outcome) => {
      setVersion((current) => current + 1);
      setNotice(outcome.ok ? undefined : { tone: 'error', text: outcome.message });
    });
  };
  return { trace, collection, fields, editable, apply };
}


function SourceRow(props: SourceRowProps) {
  const translate = useTranslate();
  const { reading, catalog } = props;
  const rowRef = useRef<HTMLDivElement>(null);
  const current = sourceKeyOf(props);
  const shown = props.fieldList === undefined ? sourceOptions(props, catalog, current, translate).find((option) => option.value === current) : undefined;
  const choose = (pick: SourcePick): void => {
    if (pick.kind === 'value' && `value:${pick.data}` === current) {
      return;
    }
    if (pick.kind === 'empty' && reading.kind !== 'empty') {
      props.onChoose({ kind: 'remove', samples: props.samples });
      return;
    }
    if (pick.kind === 'empty' || pick.kind === 'value') {
      props.onChoose(pick);
      return;
    }
    if (pick.kind === 'list') {
      props.onChoose({ kind: 'value', data: literalCode(STARTER_ITEMS) });
      return;
    }
    if (pick.kind === 'field') {
      props.onChoose({ kind: 'field', list: pick.list });
      return;
    }
    if (sourceKey(pick.source) === current) {
      return;
    }
    if (pick.source.kind === 'sanity' && catalog?.sanity.kind === 'connected' && catalog.sanity.client === 'unavailable') {
      props.onNotice(translate('props.loop.source.needsSanityAstro'));
      return;
    }
    void chooseCollection(props, catalog, pick.source);
  };
  return (
    <div className="props-field loop-settings-row" ref={rowRef}>
      <label>
        <span className="prop-label">{translate('props.loop.source.title')}</span>
      </label>
      <div className="loop-settings-source">
        <SourcePicker
          label={props.fieldList === undefined ? (shown?.label ?? translate('props.loop.source.none')) : fieldListLabel(props.fieldList, catalog)}
          icon={fieldListIcon(props.fieldList) ?? shown?.icon ?? <CmsIcon size={13} />}
          current={pickerPath(props, reading)}
          catalog={catalog}
          data={props.pickerData}
          newList={props.newList}
          bound={props.fieldList !== undefined || (reading.kind !== 'empty' && reading.kind !== 'code')}
          loadSanitySample={(type) =>
            props.projectPath !== undefined && catalog !== undefined ? loadSanitySample(props.projectPath, catalog, type) : Promise.resolve(undefined)
          }
          onPick={choose}
        />
        {props.sourceButton?.(rowRef)}
      </div>
    </div>
  );
}

function sourceKeyOf(props: SourceRowProps): string {
  if (props.literal !== undefined) {
    return 'list';
  }
  return props.fieldList === undefined ? readingKey(props.reading, props.data) : `field:${sourceKey(props.fieldList.source)}`;
}

function pickerPath(props: SourceRowProps, reading: LoopReading): string | undefined {
  if (props.fieldList !== undefined) {
    return fieldListPath(props.fieldList);
  }
  if (reading.kind === 'query') {
    return sourcePath(reading.query.source);
  }
  if (reading.kind === 'partial' && reading.source.kind === 'list') {
    return sourcePath(reading.source);
  }
  return reading.kind === 'value' ? props.data.trim() : undefined;
}

function fieldListIcon(list: FieldList | undefined): ReactNode {
  if (list === undefined) {
    return undefined;
  }
  return list.source.kind === 'astro' ? <AstroIcon size={13} /> : <SanityIcon size={13} />;
}

function fieldListLabel(list: FieldList, catalog: LoopCatalog | undefined): string {
  const collection = catalog?.collections.find((entry) => sourceKey(entry.source) === sourceKey(list.source));
  return [collection?.title ?? titled(list.source.collection), ...list.path.map((key) => titled(key))].join(' › ');
}

async function chooseCollection(
  props: { readonly projectPath: string | undefined; readonly reading: LoopReading; readonly onChoose: (target: LoopTarget) => void },
  catalog: LoopCatalog | undefined,
  source: LoopSource,
): Promise<void> {
  const fields = props.projectPath && catalog ? await loadFields(props.projectPath, catalog, source) : undefined;
  const previous = props.reading.kind === 'query' ? props.reading.query : undefined;
  const query: LoopQuery = { ...emptyQuery(source), limit: previous?.limit, offset: previous?.offset ?? 0 };
  props.onChoose({ kind: 'query', query, fields: fields ?? [] });
}

function sourceOptions(
  props: SourceRowProps,
  catalog: LoopCatalog | undefined,
  current: string,
  translate: Translator = ENGLISH_TRANSLATE,
): DropdownOption<string>[] {
  const options: DropdownOption<string>[] = [
    { value: 'empty', label: translate('props.loop.source.none') },
    { value: 'list', label: translate('props.loop.source.customList'), hint: translate('props.loop.source.typeItems'), icon: <TextIcon size={13} /> },
  ];
  const sanityLabel = catalog?.sanity.kind === 'connected' ? `Sanity · ${catalog.sanity.label}` : 'Sanity';
  const sanityMissing = catalog?.sanity.kind === 'connected' && catalog.sanity.client === 'unavailable';
  for (const collection of catalog?.collections ?? []) {
    const astro = collection.source.kind === 'astro';
    const hint = sanityMissing && !astro ? translate('props.loop.source.needsIntegration') : collection.count === undefined ? '' : String(collection.count);
    options.push({
      value: sourceKey(collection.source),
      label: collection.title,
      group: astro ? translate('props.loop.source.contentCollections') : sanityLabel,
      groupIcon: astro ? <AstroIcon size={12} /> : <SanityIcon size={12} />,
      hint,
      icon: <CmsIcon size={13} />,
      dim: sanityMissing && !astro,
    });
  }
  for (const list of props.lists) {
    const project = isProjectData(props, list.path);
    options.push({
      value: `value:${list.path}`,
      label: list.label,
      group: project ? translate('props.dataPicker.section.projectData') : translate('props.dataPicker.section.onPage'),
      hint: list.hint,
      icon: <CmsIcon size={13} />,
    });
  }
  if (!options.some((option) => option.value === current)) {
    options.push(currentOption(props, current, translate));
  }
  assert(options.length <= LOOP_CATALOG_LIMITS.collectionsMax + props.lists.length + 3, 'The Source menu is bounded');
  return options;
}

function isProjectData(props: SourceRowProps, name: string): boolean {
  const modules = props.pickerData?.projectModules;
  return modules !== undefined && Object.prototype.hasOwnProperty.call(modules, name);
}

function currentOption(props: SourceRowProps, current: string, translate: Translator): DropdownOption<string> {
  const reading = props.reading;
  if (reading.kind === 'query' || reading.kind === 'partial') {
    const source = reading.kind === 'query' ? reading.query.source : reading.source;
    if (source.kind === 'list') {
      const project = isProjectData(props, source.collection);
      return {
        value: current,
        label: source.collection,
        group: project ? translate('props.dataPicker.section.projectData') : translate('props.dataPicker.section.onPage'),
        hint: '',
        icon: <CmsIcon size={13} />,
      };
    }
    return {
      value: current,
      label: source.collection,
      group: source.kind === 'astro' ? translate('props.loop.source.contentCollections') : 'Sanity',
      icon: <CmsIcon size={13} />,
    };
  }
  if (reading.kind === 'value' && props.traced !== undefined) {
    const source = props.traced.source;
    const title = props.catalog?.collections.find((entry) => sourceKey(entry.source) === sourceKey(source))?.title ?? titled(source.collection);
    const via = reading.origin.kind === 'call' ? translate('props.loop.source.via', { name: `${reading.origin.exportName}()` }) : props.data.trim();
    return {
      value: current,
      label: `${title} · ${props.data.trim()}`,
      group: translate('props.dataPicker.section.onPage'),
      hint: via,
      icon: source.kind === 'sanity' ? <SanityIcon size={13} /> : <AstroIcon size={13} />,
    };
  }
  if (reading.kind === 'value') {
    const origin = reading.origin;
    const hint =
      origin.kind === 'call'
        ? `${origin.exportName}()`
        : origin.kind === 'import'
          ? translate('props.loop.source.import')
          : origin.kind === 'frontmatter'
            ? translate('props.loop.source.thisFile')
            : '';
    return { value: current, label: props.data.trim(), group: translate('props.dataPicker.section.onPage'), hint, icon: <CmsIcon size={13} /> };
  }
  return { value: current, label: translate('props.loop.customCode'), hint: translate('props.loop.source.editBelow') };
}

function OptionsDetails(props: { readonly home: QueryHome }) {
  const translate = useTranslate();
  const { formatList } = useFormat();
  const home = props.home;
  if (home.kind === 'chain') {
    return <LoopDetailsTip text={translate('props.loop.details.chain', { list: home.list })} />;
  }
  const bound =
    home.kind === 'options' ? LOOP_SETTINGS.filter((setting) => home.settings[setting].kind === 'prop').map((setting) => settingTitle(setting, translate)) : [];
  const saved = translate('props.loop.details.saved', { reader: home.reader });
  const text = bound.length === 0 ? saved : `${saved} ${translate('props.loop.details.defaults', { titles: formatList(bound, 'and') })}`;
  return <LoopDetailsTip text={text} />;
}

function PartialNotice(props: { readonly onReplace: () => void }) {
  const translate = useTranslate();
  const [armed, setArmed] = useState(false);
  return (
    <div className="loop-settings-partial">
      <div className="loop-settings-partial-title">{translate('props.loop.partial.title')}</div>
      <button type="button" className="loop-settings-link" onClick={() => (armed ? props.onReplace() : setArmed(true))} onBlur={() => setArmed(false)}>
        {armed ? translate('props.loop.partial.confirm') : translate('props.loop.partial.use')}
      </button>
    </div>
  );
}
