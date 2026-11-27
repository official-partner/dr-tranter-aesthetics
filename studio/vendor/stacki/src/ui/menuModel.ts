import type { ReactNode } from 'react';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

export interface MenuItem {
  readonly kind: 'item';
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly shortcut?: string;
  readonly numberKey?: number;
  readonly accelerator?: string;
  readonly checked?: boolean;
  readonly pill?: string;
  readonly info?: string;
  readonly tooltip?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly keepOpen?: boolean;
  readonly onSelect: () => void;
}

export interface MenuSubmenu {
  readonly kind: 'submenu';
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly value?: string;
  readonly disabled?: boolean;
  readonly entries: readonly MenuEntry[];
}

export interface MenuToggle {
  readonly kind: 'toggle';
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly info?: string;
  readonly on: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}

export interface MenuHeading {
  readonly kind: 'heading';
  readonly id: string;
  readonly label: string;
}

export interface MenuNote {
  readonly kind: 'note';
  readonly id: string;
  readonly text: string;
}

export interface MenuDivider {
  readonly kind: 'divider';
  readonly id: string;
}

export type MenuEntry = MenuItem | MenuSubmenu | MenuToggle | MenuHeading | MenuNote | MenuDivider;
export type MenuRow = MenuItem | MenuSubmenu | MenuToggle;

export type MenuPlacement = 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'right-start';

export function isMenuRow(entry: MenuEntry): entry is MenuRow {
  return entry.kind === 'item' || entry.kind === 'submenu' || entry.kind === 'toggle';
}

export function isNavigable(entry: MenuEntry): boolean {
  return isMenuRow(entry) && entry.disabled !== true;
}

export function assertMenuEntries(entries: readonly MenuEntry[]): void {
  assert(entries.length <= LIMITS.scanEntriesMax, 'Menu: entry limit exceeded');
  const ids = new Set<string>();
  for (const entry of entries) {
    assert(entry.id.length > 0, 'Menu: every entry has an id');
    assert(!ids.has(entry.id), `Menu: duplicate entry id ${entry.id}`);
    ids.add(entry.id);
    if (entry.kind === 'item') {
      assert(entry.numberKey === undefined || (Number.isInteger(entry.numberKey) && entry.numberKey >= 1 && entry.numberKey <= 9), 'Menu: numberKey is 1 to 9');
      assert(entry.accelerator === undefined || entry.accelerator.length === 1, 'Menu: accelerator is one character');
    }
  }
}

export function initialIndex(entries: readonly MenuEntry[]): number | undefined {
  let first: number | undefined;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || !isNavigable(entry)) {
      continue;
    }
    if (entry.kind === 'item' && entry.checked === true) {
      return index;
    }
    if (first === undefined) {
      first = index;
    }
  }
  return first;
}

export function stepIndex(entries: readonly MenuEntry[], from: number | undefined, delta: 1 | -1): number | undefined {
  assert(from === undefined || (Number.isInteger(from) && from >= 0 && from < entries.length), 'stepIndex: from is inside the entries');
  const count = entries.length;
  if (count === 0) {
    return undefined;
  }
  const origin = from ?? (delta === 1 ? -1 : 0);
  for (let taken = 1; taken <= count; taken += 1) {
    const index = (((origin + delta * taken) % count) + count) % count;
    const entry = entries[index];
    if (entry !== undefined && isNavigable(entry)) {
      return index;
    }
  }
  return undefined;
}

function edgeIndex(entries: readonly MenuEntry[], side: 'first' | 'last'): number | undefined {
  if (side === 'first') {
    return stepIndex(entries, undefined, 1);
  }
  return stepIndex(entries, undefined, -1);
}

export function indexOfNumberKey(entries: readonly MenuEntry[], digit: number): number | undefined {
  const index = entries.findIndex((entry) => entry.kind === 'item' && entry.numberKey === digit && entry.disabled !== true);
  return index < 0 ? undefined : index;
}

export function indexOfAccelerator(entries: readonly MenuEntry[], key: string): number | undefined {
  const wanted = key.toLowerCase();
  const index = entries.findIndex((entry) => entry.kind === 'item' && entry.accelerator?.toLowerCase() === wanted && entry.disabled !== true);
  return index < 0 ? undefined : index;
}

