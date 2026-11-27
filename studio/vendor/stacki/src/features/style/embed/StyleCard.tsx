
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Select from '../components/Select';
import type { SelectOption, SelectTag } from '../components/selectTypes';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { homeRoundDoor as centralHomeRoundDoor, link as centralLink } from '../../../ui/central/centralGeometry';
import { FilterIcon, GearIcon, UnlinkIcon } from '../../../ui/Icons';
import { useHoverTip } from '../components/CssPropertyTip';
import { useProjectBreakpoints } from '../../../ipc/useProjectBreakpoints';
import { breakpointLabel } from '../../../lib/breakpointLabel';
import { iconFor } from '../../../../shared/properties/breakpointIcon';
import { WidthIcon, deviceIcon } from './breakpointIcons';
import { canvasTriggerIcon, describeCondition } from './contextRows';
import { useCanvasDevice, useCanvasWidthPx } from './contextFollow';
import { groupContexts } from './contextGroups';
import { getHost } from '../model/host';
import { SelectorScopeContext } from '../model/selectorScope';
import type { StyleContext } from '../model/resolved';
import ElementTokenPicker from '../ElementTokenPicker';
import SizeSection from '../SizeSection';
import SpacingSection, { SpacingCenterButton } from '../SpacingSection';
import BordersSection from '../BordersSection';
import BackgroundSection from '../BackgroundSection';
import PositionSection from '../PositionSection';
import TypographySection from '../TypographySection';
import FlexChildSection from '../FlexChildSection';
import EffectsSection from '../EffectsSection';
import { groupProps } from '../model/sections';
import { type ResolvedProp, type ResolvedStyle } from '../model/resolved';
import { assert } from '../../../../shared/core/assert';
import { queryKey } from '../model/css';
import { PencilIcon, EmbedIcon, CreateStyleTagIcon, ComponentIcon, breakpointIcon } from './EditorBasics';
import { AddPropertyRow, useSectionVisibility } from './AddProperty';
import {
  SectionBlock,
  ProvenancePopover,
  ResolvedRow,
  DisplayRow,
  LAYOUT_CONTROL_PROPS,
  EFFECTS_CONTROL_PROPS,
  TYPOGRAPHY_CONTROL_PROPS,
} from './ResolvedRows';
import { ALIGN_PROPS, GRID_CONTROL_PROPS, LayoutModeSections, type SourceOption } from './LayoutRows';
import { SelectorPicker, ADD_QUERY, PlusIcon } from './SelectorPicker';
import { useOptimisticEdits } from './useOptimisticEdits';
import { PreviewPropContext } from '../connectFieldHelpers';
import { AddQueryForm, EditQueryForm, CssCodeSection, type StyleCardProps } from './QueryForms';

export function StyleCard(card: StyleCardProps) {
  const { resolved, busy, activeSelector, onSelectSelector } = card;
  const provenance = useProvenance();
  const [visibleSelectors, rememberVisibleSelectors] = useVisibleSelectors();
  const shown = provenance.shown;
  const provenanceResolved = shown ? resolved.props.get(shown.prop) : undefined;

  return (
    <div className="embed-editor_rule u-surface-surface">
      <StyleCardHead card={card} onVisibleSelectorsChange={rememberVisibleSelectors} />
      {}

      <CssCodeSection
        model={card.model}
        activeSelector={activeSelector}
        visibleSelectors={visibleSelectors}
        editableRule={resolved.selectedRule ?? undefined}
        busy={busy}
        open={card.cssCodeOpen}
        onToggle={card.onToggleCssCode}
        onSave={card.onSaveCssRule}
        inlineCode={card.inlineCode}
      />

      {}
      <fieldset className="embed-editor_controls" disabled={card.inlineCode?.kind === 'readonly'}>
        {}
        <PreviewPropContext.Provider value={card.previewProp}>
          <StyleSections card={card} openProvenance={provenance.openProvenance} />
          <div className="embed-editor_rule-foot">
            <AddPropertyRow busy={busy} onAdd={card.onAdd} />
          </div>
        </PreviewPropContext.Provider>
      </fieldset>

      {shown && provenanceResolved !== undefined ? (
        <ProvenancePopover
          prop={shown.prop}
          anchor={shown.rect}
          resolved={provenanceResolved}
          onClose={provenance.closeProvenance}
          onAnchorReclick={provenance.suppressProvenanceReopen}
          onSelectSelector={onSelectSelector}
        />
      ) : undefined}
    </div>
  );
}

