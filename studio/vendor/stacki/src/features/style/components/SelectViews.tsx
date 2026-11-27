import { useTranslate } from '../../../lib/i18n/useTranslate';
import { centralIcon } from '../../../ui/central/CentralIcon';
import { check as centralCheck, chevronDown as centralChevronDown } from '../../../ui/central/centralGeometry';
import Popup from '../../../ui/Popup';
import { Switch } from '../../../ui/Switch';

const ChevronDownGlyph = centralIcon(centralChevronDown, 12);

import { useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { assert } from '../../../../shared/core/assert';
import { type SelectOption, type SelectTag, type Props } from './selectTypes';
import { useHoverTip } from './CssPropertyTip';
import { CodeInline } from '../../../ui/CodeBlock';

export const present = (node: ReactNode): boolean => (node ?? undefined) !== undefined;

const SUBLINE_SEPARATOR = ', ';
const SUBLINE_MORE = '…';
const SUBLINE_SLACK_PX = 1;

export function OptionLabel({
  label,
  overline,
  tag,
  subline,
  prefix,
  detail,
}: {
  readonly label: string;
  readonly overline: string | undefined;
  readonly tag?: SelectTag | undefined;
  readonly subline?: readonly string[] | undefined;
  readonly prefix?: string | undefined;
  readonly detail?: string | undefined;
}) {
  const hasOverline = overline !== undefined && overline.length > 0;
  const hasFirstLine = hasOverline || tag !== undefined;
  const hasSubline = subline !== undefined && subline.length > 0;
  if (prefix !== undefined && prefix.length > 0 && !hasFirstLine && !hasSubline) {
    return (
      <span className="u-select-label has-prefix">
        <span className="u-select-prefix" onMouseEnter={titleWhenCut(prefix)}>
          {prefix}
        </span>
        <span className="u-select-prefix-separator" aria-hidden="true">
          ·
        </span>
        <span className="u-select-main">{label}</span>
      </span>
    );
  }
  if (!hasFirstLine && !hasSubline) {
    return (
      <span className="u-select-label" onMouseEnter={titleWhenCut(label)}>
        {label}
        {detail === undefined ? undefined : <span className="u-select-detail">{detail}</span>}
      </span>
    );
  }
  return (
    <span className="u-select-label has-overline">
      {hasFirstLine ? (
        <span className="u-select-overline">
          {tag === undefined ? undefined : <OptionTag tag={tag} />}
          {hasOverline ? <span className="u-select-overline-text">{overline}</span> : undefined}
        </span>
      ) : undefined}
      <span className="u-select-label-line" onMouseEnter={titleWhenCut(label)}>
        {label}
      </span>
      {hasSubline ? <OptionSubline items={subline} /> : undefined}
    </span>
  );
}

function titleWhenCut(label: string) {
  return (event: { readonly currentTarget: HTMLElement }): void => {
    const element = event.currentTarget;
    element.title = element.scrollWidth > element.clientWidth ? label : '';
  };
}

function OptionSubline({ items }: { readonly items: readonly string[] }) {
  const lineRef = useRef<HTMLSpanElement>(null);
  const full = items.join(SUBLINE_SEPARATOR);
  const [text, setText] = useState(full);
  useLayoutEffect(() => {
    const line = lineRef.current;
    assert(line !== null, 'OptionSubline: the line is mounted before it is fitted');
    const fit = () => setText(fitSublineToElement(line, items));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(line);
    return () => observer.disconnect();
  }, [items]);
  return (
    <span ref={lineRef} className="u-select-subline" title={full}>
      {text}
    </span>
  );
}

export function fitSubline(items: readonly string[], widthPx: number, measure: (text: string) => number): string {
  assert(items.length > 0, 'fitSubline: a subline has items');
  assert(widthPx >= 0, 'fitSubline: a width is not negative');
  const full = items.join(SUBLINE_SEPARATOR);
  if (measure(full) <= widthPx) {
    return full;
  }
  let fitted = sublineWithMore(items, 1);
  for (let count = 2; count < items.length; count += 1) {
    const candidate = sublineWithMore(items, count);
    if (measure(candidate) > widthPx) {
      break;
    }
    fitted = candidate;
  }
  assert(fitted.length > 0, 'fitSubline: the first item always shows');
  return fitted;
}

function sublineWithMore(items: readonly string[], count: number): string {
  const shown = items.slice(0, count).join(SUBLINE_SEPARATOR);
  return count < items.length ? `${shown}${SUBLINE_SEPARATOR}${SUBLINE_MORE}` : shown;
}

function fitSublineToElement(line: HTMLElement, items: readonly string[]): string {
  const full = items.join(SUBLINE_SEPARATOR);
  if (line.clientWidth === 0) {
    return full;
  }
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) {
    return full;
  }
  const style = getComputedStyle(line);
  context.font = style.font;
  context.letterSpacing = style.letterSpacing;
  return fitSubline(items, Math.max(0, line.clientWidth - SUBLINE_SLACK_PX), (text) => context.measureText(text).width);
}

