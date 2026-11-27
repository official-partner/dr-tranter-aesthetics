import { assert } from '../../shared/core/assert';

const PROJECT_KEY_CHARS_MAX = 4096;

export interface ProjectPreferenceSpec<Value> {
  readonly storageKey: string;
  readonly projectsMax: number;
  readonly parseValue: (stored: unknown) => Value | undefined;
}

export type StoredProjectPreferences<Value> = ReadonlyArray<readonly [string, Value]>;

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function parseStoredPreferences<Value>(
  raw: unknown,
  spec: Pick<ProjectPreferenceSpec<Value>, 'parseValue' | 'projectsMax'>,
): StoredProjectPreferences<Value> {
  assert(spec.projectsMax > 0, 'A preference remembers at least one project');
  if (typeof raw !== 'string') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const stored: readonly unknown[] = parsed;
  const entries: Array<readonly [string, Value]> = [];
  for (const entry of stored.slice(0, spec.projectsMax)) {
    const pair = parsePair(entry, spec.parseValue);
    if (pair !== undefined && !entries.some(([project]) => project === pair[0])) {
      entries.push(pair);
    }
  }
  assert(entries.length <= spec.projectsMax, 'The stored list stays within its project count');
  return entries;
}

function parsePair<Value>(entry: unknown, parseValue: (stored: unknown) => Value | undefined): readonly [string, Value] | undefined {
  if (!Array.isArray(entry)) {
    return undefined;
  }
  const pair: readonly unknown[] = entry;
  if (pair.length !== 2) {
    return undefined;
  }
  const project = pair[0];
  if (typeof project !== 'string' || project.length === 0 || project.length > PROJECT_KEY_CHARS_MAX) {
    return undefined;
  }
  const value = parseValue(pair[1]);
  return value === undefined ? undefined : [project, value];
}

export function loadProjectPreference<Value>(spec: ProjectPreferenceSpec<Value>, project: string, storage?: PreferenceStorage): Value | undefined {
  try {
    return parseStoredPreferences((storage ?? localStorage).getItem(spec.storageKey), spec).find(([stored]) => stored === project)?.[1];
  } catch {
    return undefined;
  }
}

export function saveProjectPreference<Value>(spec: ProjectPreferenceSpec<Value>, project: string, value: Value, storage?: PreferenceStorage): void {
  assert(project.length > 0, 'A remembered choice belongs to a project');
  try {
    const target = storage ?? localStorage;
    const others = parseStoredPreferences(target.getItem(spec.storageKey), spec).filter(([stored]) => stored !== project);
    const first: readonly [string, Value] = [project, value];
    const next: StoredProjectPreferences<Value> = [first, ...others].slice(0, spec.projectsMax);
    target.setItem(spec.storageKey, JSON.stringify(next));
  } catch {
  }
}
