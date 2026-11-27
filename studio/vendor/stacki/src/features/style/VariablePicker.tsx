
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';
import { SkeletonRows } from '../../ui/Skeleton';
import { SearchIcon } from '../../ui/Icons';
import { arrangeNames, shortLabel, type NameBlock } from '../../../shared/properties/variableGroups';
import { panelBlockKey } from './model/panelVariableList';
import Menu, { useMenuTrigger } from '../../ui/Menu';
import { centralIcon } from '../../ui/central/CentralIcon';
import { settings as centralSettings, eyeOff as centralEyeOff } from '../../ui/central/centralGeometry';
import { useGrouped } from './pickerOptions';
import { useTranslate } from '../../lib/i18n/useTranslate';
import Popup from '../../ui/Popup';
import { type ProjectVariable } from './model/webflow';
import { varKind } from './model/projectResources';
import { panelBox, panelSpan } from './model/panelBox';
import { CheckIcon, VariableTypeIcon, ChevronRightIcon } from './VariableIcons';
import { varTypeAllowed, byCollection } from './sharedVars';
import { bestRank, matchesVariableQuery, rankVariables } from './variableSearch';
import { functionSlotAt, ruleAccepts } from '../../../shared/properties/functionSlot';
import { useResolvedColor } from './model/computedColor';
import { getHost } from './model/host';
import { hasCanvas, queryCanvas } from '../../editor/canvasQuery';
import { assert } from '../../../shared/core/assert';
import { PICKER_RESTORE_EVENT } from './CustomValueEditor';
import { resolveVariableValue, valuePredicateFor } from '../../../shared/properties/propertyValueAccepts';
import { filterBySlot, isWholeSlot, VerdictCache, type Supports, type ValueSlot } from '../../../shared/properties/valueSlot';
import { LIMITS } from '../../../shared/core/limits';
import { useHiddenVariables } from '../../ipc/useHiddenVariables';
import { suggestionNames } from '../../../shared/properties/variableVisibility';
import { sameExpression, WINNING_NAMES_MAX, type WinningDeclarationText } from '../../../shared/properties/winningDeclaration';
import { cachedAnswer, rememberAnswer, type DefinedAnswer } from './model/definedAnswers';

export const FREE_MIN_WIDTH = 280;
export const FREE_MAX_WIDTH = 420;
export function pickerSpan(anchor: HTMLElement): { left: number; width: number } {
  if (panelBox(anchor)) {
    return panelSpan(anchor);
  }
  const margin = 8;
  const row = (anchor.parentElement ?? anchor).getBoundingClientRect();
  const width = Math.min(Math.max(row.width, FREE_MIN_WIDTH), FREE_MAX_WIDTH, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(row.left, window.innerWidth - width - margin));
  return { left, width };
}

const OptionsIcon = centralIcon(centralSettings, 16);
const HiddenIcon = centralIcon(centralEyeOff, 12);

const ZERO_EPOCH = (): number => 0;

