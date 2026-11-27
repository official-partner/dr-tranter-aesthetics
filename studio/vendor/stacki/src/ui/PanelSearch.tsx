import React from 'react';
import { CloseIcon } from './Icons';
import TipAnchor from './TipAnchor';
import './panelSearch.css';

export interface PanelSearchProps {
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly clearLabel?: string;
}

export function PanelSearch({ value, placeholder, onChange, hint, clearLabel }: PanelSearchProps) {
  const clearable = clearLabel !== undefined && value.length > 0;
  return (
    <div className={clearable ? 'panel-search clearable' : 'panel-search'} style={{ padding: '0 12px 8px' }}>
      <TipAnchor text={hint}>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && value.length > 0) {
              event.stopPropagation();
              onChange('');
            }
          }}
        />
      </TipAnchor>
      {clearable && (
        <button
          type="button"
          className="ghost panel-search-clear"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={(event) => {
            event.currentTarget.parentElement?.querySelector('input')?.focus();
            onChange('');
          }}
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}