export function useProvenance() {
  const [shown, setShown] = useState<{ prop: string; rect: DOMRect } | undefined>(undefined);
  const suppressProvenance = useRef<string | undefined>(undefined);
  const openProvenance = useCallback((prop: string, rect: DOMRect) => {
    if (suppressProvenance.current === prop) {
      suppressProvenance.current = undefined;
      return;
    }
    suppressProvenance.current = undefined;
    setShown({ prop, rect });
  }, []);
  const closeProvenance = useCallback(() => setShown(undefined), []);
  const suppressProvenanceReopen = useCallback((prop: string) => {
    suppressProvenance.current = prop;
  }, []);
  return { shown, openProvenance, closeProvenance, suppressProvenanceReopen };
}

export function useVisibleSelectors() {
  const [visibleSelectors, setVisibleSelectors] = useState<readonly string[]>([]);
  const rememberVisibleSelectors = useCallback((next: readonly string[]) => {
    setVisibleSelectors((previous) => {
      const same = next.length === previous.length && next.every((selector, index) => selector === previous[index]);
      return same ? previous : [...next];
    });
  }, []);
  return [visibleSelectors, rememberVisibleSelectors] as const;
}

export function StyleCardHead({ card, onVisibleSelectorsChange }: { card: StyleCardProps; onVisibleSelectorsChange: (selectors: readonly string[]) => void }) {
  const translate = useTranslate();
  const { snapshot, activeSelector, busy } = card;
  const [addingQuery, setAddingQuery] = useState(false);
  const [editingQuery, setEditingQuery] = useState<string | undefined>(undefined);
  return (
    <div className="embed-editor_head">
      <div className="embed-editor_switchers">
        {}
        {card.contexts.length > 0 ? (
          <ContextSwitcher
            card={card}
            onAddQuery={() => {
              setEditingQuery(undefined);
              setAddingQuery(true);
            }}
            onEditQuery={(query) => {
              setAddingQuery(false);
              setEditingQuery(query);
            }}
          />
        ) : undefined}
      </div>
      <QueryForms card={card} addingQuery={addingQuery} editingQuery={editingQuery} setAddingQuery={setAddingQuery} setEditingQuery={setEditingQuery} />
      <div className="embed-editor_selector">
        <div className="embed-editor_selector-box">
          {snapshot ? (
            <ElementTokenPicker snapshot={snapshot} />
          ) : (
            <div className="embed-editor_element-id is-empty">{translate('styleModel.embed.card.noElement')}</div>
          )}
          {}
          <span id="embed-editor_save-slot" className="embed-editor_selector-save" />
        </div>
      </div>

      {}
      <SelectorPicker
        selectors={card.selectors}
        suggestions={card.suggestions}
        activeSelector={activeSelector}
        activePicked={card.activePicked}
        busy={busy}
        loading={card.resolving}
        settled={card.selectionSettled}
        onSelect={card.onSelectActive}
        onDeselect={card.onDeselect}
        onAdd={card.onAddSelector}
        onVisibleSelectorsChange={onVisibleSelectorsChange}
        inline={card.inline}
      />
      <SourcePickerRow card={card} />
    </div>
  );
}