export interface KeyModifiers {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export type MenuKeyDecision =
  | { readonly kind: 'focus'; readonly index: number }
  | { readonly kind: 'choose'; readonly index: number }
  | { readonly kind: 'open-submenu'; readonly index: number }
  | { readonly kind: 'close-submenu' }
  | { readonly kind: 'close' }
  | { readonly kind: 'ignore' };

export function decideKey(entries: readonly MenuEntry[], focused: number | undefined, key: string, modifiers: KeyModifiers): MenuKeyDecision {
  assert(focused === undefined || (focused >= 0 && focused < entries.length), 'decideKey: focused is inside the entries');
  if (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey) {
    return { kind: 'ignore' };
  }
  const focusedEntry = focused === undefined ? undefined : entries[focused];
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const index = stepIndex(entries, focused, key === 'ArrowDown' ? 1 : -1);
      return index === undefined ? { kind: 'ignore' } : { kind: 'focus', index };
    }
    case 'Home':
    case 'End': {
      const index = edgeIndex(entries, key === 'Home' ? 'first' : 'last');
      return index === undefined ? { kind: 'ignore' } : { kind: 'focus', index };
    }
    case 'ArrowRight': {
      if (focused !== undefined && focusedEntry?.kind === 'submenu' && focusedEntry.disabled !== true) {
        return { kind: 'open-submenu', index: focused };
      }
      return { kind: 'ignore' };
    }
    case 'ArrowLeft':
      return { kind: 'close-submenu' };
    case 'Enter':
    case ' ': {
      if (focused === undefined || focusedEntry === undefined || !isNavigable(focusedEntry)) {
        return { kind: 'ignore' };
      }
      return focusedEntry.kind === 'submenu' ? { kind: 'open-submenu', index: focused } : { kind: 'choose', index: focused };
    }
    case 'Tab':
      return { kind: 'close' };
    default:
      return decideShortcut(entries, key);
  }
}

function decideShortcut(entries: readonly MenuEntry[], key: string): MenuKeyDecision {
  if (key.length !== 1) {
    return { kind: 'ignore' };
  }
  if (key >= '1' && key <= '9') {
    const index = indexOfNumberKey(entries, Number(key));
    return index === undefined ? { kind: 'ignore' } : { kind: 'choose', index };
  }
  const index = indexOfAccelerator(entries, key);
  return index === undefined ? { kind: 'ignore' } : { kind: 'choose', index };
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}
export interface MenuPosition {
  readonly left: number;
  readonly top: number;
  readonly heightMax: number | undefined;
}

export const MENU_GAP_PX = 6;
export const MENU_EDGE_PX = 8;
const SUBMENU_OVERLAP_PX = 4;
const SUBMENU_TOP_OFFSET_PX = 6;

export function placeMenu(anchor: Box, size: Size, viewport: Size, placement: MenuPlacement): MenuPosition {
  assert(size.width > 0, 'placeMenu: the menu has width');
  assert(size.height > 0, 'placeMenu: the menu has height');
  assert(viewport.width > 0, 'placeMenu: the window has width');
  assert(viewport.height > 0, 'placeMenu: the window has height');
  const roomHeight = viewport.height - 2 * MENU_EDGE_PX;
  const height = Math.min(size.height, roomHeight);
  const heightMax = size.height > roomHeight ? roomHeight : undefined;
  const clampLeft = (left: number): number => Math.max(MENU_EDGE_PX, Math.min(left, viewport.width - size.width - MENU_EDGE_PX));
  const clampTop = (top: number): number => Math.max(MENU_EDGE_PX, Math.min(top, viewport.height - height - MENU_EDGE_PX));
  if (placement === 'right-start') {
    const spaceRight = viewport.width - (anchor.left + anchor.width) - MENU_EDGE_PX;
    const spaceLeft = anchor.left - MENU_EDGE_PX;
    const fitsRight = size.width <= spaceRight + SUBMENU_OVERLAP_PX;
    const left = fitsRight || spaceRight >= spaceLeft ? anchor.left + anchor.width - SUBMENU_OVERLAP_PX : anchor.left - size.width + SUBMENU_OVERLAP_PX;
    return { left: clampLeft(left), top: clampTop(anchor.top - SUBMENU_TOP_OFFSET_PX), heightMax };
  }
  const alignEnd = placement === 'below-end' || placement === 'above-end';
  const left = clampLeft(alignEnd ? anchor.left + anchor.width - size.width : anchor.left);
  const spaceBelow = viewport.height - (anchor.top + anchor.height) - MENU_GAP_PX - MENU_EDGE_PX;
  const spaceAbove = anchor.top - MENU_GAP_PX - MENU_EDGE_PX;
  const wantsAbove = placement === 'above-start' || placement === 'above-end';
  const fitsPreferred = wantsAbove ? height <= spaceAbove : height <= spaceBelow;
  const above = fitsPreferred ? wantsAbove : spaceAbove > spaceBelow;
  const top = above ? anchor.top - MENU_GAP_PX - height : anchor.top + anchor.height + MENU_GAP_PX;
  return { left, top: clampTop(top), heightMax };
}

export interface InfoTipPlacement {
  readonly side: 'left' | 'right';
  readonly left: number;
  readonly top: number;
}

const INFO_TIP_GAP_PX = 10;
const INFO_TIP_WIDTH_PX_MAX = 240;
const INFO_TIP_MARGIN_PX = 8;

export function placeInfoTip(
  menu: { readonly left: number; readonly right: number },
  mark: { readonly top: number; readonly height: number },
  viewportWidth: number,
): InfoTipPlacement {
  assert(menu.right >= menu.left, 'placeInfoTip: a menu has a width');
  assert(viewportWidth > 0, 'placeInfoTip: a window has a width');
  const top = mark.top + mark.height / 2;
  if (menu.right + INFO_TIP_GAP_PX + INFO_TIP_WIDTH_PX_MAX + INFO_TIP_MARGIN_PX <= viewportWidth) {
    return { side: 'right', left: menu.right + INFO_TIP_GAP_PX, top };
  }
  return { side: 'left', left: menu.left - INFO_TIP_GAP_PX, top };
}
