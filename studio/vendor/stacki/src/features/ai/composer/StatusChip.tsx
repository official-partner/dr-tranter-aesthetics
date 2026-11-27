import type { ReactNode, RefCallback } from 'react';

export function StatusChip({
  buttonRef,
  open,
  disabled,
  tone,
  ariaLabel,
  title,
  onClick,
  children,
}: {
  readonly buttonRef: RefCallback<HTMLElement>;
  readonly open: boolean;
  readonly disabled: boolean;
  readonly tone: 'plain' | 'danger';
  readonly ariaLabel: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  const classes = ['ai-chip'];
  if (open) {
    classes.push('is-open');
  }
  if (tone === 'danger') {
    classes.push('is-danger');
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      className={classes.join(' ')}
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={open}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
