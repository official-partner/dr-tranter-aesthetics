
import { existsSync, lstatSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STUDIO_LEGACY_DIRECTORIES, STUDIO_LOCAL_DIRECTORY } from '../../shared/properties/studioLocal';
import { assert } from '../../shared/core/assert';

export function prepareStudioLocal(project: string): void {
  const local = path.join(project, STUDIO_LOCAL_DIRECTORY);
  mkdirSync(local, { recursive: true });
  if (lstatSync(local).isSymbolicLink()) {
    throw new Error('Studio storage must be a real directory');
  }
  const ignore = path.join(local, '.gitignore');
  if (!existsSync(ignore)) {
    writeFileSync(ignore, '*\n', { flag: 'wx' });
  }
  for (const [next, legacy] of Object.entries(STUDIO_LEGACY_DIRECTORIES)) {
    moveLegacy(path.join(project, legacy), path.join(project, next));
  }
  assert(existsSync(ignore), 'Studio storage ignores its own contents');
}

function moveLegacy(legacy: string, next: string): void {
  assert(path.basename(legacy) !== '', 'An older folder has a name');
  if (!existsSync(legacy) || existsSync(next)) {
    return;
  }
  if (lstatSync(legacy).isSymbolicLink()) {
    throw new Error(`${path.basename(legacy)} must be a real directory to move`);
  }
  renameSync(legacy, next);
  assert(existsSync(next), 'The moved Studio folder is in place');
}
