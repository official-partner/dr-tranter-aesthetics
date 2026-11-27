import { useCodeAccess } from '../../ui/CodeAccess';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import {
  BracesIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  AstroIcon,
  CmsIcon,
  ElementComponentIcon,
  FileIcon,
  CodeIcon,
  ElementImageIcon,
  FieldNumberIcon,
  FieldSwitchIcon,
  GearIcon,
  PencilIcon,
  RepeatIcon,
  TextIcon,
} from '../../ui/Icons';
import { pathSteps, previewText, treeKindLabel } from '../../editor/dataSample';
import type { TypedMessageRef, Translator } from '../../../shared/properties/i18n/messageRef';
import { useTranslate, useTranslateRef } from '../../lib/i18n/useTranslate';
import {
  entryPageOf,
  entryPath,
  dataFileOfSection,
  isComponentSection,
  PROJECT_DATA_SECTION,
  sectionHeads,
  missingLabel,
  pagesOfPath,
  settingsKeyOf,
  shownEntryRows,
  steppedEntryIndex,
  type DataOrigin,
  type EntryPages,
} from './dataPickerModel';
import { DataSearch, DataSection, DataSubsection, DataTreeRow, ItemNavigation, PreviewValue, dataRowIndentPx, type ItemPosition } from '../../ui/DataTree';
import type { PropSettingsOffer } from './newPropModel';
import type { ImportNeed } from '../../editor/dataSample';
import type { PickNeed } from '../../editor/bindings';


function ancestorsOf(path: string | undefined): string[] {
  const pathText = path || '';
  assert(pathText.length <= LIMITS.attrCharsMax, 'DataPicker: binding path limit exceeded');
  const steps = pathSteps(pathText) ?? [];
  return steps.slice(0, -1).map((step) => pathText.slice(0, step.end));
}

function flatten(nodes: readonly PickerNode[]): PickerNode[] {
  const pending = nodes.map((node) => ({ node, depth: 0 })).reverse();
  const out: PickerNode[] = [];
  assert(pending.length <= LIMITS.treeNodesMax, 'DataPicker: node limit exceeded');
  for (let visited = 0; pending.length; visited++) {
    assert(visited < LIMITS.treeNodesMax, 'DataPicker: node limit exceeded');
    const next = pending.pop();
    assert(next !== undefined, 'DataPicker: queued node exists');
    assert(next.depth <= LIMITS.treeDepthMax, 'DataPicker: depth limit exceeded');
    out.push(next.node);
    const children = next.node.children ?? [];
    assert(out.length + pending.length + children.length <= LIMITS.treeNodesMax, 'DataPicker: node limit exceeded');
    for (let index = children.length - 1; index >= 0; index--) {
      const node = children[index];
      assert(node !== undefined, 'DataPicker: child exists');
      pending.push({ node, depth: next.depth + 1 });
    }
  }
  return out;
}

export function searchMatches(tree: readonly PickerNode[], needle: string): { readonly node: PickerNode; readonly root: PickerNode }[] {
  assert(needle === needle.toLowerCase(), 'searchMatches: the needle is lower case');
  return withRoots(tree).filter(({ node }) => node.path.toLowerCase().includes(needle) || String(node.preview).toLowerCase().includes(needle));
}

function withRoots(tree: readonly PickerNode[]): { readonly node: PickerNode; readonly root: PickerNode }[] {
  const out = tree.flatMap((root) => flatten([root]).map((node) => ({ node, root })));
  assert(out.length <= LIMITS.treeNodesMax * Math.max(tree.length, 1), 'DataPicker: node limit exceeded');
  return out;
}

export function needOf(root: Pick<PickerNode, 'query' | 'importNeed'>): PickNeed | undefined {
  if (root.query !== undefined) {
    return { kind: 'collection', collection: root.query.collection, name: root.query.name };
  }
  if (root.importNeed !== undefined) {
    return { kind: 'import', import: root.importNeed, name: root.importNeed.name };
  }
  return undefined;
}

