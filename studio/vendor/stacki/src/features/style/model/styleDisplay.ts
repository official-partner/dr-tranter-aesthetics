
import type { ResolvedProp } from './resolved';
import { assert } from '../../../../shared/core/assert';

export type Display = {
  present: boolean;
  isSelected: boolean;
  overridden: boolean;
  winnerSelector: string;
  value: string;
  important: boolean;
};

export function displayOf(resolved: ResolvedProp | undefined): Display {
  if (!resolved) {
    return {
      present: false,
      isSelected: false,
      overridden: false,
      winnerSelector: '',
      value: '',
      important: false,
    };
  }
  const isSelected = resolved.source === 'selected';
  const source = isSelected && resolved.selectedValue ? resolved.selectedValue : resolved.winner;
  return {
    present: true,
    isSelected,
    overridden: resolved.overridden,
    winnerSelector: resolved.winner.selectorText,
    value: source.value,
    important: source.important,
  };
}

export function parseImportant(input: string): { value: string; important: boolean } {
  const match = input.match(/!\s*important\s*$/i);
  if (match) {
    return { value: input.slice(0, match.index).trim(), important: true };
  }
  return { value: input.trim(), important: false };
}


export const IMPORTANT_SUFFIX = ' !important';

export function withImportant(parsed: { readonly value: string; readonly important: boolean }): string {
  if (!parsed.important) {
    return parsed.value;
  }
  const text = `${parsed.value}${IMPORTANT_SUFFIX}`;
  assert(parseImportant(text).important, 'withImportant: the joined text reads back as important');
  return text;
}

export function displayText(display: Pick<Display, 'present' | 'value' | 'important'>): string {
  if (display.present) {
    return withImportant(display);
  }
  assert(!display.important, 'displayText: an absent property is not important');
  return '';
}

export function keepImportant(next: string, current: Pick<Display, 'important'>): { value: string; important: boolean } {
  const parsed = parseImportant(next);
  const important = parsed.important || current.important;
  assert(!/!\s*important\s*$/i.test(parsed.value), 'keepImportant: the value no longer carries the flag');
  return { value: parsed.value, important };
}
