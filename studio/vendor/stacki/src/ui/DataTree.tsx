
import type { ReactNode, Ref } from 'react';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from './Icons';
import { useTranslate } from '../lib/i18n/useTranslate';

const DEPTH_INDENT_PX = 18;
const ROW_INSET_PX = 6;

export const DATA_TREE_WIDTH_PX_MIN = 320;
export const DATA_TREE_HEIGHT_PX_MAX = 340;

export function dataRowIndentPx(depth: number): number {
  assert(Number.isSafeInteger(depth), 'dataRowIndentPx: depth is a whole number');
  assert(depth >= 0, 'dataRowIndentPx: depth is not negative');
  return ROW_INSET_PX + depth * DEPTH_INDENT_PX;
}

export interface ItemPosition {
  readonly index: number;
  readonly count: number;
}

export type DataRowTone = 'plain' | 'path-only' | 'missing' | 'disabled';

export type DataRowCheck = 'selected-only' | 'column';

export interface DataTreeRowProps {
  readonly depth: number;
  readonly label: string;
  readonly title: string;
  readonly expandable: boolean;
  readonly open: boolean;
  readonly selected: boolean;
  readonly tone: DataRowTone;
  readonly check: DataRowCheck;
  readonly value: ReactNode;
  readonly lead?: ReactNode;
  readonly detail?: string | undefined;
  readonly end?: ReactNode;
  readonly rowRef?: Ref<HTMLDivElement> | undefined;
  readonly onToggle: () => void;
  readonly onPick: () => void;
}

export function DataTreeRow(props: DataTreeRowProps) {
  const translate = useTranslate();
  assert(props.depth <= LIMITS.treeDepthMax, 'DataTreeRow: render depth limit exceeded');
  assert(props.label.length <= LIMITS.attrCharsMax, 'DataTreeRow: label limit exceeded');
  const { expandable, open, depth, tone } = props;
  const toneClass = tone === 'plain' ? '' : tone;
  return (
    <div
      ref={props.rowRef}
      className={`dp-row ${props.selected ? 'selected' : ''} ${toneClass}`}
      style={{ paddingInlineStart: dataRowIndentPx(depth) }}
      title={props.title}
      aria-selected={props.selected}
      aria-disabled={tone === 'disabled' ? true : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={tone === 'disabled' ? undefined : props.onPick}
    >
      <span
        className={`dp-twist ${expandable ? '' : depth > 0 ? 'absent' : 'hidden'} ${open ? 'open' : ''}`}
        title={expandable ? translate(open ? 'ui.close' : 'ui.open') : undefined}
        onClick={
          expandable
            ? (event) => {
                event.stopPropagation();
                props.onToggle();
              }
            : undefined
        }
      >
        <ChevronRightIcon size={10} />
      </span>
      {props.lead}
      {props.detail === undefined ? (
        <span className="dp-key">{props.label}</span>
      ) : (
        <span className="dp-key-stack">
          <span className="dp-key">{props.label}</span>
          <span className="dp-note">{props.detail}</span>
        </span>
      )}
      {props.value}
      {props.check === 'column' ? (
        <span className="dp-check-slot">{props.selected && <CheckIcon size={11} className="dp-check" />}</span>
      ) : (
        props.selected && <CheckIcon size={11} className="dp-check" />
      )}
      {props.end}
    </div>
  );
}

export function ItemNavigation({
  path,
  nav,
  onStepItem,
}: {
  readonly path: string;
  readonly nav: ItemPosition;
  readonly onStepItem: (path: string, step: -1 | 1, count: number, index: number) => void;
}) {
  const translate = useTranslate();
  assert(nav.count > 0, 'ItemNavigation: there is an item to show');
  assert(nav.index < nav.count, 'ItemNavigation: the item shown is one of the list');
  return (
    <span className="dp-item-nav" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="dp-step"
        title={translate('ui.dataTree.previousItem')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onStepItem(path, -1, nav.count, nav.index)}
      >
        <ChevronLeftIcon size={11} />
      </button>
      <span className="dp-item-count">
        {nav.index + 1}/{nav.count}
      </span>
      <button
        type="button"
        className="dp-step"
        title={translate('ui.dataTree.nextItem')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onStepItem(path, 1, nav.count, nav.index)}
      >
        <ChevronRightIcon size={11} />
      </button>
    </span>
  );
}

export function DataSearch({
  value,
  label,
  inputRef,
  onChange,
}: {
  readonly value: string;
  readonly label: string;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
  readonly onChange: (value: string) => void;
}) {
  const translate = useTranslate();
  return (
    <div className="dp-search">
      <SearchIcon size={12} />
      <input
        ref={inputRef}
        value={value}
        placeholder={translate('ui.dataTree.search')}
        aria-label={label}
        spellCheck={false}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export type DataSectionTone = 'source' | 'component';

export function DataSection({
  heading,
  tone,
  icon,
  action,
  collapse,
}: {
  readonly heading: string;
  readonly tone: DataSectionTone;
  readonly icon?: ReactNode;
  readonly action?: { readonly label: string; readonly onClick: () => void } | undefined;
  readonly collapse?: { readonly open: boolean; readonly onToggle: () => void } | undefined;
}) {
  const translate = useTranslate();
  assert(heading.length > 0, 'DataSection: a heading has words');
  assert(heading.length <= LIMITS.attrCharsMax, 'DataSection: heading limit exceeded');
  const className = `${tone === 'component' ? 'dp-section component' : 'dp-section'}${collapse === undefined ? '' : ' collapsible'}`;
  if (collapse !== undefined) {
    return (
      <div
        className={className}
        role="button"
        tabIndex={0}
        aria-expanded={collapse.open}
        title={translate(collapse.open ? 'ui.close' : 'ui.open')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={collapse.onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            collapse.onToggle();
          }
        }}
      >
        <span className={collapse.open ? 'dp-twist open' : 'dp-twist'}>
          <ChevronRightIcon size={10} />
        </span>
        {icon}
        <span className="dp-section-heading">{heading}</span>
      </div>
    );
  }
  return (
    <div className={className}>
      {icon}
      <span className="dp-section-heading">{heading}</span>
      {action !== undefined && (
        <button
          type="button"
          className="dp-section-action"
          onMouseDown={(event) => event.preventDefault()}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function DataSubsection({ heading }: { readonly heading: string }) {
  assert(heading.length > 0, 'DataSubsection: a heading has words');
  assert(heading.length <= LIMITS.attrCharsMax, 'DataSubsection: heading limit exceeded');
  return <div className="dp-subsection">{heading}</div>;
}

export function PreviewValue(props: { readonly preview: string; readonly kind: string; readonly image: string | undefined }) {
  if (props.image) {
    return (
      <span className="dp-val" title={props.image}>
        <img className="dp-thumb" src={props.image} alt="" loading="lazy" />
      </span>
    );
  }
  if (!props.preview) {
    return <span className="dp-val kind">{props.kind}</span>;
  }
  const words = unquoted(props.preview);
  return words === undefined ? (
    <span className="dp-val">{props.preview}</span>
  ) : (
    <span className="dp-val text" title={words}>
      {words.replace(/^https?:\/\//, '')}
    </span>
  );
}

function unquoted(preview: string): string | undefined {
  if (!preview.startsWith('"')) {
    return undefined;
  }
  if (preview.endsWith('…')) {
    return preview.slice(1);
  }
  if (preview.length < 2 || !preview.endsWith('"')) {
    return undefined;
  }
  return preview.slice(1, -1);
}
