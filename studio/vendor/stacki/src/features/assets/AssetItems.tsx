import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { assert } from '../../../shared/core/assert';
import { VIEW_METRICS, itemGeometry, itemWindow, nextIndex, type ItemGeometry, type ItemWindow } from './assetLayout';
import type { AssetView } from './assetOrder';

export interface ItemSlot {
  readonly role: 'listitem';
  readonly tabIndex: 0 | -1;
  readonly 'data-asset-index': number;
  readonly 'aria-posinset': number;
  readonly 'aria-setsize': number;
}

interface AssetItemsProps<Item extends { readonly rel: string }> {
  readonly view: AssetView;
  readonly items: readonly Item[];
  readonly label: string;
  readonly scroller: HTMLElement | undefined;
  readonly onItemKey: (item: Item, event: React.KeyboardEvent<HTMLElement>) => boolean;
  readonly renderItem: (item: Item, slot: ItemSlot) => React.ReactNode;
}

interface Layout {
  readonly geometry: ItemGeometry;
  readonly window: ItemWindow;
}

export function AssetItems<Item extends { readonly rel: string }>(props: AssetItemsProps<Item>) {
  const { view, items, scroller } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const layout = useItemLayout(view, items.length, listRef, scroller);
  const focus = useRovingFocus(items.length, { listRef, scroller }, layout);
  const { geometry, window } = layout;
  const gapPx = VIEW_METRICS[view].gapPx;
  const rowHeightPx = geometry.rowPitchPx - gapPx;
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLInputElement || items.length === 0) {
      return;
    }
    const target = nextIndex(event.key, focus.active, items.length, geometry.columnCount);
    if (target !== undefined) {
      event.preventDefault();
      focus.moveTo(target);
      return;
    }
    const item = items[focus.active];
    if (item !== undefined && props.onItemKey(item, event)) {
      event.preventDefault();
    }
  };
  const drawn = items.slice(window.itemStart, window.itemEnd);
  assert(drawn.length <= (window.rowEnd - window.rowStart) * geometry.columnCount, 'Only the window is drawn');
  return (
    <div
      ref={listRef}
      role="list"
      aria-label={props.label}
      className={`asset-items asset-items-${view}`}
      style={{ height: Math.max(0, window.rowCount * geometry.rowPitchPx - gapPx) }}
      onKeyDown={onKeyDown}
      onFocus={(event) => focus.noteFocus(event.target)}
    >
      <div
        className="asset-items-window"
        style={{
          transform: `translateY(${window.rowStart * geometry.rowPitchPx}px)`,
          gridTemplateColumns: `repeat(${geometry.columnCount}, minmax(0, 1fr))`,
          gridAutoRows: `${rowHeightPx}px`,
          gap: `${gapPx}px`,
        }}
      >
        {drawn.map((item, offset) => {
          const index = window.itemStart + offset;
          return (
            <React.Fragment key={item.rel}>
              {props.renderItem(item, {
                role: 'listitem',
                tabIndex: index === focus.active ? 0 : -1,
                'data-asset-index': index,
                'aria-posinset': index + 1,
                'aria-setsize': items.length,
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

interface Measure {
  readonly widthPx: number;
  readonly viewportTopPx: number;
  readonly viewportHeightPx: number;
}

const UNMEASURED: Measure = { widthPx: 0, viewportTopPx: 0, viewportHeightPx: 0 };

function useItemLayout(view: AssetView, itemCount: number, listRef: React.RefObject<HTMLElement>, scroller: HTMLElement | undefined): Layout {
  const compute = useCallback(
    (input: Measure): Layout => {
      const geometry = itemGeometry(view, input.widthPx);
      return { geometry, window: itemWindow({ itemCount, geometry, viewportTopPx: input.viewportTopPx, viewportHeightPx: input.viewportHeightPx }) };
    },
    [view, itemCount],
  );
  const [measure, setMeasure] = useState<Measure>(UNMEASURED);
  const layout = useMemo(() => compute(measure), [compute, measure]);
  const update = useCallback(() => {
    const list = listRef.current;
    if (list === null || scroller === undefined) {
      return;
    }
    const listTopPx = list.getBoundingClientRect().top;
    const scrollerTopPx = scroller.getBoundingClientRect().top;
    const next: Measure = { widthPx: list.clientWidth, viewportTopPx: scrollerTopPx - listTopPx, viewportHeightPx: scroller.clientHeight };
    setMeasure((previous) => (sameLayout(compute(previous), compute(next)) ? previous : next));
  }, [compute, listRef, scroller]);
  useLayoutEffect(() => {
    update();
    const list = listRef.current;
    if (scroller === undefined || list === null) {
      return undefined;
    }
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined;
    observer?.observe(scroller);
    observer?.observe(list);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [update, scroller, listRef]);
  return layout;
}

function sameLayout(left: Layout, right: Layout): boolean {
  return (
    left.geometry.columnCount === right.geometry.columnCount &&
    left.geometry.rowPitchPx === right.geometry.rowPitchPx &&
    left.window.rowStart === right.window.rowStart &&
    left.window.rowEnd === right.window.rowEnd &&
    left.window.itemEnd === right.window.itemEnd &&
    left.window.rowCount === right.window.rowCount
  );
}

function useRovingFocus(
  itemCount: number,
  { listRef, scroller }: { readonly listRef: React.RefObject<HTMLElement>; readonly scroller: HTMLElement | undefined },
  { geometry, window }: Layout,
) {
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<number | undefined>(undefined);
  const clamped = itemCount === 0 ? 0 : Math.min(active, itemCount - 1);
  useEffect(() => {
    if (pending === undefined) {
      return;
    }
    const element = listRef.current?.querySelector<HTMLElement>(`[data-asset-index="${pending}"]`);
    if (element) {
      element.focus({ preventScroll: true });
      setPending(undefined);
    }
  }, [pending, listRef, window.itemStart, window.itemEnd]);
  const moveTo = (index: number): void => {
    assert(index >= 0, 'A focus index is not negative');
    assert(index < itemCount, 'A focus index names an item');
    scrollRowIntoView(Math.floor(index / geometry.columnCount), geometry.rowPitchPx, listRef.current ?? undefined, scroller);
    setActive(index);
    setPending(index);
  };
  const noteFocus = (target: EventTarget): void => {
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const index = Number(target.closest('[data-asset-index]')?.getAttribute('data-asset-index'));
    if (Number.isSafeInteger(index) && index !== clamped) {
      setActive(index);
    }
  };
  return { active: clamped, moveTo, noteFocus };
}

function scrollRowIntoView(row: number, rowPitchPx: number, list: HTMLElement | undefined, scroller: HTMLElement | undefined): void {
  if (list === undefined || scroller === undefined) {
    return;
  }
  const listOffsetPx = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const rowTopPx = listOffsetPx + row * rowPitchPx;
  const rowBottomPx = rowTopPx + rowPitchPx;
  if (rowTopPx < scroller.scrollTop) {
    scroller.scrollTo({ top: rowTopPx });
  } else if (rowBottomPx > scroller.scrollTop + scroller.clientHeight) {
    scroller.scrollTo({ top: rowBottomPx - scroller.clientHeight });
  }
}