export function VariablePicker({
  anchor,
  vars,
  loading,
  prop,
  selectedBinding,
  slot,
  typing,
  panel,
  onPreview,
  previewEpoch = ZERO_EPOCH,
  onPreviewEnd,
  previewWhileTyping,
  onPick,
  onClose,
  within,
  trigger,
}: {
  anchor: HTMLElement;
  within?: HTMLElement | undefined;
  trigger?: DOMRect | undefined;
  vars: ProjectVariable[];
  loading: boolean;
  prop?: string;
  selectedBinding?: string;
  slot?: ValueSlot;
  typing?: { readonly query: string; readonly navigationRef: MutableRefObject<PickerNavigation | undefined> };
  panel?: { readonly blocks: ReadonlyMap<string, readonly NameBlock[]> };
  onPreview?: (binding: string, epoch: number) => void;
  previewEpoch?: () => number;
  onPreviewEnd?: (timing: PreviewEndTiming) => void;
  previewWhileTyping?: 'canvas';
  onPick: (binding: string) => void;
  onClose: () => void;
}) {
  const translate = useTranslate();
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [ownSearch, setSearch] = useState('');
  const search = typing === undefined ? ownSearch : typing.query;
  const [collapsed, toggleCollapse] = useCollapsedSet();
  const listRef = useRef<HTMLDivElement>(null);
  const style = usePickerPosition(ref, anchor, trigger);
  usePickerFocus(searchRef);
  const query = search.trim().toLowerCase();
  const localLabel = translate('style.variablePicker.localScope');
  const withApplied = useMemo(
    () => (panel === undefined ? withAppliedVariable(vars, selectedBinding, localLabel) : vars),
    [vars, selectedBinding, localLabel, panel],
  );
  const answer = useDefinedVariables(withApplied);
  const listed = useMemo(
    () => (panel === undefined ? withScopedVariables(withApplied, answer, localLabel) : withApplied),
    [withApplied, answer, localLabel, panel],
  );
  const scopeDepth = useMemo(() => scopeDepths(answer), [answer]);
  const defined = answer?.names;
  const winning = answer?.winning;
  const [groupedChoice, setGrouped] = useGrouped();
  const grouped = panel === undefined ? groupedChoice : true;
  const [showAll, setShowAll] = useState(false);
  const optionsMenu = useMenuTrigger();
  const { hidden } = useHiddenVariables(getHost().projectPath);
  const appliedName = selectedBinding === undefined || panel !== undefined ? undefined : customPropertyOf(selectedBinding);
  const suggested = useMemo(
    () =>
      new Set(
        suggestionNames(
          listed.flatMap((variable) => customPropertyOf(variable.binding) ?? []),
          hidden,
          appliedName,
        ),
      ),
    [listed, hidden, appliedName],
  );
  const suggestible = (variable: ProjectVariable): boolean => showAll || suggested.has(customPropertyOf(variable.binding) ?? '');
  const visibleHere = (variable: ProjectVariable): boolean =>
    panel !== undefined || sameVariable(variable.binding, selectedBinding) || defined === undefined || defined.has(customPropertyOf(variable.binding) ?? '');
  const overriddenHere = new Map<string, string>();
  const detailOf = new Map<string, RowDetail>();
  const withLocalValue = (variable: ProjectVariable): ProjectVariable => {
    const property = customPropertyOf(variable.binding) ?? '';
    const computed = defined?.get(property);
    const written = traceableDeclaration(winning?.get(property), computed);
    if (written !== undefined) {
      detailOf.set(variable.binding, { declaration: written, computed });
      if (variable.file !== LOCAL_FILE && !sameExpression(written.expression, variable.value)) {
        overriddenHere.set(variable.binding, variable.value);
      }
      return { ...variable, value: written.expression };
    }
    return variable;
  };
  const context = { computed: defined, selectedBinding, slot, scopeDepth, order: panel === undefined ? ('name' as const) : ('given' as const) };
  const offered = pickerVariables(listed, prop, '', { ...context, showAll })
    .filter(visibleHere)
    .filter(suggestible)
    .map(withLocalValue);
  const refused = useMemo(() => {
    if (!showAll) {
      return new Set<string>();
    }
    const valid = new Set(
      pickerVariables(listed, prop, '', context)
        .filter(visibleHere)
        .filter((variable) => suggested.has(customPropertyOf(variable.binding) ?? ''))
        .map((variable) => variable.binding),
    );
    return new Set(offered.filter((variable) => !valid.has(variable.binding)).map((variable) => variable.binding));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs are the ones listed
  }, [showAll, listed, prop, defined, selectedBinding, slot, suggested]);
  const filtered = query === '' ? offered : rankVariables(offered, query);
  const panelBlocks = panel?.blocks;
  const drawn = useMemo(
    () => drawingOrder(filtered, listed, offered, { grouped, query, panelBlocks }),
    [filtered, listed, offered, grouped, query, panelBlocks],
  );
  const previews = previewsOf({ typing: typing !== undefined, previewWhileTyping }, onPreview);
  const { activeBinding, navigation } = usePickerNavigation(ref, drawn, { typing, search }, previews, previewEpoch, onPick);
  const markedBinding = typing === undefined ? (activeBinding ?? selectedBinding) : selectedBinding;
  const hover = useHoverPreview({ onPreview: previews, previewEpoch, onPreviewEnd });
  const pressGuard = usePressStartedInside(ref);
  const endHover = (): void => hover.end({ when: 'now' });
  useEffect(() => {
    const element = ref.current;
    element?.addEventListener(PICKER_RESTORE_EVENT, endHover);
    return () => element?.removeEventListener(PICKER_RESTORE_EVENT, endHover);
  });
  const holdSelected = useHoldSelectedInView(listRef, {
    rows: filtered.map((variable) => variable.binding).join('\n'),
    following: typing === undefined && activeBinding === undefined && search === '' && selectedBinding !== undefined,
  });

  if (typing !== undefined && !loading && offered.length === 0 && vars.length > 0) {
    return <></>;
  }

  return (
    <Popup
      mode="popover"
      onClose={onClose}
      anchor={anchor}
      within={within}
      ref={ref}
      className="embed-editor_varpicker"
      role="dialog"
      label={translate('style.variablePicker.connectToVariable')}
      style={style}
    >
      {typing === undefined ? (
        <div className="embed-editor_varpicker-searchrow">
          <div className="embed-editor_varpicker-searchbox">
            <SearchIcon size={16} className="embed-editor_varpicker-search-icon" />
            <input
              ref={searchRef}
              className="embed-editor_varpicker-search"
              value={search}
              placeholder={translate('style.variablePicker.searchPlaceholder')}
              spellCheck={false}
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => searchKeyDown(event, navigation)}
              aria-label={translate('style.variablePicker.search')}
            />
          </div>
          <button
            type="button"
            ref={optionsMenu.ref}
            className="embed-editor_varpicker-options"
            aria-label={translate('style.variablePicker.viewOptions')}
            title={translate('style.variablePicker.viewOptions')}
            aria-haspopup="menu"
            aria-expanded={optionsMenu.open}
            onMouseDown={(event) => event.preventDefault()}
            onClick={optionsMenu.toggle}
          >
            <OptionsIcon size={16} />
          </button>
          <Menu
            open={optionsMenu.open}
            anchor={optionsMenu.anchor}
            label={translate('style.variablePicker.viewOptions')}
            placement="below-end"
            onClose={optionsMenu.close}
            entries={[
              {
                kind: 'item',
                id: 'group',
                label: translate('style.variablePicker.groupVariables'),
                checked: grouped,
                keepOpen: true,
                onSelect: () => setGrouped({ grouped: !grouped }),
              },
              {
                kind: 'item',
                id: 'show-all',
                label: translate('style.variablePicker.showAll'),
                checked: showAll,
                keepOpen: true,
                onSelect: () => setShowAll(!showAll),
              },
            ]}
          />
        </div>
      ) : undefined}
      <div
        ref={listRef}
        className="embed-editor_varpicker-list"
        onWheel={holdSelected.release}
        onPointerDown={holdSelected.release}
        onTouchStart={holdSelected.release}
        onPointerLeave={() => hover.end({ when: 'now' })}
        onClickCapture={pressGuard}
      >
        {loading && !vars.length ? (
          <div className="embed-editor_varpicker-empty">
            <SkeletonRows count={3} />
          </div>
        ) : !filtered.length ? (
          <p className="embed-editor_varpicker-empty">{translate('style.variablePicker.noVariables')}</p>
        ) : (
          <PickerCollections
            variables={filtered}
            allVariables={listed}
            offered={offered}
            grouped={grouped}
            panelBlocks={panelBlocks}
            refused={refused}
            hiddenNames={hidden}
            overridden={overriddenHere}
            details={detailOf}
            query={query}
            collapsed={collapsed}
            selectedBinding={markedBinding}
            activeBinding={typing === undefined ? undefined : activeBinding}
            onToggleCollapse={toggleCollapse}
            onPick={onPick}
            onHover={hover.enter}
          />
        )}
      </div>
    </Popup>
  );
}

