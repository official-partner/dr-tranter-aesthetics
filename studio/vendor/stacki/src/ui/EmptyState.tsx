import type { ReactNode } from 'react';
import './emptyState.css';

export interface EmptyStateProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly align?: 'start' | 'center';
}

export function EmptyState({ icon, title, description, action, align = 'start' }: EmptyStateProps) {
  return (
    <div className={`ui-empty-state ui-empty-state-${align}`} role="status">
      <span className="ui-empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="ui-empty-state-title">{title}</div>
      {description !== undefined && <p className="ui-empty-state-description">{description}</p>}
      {action !== undefined && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
