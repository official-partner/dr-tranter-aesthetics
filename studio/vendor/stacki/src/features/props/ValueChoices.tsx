
import type { ReactNode } from 'react';
import { assert } from '../../../shared/core/assert';
import SegmentedControl from '../../ui/SegmentedControl';
import type { SegmentedOption } from '../../ui/SegmentedControl';
import './valueChoices.css';

export interface ValueChoice {
  readonly value: string;
  readonly label: string;
  readonly icon: ReactNode;
}

const CHOICES_MAX = 5;

export function ValueChoiceSwitch(props: {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly ValueChoice[];
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  readonly onChange: (value: string) => void;
}) {
  assert(props.choices.length > 0, 'ValueChoiceSwitch: there is something to choose');
  assert(props.choices.length <= CHOICES_MAX, 'ValueChoiceSwitch: the choices fit one row');
  const options: readonly SegmentedOption<string>[] = props.choices.map((choice) => ({
    value: choice.value,
    label: choice.icon,
    ariaLabel: choice.label,
    tooltip: choice.label,
  }));
  return (
    <SegmentedControl
      ariaLabel={props.label}
      className={['value-choices', props.className].filter((name) => name !== undefined).join(' ')}
      options={options}
      widthMode="hug"
      value={props.value}
      disabled={props.disabled === true}
      onChange={props.onChange}
    />
  );
}