function OptionTag({ tag }: { readonly tag: SelectTag }) {
  return (
    <span className="u-select-tag" data-tone={tag.tone}>
      {present(tag.icon) ? <span className="u-select-tag-icon">{tag.icon}</span> : undefined}
      <span className="u-select-tag-label">{tag.label}</span>
    </span>
  );
}

export const CHEVRON = <ChevronDownGlyph className="u-select-chevron" />;

export function SelectTrigger<T extends string>({
  props,
  selectedOption,
  open,
  buttonRef,
  onToggle,
  onKeyDown,
}: {
  props: Props<T>;
  selectedOption: SelectOption<T> | undefined;
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement>;
  onToggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const triggerLabel = selectedOption ? (selectedOption.triggerLabel ?? selectedOption.label) : '';
  const triggerOverline = selectedOption?.triggerOverline ?? selectedOption?.overline;
  const triggerTag = selectedOption?.triggerTag ?? selectedOption?.tag;
  const triggerIcon = selectedOption?.triggerIcon ?? selectedOption?.icon;
  const shared = {
    ref: buttonRef,
    id: props.id,
    type: 'button' as const,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-label': props.ariaLabel,
    'aria-labelledby': props.labelId,
    disabled: props.disabled,
    onClick: onToggle,
    onKeyDown,
  };
  const icon = !props.hideTriggerIcon && present(triggerIcon) ? <span className="u-select-icon">{triggerIcon}</span> : undefined;
  if (present(props.customInput)) {
    return (
      <div className="u-select-button is-custom">
        {props.customInput}
        <button {...shared} className="u-select-chevron-btn">
          {CHEVRON}
        </button>
      </div>
    );
  }
  if (props.variant === 'link') {
    return <LinkTrigger shared={shared} tone={selectedOption?.tone} icon={icon} label={triggerLabel} />;
  }
  return (
    <button {...shared} className="u-select-button" data-tone={selectedOption?.tone} title={selectedOption?.title}>
      <span className="u-select-value">
        {icon}
        <OptionLabel
          label={triggerLabel}
          overline={triggerOverline}
          tag={triggerOverline === undefined ? undefined : triggerTag}
          prefix={selectedOption?.triggerPrefix}
        />
        {present(selectedOption?.triggerMark) ? <span className="u-select-mark">{selectedOption?.triggerMark}</span> : undefined}
      </span>
      {CHEVRON}
    </button>
  );
}

function LinkTrigger({
  shared,
  tone,
  icon,
  label,
}: {
  readonly shared: Omit<ComponentProps<'button'>, 'className' | 'ref'> & { readonly ref: RefObject<HTMLButtonElement> };
  readonly tone: SelectOption<string>['tone'];
  readonly icon: ReactNode;
  readonly label: string;
}) {
  const [truncated, setTruncated] = useState(false);
  const { ref, hoverProps, hide, tip } = useHoverTip<HTMLSpanElement>(<CodeInline text={label} className="u-select-link-tip-code" />);
  return (
    <>
      <button
        {...shared}
        className="u-select-link"
        data-tone={tone}
        title={truncated ? undefined : label}
        onClick={(event) => {
          hide();
          shared.onClick?.(event);
        }}
      >
        {icon}
        <span
          ref={ref}
          className="u-select-label is-path"
          onMouseEnter={(event) => {
            const cut = event.currentTarget.scrollWidth > event.currentTarget.clientWidth;
            setTruncated(cut);
            if (cut) {
              hoverProps.onMouseEnter?.();
            }
          }}
          onMouseLeave={hoverProps.onMouseLeave}
        >
          <bdi dir="ltr">{label}</bdi>
        </span>
        {CHEVRON}
      </button>
      {tip}
    </>
  );
}

export type SelectListProps<T extends string> = {
  props: Props<T>;
  listRef: RefObject<HTMLDivElement>;
  searchRef: RefObject<HTMLInputElement>;
  trigger: HTMLElement | undefined;
  dropUp: boolean;
  baseId: string;
  displayed: SelectOption<T>[];
  activeIndex: number;
  query: string;
  onQuery: (query: string) => void;
  onListKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onActivate: (index: number, source: 'pointer') => void;
  onLeave: () => void;
  onChoose: (index: number) => void;
  onCancel: () => void;
};

export const optionId = (baseId: string, index: number) => `${baseId}-opt-${index}`;

export function SelectList<T extends string>(list: SelectListProps<T>) {
  const translate = useTranslate();
  const { props, displayed } = list;
  const { ariaLabel, labelId, searchable = false } = props;
  const dotColumn = dotColumnFor(props.options);
  const row = (index: number) => {
    const option = displayed[index];
    assert(option !== undefined, 'SelectList: a section names displayed rows');
    return (
      <SelectRow
        key={option.value}
        option={option}
        id={optionId(list.baseId, index)}
        selected={option.checked ?? option.value === props.value}
        active={index === list.activeIndex}
        dotColumn={dotColumn}
        onActivate={() => list.onActivate(index, 'pointer')}
        onChoose={() => list.onChoose(index)}
        onCancel={list.onCancel}
      />
    );
  };
  const pinned = (key: 'header' | 'footer'): number[] => displayed.flatMap((option, index) => (option[key] === true ? [index] : []));
  const headerIndexes = pinned('header');
  const footerIndexes = pinned('footer');
  const pinnedAway = (option: SelectOption<T> | undefined): boolean => option?.header === true || option?.footer === true;
  const body =
    displayed.length === 0 ? (
      <div className="u-select-empty" role="presentation">
        {translate('styleModel.components.select.noMatches')}
      </div>
    ) : (
      displayed.flatMap((option, index) => (pinnedAway(option) ? [] : [row(index)]))
    );
  const framed = headerIndexes.length > 0 || footerIndexes.length > 0;
  return (
    <Popup
      mode="popover"
      portal={false}
      anchor={list.trigger}
      onClose={list.onCancel}
      ref={list.listRef}
      className={['u-select-list', list.dropUp ? 'is-up' : '', framed ? 'has-footer' : '', headerIndexes.length > 0 ? 'has-header' : '']
        .filter(Boolean)
        .join(' ')}
      role="listbox"
      tabIndex={-1}
      label={ariaLabel}
      labelledBy={labelId}
      aria-activedescendant={optionId(list.baseId, list.activeIndex)}
      onKeyDown={searchable ? undefined : list.onListKeyDown}
      onMouseLeave={list.onLeave}
    >
      {searchable ? (
        <div className="u-select-search">
          <input
            ref={list.searchRef}
            type="text"
            className="u-select-search-input"
            placeholder={props.searchPlaceholder ?? translate('ui.search')}
            value={list.query}
            onChange={(event) => list.onQuery(event.target.value)}
            onKeyDown={list.onSearchKeyDown}
            aria-label={
              ariaLabel ? translate('styleModel.components.select.searchNamed', { label: ariaLabel }) : translate('styleModel.components.select.search')
            }
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      ) : undefined}
      {!framed ? (
        body
      ) : (
        <>
          {headerIndexes.length > 0 ? <div className="u-select-header">{headerIndexes.map(row)}</div> : undefined}
          <div className="u-select-scroll">{body}</div>
          {footerIndexes.length > 0 ? <div className="u-select-footer">{footerIndexes.map(row)}</div> : undefined}
        </>
      )}
    </Popup>
  );
}

export type DotColumn = 'held' | 'none';

export function dotColumnFor<T extends string>(options: readonly SelectOption<T>[]): DotColumn {
  return options.some((option) => option.marked === true) ? 'held' : 'none';
}

export function SelectRow<T extends string>({
  option,
  id,
  selected,
  active,
  dotColumn,
  onActivate,
  onChoose,
  onCancel,
}: {
  option: SelectOption<T>;
  id: string;
  selected: boolean;
  active: boolean;
  dotColumn: DotColumn;
  onActivate: () => void;
  onChoose: () => void;
  onCancel: () => void;
}) {
  const translate = useTranslate();
  const icon = present(option.icon) ? <span className="u-select-icon">{option.icon}</span> : undefined;
  if (option.heading) {
    return (
      <div id={id} className={option.tag === undefined ? 'u-select-heading' : 'u-select-heading has-tag'} role="presentation">
        {icon}
        {option.tag === undefined ? undefined : <OptionTag tag={option.tag} />}
        <span className="u-select-heading-label" title={option.label}>
          {option.label}
        </span>
      </div>
    );
  }
  const hasStyles = translate('styleModel.components.select.hasStyles');
  return (
    <div
      id={id}
      className={[
        'u-select-option',
        active ? 'is-active' : '',
        selected ? 'is-selected' : '',
        option.indent ? 'is-indented' : '',
        option.action ? 'has-action' : '',
        option.footer ? 'is-footer' : '',
        option.header ? 'is-header' : '',
        (option.subline?.length ?? 0) > 0 ? 'has-subline' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="option"
      aria-selected={selected}
      title={option.title}
      data-active={active || undefined}
      onMouseEnter={onActivate}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button === 0 && option.switch !== true) {
          event.preventDefault();
          onChoose();
        }
      }}
      onClick={onChoose}
    >
      {icon}
      <OptionLabel label={option.label} overline={option.overline} tag={option.tag} subline={option.subline} detail={option.detail} />
      {}
      {dotColumn === 'held' ? (
        <span className="u-select-dot-slot">
          {option.marked ? <span className="u-select-dot" role="img" title={hasStyles} aria-label={hasStyles} /> : undefined}
        </span>
      ) : undefined}
      <span className="u-select-check">
        {option.switch ? undefined : selected ? CHECK : undefined}
        {option.action ? <RowAction action={option.action} onCancel={onCancel} /> : undefined}
      </span>
      {option.switch ? (
        <span className="u-select-switch">
          <Switch label={option.label} checked={selected} onToggle={NOOP} />
        </span>
      ) : undefined}
    </div>
  );
}

const NOOP = (): void => undefined;

const CheckIcon = centralIcon(centralCheck);
export const CHECK = <CheckIcon />;

export function RowAction({ action, onCancel }: { action: NonNullable<SelectOption<string>['action']>; onCancel: () => void }) {
  return (
    <button
      type="button"
      className="u-select-action"
      title={action.label}
      aria-label={action.label}
      tabIndex={-1}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        const run = action.onSelect;
        onCancel();
        run();
      }}
    >
      {action.icon}
    </button>
  );
}
