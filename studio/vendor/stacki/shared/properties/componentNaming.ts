import { assert } from '../core/assert';
import { err, ok, type Result } from '../core/result';
import { COMPONENT_ACCESS_LIMITS } from './componentAccess';

export type NamingStyle = 'pascal' | 'kebab';

export interface NormalizedName {
  readonly fileName: string;
  readonly identifier: string;
  readonly rejected: readonly string[];
}

export const RESERVED_COMPONENT_NAMES: ReadonlySet<string> = new Set(['Fragment', 'Astro', 'Component', 'Props', 'Slot']);

export const NAMING_LIMITS = {
  inputCharsMax: 256,
} as const satisfies Record<string, number>;

export function normalizeComponentName(input: string, style: NamingStyle): NormalizedName {
  const typed = input.slice(0, NAMING_LIMITS.inputCharsMax).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rejected: string[] = [];
  const words: string[] = [];
  let word = '';
  for (const character of typed) {
    if (/[A-Za-z0-9]/.test(character)) {
      word += character;
      continue;
    }
    if (!/[\s\-_.]/.test(character) && !rejected.includes(character)) {
      rejected.push(character);
    }
    if (word !== '') {
      words.push(word);
      word = '';
    }
  }
  if (word !== '') {
    words.push(word);
  }
  const identifier = words.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  const fileName = style === 'pascal' ? identifier : kebabWords(words).join('-');
  assert(fileName.length <= NAMING_LIMITS.inputCharsMax * 2, 'A normalized name is bounded by its input');
  return { fileName, identifier, rejected };
}

function kebabWords(words: readonly string[]): readonly string[] {
  return words.flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ')).map((part) => part.toLowerCase());
}

export function identifierOfFileName(fileName: string): string {
  return fileName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function isComponentFileName(fileName: string): boolean {
  const pascal = /^[A-Z][A-Za-z0-9]*$/.test(fileName);
  const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(fileName);
  return (pascal || kebab) && !RESERVED_COMPONENT_NAMES.has(identifierOfFileName(fileName));
}

export function detectNamingStyle(fileNames: readonly string[]): NamingStyle {
  let dashed = 0;
  let pascal = 0;
  for (const name of fileNames) {
    if (name.includes('-')) {
      dashed += 1;
    } else if (/^[A-Z]/.test(name)) {
      pascal += 1;
    }
  }
  return dashed > pascal ? 'kebab' : 'pascal';
}

export function detectFolderStyle(folderNames: readonly string[]): NamingStyle {
  const capitals = folderNames.filter((name) => /^[A-Z]/.test(name)).length;
  return capitals > folderNames.length - capitals ? 'pascal' : 'kebab';
}

export function normalizeFolderPath(input: string, style: NamingStyle): { readonly path: string; readonly rejected: readonly string[] } {
  const rejected: string[] = [];
  const levels: string[] = [];
  for (const level of input.split('/')) {
    const normalized = normalizeComponentName(level, style);
    for (const character of normalized.rejected) {
      if (!rejected.includes(character)) {
        rejected.push(character);
      }
    }
    if (normalized.fileName !== '') {
      levels.push(normalized.fileName);
    }
  }
  return { path: levels.join('/'), rejected };
}


export type FolderPathProblem =
  | { readonly kind: 'empty' }
  | { readonly kind: 'absolute' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'empty-level' }
  | { readonly kind: 'character'; readonly character: string }
  | { readonly kind: 'too-long' }
  | { readonly kind: 'too-deep' };

const FOLDER_ILLEGAL = /[<>:"|?*\u0000-\u001f]/;

export function parseTypedFolderPath(input: string, style: NamingStyle, existing: readonly string[] = []): Result<string, FolderPathProblem> {
  const typed = input.slice(0, NAMING_LIMITS.inputCharsMax).trim().replaceAll('\\', '/');
  if (typed === '') {
    return err({ kind: 'empty' });
  }
  if (typed.startsWith('/') || typed.startsWith('~') || /^[A-Za-z]:/.test(typed)) {
    return err({ kind: 'absolute' });
  }
  const levels = typed.replace(/\/+$/, '').split('/');
  const normalized: string[] = [];
  for (const level of levels) {
    const trimmed = level.trim();
    if (trimmed === '') {
      return err({ kind: 'empty-level' });
    }
    if (trimmed === '.' || trimmed === '..') {
      return err({ kind: 'parent' });
    }
    const name = normalizeComponentName(trimmed, style);
    const stray = name.rejected[0];
    if (stray !== undefined) {
      return err({ kind: 'character', character: stray });
    }
    if (name.fileName === '') {
      return err({ kind: 'empty-level' });
    }
    normalized.push(name.fileName);
  }
  const folded = foldFolderCase(normalized, existing);
  const problem = componentFolderProblem(folded);
  if (problem !== undefined) {
    return err(problem);
  }
  assert(!folded.startsWith('/'), 'A typed folder is relative to the components root');
  assert(!folded.split('/').includes('..'), 'A typed folder never climbs out of the components root');
  return ok(folded);
}

export function componentFolderProblem(folder: string): FolderPathProblem | undefined {
  if (folder === '') {
    return undefined;
  }
  if (folder.length > COMPONENT_ACCESS_LIMITS.pathCharsMax) {
    return { kind: 'too-long' };
  }
  if (folder.startsWith('/') || /^[A-Za-z]:/.test(folder) || folder.includes('\\')) {
    return { kind: 'absolute' };
  }
  const levels = folder.split('/');
  if (levels.length > COMPONENT_ACCESS_LIMITS.pathDepthMax) {
    return { kind: 'too-deep' };
  }
  for (const level of levels) {
    if (level === '') {
      return { kind: 'empty-level' };
    }
    if (level === '.' || level === '..') {
      return { kind: 'parent' };
    }
    const illegal = FOLDER_ILLEGAL.exec(level);
    if (illegal !== null) {
      return { kind: 'character', character: illegal[0] };
    }
  }
  return undefined;
}

export function parseComponentSubfolder(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('A component folder is a string');
  }
  const problem = componentFolderProblem(input);
  if (problem !== undefined) {
    throw new Error(`"${input.slice(0, NAMING_LIMITS.inputCharsMax)}" is not a folder under the components folder (${problem.kind})`);
  }
  return input;
}

function foldFolderCase(levels: readonly string[], existing: readonly string[]): string {
  assert(levels.length > 0, 'foldFolderCase: a path has a level');
  const known = new Map(existing.map((folder) => [folder.toLowerCase(), folder] as const));
  const folded: string[] = [];
  for (const level of levels) {
    const candidate = [...folded, level].join('/');
    const match = known.get(candidate.toLowerCase());
    if (match === undefined) {
      folded.push(level);
      continue;
    }
    const spelled = match.slice(match.lastIndexOf('/') + 1);
    folded.push(spelled);
  }
  assert(folded.length === levels.length, 'foldFolderCase: folding keeps every level');
  return folded.join('/');
}
