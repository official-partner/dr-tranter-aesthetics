import {
  RESERVED_COMPONENT_NAMES,
  identifierOfFileName,
  normalizeComponentName,
  normalizeFolderPath,
  parseTypedFolderPath,
  type FolderPathProblem,
  type NamingStyle,
} from '../../../shared/properties/componentNaming';
import { assert } from '../../../shared/core/assert';
import { described, type Described } from '../../../shared/properties/i18n/messageRef';

export interface RenameCandidate {
  readonly file: string;
  readonly name: string;
}

export type NameChange = 'spaces' | 'other' | undefined;

export type RenameAvailability =
  | { readonly kind: 'same' }
  | { readonly kind: 'invalid'; readonly problem: Described; readonly path: string | undefined }
  | { readonly kind: 'taken'; readonly by: string; readonly path: string }
  | { readonly kind: 'available'; readonly path: string; readonly fileName: string; readonly change: NameChange; readonly sameNameIn: string | undefined };

export interface RenameInput {
  readonly current: string;
  readonly name: string;
  readonly folder: string;
  readonly style: NamingStyle;
  readonly components: readonly RenameCandidate[];
}

export function renameAvailability(input: RenameInput): RenameAvailability {
  const typed = input.name.trim();
  const invalid = (problem: Described, fileName?: string): RenameAvailability => ({
    kind: 'invalid',
    problem,
    path: fileName === undefined || fileName === '' ? undefined : `${input.folder}/${fileName}.astro`,
  });
  if (typed === '') {
    return invalid(described('palette.name.empty'));
  }
  if (typed.includes('/') || typed.includes('\\')) {
    return invalid(described('palette.rename.separator'));
  }
  if (/\.astro$/i.test(typed)) {
    return invalid(described('palette.rename.extension'));
  }
  const normalized = normalizeComponentName(typed, input.style);
  const stray = normalized.rejected[0];
  if (stray !== undefined) {
    return invalid(described('palette.rename.badCharacter', { character: stray }), normalized.fileName);
  }
  if (normalized.fileName === '') {
    return invalid(described('palette.name.noLetters'));
  }
  if (/^[0-9]/.test(normalized.identifier)) {
    return invalid(described('palette.name.startsWithNumber'), normalized.fileName);
  }
  if (RESERVED_COMPONENT_NAMES.has(normalized.identifier)) {
    return invalid(described('palette.name.reserved', { name: normalized.identifier }), normalized.fileName);
  }
  const path = `${input.folder}/${normalized.fileName}.astro`;
  if (path === input.current) {
    return { kind: 'same' };
  }
  const clash = input.components.find((other) => other.file !== input.current && other.file.toLowerCase() === path.toLowerCase());
  if (clash !== undefined) {
    return { kind: 'taken', by: clash.file, path };
  }
  const identifier = normalized.identifier.toLowerCase();
  const twin = input.components.find((other) => other.file !== input.current && identifierOfFileName(other.name).toLowerCase() === identifier);
  const change: NameChange = normalized.fileName === typed ? undefined : /\s/.test(typed) ? 'spaces' : 'other';
  return { kind: 'available', path, fileName: normalized.fileName, change, sameNameIn: twin?.file };
}

export function folderInput(
  input: string,
  style: NamingStyle,
  existing: readonly string[] = [],
): { readonly path: string; readonly problem: Described | undefined } {
  const parsed = parseTypedFolderPath(input, style, existing);
  if (parsed.ok) {
    assert(parsed.value !== '', 'folderInput: a parsed folder has a level');
    return { path: parsed.value, problem: undefined };
  }
  return { path: normalizeFolderPath(input, style).path, problem: folderProblemText(parsed.error) };
}

export function folderProblemText(problem: FolderPathProblem): Described {
  switch (problem.kind) {
    case 'empty':
      return described('palette.rename.folderInvalid');
    case 'absolute':
      return described('palette.folder.absolute');
    case 'parent':
      return described('palette.folder.parent');
    case 'empty-level':
      return described('palette.folder.emptyLevel');
    case 'character':
      return described('palette.rename.badCharacter', { character: problem.character });
    case 'too-long':
      return described('palette.folder.tooLong');
    case 'too-deep':
      return described('palette.folder.tooDeep');
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
}