function withCurrent(tree: readonly PickerNode[], current: string | undefined, translate: Translator) {
  const flat = flatten(tree);
  if (!current) {
    return tree;
  }
  if (flat.some((node) => node.path === current)) {
    return tree;
  }
  const anchors: PickerNode[] = [];
  for (const ancestor of ancestorsOf(current)) {
    const found = flat.find((node) => node.path === ancestor);
    if (found) {
      anchors.push(found);
    }
  }
  const anchor = anchors[anchors.length - 1];
  const missing: PickerNode = {
    path: current,
    key: anchor ? current.slice(anchor.path.length).replace(/^\./, '') : current,
    kind: missingLabel(anchors, translate),
    preview: '',
    children: undefined,
    missing: true,
  };
  if (!anchor) {
    return [...(tree || []), missing];
  }
  const anchorPath = anchor.path;
  const graft = (nodes: readonly PickerNode[], depth: number): readonly PickerNode[] => {
    assert(depth <= LIMITS.treeDepthMax, 'DataPicker: depth limit exceeded');
    return nodes.map((node) =>
      node.path === anchorPath
        ? { ...node, children: [...(node.children || []), missing] }
        : node.children
          ? { ...node, children: graft(node.children, depth + 1) }
          : node,
    );
  };
  return graft(tree || [], 0);
}

type Navigation = ItemPosition;
interface Entries extends Navigation {
  readonly label: string;
  readonly onStep: (step: -1 | 1) => void;
}
export interface PickerNode {
  readonly path: string;
  readonly key: string;
  readonly kind: string;
  readonly preview: string;
  readonly previewRef?: TypedMessageRef | undefined;
  readonly children: readonly PickerNode[] | undefined;
  readonly section?: string;
  readonly nav?: Navigation;
  readonly entryCount?: number;
  readonly query?: { readonly collection: string; readonly name: string };
  readonly importNeed?: ImportNeed;
  readonly unbindable?: string;
  readonly unbindableRef?: TypedMessageRef | undefined;
  readonly note?: string;
  readonly noteRef?: TypedMessageRef | undefined;
  readonly detail?: string;
  readonly lazy?: boolean;
  readonly pickable?: boolean;
  readonly missing?: boolean;
  readonly image?: string;
}
export interface DataPickerProps {
  readonly tree?: readonly PickerNode[] | undefined;
  readonly current?: string | undefined;
  readonly entries?: Entries | undefined;
  readonly onStepItem?: (path: string, step: -1 | 1, count: number, index: number) => void;
  readonly onPick: (path: string, need: PickNeed | undefined) => void;
  readonly onExpand?: (node: PickerNode, index: number | undefined) => void;
  readonly origin?: DataOrigin | undefined;
  readonly onWrite?: () => void;
  readonly onEdit?: (() => void) | undefined;
  readonly editLabel?: string;
  readonly footer?: boolean;
  readonly lead?: ReactNode;
  readonly propSettings?: PropSettingsOffer | undefined;
  readonly sources?: 'folded' | 'open';
  readonly rows?: 'data' | 'lead';
}

export default function DataPicker(props: DataPickerProps) {
  const allowCode = useCodeAccess();
  const { entries, onStepItem, onPick, onWrite, onEdit, footer = true, lead } = props;
  const translate = useTranslate();
  const editLabel = props.editLabel ?? translate('props.dataPicker.edit');
  const state = useDataPicker(props);
  const { query, setQuery, searchRef, listRef } = state;
  const origin = props.origin;
  const { propSettings } = props;
  const editing = propSettings === undefined ? undefined : state.settingsKey;
  return (
    <>
      {}
      <div className={editing === undefined ? 'data-picker' : 'data-picker is-covered'}>
        {}
        {lead !== undefined && <div className="dp-lead">{lead}</div>}
        {}
        {entries && entries.count > 1 && <EntryNavigation entries={entries} />}
        {props.rows !== 'lead' && (
          <>
            <DataSearch value={query} label={translate('props.dataPicker.search')} inputRef={searchRef} onChange={setQuery} />
            <DataPickerResults state={state} origin={origin} folding={props.sources ?? 'folded'} onPick={onPick} onStepItem={onStepItem} listRef={listRef} />
          </>
        )}
        {}
        {allowCode && onEdit && (
          <div className="dp-foot" onMouseDown={(event) => event.preventDefault()} onClick={onEdit}>
            <PencilIcon size={11} />
            {editLabel}
          </div>
        )}
        {allowCode && footer && (
          <div className="dp-foot" onMouseDown={(event) => event.preventDefault()} onClick={onWrite}>
            <CodeIcon size={11} />
            {translate('props.dataPicker.writeExpression')}
          </div>
        )}
      </div>
      {editing !== undefined && propSettings !== undefined && <div className="dp-property-settings">{propSettings.render(editing, state.closeSettings)}</div>}
    </>
  );
}

