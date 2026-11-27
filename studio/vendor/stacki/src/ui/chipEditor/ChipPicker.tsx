import { useCallback, useLayoutEffect, useState } from 'react';
import type { ReactNode, RefCallback } from 'react';
import { assert } from '../../../shared/core/assert';
import { EmptyState } from '../EmptyState';
import Popup from '../Popup';
import { placeMenu } from '../menuModel';
import { SegmentedTabs, type SegmentedTab } from '../SegmentedTabs';
import { SearchIcon } from '../Icons';
import './chipEditor.css';

export const CHIP_PICKER_ROWS_MAX = 50;
export const CHIP_PICKER_HEIGHT_PX = 320;

export interface ChipPickerCandidate {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly icon?: ReactNode;
}

export interface ChipPickerTabs<T extends string> {
  readonly tabs: readonly SegmentedTab<T>[];
  readonly value: T;
  readonly label: string;
  readonly onPick: (value: T) => void;
}

export interface ChipPickerProps<T extends string> {
  readonly open: boolean;
  readonly anchor: { readonly left: number; readonly top: number; readonly bottom: number } | undefined;
  readonly candidates: readonly ChipPickerCandidate[];
  readonly activeIndex: number;
  readonly label: string;
  readonly listId: string;
  readonly emptyText: string;
  readonly tabs?: ChipPickerTabs<T> | undefined;
  readonly onActiveChange: (index: number) => void;
  readonly onChoose: (candidate: ChipPickerCandidate) => void;
  readonly onClose: () => void;
}

export function chipPickerOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

const WIDTH_PX = 320;
const EDGE_PX = 8;

export function ChipPicker<T extends string>(props: ChipPickerProps<T>) {
  assert(props.candidates.length <= CHIP_PICKER_ROWS_MAX, 'ChipPicker: the caller narrows the list to the rows that fit');
  assert(props.activeIndex >= 0, 'ChipPicker: the active row is not negative');
  const [list, setList] = useState<HTMLDivElement | undefined>(undefined);
  const attachList = useCallback<RefCallback<HTMLDivElement>>((element) => setList(element ?? undefined), []);
  const anchor = props.anchor;
  useLayoutEffect(() => {
    if (list === undefined) {
      return;
    }
    const row = list.ownerDocument.getElementById(chipPickerOptionId(props.listId, props.activeIndex));
    if (row !== null && list.contains(row) && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    } else {
      list.scrollTop = 0;
    }
  }, [list, props.listId, props.activeIndex, props.candidates]);
  if (anchor === undefined) {
    return undefined;
  }
  const height = Math.max(1, Math.min(CHIP_PICKER_HEIGHT_PX, window.innerHeight - 2 * EDGE_PX));
  const shown = placeMenu(
    { left: anchor.left, top: anchor.top, width: 0, height: anchor.bottom - anchor.top },
    { width: WIDTH_PX, height },
    { width: window.innerWidth, height: window.innerHeight },
    'above-start',
  );
  let lastGroup: string | undefined;
  return (
    <Popup
      mode="popover"
      open={props.open}
      onClose={props.onClose}
      keepOnScroll
      role="listbox"
      label={props.label}
      className="chip-picker"
      style={{ position: 'fixed', left: shown.left, top: shown.top, width: WIDTH_PX, height }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {props.tabs !== undefined && (
        <div className="chip-picker-tabs">
          <SegmentedTabs tabs={props.tabs.tabs} value={props.tabs.value} label={props.tabs.label} onPick={props.tabs.onPick} />
        </div>
      )}
      <div ref={attachList} className="chip-picker-list">
        {props.candidates.length === 0 ? (
          <div className="chip-picker-empty">
            <EmptyState icon={<SearchIcon size={16} />} title={props.emptyText} align="center" />
          </div>
        ) : (
          props.candidates.map((candidate, index) => {
            const heading = candidate.group !== undefined && candidate.group !== lastGroup ? candidate.group : undefined;
            lastGroup = candidate.group;
            return (
              <div key={candidate.id} role="presentation">
                {heading !== undefined && (
                  <div role="presentation" className="chip-picker-heading">
                    {heading}
                  </div>
                )}
                <div
                  role="option"
                  id={chipPickerOptionId(props.listId, index)}
                  aria-selected={index === props.activeIndex}
                  className={index === props.activeIndex ? 'chip-picker-option is-active' : 'chip-picker-option'}
                  onMouseEnter={() => props.onActiveChange(index)}
                  onClick={() => props.onChoose(candidate)}
                >
                  {candidate.icon !== undefined && <span className="chip-picker-icon">{candidate.icon}</span>}
                  <span className="chip-picker-text">
                    <span className="chip-picker-label">{candidate.label}</span>
                    {candidate.description !== undefined && <span className="chip-picker-description">{candidate.description}</span>}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Popup>
  );
}
