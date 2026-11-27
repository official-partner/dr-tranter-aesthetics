import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { RESERVED_COMPONENT_NAMES, normalizeComponentName } from '../../../shared/properties/componentNaming';
import { described, type Described } from '../../../shared/properties/i18n/messageRef';


export function toComponentName(input: unknown): string {
  return normalizeComponentName(String(input ?? ''), 'pascal').identifier;
}

export function componentNameProblem(input: unknown, taken: readonly string[] = []): Described | undefined {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return described('palette.name.empty');
  }
  const name = toComponentName(raw);
  if (!name) {
    return described('palette.name.noLetters');
  }
  if (/^[0-9]/.test(name)) {
    return described('palette.name.startsWithNumber');
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    return described('palette.name.lettersOnly');
  }
  if (RESERVED_COMPONENT_NAMES.has(name)) {
    return described('palette.name.reserved', { name });
  }
  assert(taken.length <= LIMITS.scanEntriesMax, 'Component list exceeds scan limit');
  const clash = taken.find((other) => String(other).toLowerCase() === name.toLowerCase());
  if (clash) {
    return described('palette.name.taken', { name: clash });
  }
  return undefined;
}

export function componentNameError(input: unknown, taken: readonly string[] = []): string | undefined {
  return componentNameProblem(input, taken)?.message;
}
