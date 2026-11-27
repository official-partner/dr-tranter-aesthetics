import { assert } from '../core/assert';
import { err, ok, type AppError, type Result } from '../core/result';

export const VARIABLE_VISIBILITY_FILE = '.stacki/variables.json';

export const VARIABLE_VISIBILITY_LIMITS = {
  hiddenMax: 5_000,
  nameCharsMax: 128,
} as const satisfies Record<string, number>;

export interface VariableVisibility {
  readonly version: 1;
  readonly hiddenFromSuggestions: readonly string[];
}

export const EMPTY_VARIABLE_VISIBILITY: VariableVisibility = { version: 1, hiddenFromSuggestions: [] };

const CUSTOM_PROPERTY_NAME = /^--[^\s"'`;:{}()<>\\/,]+$/;

export function isVariableName(name: string): boolean {
  if (name.length > VARIABLE_VISIBILITY_LIMITS.nameCharsMax) {
    return false;
  }
  return CUSTOM_PROPERTY_NAME.test(name);
}

export function parseVariableVisibilitySource(source: string | undefined): Result<VariableVisibility> {
  if (source === undefined) {
    return ok(EMPTY_VARIABLE_VISIBILITY);
  }
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error: unknown) {
    return failure('unreadable', `not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  return parseVariableVisibility(input);
}

export function parseVariableVisibility(input: unknown): Result<VariableVisibility> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return failure('shape', 'expected an object');
  }
  const fields = new Map<string, unknown>(Object.entries(input));
  if (fields.get('version') !== 1) {
    return failure('version', 'unsupported version, expected 1');
  }
  const hidden = fields.get('hiddenFromSuggestions');
  if (!Array.isArray(hidden)) {
    return failure('shape', 'hiddenFromSuggestions must be an array');
  }
  if (hidden.length > VARIABLE_VISIBILITY_LIMITS.hiddenMax) {
    return failure('limit', `more than ${VARIABLE_VISIBILITY_LIMITS.hiddenMax} hidden variables`);
  }
  const names = new Set<string>();
  for (const entry of hidden) {
    if (typeof entry !== 'string') {
      return failure('shape', 'every hidden name must be a string');
    }
    if (entry.length > VARIABLE_VISIBILITY_LIMITS.nameCharsMax) {
      return failure('limit', `a name is longer than ${VARIABLE_VISIBILITY_LIMITS.nameCharsMax} characters`);
    }
    if (!isVariableName(entry)) {
      return failure('name', `"${entry}" is not a custom property name starting with --`);
    }
    if (names.has(entry)) {
      return failure('duplicate', `"${entry}" is listed twice`);
    }
    names.add(entry);
  }
  return ok({ version: 1, hiddenFromSuggestions: sortedNames(names) });
}

export function serializeVariableVisibility(value: VariableVisibility): string {
  assert(value.version === 1, 'serializeVariableVisibility: version 1');
  assert(value.hiddenFromSuggestions.length <= VARIABLE_VISIBILITY_LIMITS.hiddenMax, 'serializeVariableVisibility: within the count bound');
  const names = sortedNames(new Set(value.hiddenFromSuggestions));
  for (const name of names) {
    assert(isVariableName(name), 'serializeVariableVisibility: every name is a custom property name');
  }
  return JSON.stringify({ version: 1, hiddenFromSuggestions: names }, undefined, 2) + '\n';
}

export function withHidden(value: VariableVisibility, name: string): Result<VariableVisibility> {
  return changed(value, name, { hide: true });
}

export function withShown(value: VariableVisibility, name: string): Result<VariableVisibility> {
  return changed(value, name, { hide: false });
}

function changed(value: VariableVisibility, name: string, change: { readonly hide: boolean }): Result<VariableVisibility> {
  if (!isVariableName(name)) {
    return failure('name', `"${name}" is not a custom property name starting with --`);
  }
  const names = new Set(value.hiddenFromSuggestions);
  if (change.hide) {
    names.add(name);
  } else {
    names.delete(name);
  }
  if (names.size > VARIABLE_VISIBILITY_LIMITS.hiddenMax) {
    return failure('limit', `more than ${VARIABLE_VISIBILITY_LIMITS.hiddenMax} hidden variables`);
  }
  const next: VariableVisibility = { version: 1, hiddenFromSuggestions: sortedNames(names) };
  assert(next.hiddenFromSuggestions.includes(name) === change.hide, 'changed: the name is hidden exactly when asked');
  return ok(next);
}

export function hiddenNameSet(value: VariableVisibility): ReadonlySet<string> {
  return new Set(value.hiddenFromSuggestions);
}

export function isHiddenFromSuggestions(hidden: ReadonlySet<string>, name: string): boolean {
  return hidden.has(name);
}

export function suggestionNames(candidates: readonly string[], hidden: ReadonlySet<string>, applied: string | undefined): readonly string[] {
  return candidates.filter((name) => name === applied || !hidden.has(name));
}

function sortedNames(names: ReadonlySet<string>): readonly string[] {
  return [...names].sort((first, second) => (first < second ? -1 : first > second ? 1 : 0));
}

function failure(code: string, detail: string): Result<never, AppError> {
  return err({ code: `variables-visibility-${code}`, message: `.stacki/variables.json: ${detail}` });
}
