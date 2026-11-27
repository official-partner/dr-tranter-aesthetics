import { useTranslate } from '../../../lib/i18n/useTranslate';
import { ENGLISH_TRANSLATE } from '../../../../shared/properties/i18n/englishTranslator';
import type { MessageKey, Translator } from '../../../../shared/properties/i18n/messageRef';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { chevronRight as centralChevronRight } from '../../../ui/central/centralGeometry';

import type { InlineChip } from './useInlineTarget';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClassPlacement } from '../../../editor/classAttr';
import FieldLabel from '../components/FieldLabel';
import { PropTip } from '../components/CssPropertyTip';
import DirectionControl from '../DirectionControl';
import AlignControl from '../AlignControl';
import GapControl from '../GapControl';
import GridControls from '../GridControls';
import { GroupLabel } from '../TypographySection';
import { type MatchedSelector, type ResolvedProp } from '../model/resolved';
import { isGlobalSelector, selectorDependsOnAncestor, selectorKind, type SelectorKind } from '../model/selectors';
import { getHost, onHostChange } from '../model/host';
import { type LiveSetProp } from './EditorBasics';
import { keepImportant } from '../model/styleDisplay';
import { VALIGN_DISPLAYS, VerticalAlignRow, effectiveValue, rawEffective, currentFlexFlow } from './ResolvedRows';

export function DirectionRow({
  read,
  busy,
  setProp,
  clearProp,
  onProvenance,
  onSelectSelector,
}: {
  read: (prop: string) => ResolvedProp | undefined;
  busy: boolean;
  setProp: (prop: string, value: string, important: boolean) => void;
  clearProp: (prop: string | string[]) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  return (
    <div className="embed-editor_size-row">
      <GroupLabel
        label={translate('styleModel.embed.layout.direction')}
        props={['flex-flow', 'flex-direction', 'flex-wrap']}
        read={read}
        busy={busy}
        onClear={() => clearProp(['flex-flow', 'flex-direction', 'flex-wrap'])}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
      <DirectionControl
        value={currentFlexFlow(read)}
        rawDirection={rawEffective(read('flex-direction')).value}
        important={rawEffective(read('flex-direction')).important}
        busy={busy}
        onCommit={(direction, wrap) => {
          setProp('flex-direction', direction, false);
          setProp('flex-wrap', wrap, false);
        }}
        onCommitCustom={(value, important) => setProp('flex-direction', value, important)}
      />
    </div>
  );
}

export const ALIGN_PROPS = new Set(['justify-content', 'align-items']);
export const GRID_CONTROL_PROPS = new Set([
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'justify-items',
  'align-items',
  'justify-content',
  'align-content',
]);

export function AlignRow({
  read,
  busy,
  setProp,
  clearProp,
  liveSetProp,
  onProvenance,
  onSelectSelector,
}: {
  read: (prop: string) => ResolvedProp | undefined;
  busy: boolean;
  setProp: (prop: string, value: string, important: boolean) => void;
  clearProp: (prop: string | string[]) => void;
  liveSetProp: LiveSetProp;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}) {
  const translate = useTranslate();
  const column = currentFlexFlow(read).startsWith('column');
  return (
    <div className="embed-editor_size-row embed-editor_align-row">
      {}
      <FieldLabel
        className="embed-editor_size-label"
        active={false}
        disabled={busy}
        onReset={() => {}}
        tooltip={<PropTip props={['justify-content', 'align-items']} />}
      >
        {translate('styleModel.embed.layout.align')}
      </FieldLabel>
      <AlignControl
        justify={effectiveValue(read('justify-content'))}
        align={effectiveValue(read('align-items'))}
        column={column}
        busy={busy}
        read={read}
        onSet={(prop, value) => {
          const kept = keepImportant(value, rawEffective(read(prop)));
          setProp(prop, kept.value, kept.important);
        }}
        onLive={(prop, value) => {
          if (value === undefined) {
            liveSetProp(prop, undefined, false);
            return;
          }
          const kept = keepImportant(value, rawEffective(read(prop)));
          liveSetProp(prop, kept.value, kept.important);
        }}
        onClear={(prop) => clearProp(prop)}
        onProvenance={onProvenance}
        onSelectSelector={onSelectSelector}
      />
    </div>
  );
}

export const ChevronRightIcon = centralIcon(centralChevronRight);

export function layoutMode(display: string): 'grid' | 'flex' | 'inline' | undefined {
  const lowered = display.toLowerCase();
  if (lowered.includes('grid')) {
    return 'grid';
  }
  if (lowered.includes('flex')) {
    return 'flex';
  }
  if (lowered.includes('inline')) {
    return 'inline';
  }
  return undefined;
}

export function LayoutDisclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`embed-editor_disclosure ${open ? 'is-open' : ''}`}>
      <button type="button" className="embed-editor_disclosure-btn" aria-expanded={open} onClick={onToggle}>
        <span className={`embed-editor_disclosure-arrow ${open ? 'is-open' : ''}`}>
          <ChevronRightIcon />
        </span>
        <span className="embed-editor_disclosure-label">{label}</span>
      </button>
      {open ? <div className="embed-editor_disclosure-body">{children}</div> : undefined}
    </div>
  );
}

