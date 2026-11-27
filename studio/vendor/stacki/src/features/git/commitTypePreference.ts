import { BOUNDARY_LIMITS } from '../../../shared/core/boundary';
import { assert } from '../../../shared/core/assert';
import { parseCommitTypeName, type CommitTypeName } from './commitType';

const COMMIT_TYPES_KEY = 'stacki.git.commitTypes';

export const COMMIT_TYPE_PROJECTS_MAX = 64;
const COMMIT_TYPES_CHARS_MAX = COMMIT_TYPE_PROJECTS_MAX * (BOUNDARY_LIMITS.pathLengthMax + 32);

export type CommitTypeChoices = ReadonlyMap<string, CommitTypeName>;

export function commitTypeProjectKey(project: { readonly path: string; readonly name: string }): string {
  assert(project.path.length > 0, 'Commit type preference: a project has a path');
  return `${project.path}\n${project.name}`;
}

export function parseStoredCommitTypes(raw: unknown): CommitTypeChoices {
  const choices = new Map<string, CommitTypeName>();
  if (typeof raw !== 'string') {
    return choices;
  }
  if (raw.length > COMMIT_TYPES_CHARS_MAX) {
    return choices;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return choices;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return choices;
  }
  for (const [project, value] of Object.entries(parsed).slice(-COMMIT_TYPE_PROJECTS_MAX)) {
    const type = parseCommitTypeName(value);
    if (type !== undefined && project.length > 0 && project.length <= BOUNDARY_LIMITS.pathLengthMax * 2) {
      choices.set(project, type);
    }
  }
  assert(choices.size <= COMMIT_TYPE_PROJECTS_MAX, 'Commit type preference: the map is bounded');
  return choices;
}

export function withCommitType(choices: CommitTypeChoices, project: string, type: CommitTypeName | undefined): CommitTypeChoices {
  const next = new Map(choices);
  next.delete(project);
  if (type !== undefined) {
    next.set(project, type);
  }
  const kept = new Map([...next].slice(-COMMIT_TYPE_PROJECTS_MAX));
  assert(kept.size <= COMMIT_TYPE_PROJECTS_MAX, 'Commit type preference: the map stays bounded');
  assert(kept.get(project) === type, 'Commit type preference: the project holds the chosen type');
  return kept;
}

export function loadCommitType(project: string): CommitTypeName | undefined {
  try {
    return parseStoredCommitTypes(localStorage.getItem(COMMIT_TYPES_KEY)).get(project);
  } catch {
    return undefined;
  }
}

export function saveCommitType(project: string, type: CommitTypeName | undefined): void {
  try {
    const choices = withCommitType(parseStoredCommitTypes(localStorage.getItem(COMMIT_TYPES_KEY)), project, type);
    localStorage.setItem(COMMIT_TYPES_KEY, JSON.stringify(Object.fromEntries(choices)));
  } catch {
  }
}