export function ContextSwitcher({ card, onAddQuery, onEditQuery }: { card: StyleCardProps; onAddQuery: () => void; onEditQuery: (query: string) => void }) {
  const translate = useTranslate();
  const { contexts, contextInfos, queryUses } = card;
  const sourceByKey = new Map(card.sourceOptions.filter((option) => option.heading !== true).map((option) => [option.value, option]));
  const tagFor = (sourceKey: string | undefined): SelectTag | undefined => {
    const source = sourceKey === undefined ? undefined : sourceByKey.get(sourceKey);
    if (source === undefined) {
      return undefined;
    }
    return {
      label: source.triggerLabel ?? source.label,
      icon: source.fromComponent ? <ComponentIcon /> : <EmbedIcon />,
      tone: source.fromComponent ? 'component' : 'embed',
    };
  };
  const { resolved } = useProjectBreakpoints(getHost().projectPath);
  const canvas = { device: useCanvasDevice(), widthPx: useCanvasWidthPx() };
  const optionFor = (styleContext: StyleContext, placement: 'base' | 'section' | 'other'): SelectOption<string> => {
    const query = (styleContext.embedAtContext || '').split(' › ').pop() || '';
    const inSourceDocument = styleContext.source === undefined || styleContext.source === card.sourceValue;
    const uses = inSourceDocument ? (queryUses.get(queryKey(query)) ?? 0) : 0;
    const info = contextInfos.find((entry) => entry.key === styleContext.key);
    const tag = tagFor(styleContext.source);
    const condition = placement === 'base' || query === '' ? undefined : describeCondition(styleContext.embedAtContext ?? '', resolved);
    const width = condition?.kind === 'width' ? condition : undefined;
    const label = width === undefined ? styleContext.label : width.breakpoint === undefined ? width.condition : breakpointLabel(width.breakpoint, translate);
    const icon =
      placement === 'base' ? (
        <BaseContextIcon />
      ) : width === undefined ? (
        (breakpointIcon(styleContext.breakpoint ?? undefined) ?? <FilterIcon />)
      ) : width.breakpoint === undefined ? (
        <WidthIcon />
      ) : (
        deviceIcon(iconFor(width.breakpoint, resolved))
      );
    const canvasKind = placement === 'base' ? undefined : canvasTriggerIcon(styleContext.embedAtContext ?? '', canvas, resolved);
    const prefix = placement === 'base' ? undefined : (info?.wrapper ?? (placement === 'other' ? tag?.label : undefined));
    return {
      value: styleContext.key,
      label,
      ...(width?.breakpoint === undefined ? {} : { detail: width.condition, triggerLabel: width.condition }),
      ...(placement === 'base' ? {} : { title: query }),
      ...(prefix === undefined ? {} : { triggerPrefix: prefix }),
      ...(placement === 'other' && info?.querySelectors !== undefined ? { subline: info.querySelectors } : {}),
      ...(icon === undefined ? {} : { icon }),
      ...(canvasKind === undefined ? {} : { triggerIcon: deviceIcon(canvasKind) }),
      ...(card.contextFollow === undefined ? {} : { triggerMark: <FollowPin follow={card.contextFollow} /> }),
      marked: info?.hasStyles ?? false,
      ...(uses > 0
        ? {
            action: {
              icon: <PencilIcon />,
              label: translate('styleModel.embed.card.editQuery', { query }),
              onSelect: () => onEditQuery(query),
            },
          }
        : {}),
    };
  };
  const wrapperOf = (styleContext: StyleContext): string | undefined => contextInfos.find((entry) => entry.key === styleContext.key)?.wrapper;
  const options: SelectOption<string>[] = [];
  let otherRows: SelectOption<string>[] = [];
  for (const group of groupContexts(
    contexts.map((context) => ({ context, wrapper: wrapperOf(context) })),
    resolved,
  )) {
    switch (group.kind) {
      case 'base':
        options.push(optionFor(group.item.context, 'base'));
        break;
      case 'loose':
        options.push(optionFor(group.item.context, 'section'));
        break;
      case 'group': {
        const tag = tagFor(group.key.source);
        const label = group.key.wrapper ?? tag?.label ?? group.key.source ?? '';
        options.push({
          value: `${GROUP_HEADING_PREFIX}${group.key.source ?? ''}\u0000${group.key.wrapper ?? ''}`,
          label,
          heading: true,
          ...(group.key.wrapper === undefined || tag === undefined ? {} : { tag }),
        });
        for (const item of group.items) {
          options.push(optionFor(item.context, 'section'));
        }
        break;
      }
      case 'other':
        otherRows = group.items.map((item) => optionFor(item.context, 'other'));
        break;
      default: {
        const exhaustive: never = group;
        return exhaustive;
      }
    }
  }
  if (otherRows.length > 0) {
    options.push({ value: OTHER_HEADING, label: translate('styleModel.embed.card.other'), heading: true }, ...otherRows);
  }
  return (
    <Select
      className={card.context === '' ? 'embed-editor_context-select' : 'embed-editor_context-select is-query'}
      value={card.context}
      options={[...options, { value: ADD_QUERY, label: translate('styleModel.embed.card.addQuery'), icon: <PlusIcon />, footer: true }]}
      onChange={(next) => {
        if (next === ADD_QUERY) {
          onAddQuery();
        } else {
          card.onContext(next);
        }
      }}
      ariaLabel={translate('styleModel.embed.card.context')}
    />
  );
}

