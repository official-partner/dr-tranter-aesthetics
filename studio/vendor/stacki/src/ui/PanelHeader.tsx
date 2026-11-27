import { useContext, type ReactNode } from 'react';
import { ChevronLeftIcon } from './Icons';
import { PanelBackContext } from './panelBack';
import './panelHeader.css';

export interface PanelHeaderBack {
  readonly label: string;
  readonly onBack: () => void;
}

export interface PanelHeaderProps {
  readonly title: ReactNode;
  readonly titleHint?: string | undefined;
  readonly titleClassName?: string | undefined;
  readonly back?: PanelHeaderBack | undefined;
  readonly lead?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string | undefined;
}

export function PanelHeader({ title, titleHint, titleClassName, back: ownBack, lead, actions, className }: PanelHeaderProps) {
  const inherited = useContext(PanelBackContext);
  const back = ownBack ?? inherited;
  return (
    <div className={className === undefined ? 'panel-header' : `panel-header ${className}`}>
      <div className="panel-header-lead">
        {back !== undefined && (
          <button type="button" className="ghost panel-header-back" title={back.label} aria-label={back.label} onClick={back.onBack}>
            <ChevronLeftIcon size={14} className="icon-mirror-rtl" />
          </button>
        )}
        {lead}
        <h2 className={titleClassName} title={titleHint}>
          {title}
        </h2>
      </div>
      {actions ? <div className="panel-header-actions">{actions}</div> : undefined}
    </div>
  );
}