function usePressStartedInside(ref: React.RefObject<HTMLDivElement>): (event: React.MouseEvent) => void {
  const insideRef = useRef(false);
  useEffect(() => {
    const press = (event: Event): void => {
      const picker = ref.current;
      insideRef.current = picker !== null && event.target instanceof Node && picker.contains(event.target);
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('mousedown', press, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('mousedown', press, true);
    };
  }, [ref]);
  return (event) => {
    if (event.detail === 0) {
      return;
    }
    if (insideRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
}

export type PreviewEndTiming = { readonly when: 'now' | 'batched' };

function previewsOf(
  { typing, previewWhileTyping }: { readonly typing: boolean; readonly previewWhileTyping: 'canvas' | undefined },
  onPreview: ((binding: string, epoch: number) => void) | undefined,
): ((binding: string, epoch: number) => void) | undefined {
  if (typing) {
    return previewWhileTyping === 'canvas' ? onPreview : undefined;
  }
  return onPreview;
}

export function useHoverPreview({
  onPreview,
  previewEpoch,
  onPreviewEnd,
}: {
  readonly onPreview: ((binding: string, epoch: number) => void) | undefined;
  readonly previewEpoch: () => number;
  readonly onPreviewEnd: ((timing: PreviewEndTiming) => void) | undefined;
}): { readonly enter: (binding: string) => void; readonly end: (timing: PreviewEndTiming) => void } {
  const frame = useRef<number | undefined>(undefined);
  const latest = useRef({ onPreview, previewEpoch, onPreviewEnd });
  latest.current = { onPreview, previewEpoch, onPreviewEnd };
  const pending = useRef<{ readonly binding: string; readonly epoch: number } | undefined>(undefined);
  const cancel = (): void => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
    pending.current = undefined;
  };
  const end = (timing: PreviewEndTiming): void => {
    cancel();
    latest.current.onPreviewEnd?.(timing);
  };
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => {
    const onBlur = (): void => endRef.current({ when: 'now' });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      endRef.current({ when: 'batched' });
    };
  }, []);
  const enter = (binding: string): void => {
    if (latest.current.onPreview === undefined) {
      return;
    }
    pending.current = { binding, epoch: latest.current.previewEpoch() };
    if (frame.current !== undefined) {
      return;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const next = pending.current;
      pending.current = undefined;
      if (next !== undefined && next.epoch === latest.current.previewEpoch()) {
        latest.current.onPreview?.(next.binding, next.epoch);
      }
    });
  };
  return { enter, end };
}

export function useCollapsedSet(): [ReadonlySet<string>, (name: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  return [collapsed, toggle];
}

export function pickerVariables(
  vars: ProjectVariable[],
  prop: string | undefined,
  query: string,
  context: {
    readonly computed?: ReadonlyMap<string, string> | undefined;
    readonly selectedBinding?: string | undefined;
    readonly slot?: ValueSlot | undefined;
    readonly supports?: Supports | undefined;
    readonly showAll?: boolean | undefined;
    readonly scopeDepth?: ReadonlyMap<string, number> | undefined;
    readonly order?: 'name' | 'given' | undefined;
  } = {},
): ProjectVariable[] {
  const declared = declaredValues(vars);
  const lookup = (name: string): string | undefined => declared.get(name);
  const computedOf = (variable: ProjectVariable): string | undefined =>
    context.computed?.get(customPropertyOf(variable.binding) ?? '') ?? resolveVariableValue(variable.value, lookup);
  const supports = context.supports ?? engineSupports();
  const slotRule =
    context.showAll === true || context.slot === undefined
      ? undefined
      : functionSlotAt(context.slot.before, (name) => {
          const value = context.computed?.get(name) ?? lookup(name.slice(2));
          return value === undefined ? undefined : resolveVariableValue(value, lookup);
        });
  const fitsSlot = (variable: ProjectVariable): boolean =>
    slotRule === undefined || sameVariable(variable.binding, context.selectedBinding) || ruleAccepts(slotRule, computedOf(variable), variable.type);
  const pool = slotRule === undefined ? vars : vars.filter(fitsSlot);
  const judged =
    context.showAll === true || prop?.startsWith('--') === true
      ?
        pool
      : engineKnows(prop, supports)
        ?
          [
            ...filterBySlot(
              pool.map((variable) => ({ item: variable, computed: computedOf(variable), keep: sameVariable(variable.binding, context.selectedBinding) })),
              prop,
              context.slot,
              supports,
              VERDICTS,
            ),
          ]
        : pool.filter((variable) => legacyAllowed(variable, prop, context, computedOf));
  const slotted = slotRule !== undefined && judged.length === 0 ? pool : judged;
  const depthOf = (variable: ProjectVariable): number => (variable.group === '' ? -1 : (context.scopeDepth?.get(variable.group) ?? 0));
  const sorted =
    context.order === 'given'
      ? slotted
      : [...slotted].sort(
          (left, right) =>
            Number(right.file === LOCAL_FILE) - Number(left.file === LOCAL_FILE) ||
            (left.file === LOCAL_FILE && right.file === LOCAL_FILE ? depthOf(left) - depthOf(right) : 0) ||
            left.collection.localeCompare(right.collection) ||
            left.group.localeCompare(right.group) ||
            left.name.localeCompare(right.name),
        );
  if (!query) {
    return sorted;
  }
  return rankVariables(sorted, query);
}

function legacyAllowed(
  variable: ProjectVariable,
  prop: string | undefined,
  context: { readonly selectedBinding?: string | undefined; readonly slot?: ValueSlot | undefined },
  computedOf: (variable: ProjectVariable) => string | undefined,
): boolean {
  if (!varTypeAllowed(prop, variable.type)) {
    return false;
  }
  const accepts = valuePredicateFor(prop);
  if (accepts === undefined || !isWholeSlot(context.slot)) {
    return true;
  }
  if (sameVariable(variable.binding, context.selectedBinding)) {
    return true;
  }
  const computed = computedOf(variable);
  return computed !== undefined && accepts(computed);
}

const VERDICTS = new VerdictCache();

function engineSupports(): Supports | undefined {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return undefined;
  }
  return (property, value) => CSS.supports(property, value);
}

