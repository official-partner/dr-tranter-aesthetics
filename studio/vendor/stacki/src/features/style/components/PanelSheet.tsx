
import type { CSSProperties, ReactNode } from 'react';
import Popup, { type PopupActions } from '../../../ui/Popup';
import { useFloatingDrag } from '../../../ui/useFloatingDrag';
import './PanelSheet.css';

export default function PanelSheet(props: {
  readonly label: string;
  readonly className: string;
  readonly style?: CSSProperties | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode | ((actions: PopupActions) => ReactNode);
}) {
  const drag = useFloatingDrag();
  return (
    <Popup
      mode="popover"
      portal={true}
      className={`panel-sheet ${props.className}`}
      style={{ ...props.style, marginLeft: drag.offset.x, marginTop: drag.offset.y }}
      role="dialog"
      label={props.label}
      onClose={props.onClose}
      onPointerDown={drag.onPointerDown}
    >
      {props.children}
    </Popup>
  );
}
