import type { ReactNode } from 'react';
import { assert } from '../../shared/core/assert';
import MoreMenu from '../ui/MoreMenu';
import { RailMoreIcon } from './featureIcons';
import { useTranslate } from '../lib/i18n/useTranslate';

export interface RailMoreItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly shortcut: string | undefined;
  readonly select: () => void;
}

const MENU_WIDTH_PX = 200;

export function RailMore(props: { readonly items: readonly RailMoreItem[]; readonly active: string | undefined }) {
  const translate = useTranslate();
  assert(props.items.length > 0, 'The More button lists something');
  const activeInside = props.items.some((item) => item.id === props.active);
  return (
    <MoreMenu
      title={translate('rail.more')}
      side="right"
      width={MENU_WIDTH_PX}
      className={`rail-btn rail-more ${activeInside ? 'on' : ''}`}
      icon={<RailMoreIcon size={20} />}
      items={props.items.map((item) => ({
        label: item.label,
        icon: <span className="rail-more-icon">{item.icon}</span>,
        ...(item.shortcut === undefined ? {} : { shortcut: item.shortcut }),
        current: item.id === props.active,
        onSelect: item.select,
      }))}
    />
  );
}
