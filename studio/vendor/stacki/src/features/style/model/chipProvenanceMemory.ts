
import { assert } from '../../../../shared/core/assert';

export const PROVENANCE_SCOPES_MAX = 64;

export const PROVENANCE_CHIPS_MAX = 256;

const green = new Map<string, Set<string>>();

export function rememberedGreenChips(scope: string): ReadonlySet<string> | undefined {
  assert(scope.length > 0, 'rememberedGreenChips: a scope is never empty');
  return green.get(scope);
}

export function rememberChipProvenance(scope: string, answer: { readonly greenKeys: readonly string[]; readonly plainKeys: readonly string[] }): void {
  assert(scope.length > 0, 'rememberChipProvenance: a scope is never empty');
  const held = green.get(scope) ?? new Set<string>();
  for (const key of answer.plainKeys) {
    held.delete(key);
  }
  for (const key of answer.greenKeys) {
    if (held.size < PROVENANCE_CHIPS_MAX) {
      held.add(key);
    }
  }
  green.delete(scope);
  green.set(scope, held);
  if (green.size > PROVENANCE_SCOPES_MAX) {
    const oldest = green.keys().next().value;
    if (oldest !== undefined) {
      green.delete(oldest);
    }
  }
  assert(green.size <= PROVENANCE_SCOPES_MAX, 'rememberChipProvenance: bounded by PROVENANCE_SCOPES_MAX');
  assert(held.size <= PROVENANCE_CHIPS_MAX, 'rememberChipProvenance: bounded by PROVENANCE_CHIPS_MAX');
}

export function forgetChipProvenance(): void {
  green.clear();
}
