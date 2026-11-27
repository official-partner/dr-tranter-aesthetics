
import { assert } from '../../shared/core/assert';
import { LIMITS } from '../../shared/core/limits';

export interface VariablePlace {
  readonly openFile: string | undefined;
  readonly contextPage: string | undefined;
}

export type VariableFileReach = 'global' | 'page' | 'component';

export function variableFileReach(rel: string): VariableFileReach {
  assert(rel.length > 0, 'variableFileReach: a file has a path');
  assert(rel.length <= LIMITS.ipcFieldCharsMax, 'variableFileReach: the path is within the field limit');
  if (!/\.astro$/i.test(rel)) {
    return 'global';
  }
  if (rel.startsWith('src/layouts/')) {
    return 'global';
  }
  if (rel.startsWith('src/pages/')) {
    return 'page';
  }
  return 'component';
}

export function variableFileListed(rel: string, place: VariablePlace): boolean {
  const reach = variableFileReach(rel);
  switch (reach) {
    case 'global':
      return true;
    case 'page':
    case 'component':
      return rel === place.openFile;
    default: {
      const exhaustive: never = reach;
      return exhaustive;
    }
  }
}

export function variableFileOffered(rel: string, place: VariablePlace): boolean {
  const reach = variableFileReach(rel);
  switch (reach) {
    case 'global':
    case 'component':
      return true;
    case 'page':
      if (rel === place.openFile) {
        return true;
      }
      return rel === place.contextPage;
    default: {
      const exhaustive: never = reach;
      return exhaustive;
    }
  }
}

export function projectRelative(projectPath: string | undefined, file: string | undefined): string | undefined {
  if (file === undefined) {
    return undefined;
  }
  assert(file.length <= LIMITS.ipcFieldCharsMax, 'projectRelative: the path is within the field limit');
  const posix = file.replace(/\\/g, '/');
  if (projectPath === undefined) {
    return posix;
  }
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root.length > 0) {
    if (posix.startsWith(`${root}/`)) {
      return posix.slice(root.length + 1);
    }
  }
  return posix;
}