const OTHER_HEADING = '\u0000other';

function FollowPin({ follow }: { follow: NonNullable<StyleCardProps['contextFollow']> }) {
  const translate = useTranslate();
  const tipText = translate(follow.following ? 'styleModel.embed.card.followCanvasHold' : 'styleModel.embed.card.followCanvasFollow');
  const { ref, hoverProps, hide, tip } = useHoverTip<HTMLSpanElement>(tipText);
  return (
    <>
      <span
        ref={ref}
        {...hoverProps}
        role="button"
        tabIndex={-1}
        className={follow.following ? 'u-select-pin is-on' : 'u-select-pin'}
        aria-label={translate('styleModel.embed.card.followCanvas')}
        aria-pressed={follow.following}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          hide();
          if (follow.following) {
            follow.onHold();
          } else {
            follow.onFollow();
          }
        }}
      >
        {follow.following ? <FollowLinkIcon /> : <UnlinkIcon />}
      </span>
      {tip}
    </>
  );
}

const FollowLinkIcon = centralIcon(centralLink);

const GROUP_HEADING_PREFIX = '\u0000group:';

const BaseContextIcon = centralIcon(centralHomeRoundDoor);

export function QueryForms({
  card,
  addingQuery,
  editingQuery,
  setAddingQuery,
  setEditingQuery,
}: {
  card: StyleCardProps;
  addingQuery: boolean;
  editingQuery: string | undefined;
  setAddingQuery: (adding: boolean) => void;
  setEditingQuery: (query: string | undefined) => void;
}) {
  return (
    <>
      {addingQuery ? (
        <AddQueryForm
          canNest={card.activeSelector.length > 0}
          contexts={card.contexts}
          onCancel={() => setAddingQuery(false)}
          onExisting={(key) => {
            setAddingQuery(false);
            card.onContext(key);
          }}
          onAdd={(query, mode) => {
            setAddingQuery(false);
            card.onAddQuery(query, mode);
          }}
        />
      ) : undefined}
      {editingQuery ? (
        <EditQueryForm
          query={editingQuery}
          uses={card.queryUses.get(queryKey(editingQuery)) ?? 0}
          sourceLabel={card.sourceLabel}
          suggestions={card.querySuggestions}
          onCancel={() => setEditingQuery(undefined)}
          onRename={(from, to) => {
            setEditingQuery(undefined);
            card.onRenameQuery(from, to);
          }}
        />
      ) : undefined}
    </>
  );
}

export function SourcePickerRow({ card }: { card: StyleCardProps }) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_selector-head">
      <div className="embed-editor_source-picker">
        <span className="embed-editor_source-prefix">{translate('styleModel.embed.card.addIn')}</span>
        {}
        <Select
          variant="link"
          searchable
          searchPlaceholder={translate('styleModel.embed.card.searchEmbeds')}
          className="embed-editor_source-link"
          value={card.sourceValue}
          options={sourceOptionsWithDefaults(card.sourceOptions, translate('styleModel.embed.card.styleTagDefaults'))}
          onChange={(next) => {
            const openSettings = getHost().openStyleTagSettings;
            if (next === STYLE_TAG_DEFAULTS && openSettings !== undefined) {
              openSettings();
            } else {
              card.onSourceChange(next);
            }
          }}
          ariaLabel={translate('styleModel.embed.card.source')}
        />
        {card.loading ? (
          <span className="embed-editor_source-loading" title={translate('styleModel.embed.card.fetching')} aria-live="polite">
            <svg className="embed-editor_source-spinner" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
            </svg>
          </span>
        ) : undefined}
      </div>
      {card.pending ? (
        <span className="embed-editor_unsaved" title={translate('styleModel.embed.card.unsavedTip')}>
          {translate('styleModel.embed.card.unsaved')}
        </span>
      ) : undefined}
    </div>
  );
}

