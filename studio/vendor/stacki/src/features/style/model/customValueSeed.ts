
import { assert } from '../../../../shared/core/assert';

export type CustomValueSeedSource = 'own' | 'declared' | 'none';

export interface CustomValueSeed {
  readonly text: string;
  readonly source: CustomValueSeedSource;
}

export function customValueSeed(input: { readonly own: string; readonly declared: string }): CustomValueSeed {
  if (input.own.trim().length > 0) {
    return { text: input.own, source: 'own' };
  }
  const declared = input.declared.trim();
  if (declared.length > 0) {
    const seed: CustomValueSeed = { text: declared, source: 'declared' };
    assert(seed.text.length > 0, 'customValueSeed: a declared seed is never empty');
    return seed;
  }
  return { text: '', source: 'none' };
}

export function customValueWrites(seed: CustomValueSeed, fieldValue: string, next: string): boolean {
  if (next === fieldValue) {
    return false;
  }
  if (seed.source === 'declared') {
    assert(seed.text.length > 0, 'customValueWrites: a declared seed carries its text');
    if (next.trim() === seed.text) {
      return false;
    }
  }
  return true;
}
