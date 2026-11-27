import { CloseIcon, SearchIcon } from './Icons';
import './searchField.css';

export function SearchField({
  label,
  value,
  placeholder,
  className,
  clearLabel,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly className?: string;
  readonly clearLabel?: string;
  readonly onChange: (value: string) => void;
}) {
  const clearable = clearLabel !== undefined;
  const classes = ['ui-search', clearable ? 'clearable' : '', className ?? ''].filter((name) => name !== '').join(' ');
  return (
    <label className={classes}>
      <SearchIcon size={14} className="ui-search-icon" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (clearable && event.key === 'Escape' && value.length > 0) {
            event.stopPropagation();
            onChange('');
          }
        }}
      />
      {clearable && value.length > 0 && (
        <button
          type="button"
          className="ghost ui-search-clear"
          aria-label={clearLabel}
          onClick={(event) => {
            event.preventDefault();
            event.currentTarget.parentElement?.querySelector('input')?.focus();
            onChange('');
          }}
        >
          <CloseIcon size={12} />
        </button>
      )}
    </label>
  );
}
