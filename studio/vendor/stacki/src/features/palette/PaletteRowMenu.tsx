import { useEffect, useMemo } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { MoreIcon } from '../../ui/Icons';
import Menu, { useMenuTrigger, type MenuEntry } from '../../ui/Menu';
import './roleMenu.css';

export function PaletteRowMenu(props: {
  readonly entries: (anchor: HTMLElement | undefined) => readonly MenuEntry[];
  readonly name: string;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const translate = useTranslate();
  const trigger = useMenuTrigger();
  const { entries, name } = props;
  const rows = useMemo(() => entries(trigger.anchor), [entries, trigger.anchor]);
  const label = translate('palette.roles.options', { name });
  const { open } = trigger;
  const { onOpenChange } = props;
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);
  return (
    <>
      <button
        ref={trigger.ref}
        type="button"
        className={`ghost palette-row-menu${trigger.open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={trigger.open}
        aria-label={label}
        draggable={false}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          trigger.toggle();
        }}
      >
        <MoreIcon size={14} />
      </button>
      <Menu open={trigger.open} anchor={trigger.anchor} entries={rows} label={label} onClose={trigger.close} />
    </>
  );
}
