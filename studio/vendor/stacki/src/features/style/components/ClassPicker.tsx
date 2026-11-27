import { useTranslate } from '../../../lib/i18n/useTranslate';
import './ClassPicker.css';

export type ClassTokenKind = 'tag' | 'class' | 'attribute';

export type ClassToken = {
  name: string;
  label?: string;
  kind?: ClassTokenKind;
};

export type ClassPickerProps = {
  tokens: ClassToken[];
  selected: string[];
  onChange: (selected: string[]) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  tagTitle?: (token: ClassToken, isActive: boolean) => string;
};

export function ClassPicker({ tokens, selected, onChange, ariaLabel, className, disabled = false, tagTitle }: ClassPickerProps) {
  const translate = useTranslate();
  const order = tokens.map((token) => token.name);

  const selectToken = (name: string, options: { readonly additive: boolean }) => {
    const next = options.additive
      ? selected.includes(name)
        ?
          selected.length > 1
          ? selected.filter((entry) => entry !== name)
          : selected
        : [...selected, name]
      : [name];
    const ordered = [...next].sort((left, right) => order.indexOf(left) - order.indexOf(right));
    if (ordered.length === selected.length && ordered.every((entry, index) => entry === selected[index])) {
      return;
    }
    onChange(ordered);
  };

  if (!tokens.length) {
    return undefined;
  }

  return (
    <div
      className={`class-picker${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={ariaLabel ?? translate('styleModel.components.classPicker.tokens')}
    >
      {tokens.map((token) => {
        const isActive = selected.includes(token.name);
        const kind = token.kind ?? 'class';
        return (
          <button
            key={`${kind}:${token.name}`}
            type="button"
            className={`class-picker_tag is-${kind}${isActive ? ' is-active' : ''}`}
            aria-pressed={isActive}
            disabled={disabled}
            title={tagTitle ? tagTitle(token, isActive) : translate('styleModel.components.classPicker.combine', { name: token.label ?? token.name })}
            onClick={(event) => selectToken(token.name, { additive: event.shiftKey || event.altKey })}
          >
            {token.label ?? token.name}
          </button>
        );
      })}
    </div>
  );
}

export default ClassPicker;