function engineKnows(prop: string | undefined, supports: Supports | undefined): supports is Supports {
  return supports !== undefined && prop !== undefined && !prop.startsWith('--') && supports(prop, 'inherit');
}

export function isRootScope(group: string): boolean {
  return /^(?::root|html|:where\(\s*:root\s*\))$/i.test(group.trim());
}

export function PickerCollections({
  variables,
  query,
  collapsed,
  selectedBinding,
  activeBinding,
  onToggleCollapse,
  onPick,
  onHover,
  allVariables,
  offered,
  grouped = true,
  panelBlocks,
  refused,
  hiddenNames,
  overridden,
  details,
}: {
  variables: ProjectVariable[];
  allVariables?: readonly ProjectVariable[] | undefined;
  offered?: readonly ProjectVariable[] | undefined;
  grouped?: boolean;
  panelBlocks?: ReadonlyMap<string, readonly NameBlock[]> | undefined;
  refused?: ReadonlySet<string> | undefined;
  hiddenNames?: ReadonlySet<string> | undefined;
  overridden?: ReadonlyMap<string, string> | undefined;
  details?: ReadonlyMap<string, RowDetail> | undefined;
  query: string;
  collapsed: ReadonlySet<string>;
  selectedBinding: string | undefined;
  activeBinding?: string | undefined;
  onToggleCollapse: (name: string) => void;
  onPick: (binding: string) => void;
  onHover?: ((binding: string) => void) | undefined;
}) {
  const translate = useTranslate();
  return byCollection(variables).map(({ collection, groups }) => {
    const open = !!query || !collapsed.has(collection);
    return (
      <div key={collection} className="embed-editor_varpicker-collection">
        <button type="button" className="embed-editor_varpicker-collection-head" aria-expanded={open} onClick={() => onToggleCollapse(collection)}>
          <span className="embed-editor_varpicker-collection-name">{collection}</span>
          <span className={`embed-editor_varpicker-collection-arrow ${open ? 'is-open' : ''}`}>
            <ChevronRightIcon />
          </span>
        </button>
        {open
          ? groups.map(({ group, items }) => {
              const blocks = blocksOf(collection, group, items, allVariables, offered, { grouped, query, panelBlocks });
              const scopeLabel = group && !isRootScope(group) ? group : undefined;
              const hasNamedGroups = blocks.some((block) => block.title !== undefined);
              const flatRun = blocks.some((block) => block.title === undefined);
              return (
                <div key={group || '_'} className="embed-editor_varpicker-group">
                  {}
                  {scopeLabel !== undefined && !flatRun ? (
                    <div className="embed-editor_varpicker-group-name" title={scopeLabel}>
                      {scopeLabel}
                    </div>
                  ) : undefined}
                  {blocks.map((block) => {
                    const rows = block.items.map((variable) => {
                      const detail = details?.get(variable.binding);
                      return (
                        <PickerItem
                          key={variable.binding}
                          variable={variable}
                          collection={collection}
                          group={group}
                          {...(block.title === undefined ? {} : { label: shortLabel(`--${variable.name}`, block.title) })}
                          invalid={refused?.has(variable.binding) === true}
                          hidden={hiddenNames?.has(customPropertyOf(variable.binding) ?? '') === true}
                          {...(overridden?.has(variable.binding) === true ? { declared: overridden.get(variable.binding) ?? '' } : {})}
                          {...(detail === undefined ? {} : { detail })}
                          selected={sameVariable(variable.binding, selectedBinding)}
                          active={variable.binding === activeBinding}
                          onPick={onPick}
                          onHover={onHover}
                        />
                      );
                    });
                    const flatHeading =
                      block.title === undefined ? (scopeLabel ?? (hasNamedGroups ? translate('style.variablePicker.otherGroup') : undefined)) : block.title;
                    if (flatHeading === undefined) {
                      return rows;
                    }
                    return (
                      <div key={`s:${block.title ?? ''}`} role="group" aria-label={flatHeading} className="embed-editor_varpicker-family">
                        <div className="embed-editor_varpicker-family-name" aria-hidden="true" title={flatHeading}>
                          {flatHeading}
                        </div>
                        {rows}
                      </div>
                    );
                  })}
                </div>
              );
            })
          : undefined}
      </div>
    );
  });
}

