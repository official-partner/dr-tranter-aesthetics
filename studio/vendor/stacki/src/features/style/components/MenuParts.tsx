import { centralIcon } from '../../../ui/central/CentralIcon';
import { add as centralAdd, chevronDown as centralChevronDown } from '../../../ui/central/centralGeometry';

import { useEffect } from 'react';
import type { CSSProperties, RefObject } from 'react';

export const ChevronIcon = centralIcon(centralChevronDown);

export const PlusIcon = centralIcon(centralAdd);

export function MenuItem({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={`embed-editor_display-menu-item ${selected ? 'is-selected' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function useMenuDismiss({ open, rootRef, setOpen }: { open: boolean; rootRef: RefObject<HTMLDivElement>; setOpen: (open: boolean) => void }): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, rootRef, setOpen]);
}

export function tooltipArrowStyle(arrowRight: number): CSSProperties & { readonly '--tip-arrow-right': string } {
  return { '--tip-arrow-right': `${arrowRight}px` };
}