export interface LayoutRowProps {
  read: (prop: string) => ResolvedProp | undefined;
  busy: boolean;
  setProp: (prop: string, value: string, important: boolean) => void;
  clearProp: (prop: string | string[]) => void;
  onProvenance: (prop: string, anchor: DOMRect) => void;
  onSelectSelector: (selector: string, prop?: string) => void;
}

export function LayoutModeSections({
  liveSetProp,
  activeSelector,
  resolving,
  ...rowProps
}: LayoutRowProps & {
  liveSetProp: LiveSetProp;
  activeSelector: string;
  resolving: boolean;
}) {
  const translate = useTranslate();
  const { read, busy, setProp, clearProp, onProvenance, onSelectSelector } = rowProps;
  const display = effectiveValue(read('display'));
  const mode = layoutMode(display);
  const [open, toggle] = useLayoutModeOpen(mode, { resolving });
  const hasGridGap = ['row-gap', 'column-gap', 'grid-row-gap', 'grid-column-gap', 'gap'].some((prop) => read(prop) !== undefined);
  return (
    <>
      <LayoutDisclosure label={translate('styleModel.embed.layout.flexSettings')} open={open.flex} onToggle={() => toggle('flex')}>
        <DirectionRow {...rowProps} />
        <AlignRow {...rowProps} liveSetProp={liveSetProp} />
      </LayoutDisclosure>
      <LayoutDisclosure label={translate('styleModel.embed.layout.gridSettings')} open={open.grid} onToggle={() => toggle('grid')}>
        <GridControls {...rowProps} liveSetProp={liveSetProp} />
      </LayoutDisclosure>
      {}
      <GapControl key={activeSelector} show={mode === 'flex' || mode === 'grid' || hasGridGap} {...rowProps} liveSetProp={liveSetProp} />
      <LayoutDisclosure label={translate('styleModel.embed.layout.inlineSettings')} open={open.inline} onToggle={() => toggle('inline')}>
        {}
        <VerticalAlignRow
          resolved={read('vertical-align')}
          dimmed={!VALIGN_DISPLAYS.has(display || 'block')}
          busy={busy}
          setProp={setProp}
          clearProp={clearProp}
          onProvenance={onProvenance}
          onSelectSelector={onSelectSelector}
        />
      </LayoutDisclosure>
    </>
  );
}

