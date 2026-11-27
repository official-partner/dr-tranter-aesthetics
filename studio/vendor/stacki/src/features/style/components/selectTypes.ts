
import type { ReactNode } from 'react';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  overline?: string;
  subline?: readonly string[];
  tag?: SelectTag;
  icon?: ReactNode;
  marked?: boolean;
  heading?: boolean;
  checked?: boolean;
  indent?: boolean;
  detail?: string;
  title?: string;
  triggerPrefix?: string;
  switch?: boolean;
  header?: boolean;
  footer?: boolean;
  triggerOverline?: string;
  triggerTag?: SelectTag;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  triggerMark?: ReactNode;
  tone?: string;
  action?: { icon: ReactNode; label: string; onSelect: () => void };
};

export type SelectTag = { readonly label: string; readonly icon?: ReactNode; readonly tone?: string };

export type Props<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  labelId?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  customInput?: ReactNode;
  variant?: 'default' | 'link';
  searchable?: boolean;
  searchPlaceholder?: string;
  hideTriggerIcon?: boolean;
  onPreview?: (value: T | undefined) => void;
};