function DataPickerResults({
  state,
  origin,
  folding,
  onPick,
  onStepItem,
  listRef,
}: {
  readonly state: PickerState;
  readonly origin: DataOrigin | undefined;
  readonly folding: 'folded' | 'open';
  readonly onPick: DataPickerProps['onPick'];
  readonly onStepItem: DataPickerProps['onStepItem'];
  readonly listRef: React.RefObject<HTMLDivElement>;
}) {
  const translate = useTranslate();
  const { matches, tree } = state;
  return (
    <div className="dp-list" ref={listRef}>
      {}
      {matches ? (
        matches.map((match) => (
          <DataRow key={match.node.path} node={match.node} depth={0} showPath root={match.root} state={state} onPick={onPick} onStepItem={onStepItem} />
        ))
      ) : (
        <DataRoots nodes={tree} origin={origin} folding={folding} state={state} onPick={onPick} onStepItem={onStepItem} />
      )}
      {((matches && !matches.length) || (!matches && !tree.length)) && (
        <div className="dp-empty">{matches ? translate('props.dataPicker.noMatch') : translate('props.dataPicker.empty')}</div>
      )}
    </div>
  );
}

function useDataPicker({ tree: rawTree, current, onExpand, propSettings }: DataPickerProps) {
  const translate = useTranslate();
  const [sections, setSections] = useState<ReadonlySet<string>>(() => sectionsHolding(rawTree ?? [], current));
  const [query, setQuery] = useState('');
  const [settingsKey, setSettingsKey] = useState<string | undefined>(undefined);
  const tree = useMemo(() => withCurrent(rawTree ?? [], current, translate), [rawTree, current, translate]);
  const [pages, setPages] = useState<EntryPages>(() => pagesOfPath(current));
  const [open, setOpen] = useState(() => {
    const start = new Set(ancestorsOf(current));
    if (!start.size) {
      const first = (tree || []).find((node) => node.children?.length && node.section !== 'collections' && needOf(node) === undefined);
      if (first) {
        start.add(first.path);
        const page = entryPageOf(first, pages);
        if (page !== undefined) {
          start.add(entryPath(first.path, page.index));
        }
      }
    }
    return start;
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = selectedRef.current;
    if (!list || !row) {
      return;
    }
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top >= lr.top && rr.bottom <= lr.bottom) {
      return;
    }
    list.scrollTop += rr.top - lr.top - (lr.height - rr.height) / 2;
  }, [current]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) {
      return undefined;
    }
    return searchMatches(tree, needle);
  }, [needle, tree]);

  useEffect(() => {
    if (onExpand === undefined) {
      return;
    }
    for (const node of flatten(tree)) {
      const page = open.has(node.path) && node.query !== undefined ? entryPageOf(node, pages) : undefined;
      if (page !== undefined && shownEntryRows(node.path, node.children ?? [], page).unread) {
        onExpand(node, page.index);
      }
    }
  }, [tree, open, pages, onExpand]);

  const toggle = (node: PickerNode) => {
    if (node.lazy && !node.children?.length) {
      onExpand?.(node, undefined);
    }
    const page = entryPageOf(node, pages);
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(node.path)) {
        next.delete(node.path);
      } else {
        next.add(node.path);
        if (page !== undefined) {
          next.add(entryPath(node.path, page.index));
        }
      }
      return next;
    });
  };

  const stepEntry = (node: PickerNode, step: -1 | 1) => {
    const page = entryPageOf(node, pages);
    assert(page !== undefined, 'DataPicker: only a list of entries is stepped');
    const index = steppedEntryIndex(page, step);
    setPages((previous) => ({ ...previous, [node.path]: index }));
    setOpen((previous) => new Set(previous).add(entryPath(node.path, index)));
  };

  const closeSettings = (): void => {
    setSettingsKey(undefined);
    searchRef.current?.focus();
  };

  const toggleSection = (section: string): void => {
    setSections((previous) => {
      const next = new Set(previous);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  return {
    query,
    setQuery,
    sections,
    toggleSection,
    tree,
    open,
    pages,
    searchRef,
    listRef,
    selectedRef,
    matches,
    toggle,
    stepEntry,
    current,
    settingsKey,
    openSettings: setSettingsKey,
    closeSettings,
    keyOf: propSettings?.keyOf,
  };
}

type PickerState = ReturnType<typeof useDataPicker>;
interface RowProps {
  readonly node: PickerNode;
  readonly depth: number;
  readonly showPath: boolean;
  readonly root: PickerNode | undefined;
  readonly state: PickerState;
  readonly onPick: DataPickerProps['onPick'];
  readonly onStepItem: DataPickerProps['onStepItem'];
}
function DataRow({ node, depth, showPath, root, state, onPick, onStepItem }: RowProps) {
  const translate = useTranslate();
  const translateRef = useTranslateRef();
  assert(depth <= LIMITS.treeDepthMax, 'DataPicker: render depth limit exceeded');
  const { open, pages, current, selectedRef, toggle, stepEntry } = state;
  const expandable = !!node.children?.length || node.lazy;
  const isOpen = open.has(node.path);
  const page = isOpen ? entryPageOf(node, pages) : undefined;
  const shown = page === undefined ? undefined : shownEntryRows(node.path, node.children ?? [], page);
  const from = root || node;
  const isCurrent = node.path === current;
  return (
    <React.Fragment key={node.path}>
      <DataTreeRow
        depth={depth}
        label={showPath ? node.path : node.key}
        title={`${node.path} — ${node.unbindableRef !== undefined ? translateRef(node.unbindableRef) : (node.unbindable ?? treeKindLabel(node.kind, translate))}`}
        detail={node.detail}
        expandable={expandable === true}
        open={isOpen}
        selected={isCurrent}
        tone={node.missing ? 'missing' : node.unbindable !== undefined ? 'disabled' : node.pickable === false ? 'path-only' : 'plain'}
        check="selected-only"
        rowRef={isCurrent ? selectedRef : undefined}
        lead={<DataRowLead node={node} depth={depth} />}
        value={
          node.nav && onStepItem ? (
            <ItemNavigation path={node.path} nav={node.nav} onStepItem={onStepItem} />
          ) : page !== undefined ? (
            <ItemNavigation path={node.path} nav={page} onStepItem={(_path, step) => stepEntry(node, step)} />
          ) : node.note !== undefined ? (
            <span className="dp-val kind">{node.noteRef !== undefined ? translateRef(node.noteRef) : node.note}</span>
          ) : (
            <PreviewValue preview={previewText(node, translate)} kind={treeKindLabel(node.kind, translate)} image={node.image} />
          )
        }
        end={state.keyOf !== undefined && <PropSettingsSlot propKey={settingsKeyOf(node, state.keyOf)} onOpen={state.openSettings} />}
        onToggle={() => toggle(node)}
        onPick={() => (node.pickable === false ? toggle(node) : onPick(node.path, needOf(from)))}
      />
      {isOpen &&
        (shown !== undefined ? (
          <>
            {shown.rows.map((child) => (
              <DataRow key={child.path} node={child} depth={depth + 1} showPath={false} root={from} state={state} onPick={onPick} onStepItem={onStepItem} />
            ))}
            {shown.unread && (
              <div className="dp-loading" style={{ paddingInlineStart: dataRowIndentPx(depth + 1) }}>
                {translate('props.dataPicker.reading')}
              </div>
            )}
          </>
        ) : node.children?.length ? (
          node.children.map((child) => (
            <DataRow key={child.path} node={child} depth={depth + 1} showPath={false} root={from} state={state} onPick={onPick} onStepItem={onStepItem} />
          ))
        ) : node.lazy ? (
          <div className="dp-loading" style={{ paddingInlineStart: dataRowIndentPx(depth + 1) }}>
            {translate('props.dataPicker.reading')}
          </div>
        ) : undefined)}
    </React.Fragment>
  );
}
function DataRowLead({ node, depth }: { readonly node: PickerNode; readonly depth: number }) {
  const translate = useTranslate();
  if (depth > 0) {
    return undefined;
  }
  if (node.section === 'props') {
    return <PropKindIcon kind={node.kind} />;
  }
  if (node.section === 'collections') {
    return (
      <span className="dp-kind-icon" title={translate('props.dataPicker.contentCollection')}>
        <CmsIcon size={12} />
      </span>
    );
  }
  return undefined;
}

function PropSettingsSlot({ propKey, onOpen }: { readonly propKey: string | undefined; readonly onOpen: (key: string) => void }) {
  const translate = useTranslate();
  return (
    <span className="dp-settings-slot">
      {propKey !== undefined && (
        <button
          type="button"
          className="dp-settings"
          aria-label={translate('props.dataPicker.editPropSettings', { name: propKey })}
          title={translate('props.dataPicker.editSettings')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(propKey);
          }}
        >
          <GearIcon size={12} />
        </button>
      )}
    </span>
  );
}
function DataRoots({
  nodes,
  origin,
  folding,
  state,
  onPick,
  onStepItem,
}: {
  readonly nodes: readonly PickerNode[];
  readonly origin: DataOrigin | undefined;
  readonly folding: 'folded' | 'open';
  readonly state: PickerState;
  readonly onPick: DataPickerProps['onPick'];
  readonly onStepItem: DataPickerProps['onStepItem'];
}) {
  const translate = useTranslate();
  let section: string | undefined;
  return (nodes || []).map((node) => {
    const heads = node.section && node.section !== section ? sectionHeads(node.section, section, origin, translate) : [];
    section = node.section || section;
    const folds = folding === 'folded' && isSourceSection(section);
    const shown = !folds || (section !== undefined && state.sections.has(section));
    const key = section;
    return (
      <React.Fragment key={`s:${node.path}`}>
        {heads.map((head) =>
          head.kind === 'part' ? (
            <DataSubsection key={`h:${head.heading}`} heading={head.heading} />
          ) : (
            <DataSection
              key={`h:${head.heading}`}
              heading={head.heading}
              tone={isComponentSection(head.section, origin) ? 'component' : 'source'}
              icon={<SectionIcon section={head.section} />}
              collapse={folds && key !== undefined ? { open: shown, onToggle: () => state.toggleSection(key) } : undefined}
            />
          ),
        )}
        {shown && <DataRow node={node} depth={0} showPath={false} root={undefined} state={state} onPick={onPick} onStepItem={onStepItem} />}
      </React.Fragment>
    );
  });
}

export function isSourceSection(section: string | undefined): boolean {
  if (section === 'collections') {
    return true;
  }
  return dataFileOfSection(section) !== undefined;
}

function sectionsHolding(tree: readonly PickerNode[], current: string | undefined): ReadonlySet<string> {
  const steps = current === undefined ? [] : [...ancestorsOf(current), current];
  const sections = new Set<string>();
  for (const node of tree) {
    if (node.section !== undefined && isSourceSection(node.section) && steps.includes(node.path)) {
      sections.add(node.section);
    }
  }
  assert(sections.size <= tree.length, 'sectionsHolding: one group per root at most');
  return sections;
}

function SectionIcon({ section }: { readonly section: string | undefined }) {
  if (section === 'props' || section === 'loop-component') {
    return <ElementComponentIcon size={11} className="dp-section-icon" />;
  }
  if (section === 'collections') {
    return <AstroIcon size={11} className="dp-section-icon" />;
  }
  if (section === PROJECT_DATA_SECTION) {
    return <FileIcon size={11} className="dp-section-icon" />;
  }
  if (dataFileOfSection(section) !== undefined) {
    return <FileIcon size={11} className="dp-section-icon" />;
  }
  return undefined;
}

function EntryNavigation({ entries }: { readonly entries: Entries }) {
  const translate = useTranslate();
  return (
    <div className="dp-entry">
      <button
        type="button"
        className="dp-step"
        title={translate('props.dataPicker.previousEntry')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => entries.onStep(-1)}
      >
        <ChevronLeftIcon size={12} />
      </button>
      <span className="dp-entry-label" title={entries.label}>
        {entries.label}
      </span>
      <span className="dp-entry-count">
        {entries.index + 1}/{entries.count}
      </span>
      <button
        type="button"
        className="dp-step"
        title={translate('props.dataPicker.nextEntry')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => entries.onStep(1)}
      >
        <ChevronRightIcon size={12} />
      </button>
    </div>
  );
}

function PropKindIcon({ kind }: { readonly kind: string }) {
  const translate = useTranslate();
  switch (kind) {
    case 'string':
    case 'text':
    case 'enum':
      return (
        <span className="dp-kind-icon" title={translate('props.dataPicker.kind.text')}>
          <TextIcon size={11} />
        </span>
      );
    case 'number':
      return (
        <span className="dp-kind-icon" title={translate('props.dataPicker.kind.number')}>
          <FieldNumberIcon size={11} />
        </span>
      );
    case 'boolean':
      return (
        <span className="dp-kind-icon" title={translate('props.dataPicker.kind.switch')}>
          <FieldSwitchIcon size={11} />
        </span>
      );
    case 'rest props':
      return (
        <span className="dp-kind-icon" title={translate('props.dataPicker.kind.attributes')}>
          <BracesIcon size={11} />
        </span>
      );
    case 'image':
    case 'image url':
      return (
        <span className="dp-kind-icon" title={translate('props.dataPicker.kind.image')}>
          <ElementImageIcon size={11} />
        </span>
      );
    case 'list':
      return (
        <span className="dp-kind-icon" title={translate('props.dataPicker.kind.list')}>
          <RepeatIcon size={11} />
        </span>
      );
    default:
      return undefined;
  }
}