const STYLE_TAG_DEFAULTS = '\u0000style-tag-defaults';

function sourceOptionsWithDefaults(options: readonly SourceOption[], label: string): SelectOption<string>[] {
  const rows: SelectOption<string>[] = options.map(sourceSelectOption);
  if (getHost().openStyleTagSettings === undefined) {
    return rows;
  }
  return [...rows, { value: STYLE_TAG_DEFAULTS, label, icon: <GearIcon />, footer: true }];
}

export function sourceSelectOption(option: SourceOption) {
  return {
    value: option.value,
    label: option.label,
    marked: option.heading ? false : (option.marked ?? false),
    ...(option.heading === undefined ? {} : { heading: option.heading }),
    ...(option.indent === undefined ? {} : { indent: option.indent }),
    ...(option.triggerLabel === undefined ? {} : { triggerLabel: option.triggerLabel }),
    icon: option.heading ? <ComponentIcon /> : option.create ? <CreateStyleTagIcon /> : <EmbedIcon />,
    triggerIcon: option.fromComponent ? <ComponentIcon /> : option.create ? <CreateStyleTagIcon /> : <EmbedIcon />,
    tone: option.fromComponent ? ('component' as const) : ('embed' as const),
  };
}

export type SectionCard = Pick<StyleCardProps, 'busy' | 'resolving' | 'liveSetProp' | 'onSelectSelector' | 'activeSelector'> & {
  read: (prop: string) => ResolvedProp | undefined;
  setProp: (prop: string, value: string, important: boolean) => void;
  clearProp: (prop: string | string[]) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
};

export function StyleSections({ card, openProvenance }: { card: StyleCardProps; openProvenance: (prop: string, anchor: DOMRect) => void }) {
  const translate = useTranslate();
  const { resolved } = card;
  const groups = groupProps([...resolved.props.keys()], SECTION_ORDER);
  const sectionIds = groups.map((group) => group.def.id);
  const [closedSectionIds, toggleSection] = useSectionVisibility();
  const { read, setProp, clearProp } = useOptimisticEdits(resolved.props, { setProp: card.setProp, clearProp: card.clearProp, selector: card.activeSelector });
  const elementKey = `${getHost().openFilePath ?? ''}\u0000${getHost().selectedId ?? ''}`;
  const section: SectionCard = {
    read,
    busy: card.busy,
    resolving: card.resolving,
    setProp,
    clearProp,
    liveSetProp: card.liveSetProp,
    onProvenance: openProvenance,
    onSelectSelector: card.onSelectSelector,
    activeSelector: card.activeSelector,
  };
  return (
    <SelectorScopeContext.Provider value={`${elementKey}\u0000${card.activeSelector}`}>
      <div className="embed-editor_decls">
        {groups.map((group) => (
          <SectionBlock
            key={group.def.id}
            label={translate(group.def.labelKey)}
            open={!closedSectionIds.has(group.def.id)}
            onToggle={(event) => {
              const open = !closedSectionIds.has(group.def.id);
              toggleSection({
                id: group.def.id,
                ids: sectionIds,
                next: open ? 'closed' : 'open',
                scope: event.shiftKey ? 'all' : 'one',
              });
            }}
            mark={group.props.some((prop) => read(prop)?.source === 'selected') ? 'own' : group.props.length ? 'other' : undefined}
            headerAction={group.def.id === 'spacing' ? <SpacingCenterButton read={read} busy={card.busy} setProp={setProp} clearProp={clearProp} /> : undefined}
          >
            <HeldBody hold={card.selectionAwaiting}>
              {SECTION_CONTROLS[group.def.id]?.(section)}
              <FallThroughRows props={fallThroughProps(group.def.id, group.props)} resolved={resolved} section={section} />
            </HeldBody>
          </SectionBlock>
        ))}
      </div>
    </SelectorScopeContext.Provider>
  );
}

