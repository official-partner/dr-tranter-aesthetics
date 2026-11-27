import { useShortcutTip } from '../../ui/shortcutTip';
import { INSPECTOR_TAB_KEYS, type InspectorTabId } from '../inspectorTabKeys';

interface InspectorTabButtonProps {
  readonly tab: InspectorTabId;
  readonly label: string;
  readonly active: boolean;
  readonly select: (tab: InspectorTabId) => void;
}

export function InspectorTabButton({ tab, label, active, select }: InspectorTabButtonProps) {
  const tip = useShortcutTip(label, INSPECTOR_TAB_KEYS[tab]);
  return (
    <>
      <button
        {...tip.props}
        type="button"
        data-right-tab={tab}
        className={active ? 'on' : ''}
        onClick={() => {
          tip.props.onMouseLeave();
          select(tab);
        }}
      >
        {label}
      </button>
      {tip.tip}
    </>
  );
}
