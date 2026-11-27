import React, { useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';
import Popup from './Popup';
import { MoreIcon } from './Icons';
import { popupBox } from './Dropdown';
import { useShortcutTip } from './shortcutTip';


export interface MenuItem {
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly shortcut?: string;
  readonly current?: boolean;
  readonly onSelect?: () => void;
}
interface MoreMenuProps {
  readonly items?: readonly (MenuItem | false | undefined)[];
  readonly title?: string;
  readonly className?: string;
  readonly width?: number;
  readonly icon?: React.ReactNode;
  readonly side?: 'below' | 'right';
}
export default function MoreMenu({ items, title = 'Options', className = '', width = 150, icon, side = 'below' }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<CSSProperties | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  assert((items?.length ?? 0) <= LIMITS.scanEntriesMax, 'MoreMenu: item limit exceeded');
  assert(width > 0, 'MoreMenu: positive menu width');
  const rows = (items || []).filter((item): item is MenuItem => Boolean(item));
  if (!rows.length) {
    return undefined;
  }

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const wantedPx = rows.length * MENU_ROW_PX + MENU_PADDING_PX;
    setBox(side === 'right' ? besideBox(rect, wantedPx) : belowBox(rect, wantedPx, width));
    setOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`more-menu-button ${className} ${open ? 'is-open' : ''}`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (open) {
            setOpen(false);
          } else {
            show();
          }
        }}
      >
        {icon ?? <MoreIcon size={13} />}
      </button>
      {box ? (
        <MenuSurface open={open} anchor={buttonRef.current ?? undefined} rows={rows} box={box} width={width} menuRef={menuRef} close={() => setOpen(false)} />
      ) : undefined}
    </>
  );
}

const MENU_ROW_PX = 30;
const MENU_PADDING_PX = 12;
const MENU_EDGE_PX = 8;

export function menuBoxBelow(rect: DOMRect, rowCount: number, width: number): CSSProperties {
  assert(rowCount > 0, 'menuBoxBelow: a menu has rows');
  return belowBox(rect, rowCount * MENU_ROW_PX + MENU_PADDING_PX, width);
}

function belowBox(rect: DOMRect, wantedPx: number, width: number): CSSProperties {
  assert(wantedPx > 0, 'MoreMenu: a menu has height');
  const left = Math.max(MENU_EDGE_PX, Math.min(rect.right - width, window.innerWidth - width - MENU_EDGE_PX));
  return { left, ...popupBox(rect, wantedPx, window.innerHeight) };
}

function besideBox(rect: DOMRect, wantedPx: number): CSSProperties {
  assert(wantedPx > 0, 'MoreMenu: a menu has height');
  const roomPx = window.innerHeight - 2 * MENU_EDGE_PX;
  const heightPx = Math.min(wantedPx, roomPx);
  const top = Math.max(MENU_EDGE_PX, Math.min(rect.bottom - heightPx, window.innerHeight - heightPx - MENU_EDGE_PX));
  return { left: rect.right + MENU_EDGE_PX, top, ...(wantedPx > roomPx ? { maxHeight: roomPx, overflowY: 'auto', scrollbarGutter: 'stable' } : {}) };
}

export interface MenuSurfaceProps {
  readonly open: boolean;
  readonly anchor: HTMLElement | undefined;
  readonly rows: readonly MenuItem[];
  readonly box: CSSProperties;
  readonly width: number;
  readonly menuRef: RefObject<HTMLDivElement>;
  readonly close: () => void;
}
export function MenuSurface({ rows, box, width, menuRef, close, open, anchor }: MenuSurfaceProps) {
  return (
    <Popup
      mode="popover"
      open={open}
      anchor={anchor}
      onClose={close}
      ref={menuRef}
      className="more-menu"
      role="menu"
      style={{ position: 'fixed', ...box, minWidth: width }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {({ finish }) => rows.map((item) => <MoreMenuRow key={item.label} item={item} close={close} finish={finish} />)}
    </Popup>
  );
}

function MoreMenuRow({ item, close, finish }: { readonly item: MenuItem; readonly close: () => void; readonly finish: (action: () => void) => void }) {
  const { props, tip } = useShortcutTip(item.label, item.shortcut);
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className={`more-menu-item ${item.danger ? 'is-danger' : ''} ${item.current ? 'is-current' : ''}`}
        aria-current={item.current ? 'true' : undefined}
        disabled={item.disabled}
        onClick={(event) => {
          event.stopPropagation();
          props.onMouseLeave();
          finish(() => {
            close();
            item.onSelect?.();
          });
        }}
        {...props}
      >
        {item.icon}
        <span className="more-menu-label">{item.label}</span>
      </button>
      {tip}
    </>
  );
}
