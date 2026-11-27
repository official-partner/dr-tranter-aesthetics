import { createPortal } from 'react-dom';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { useTranslate } from '../lib/i18n/useTranslate';
import { ariaKeyShortcuts } from '../lib/shortcutLabel';
import { tooltipAnchor, tooltipHost, useDelayedPlacement, type TooltipAnchor } from './delayedTooltip';
import FittedTooltip from './FittedTooltip';

interface ShortcutTipPlacement {
  readonly anchor: TooltipAnchor;
  readonly host: HTMLElement;
}

export interface ShortcutTipProps {
  readonly onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur: () => void;
  readonly 'aria-keyshortcuts': string | undefined;
}

function placeShortcutTip(element: HTMLElement): ShortcutTipPlacement {
  return { anchor: tooltipAnchor(element.getBoundingClientRect()), host: tooltipHost(element) };
}

export function useShortcutTip(label: string, shortcut: string | undefined): { readonly props: ShortcutTipProps; readonly tip: ReactNode } {
  const translate = useTranslate();
  const placement = useDelayedPlacement(placeShortcutTip);
  const hasShortcut = shortcut !== undefined && shortcut.length > 0;
  const props: ShortcutTipProps = {
    onMouseEnter: (event) => {
      if (hasShortcut) {
        placement.show(event.currentTarget);
      }
    },
    onMouseLeave: placement.hide,
    onFocus: (event) => {
      if (hasShortcut) {
        placement.show(event.currentTarget);
      }
    },
    onBlur: placement.hide,
    'aria-keyshortcuts': hasShortcut ? ariaKeyShortcuts(shortcut) : undefined,
  };
  const shown = placement.value;
  const tip =
    shown !== undefined && hasShortcut
      ? createPortal(
          <FittedTooltip className="shortcut-tip" role="tooltip" hidden anchor={shown.anchor}>
            {}
            {translate('ui.shortcutTip', { label, shortcut })}
          </FittedTooltip>,
          shown.host,
        )
      : undefined;
  return { props, tip };
}
