import { assert } from '../../shared/core/assert';
import type { BuiltinChipId } from '../../shared/properties/ai/mentions';

const providers = new Map<BuiltinChipId, () => string>();

export function provideBuiltinInstructions(id: BuiltinChipId, text: () => string): void {
  providers.set(id, text);
}

export function builtinInstructionsText(id: BuiltinChipId): string {
  const provider = providers.get(id);
  assert(provider !== undefined, `builtinInstructionsText: nothing provides the "${id}" instructions`);
  return provider();
}