export function useLayoutModeOpen(mode: ReturnType<typeof layoutMode>, options: { readonly resolving: boolean }) {
  const { resolving } = options;
  const elementKey = getHost().selectedId ?? '';
  const [open, setOpen] = useState({
    flex: mode === 'flex',
    grid: mode === 'grid',
    inline: mode === 'inline',
  });
  const [seen, setSeen] = useState({ mode, resolving, elementKey });
  if (seen.mode !== mode || seen.resolving !== resolving || seen.elementKey !== elementKey) {
    setSeen({ mode, resolving, elementKey });
    if (!heldThroughResolution({ sameElement: seen.elementKey === elementKey, resolving, mode })) {
      setOpen({ flex: mode === 'flex', grid: mode === 'grid', inline: mode === 'inline' });
    }
  }
  const toggle = (key: 'flex' | 'grid' | 'inline') => setOpen((previous) => ({ ...previous, [key]: !previous[key] }));
  return [open, toggle] as const;
}

function heldThroughResolution(state: { readonly sameElement: boolean; readonly resolving: boolean; readonly mode: ReturnType<typeof layoutMode> }): boolean {
  if (!state.sameElement) {
    return false;
  }
  if (!state.resolving) {
    return false;
  }
  return state.mode === undefined;
}


export type SourceOption = {
  value: string;
  label: string;
  marked?: boolean;
  fromComponent?: boolean;
  heading?: boolean;
  indent?: boolean;
  triggerLabel?: string;
  create?: boolean;
};

export type SelectorSuggestion = {
  selector: string;
  kind: 'tag' | 'class' | 'attribute' | 'attribute-value' | 'combo';
};

export function useProjectClasses(): string[] {
  const [list, setList] = useState<string[]>(() => getHost().projectClasses ?? []);
  useEffect(() => {
    const sync = () =>
      setList((previous) => {
        const next = getHost().projectClasses ?? [];
        return next.length === previous.length && next.every((name, i) => name === previous[i]) ? previous : next;
      });
    sync();
    return onHostChange(sync);
  }, []);
  return list;
}
export const PROJECT_CLASS_LIMIT = 30;

export const SUGGESTION_KIND_LABEL_KEY: Record<SelectorSuggestion['kind'], MessageKey> = {
  tag: 'styleModel.embed.picker.kind.tag',
  class: 'styleModel.embed.picker.kind.class',
  attribute: 'styleModel.embed.picker.kind.attribute',
  'attribute-value': 'styleModel.embed.picker.kind.attribute',
  combo: 'styleModel.embed.picker.kind.combo',
};

export type ClassifiedSelector = {
  readonly selector: MatchedSelector;
  readonly global: boolean;
  readonly inherited: boolean;
  readonly kind: SelectorKind;
};

export function classifySelector(selector: MatchedSelector): ClassifiedSelector {
  const inherited = selectorDependsOnAncestor(selector.text);
  return {
    selector,
    global: !inherited && isGlobalSelector(selector.text),
    inherited,
    kind: selectorKind(selector.text),
  };
}

export function selectorAccessibleLabel(entry: ClassifiedSelector, label: string, translate: Translator = ENGLISH_TRANSLATE): string {
  const categories: string[] = [];
  if (entry.global) {
    categories.push(translate('styleModel.embed.layout.category.global'));
  }
  if (entry.inherited) {
    categories.push(translate('styleModel.embed.layout.category.inherited'));
  }
  if (entry.selector.inComponentMarkup === true) {
    categories.push(translate('styleModel.embed.layout.category.component'));
  }
  if (entry.selector.fromInstance === true) {
    categories.push(translate('styleModel.embed.layout.category.instance'));
  }
  const last = categories.pop();
  if (last === undefined) {
    return label;
  }
  const joined = categories.length === 0 ? last : translate('styleModel.embed.layout.categoriesAnd', { rest: categories.join(', '), last });
  return translate('styleModel.embed.layout.selectorLabel', { label, categories: joined });
}

export type SelectorPickerProps = {
  selectors: readonly MatchedSelector[];
  suggestions: SelectorSuggestion[];
  activeSelector: string;
  activePicked: boolean;
  busy: boolean;
  loading: boolean;
  settled?: boolean;
  onSelect: (selector: string) => void;
  onDeselect: () => void;
  onAdd: (selector: string, placement: ClassPlacement) => void;
  onVisibleSelectorsChange?: (selectors: readonly string[]) => void;
  inline?: InlineChip | undefined;
};
