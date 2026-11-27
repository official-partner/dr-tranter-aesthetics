import './switch.css';

export interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly mixed?: boolean;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly onToggle: () => void;
}

export function Switch(props: SwitchProps) {
  return (
    <button
      type="button"
      className="ui-switch"
      role="switch"
      aria-label={props.label}
      aria-checked={props.mixed === true ? 'mixed' : props.checked}
      aria-describedby={props.describedBy}
      disabled={props.disabled ?? false}
      onClick={props.onToggle}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  );
}

export function SwitchRow(props: SwitchProps) {
  return (
    <label className="ui-switch-row">
      <span className="ui-switch-row-label">{props.label}</span>
      <Switch {...props} />
    </label>
  );
}
