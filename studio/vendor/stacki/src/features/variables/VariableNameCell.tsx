import React, { useState } from 'react';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { HideIcon, PreviewIcon } from '../../ui/Icons';

export interface VariableVisibilityControl {
  readonly isHidden: (name: string) => boolean;
  readonly setHidden: (name: string, change: { readonly hidden: boolean }) => Promise<boolean>;
}

interface VariableNameCellProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

export function VariableVisibilityButton({ name, visibility }: { readonly name: string; readonly visibility: VariableVisibilityControl }) {
  const translate = useTranslate();
  const [pending, setPending] = useState<boolean | undefined>(undefined);
  const hidden = pending ?? visibility.isHidden(name);
  const label = translate(hidden ? 'variables.settings.showInSuggestions' : 'variables.settings.hideFromSuggestions');
  return (
    <button
      type="button"
      className="vars-visibility"
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      data-variable={name}
      onClick={(event) => {
        event.stopPropagation();
        const next = !hidden;
        setPending(next);
        void visibility.setHidden(name, { hidden: next }).then(() => {
          setPending((current) => (current === next ? undefined : current));
        });
      }}
    >
      {hidden ? <HideIcon size={12} /> : <PreviewIcon size={12} />}
    </button>
  );
}

export default function VariableNameCell({ title, children }: VariableNameCellProps) {
  return (
    <div className="vars-name" title={title}>
      {children}
    </div>
  );
}
