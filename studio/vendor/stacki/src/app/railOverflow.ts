import { useLayoutEffect, useState, type RefObject } from 'react';
import { assert } from '../../shared/core/assert';
import { ROLE_LIMITS } from '../../shared/properties/projectRoles';

export interface RailOverflowItem {
  readonly id: string;
  readonly group: 'panel' | 'app';
}

export interface RailRoom {
  readonly availablePx: number;
  readonly itemPx: number;
  readonly separatorPx: number;
}

export interface RailLayout {
  readonly visible: readonly string[];
  readonly hidden: readonly string[];
}

const RAIL_ITEMS_MAX = 32 + ROLE_LIMITS.pinnedAppsMax;

const RAIL_BUTTON_PX = 32;
const RAIL_GAP_PX = 4;
const RAIL_SEPARATOR_PX = 5;

export function railOverflow(items: readonly RailOverflowItem[], room: RailRoom, active: string | undefined): RailLayout {
  assert(items.length <= RAIL_ITEMS_MAX, 'The rail lays out a bounded number of rows');
  assert(room.itemPx > 0, 'A rail row has height');
  assert(new Set(items.map((item) => item.id)).size === items.length, 'Rail ids are unique');
  if (fits(items, room, 'without-more')) {
    return { visible: items.map((item) => item.id), hidden: [] };
  }
  const order = leavingOrder(items);
  assert(order.length === items.length, 'Every item has a place in the leaving order');
  for (let count = 1; count <= items.length; count += 1) {
    const leaving = new Set(leavers(order, count, active));
    const staying = items.filter((item) => !leaving.has(item.id));
    if (fits(staying, room, 'with-more')) {
      return layoutOf(items, leaving);
    }
  }
  return layoutOf(items, new Set(items.map((item) => item.id)));
}

export function useRailOverflow(
  rail: RefObject<HTMLElement>,
  anchored: RefObject<HTMLElement> | undefined,
  items: readonly RailOverflowItem[],
  active: string | undefined,
): RailLayout {
  const [room, setRoom] = useState<RailRoom | undefined>(undefined);
  useLayoutEffect(() => {
    const element = rail.current ?? undefined;
    if (element === undefined || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const update = () => {
      const next = measureRail(element, anchored?.current ?? undefined);
      setRoom((previous) => (previous !== undefined && next !== undefined && sameRoom(previous, next) ? previous : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const anchoredElement = anchored?.current ?? undefined;
    if (anchoredElement !== undefined) {
      observer.observe(anchoredElement);
    }
    return () => observer.disconnect();
  }, [rail, anchored]);
  if (room === undefined) {
    return { visible: items.map((item) => item.id), hidden: [] };
  }
  return railOverflow(items, room, active);
}

export function measureRail(rail: HTMLElement, anchored: HTMLElement | undefined): RailRoom | undefined {
  const heightPx = rail.clientHeight;
  if (heightPx <= 0) {
    return undefined;
  }
  const style = window.getComputedStyle(rail);
  const gapPx = pixels(style.rowGap, RAIL_GAP_PX);
  const paddingPx = pixels(style.paddingTop, 0) + pixels(style.paddingBottom, 0);
  const button = rail.querySelector<HTMLElement>('.rail-btn') ?? undefined;
  const buttonPx = button === undefined || button.offsetHeight <= 0 ? RAIL_BUTTON_PX : button.offsetHeight;
  const anchoredPx = anchored === undefined ? 0 : (anchored.offsetHeight > 0 ? anchored.offsetHeight : RAIL_BUTTON_PX) + gapPx;
  const room = { availablePx: heightPx - paddingPx - anchoredPx + gapPx, itemPx: buttonPx + gapPx, separatorPx: RAIL_SEPARATOR_PX + gapPx };
  assert(room.itemPx > 0, 'A measured rail row has height');
  return room;
}

function pixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sameRoom(left: RailRoom, right: RailRoom): boolean {
  return left.availablePx === right.availablePx && left.itemPx === right.itemPx && left.separatorPx === right.separatorPx;
}

function fits(items: readonly RailOverflowItem[], room: RailRoom, more: 'with-more' | 'without-more'): boolean {
  const panels = items.some((item) => item.group === 'panel');
  const apps = items.some((item) => item.group === 'app');
  const separatorPx = panels && apps ? room.separatorPx : 0;
  const morePx = more === 'with-more' ? room.itemPx : 0;
  return items.length * room.itemPx + separatorPx + morePx <= room.availablePx;
}

function leavingOrder(items: readonly RailOverflowItem[]): readonly string[] {
  const apps = items.filter((item) => item.group === 'app').map((item) => item.id);
  const panels = items.filter((item) => item.group === 'panel').map((item) => item.id);
  return [...apps.reverse(), ...panels.reverse()];
}

function leavers(order: readonly string[], count: number, active: string | undefined): readonly string[] {
  assert(count > 0, 'Some item leaves');
  assert(count <= order.length, 'No more items leave than there are');
  if (active === undefined || !order.includes(active) || count === order.length) {
    return order.slice(0, count);
  }
  const others = order.filter((id) => id !== active);
  const chosen = others.slice(0, count);
  assert(!chosen.includes(active), 'The active item stays while another can leave');
  return chosen;
}

function layoutOf(items: readonly RailOverflowItem[], leaving: ReadonlySet<string>): RailLayout {
  const visible = items.filter((item) => !leaving.has(item.id)).map((item) => item.id);
  const hidden = items.filter((item) => leaving.has(item.id)).map((item) => item.id);
  assert(visible.length + hidden.length === items.length, 'Every item is either shown or in the menu');
  return { visible, hidden };
}
