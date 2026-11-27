import { useRef, type MouseEvent, type RefObject } from 'react';
import { assert } from '../../../shared/core/assert';
import { insertFolderLabel, type InsertFolderKey } from './insertFolders';
import type { InsertPill } from './insertGrid';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { insertItemLabel, insertItemSub, type InsertItem } from './insertItem';
import { InsertPreviewSurface, useReportVisibility, type InsertPreviewSource } from './InsertPreview';


export type InsertPreviewHost = Omit<InsertPreviewSource, 'component'>;

export function InsertCard({
  item,
  itemKey,
  highlighted,
  host,
  scrollRoot,
  onVisible,
  showFolder,
  onHover,
  onInsert,
  describedBy,
}: {
  readonly item: InsertItem;
  readonly itemKey: string;
  readonly highlighted: boolean;
  readonly host: InsertPreviewHost;
  readonly scrollRoot: RefObject<HTMLElement>;
  readonly onVisible: (key: string, visible: boolean) => void;
  readonly showFolder: boolean;
  readonly onHover: () => void;
  readonly onInsert: () => void;
  readonly describedBy?: string | undefined;
}) {
  assert(item.card !== undefined, 'Only a card item renders as a card');
  const translate = useTranslate();
  const ref = useRef<HTMLDivElement>(null);
  useReportVisibility(ref, scrollRoot, itemKey, onVisible);
  const uses = item.instances ?? 0;
  const folder = showFolder && item.card.folder !== undefined ? insertFolderLabel(item.card.folder) : undefined;
  return (
    <div
      ref={ref}
      className={`insert-item insert-card ${highlighted ? 'highlight' : ''}`}
      aria-describedby={describedBy}
      onMouseMove={highlighted ? undefined : onHover}
      onClick={onInsert}
    >
      <InsertPreviewSurface source={{ ...host, component: item.preview }} icon={item.icon} />
      <div className="insert-card-foot">
        <span className="insert-item-icon">{item.icon}</span>
        <span className="insert-item-label">{insertItemLabel(item, translate)}</span>
        {folder !== undefined && <span className="insert-card-folder">· {folder}</span>}
        {uses > 0 && <span className="insert-item-uses">{uses}×</span>}
      </div>
    </div>
  );
}

export function InsertRow({
  item,
  highlighted,
  onHover,
  onInsert,
  describedBy,
}: {
  readonly item: InsertItem;
  readonly highlighted: boolean;
  readonly onHover: () => void;
  readonly onInsert: () => void;
  readonly describedBy?: string | undefined;
}) {
  const translate = useTranslate();
  const where = item.card?.folder === undefined ? insertItemSub(item, translate) : insertFolderLabel(item.card.folder);
  return (
    <div
      className={`insert-item ${highlighted ? 'highlight' : ''}`}
      aria-describedby={describedBy}
      onMouseMove={highlighted ? undefined : onHover}
      onClick={onInsert}
    >
      <span className="insert-item-icon">{item.icon}</span>
      <span className="insert-item-label">{insertItemLabel(item, translate)}</span>
      {where !== undefined && where !== '' && <span className="insert-item-sub">{where}</span>}
    </div>
  );
}

export function InsertPills({
  pills,
  selected,
  onPick,
}: {
  readonly pills: readonly InsertPill[];
  readonly selected: InsertFolderKey | undefined;
  readonly onPick: (folder: InsertFolderKey) => void;
}) {
  const translate = useTranslate();
  return (
    <div className="insert-pills" role="group" aria-label={translate('palette.insert.folders')}>
      {pills.map((pill) => {
        const on = pill.key === selected;
        return (
          <button
            key={pill.key}
            type="button"
            className={`insert-pill ${on ? 'on' : ''}`}
            aria-pressed={on}
            disabled={pill.count === 0 && !on}
            onMouseDown={keepFocus}
            onClick={() => onPick(pill.key)}
          >
            <span>{insertFolderLabel(pill.key)}</span>
            <span className="insert-pill-count">{pill.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function InsertHints() {
  const translate = useTranslate();
  return (
    <div className="insert-footer">
      <span className="insert-hint">
        <kbd>↵</kbd> {translate('palette.insert.hint')}
      </span>
    </div>
  );
}

function keepFocus(event: MouseEvent): void {
  event.preventDefault();
}