function blocksOf(
  collection: string,
  group: string,
  items: ProjectVariable[],
  allVariables: readonly ProjectVariable[] | undefined,
  offered: readonly ProjectVariable[] | undefined,
  options: BlockOptions,
): Array<{ readonly title: string | undefined; readonly items: ProjectVariable[] }> {
  const given = options.panelBlocks?.get(panelBlockKey(collection, group));
  const blocks = given === undefined ? panelBlocksOf(collection, group, items, allVariables, offered, options) : givenBlocks(given, items);
  return options.query !== undefined && options.query !== '' ? rankedBlocks(blocks, items, options.query) : blocks;
}

function rankedBlocks(
  blocks: Array<{ readonly title: string | undefined; readonly items: ProjectVariable[] }>,
  items: readonly ProjectVariable[],
  query: string,
): Array<{ readonly title: string | undefined; readonly items: ProjectVariable[] }> {
  const position = new Map(items.map((variable, index): [ProjectVariable, number] => [variable, index]));
  const at = (variable: ProjectVariable): number => position.get(variable) ?? items.length;
  const sorted = blocks.map((block) => ({ title: block.title, items: [...block.items].sort((left, right) => at(left) - at(right)) }));
  const tier = (block: { readonly items: readonly ProjectVariable[] }): number => bestRank(block.items, query) ?? Number.MAX_SAFE_INTEGER;
  return sorted.sort((left, right) => tier(left) - tier(right));
}

function panelBlocksOf(
  collection: string,
  group: string,
  items: ProjectVariable[],
  allVariables: readonly ProjectVariable[] | undefined,
  offered: readonly ProjectVariable[] | undefined,
  { grouped }: { readonly grouped: boolean },
): Array<{ readonly title: string | undefined; readonly items: ProjectVariable[] }> {
  const inScope = (variable: ProjectVariable): boolean => variable.collection === collection && variable.group === group;
  const everyName = (allVariables ?? items).filter(inScope).map((variable) => `--${variable.name}`);
  const byName = new Map<string, ProjectVariable>(items.map((variable): [string, ProjectVariable] => [`--${variable.name}`, variable]));
  const blocks = arrangeNames(everyName, new Set(byName.keys()));
  if (!blocks.some((block) => block.title !== undefined)) {
    return [{ title: undefined, items }];
  }
  const resolved = blocks.map((block) => ({ title: block.title, items: block.names.flatMap((name) => byName.get(name) ?? []) }));
  if (!grouped) {
    return [{ title: undefined, items: resolved.flatMap((block) => block.items) }];
  }
  const offeredNames = new Set((offered ?? items).filter(inScope).map((variable) => `--${variable.name}`));
  const offeredCount = new Map<string, number>();
  for (const block of arrangeNames(everyName, offeredNames)) {
    if (block.title !== undefined) {
      offeredCount.set(block.title, block.names.length);
    }
  }
  const flat: ProjectVariable[] = [];
  const groups: Array<{ readonly title: string | undefined; readonly items: ProjectVariable[] }> = [];
  for (const block of resolved) {
    if (block.title === undefined || (offeredCount.get(block.title) ?? 0) < GROUP_ROWS_MIN) {
      flat.push(...block.items);
    } else {
      groups.push(block);
    }
  }
  return [...(flat.length > 0 ? [{ title: undefined, items: flat }] : []), ...groups];
}

interface BlockOptions {
  readonly grouped: boolean;
  readonly query?: string;
  readonly panelBlocks?: ReadonlyMap<string, readonly NameBlock[]> | undefined;
}

function givenBlocks(given: readonly NameBlock[], items: ProjectVariable[]): Array<{ readonly title: string | undefined; readonly items: ProjectVariable[] }> {
  const byName = new Map(items.map((variable): [string, ProjectVariable] => [`--${variable.name}`, variable]));
  const placed = new Set<string>();
  const blocks = given.flatMap((block) => {
    const rows = block.names.flatMap((name) => byName.get(name) ?? []);
    rows.forEach((variable) => placed.add(variable.binding));
    return rows.length === 0 ? [] : [{ title: block.title, items: rows }];
  });
  const rest = items.filter((variable) => !placed.has(variable.binding));
  assert(placed.size + rest.length === items.length, 'givenBlocks: every listed row is drawn once');
  return rest.length === 0 ? blocks : [...blocks, { title: undefined, items: rest }];
}

const GROUP_ROWS_MIN = 2;

function drawingOrder(
  filtered: ProjectVariable[],
  allVariables: readonly ProjectVariable[],
  offered: readonly ProjectVariable[],
  options: BlockOptions,
): ProjectVariable[] {
  const ordered: ProjectVariable[] = [];
  for (const { collection, groups } of byCollection(filtered)) {
    for (const { group, items } of groups) {
      for (const block of blocksOf(collection, group, items, allVariables, offered, options)) {
        ordered.push(...block.items);
      }
    }
  }
  return ordered;
}

