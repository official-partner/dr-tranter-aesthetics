
import { selectorsMatch, type ResolvedProp } from './model/resolved';

export type SetProp = (prop: string, value: string, important: boolean) => void;
export type ClearProp = (prop: string | string[]) => void;
export type LiveSetProp = (prop: string | readonly string[], value: string | undefined, important: boolean) => void;
export type Read = (prop: string) => ResolvedProp | undefined;
export type SelectSelector = (selector: string, prop?: string) => void;

export type Side = 'top' | 'right' | 'bottom' | 'left';

export type Display = {
  present: boolean;
  isSelected: boolean;
  value: string;
  important: boolean;
  overridden: boolean;
  winnerSelector: string;
};
export function displayOf(resolved: ResolvedProp | undefined): Display {
  if (!resolved) {
    return {
      present: false,
      isSelected: false,
      value: '',
      important: false,
      overridden: false,
      winnerSelector: '',
    };
  }
  const isSelected = resolved.source === 'selected';
  const editingSelector = resolved.contributors.find((contributor) => contributor.editing)?.selectorText;
  const wrappedFallback = resolved.contributors.find(
    (contributor) =>
      contributor.origin === 'embed' &&
      isWrappedValue(contributor.value) &&
      (contributor.isSelected || (!!editingSelector && selectorsMatch(contributor.selectorText, editingSelector))),
  );
  const source = wrappedFallback ?? (isSelected && resolved.selectedValue ? resolved.selectedValue : resolved.winner);
  return {
    present: true,
    isSelected,
    value: source.value,
    important: source.important,
    overridden: resolved.overridden,
    winnerSelector: resolved.winner.selectorText,
  };
}

export function isWrappedValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const raw = value.trim().replace(/\s*!important$/i, '');
  return /^(?!var\()[a-z-]+\(/i.test(raw);
}