function HeldBody({ hold, children }: { readonly hold: boolean; readonly children: ReactNode }) {
  const last = useRef<ReactNode>(undefined);
  if (!hold || last.current === undefined) {
    last.current = children;
  }
  return (
    <div className={`embed-editor_body${hold ? ' is-held' : ''}`} aria-busy={hold}>
      {last.current}
    </div>
  );
}

export const SECTION_ORDER = ['flex-child', 'layout', 'position', 'spacing', 'size', 'typography', 'backgrounds', 'borders', 'effects', 'other'] as const;

export const SECTION_CONTROLS: Readonly<Record<string, (section: SectionCard) => ReactNode>> = {
  'flex-child': (section) => (
    <FlexChildSection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={(prop, value, important) => section.liveSetProp(prop, value ?? undefined, important)}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
  size: (section) => (
    <SizeSection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={section.liveSetProp}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
  position: (section) => (
    <PositionSection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={section.liveSetProp}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
  borders: (section) => (
    <BordersSection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={section.liveSetProp}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
  spacing: (section) => (
    <SpacingSection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={section.liveSetProp}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
  backgrounds: (section) => (
    <BackgroundSection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={section.liveSetProp}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
  typography: (section) => (
    <TypographySection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={(prop, value, important) => section.liveSetProp(prop, value ?? undefined, important)}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
  layout: (section) => (
    <>
      <DisplayRow
        resolved={section.read('display')}
        busy={section.busy}
        setProp={section.setProp}
        clearProp={section.clearProp}
        onProvenance={section.onProvenance}
        onSelectSelector={section.onSelectSelector}
      />
      <LayoutModeSections
        read={section.read}
        busy={section.busy}
        resolving={section.resolving}
        setProp={section.setProp}
        clearProp={section.clearProp}
        liveSetProp={section.liveSetProp}
        onProvenance={section.onProvenance}
        onSelectSelector={section.onSelectSelector}
        activeSelector={section.activeSelector}
      />
    </>
  ),
  effects: (section) => (
    <EffectsSection
      read={section.read}
      busy={section.busy}
      setProp={section.setProp}
      clearProp={section.clearProp}
      liveSetProp={section.liveSetProp}
      onProvenance={section.onProvenance}
      onSelectSelector={section.onSelectSelector}
    />
  ),
};

export function isControlSection(id: string): boolean {
  return SECTION_CONTROLS[id] !== undefined;
}

export function fallThroughProps(id: string, props: readonly string[]): readonly string[] {
  switch (id) {
    case 'typography':
      return props.filter((prop) => !TYPOGRAPHY_CONTROL_PROPS.has(prop));
    case 'layout':
      return props.filter((prop) => !LAYOUT_CONTROL_PROPS.has(prop) && !ALIGN_PROPS.has(prop) && !GRID_CONTROL_PROPS.has(prop));
    case 'effects':
      return props.filter((prop) => !EFFECTS_CONTROL_PROPS.has(prop));
    default:
      return isControlSection(id) ? [] : props;
  }
}

export function FallThroughRows({ props, resolved, section }: { props: readonly string[]; resolved: ResolvedStyle; section: SectionCard }) {
  return props.map((prop) => {
    const found = resolved.props.get(prop);
    assert(found !== undefined, `Grouped property ${prop} is resolved`);
    return (
      <ResolvedRow
        key={prop}
        prop={prop}
        resolved={found}
        busy={section.busy}
        setProp={section.setProp}
        clearProp={section.clearProp}
        liveSetProp={section.liveSetProp}
        onProvenance={section.onProvenance}
        onSelectSelector={section.onSelectSelector}
      />
    );
  });
}