export function PickerItem({
  variable,
  collection,
  group,
  label,
  invalid = false,
  hidden = false,
  declared,
  detail,
  selected,
  active,
  onPick,
  onHover,
}: {
  variable: ProjectVariable;
  label?: string;
  invalid?: boolean;
  hidden?: boolean;
  declared?: string;
  detail?: RowDetail;
  collection: string;
  group: string;
  selected: boolean;
  active?: boolean;
  onPick: (binding: string) => void;
  onHover?: ((binding: string) => void) | undefined;
}) {
  const translate = useTranslate();
  const selectedClassName = `${selected ? 'is-selected' : ''}${active === true ? ' is-active' : ''}${invalid ? ' is-invalid' : ''}${hidden ? ' is-hidden' : ''}${declared === undefined ? '' : ' is-overridden'}`;
  const note = [
    invalid ? translate('style.variablePicker.notValidForProperty') : '',
    hidden ? translate('variables.hidden.indicator') : '',
    declared === undefined || detail === undefined
      ? ''
      : `${translate('style.variablePicker.overriddenHere')}: ${detail.declaration.selector}${detail.declaration.file === undefined ? '' : ` (${fileLabel(detail.declaration.file)})`}`,
  ]
    .filter(Boolean)
    .join('. ');
  const groupPrefix = group ? `${group} / ` : '';
  const valueSuffix = variable.value ? ` — ${variable.value}` : '';
  const lines = detail === undefined ? [] : detailLines(variable.name, detail, translate);
  return (
    <button
      type="button"
      className={`embed-editor_varpicker-item ${selectedClassName}`}
      aria-current={selected || undefined}
      data-binding={variable.binding}
      aria-label={`--${variable.name}${variable.value ? `: ${variable.value}` : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(variable.binding)}
      onPointerEnter={() => onHover?.(variable.binding)}
      title={[`${collection} / ${groupPrefix}${variable.name}${valueSuffix}${note === '' ? '' : ` (${note})`}`, ...lines].join('\n')}
    >
      {variable.type === 'Color' ? (
        <VariableSwatch binding={variable.binding} />
      ) : (
        <span className="embed-editor_varpicker-item-icon" aria-hidden="true">
          <VariableTypeIcon type={variable.type} />
        </span>
      )}
      <span className="embed-editor_varpicker-item-name">{label ?? variable.name}</span>
      <span className="embed-editor_varpicker-item-value">{variable.value}</span>
      <span className="embed-editor_varpicker-item-marks">
        {hidden ? (
          <span className="embed-editor_varpicker-item-hidden" aria-hidden="true">
            <HiddenIcon />
          </span>
        ) : undefined}
        {selected ? (
          <span className="embed-editor_varpicker-item-check" aria-hidden="true">
            <CheckIcon />
          </span>
        ) : undefined}
      </span>
    </button>
  );
}

export interface RowDetail {
  readonly declaration: WinningDeclarationText;
  readonly computed: string | undefined;
}

export function traceableDeclaration(declaration: WinningDeclarationText | undefined, computed: string | undefined): WinningDeclarationText | undefined {
  if (declaration === undefined || declaration.expression === '') {
    return undefined;
  }
  if (/var\(|env\(/i.test(declaration.expression) || computed === undefined) {
    return declaration;
  }
  return sameExpression(declaration.expression, computed) ? declaration : undefined;
}

function detailLines(name: string, detail: RowDetail, translate: ReturnType<typeof useTranslate>): string[] {
  const { declaration, computed } = detail;
  const where =
    declaration.file === undefined
      ? translate('style.variablePicker.declaredOn', { name: `--${name}`, value: declaration.expression, selector: declaration.selector })
      : translate('style.variablePicker.declaredIn', {
          name: `--${name}`,
          value: declaration.expression,
          file: fileLabel(declaration.file),
          selector: declaration.selector,
        });
  if (computed === undefined || sameExpression(computed, declaration.expression)) {
    return [where];
  }
  return [where, translate('style.variablePicker.computesTo', { value: computed })];
}

function fileLabel(file: string): string {
  return file.split('/').filter(Boolean).pop() ?? file;
}

export function withScopedVariables(vars: ProjectVariable[], answer: DefinedAnswer | undefined, localLabel: string): ProjectVariable[] {
  if (answer === undefined || answer.scoped.size === 0) {
    return vars;
  }
  const known = new Set(vars.flatMap((variable) => customPropertyOf(variable.binding) ?? []));
  const added: ProjectVariable[] = [];
  for (const [name, declaration] of answer.scoped) {
    if (known.has(name) || !answer.names.has(name) || added.length >= SCOPED_ROWS_MAX) {
      continue;
    }
    added.push({
      collection: localLabel,
      group: declaration.selector,
      name: name.slice(2),
      value: declaration.expression,
      binding: `var(${name})`,
      type: varKind(name, answer.names.get(name) ?? declaration.expression),
      file: LOCAL_FILE,
    });
  }
  return added.length === 0 ? vars : [...added, ...vars];
}

const SCOPED_ROWS_MAX = 512;

function scopeDepths(answer: DefinedAnswer | undefined): ReadonlyMap<string, number> {
  const depths = new Map<string, number>();
  for (const declaration of answer?.scoped.values() ?? []) {
    const known = depths.get(declaration.selector);
    if (known === undefined || declaration.depth < known) {
      depths.set(declaration.selector, declaration.depth);
    }
  }
  return depths;
}

export const LOCAL_FILE = '\u0000local';

export function withAppliedVariable(vars: ProjectVariable[], selectedBinding: string | undefined, localLabel: string): ProjectVariable[] {
  const property = selectedBinding === undefined ? undefined : customPropertyOf(selectedBinding);
  if (property === undefined) {
    return vars;
  }
  if (vars.some((variable) => customPropertyOf(variable.binding) === property)) {
    return vars;
  }
  const local: ProjectVariable = {
    collection: localLabel,
    group: '',
    name: property.slice(2),
    value: '',
    binding: `var(${property})`,
    type: 'String',
    file: LOCAL_FILE,
  };
  return [local, ...vars];
}

export function matchesQuery(variable: ProjectVariable, query: string): boolean {
  return matchesVariableQuery(variable, query);
}

function declaredValues(vars: readonly ProjectVariable[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const variable of vars) {
    const name = (customPropertyOf(variable.binding) ?? '').slice(2);
    if (name !== '' && !values.has(name)) {
      values.set(name, variable.value);
    }
  }
  return values;
}

export function customPropertyOf(binding: string): string | undefined {
  return /--[\w-]+/.exec(binding)?.[0];
}

function useDefinedVariables(vars: readonly ProjectVariable[]): DefinedAnswer | undefined {
  const names = [...new Set(vars.flatMap((variable) => customPropertyOf(variable.binding) ?? []))].sort();
  const key = names.join(' ');
  const host = getHost();
  const path = host.selectedId ? host.pathOf?.(host.selectedId) : undefined;
  const cacheKey = path === undefined ? undefined : `${path}\n${key}`;
  const [fresh, setFresh] = useState<{ readonly key: string; readonly answer: DefinedAnswer } | undefined>(undefined);
  useEffect(() => {
    const asked = key === '' ? [] : key.split(' ');
    if (path === undefined || cacheKey === undefined || !hasCanvas() || asked.length === 0 || asked.length > LIMITS.scanEntriesMax) {
      return undefined;
    }
    let live = true;
    assert(
      asked.every((name) => name.startsWith('--')),
      'Only custom properties are asked about',
    );
    void queryCanvas(path, [], [], asked, { winning: asked.slice(0, WINNING_NAMES_MAX), scoped: true }).then((reply) => {
      if (live && reply !== undefined) {
        const answer: DefinedAnswer = {
          names: new Map(
            Object.entries(reply.computedProps).flatMap(([name, text]): Array<[string, string]> => {
              const value = (text ?? '').trim();
              return name.startsWith('--') && value !== '' ? [[name, value]] : [];
            }),
          ),
          winning: new Map(Object.entries(reply.winning)),
          scoped: new Map(Object.entries(reply.scoped)),
        };
        rememberAnswer(cacheKey, answer);
        setFresh({ key: cacheKey, answer });
      }
    });
    return () => {
      live = false;
    };
  }, [key, path, cacheKey]);
  if (cacheKey === undefined) {
    return undefined;
  }
  return fresh?.key === cacheKey ? fresh.answer : cachedAnswer(cacheKey);
}

function VariableSwatch({ binding }: { binding: string }) {
  const reference = binding.trim().startsWith('--') ? `var(${binding.trim()})` : binding;
  const fill = useResolvedColor(reference);
  return (
    <span className="embed-editor_varpicker-item-swatch" aria-hidden="true">
      <span style={{ background: fill.trim() || 'transparent' }} />
    </span>
  );
}

export function useHoldSelectedInView(
  listRef: React.RefObject<HTMLDivElement>,
  { rows, following }: { readonly rows: string; readonly following: boolean },
): { readonly release: () => void } {
  const released = useRef(false);
  useLayoutEffect(() => {
    if (!following) {
      released.current = true;
      return undefined;
    }
    if (released.current) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const row = list?.querySelector<HTMLElement>('.embed-editor_varpicker-item.is-selected');
      if (row !== null && row !== undefined && !released.current) {
        centreInList(row);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [listRef, rows, following]);
  return {
    release: () => {
      released.current = true;
    },
  };
}

export function centreInList(element: HTMLElement): void {
  const list = element.closest<HTMLElement>('.embed-editor_varpicker-list');
  if (!list) {
    return;
  }
  assert(list.contains(element), 'centreInList: the row is inside the list it scrolls');
  const listRect = list.getBoundingClientRect();
  const itemRect = element.getBoundingClientRect();
  const scale = list.offsetHeight > 0 && listRect.height > 0 ? listRect.height / list.offsetHeight : 1;
  assert(scale > 0, 'centreInList: the list has a positive scale');
  const offset = (itemRect.top - listRect.top) / scale;
  list.scrollTop += Math.round(offset - (list.clientHeight - element.clientHeight) / 2);
}

export function revealInList(element: HTMLElement): void {
  const list = element.closest<HTMLElement>('.embed-editor_varpicker-list');
  if (!list) {
    return;
  }
  const listRect = list.getBoundingClientRect();
  const itemRect = element.getBoundingClientRect();
  const scale = list.offsetHeight > 0 && listRect.height > 0 ? listRect.height / list.offsetHeight : 1;
  assert(scale > 0, 'revealInList: the list has a positive scale');
  if (itemRect.top < listRect.top) {
    list.scrollTop -= Math.ceil((listRect.top - itemRect.top) / scale);
  } else if (itemRect.bottom > listRect.bottom) {
    list.scrollTop += Math.ceil((itemRect.bottom - listRect.bottom) / scale);
  }
}

export function sameVariable(binding: string, selected: string | undefined): boolean {
  if (selected === undefined || selected === '') {
    return false;
  }
  const property = customPropertyOf(binding);
  if (property === undefined) {
    return binding === selected;
  }
  return property === customPropertyOf(selected);
}

export interface PickerNavigation {
  readonly move: (step: 1 | -1) => void;
  readonly pick: () => boolean;
}

function usePickerNavigation(
  ref: React.RefObject<HTMLDivElement>,
  variables: readonly ProjectVariable[],
  {
    typing,
    search,
  }: {
    readonly typing: { readonly query: string; readonly navigationRef: MutableRefObject<PickerNavigation | undefined> } | undefined;
    readonly search: string;
  },
  onPreview: ((binding: string, epoch: number) => void) | undefined,
  previewEpoch: () => number,
  onPick: (binding: string) => void,
): { readonly activeBinding: string | undefined; readonly navigation: PickerNavigation } {
  const [marked, setMarked] = useState<string | undefined>(undefined);
  useEffect(() => setMarked(undefined), [search]);
  const fallback = typing === undefined ? undefined : variables[0]?.binding;
  const visible = marked !== undefined && variables.some((variable) => variable.binding === marked) ? marked : undefined;
  const activeBinding = visible ?? fallback;
  const rows = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>('.embed-editor_varpicker-item') ?? [])];
  const navigation: PickerNavigation = {
    move: (step) => {
      const list = rows();
      if (list.length === 0) {
        return;
      }
      const from = startingRow(list, activeBinding);
      const next = from < 0 ? (step === 1 ? 0 : list.length - 1) : (from + step + list.length) % list.length;
      assert(next >= 0, 'usePickerNavigation: the next row is on the list');
      assert(next < list.length, 'usePickerNavigation: the next row is on the list');
      const binding = list[next]?.dataset['binding'];
      setMarked(binding);
      if (binding !== undefined) {
        onPreview?.(binding, previewEpoch());
      }
    },
    pick: () => {
      const binding = activeBinding ?? variables[0]?.binding;
      if (binding === undefined) {
        return false;
      }
      onPick(binding);
      return true;
    },
  };
  const navigationRef = typing?.navigationRef;
  useEffect(() => {
    if (navigationRef === undefined) {
      return undefined;
    }
    navigationRef.current = navigation;
    return () => {
      navigationRef.current = undefined;
    };
  });
  useEffect(() => {
    if (activeBinding === undefined) {
      return;
    }
    const row = [...(ref.current?.querySelectorAll<HTMLElement>('.embed-editor_varpicker-item') ?? [])].find(
      (item) => item.dataset['binding'] === activeBinding,
    );
    if (row !== undefined) {
      revealInList(row);
    }
  }, [activeBinding, ref]);
  return { activeBinding, navigation };
}

function startingRow(rows: readonly HTMLElement[], activeBinding: string | undefined): number {
  if (activeBinding !== undefined) {
    const index = rows.findIndex((row) => row.dataset['binding'] === activeBinding);
    if (index >= 0) {
      return index;
    }
  }
  return rows.findIndex((row) => row.classList.contains('is-selected'));
}

function searchKeyDown(event: React.KeyboardEvent<HTMLInputElement>, navigation: PickerNavigation): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    navigation.move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    if (navigation.pick()) {
      event.preventDefault();
    }
  }
}

export function usePickerFocus(searchRef: React.RefObject<HTMLInputElement>): void {
  useEffect(() => {
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [searchRef]);
}

export const PICKER_HEIGHT_REM_MAX = 22;
const PICKER_GAP_REM = 0.25;
const PICKER_EDGE_REM = 1;

export type PickerPlacement =
  | { readonly side: 'below'; readonly top: number; readonly heightMax: number }
  | { readonly side: 'above'; readonly bottom: number; readonly heightMax: number };

export function pickerPlacement(input: {
  readonly rowTop: number;
  readonly rowBottom: number;
  readonly naturalHeight: number;
  readonly viewportHeight: number;
  readonly rootFontPx: number;
  readonly trigger?: { readonly top: number; readonly bottom: number } | undefined;
}): PickerPlacement {
  const { rowTop, rowBottom, naturalHeight, viewportHeight, rootFontPx, trigger } = input;
  assert(rootFontPx > 0, 'pickerPlacement: the root font size is positive');
  assert(viewportHeight > 0, 'pickerPlacement: the window has a height');
  const edge = PICKER_EDGE_REM * rootFontPx;
  const gap = PICKER_GAP_REM * rootFontPx;
  const capPx = PICKER_HEIGHT_REM_MAX * rootFontPx;
  let roomBelow = Math.max(0, viewportHeight - (rowBottom + gap) - edge);
  let roomAbove = Math.max(0, rowTop - gap - edge);
  if (trigger !== undefined) {
    if (trigger.top >= rowBottom) {
      roomBelow = Math.min(roomBelow, Math.max(0, trigger.top - gap - (rowBottom + gap)));
    } else if (trigger.bottom <= rowTop) {
      roomAbove = Math.min(roomAbove, Math.max(0, rowTop - gap - (trigger.bottom + gap)));
    }
  }
  const wanted = Math.min(naturalHeight, capPx);
  if (wanted <= roomBelow || roomBelow >= roomAbove) {
    const heightMax = Math.min(capPx, roomBelow);
    const placement = { side: 'below', top: rowBottom + gap, heightMax } as const;
    assert(placement.top > rowBottom, 'pickerPlacement: below the row, never over it');
    assert(heightMax <= capPx, 'pickerPlacement: never past the cap');
    return placement;
  }
  const heightMax = Math.min(capPx, roomAbove);
  const placement = { side: 'above', bottom: viewportHeight - (rowTop - gap), heightMax } as const;
  assert(viewportHeight - placement.bottom < rowTop, 'pickerPlacement: above the row, never over it');
  assert(heightMax <= roomAbove, 'pickerPlacement: inside the room above');
  return placement;
}

export function usePickerPosition(ref: React.RefObject<HTMLDivElement>, anchor: HTMLElement, trigger: DOMRect | undefined): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(() => ({
    position: 'fixed',
    top: 0,
    ...pickerSpan(anchor),
    maxHeight: `${PICKER_HEIGHT_REM_MAX}rem`,
    visibility: 'hidden',
  }));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const row = (anchor.parentElement ?? anchor).getBoundingClientRect();
    const { height } = element.getBoundingClientRect();
    const { left, width } = pickerSpan(anchor);
    const rootFontPx = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const placement = pickerPlacement({
      rowTop: row.top,
      rowBottom: row.bottom,
      naturalHeight: height,
      viewportHeight: window.innerHeight,
      rootFontPx,
      trigger,
    });
    setStyle({
      position: 'fixed',
      ...(placement.side === 'below' ? { top: placement.top } : { bottom: placement.bottom }),
      left,
      width,
      maxHeight: placement.heightMax,
      visibility: 'visible',
    });
  }, [ref, anchor, trigger]);
  return style;
}

