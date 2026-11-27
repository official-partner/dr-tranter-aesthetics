
import { assert } from '../core/assert';

export const STUDIO_LOCAL_DIRECTORY = '.stacki/studio';
export const STUDIO_STATE_DIRECTORY = '.stacki/studio/state';
export const STUDIO_UPDATES_DIRECTORY = '.stacki/studio/updates';
export const STUDIO_LEGACY_DIRECTORIES: Readonly<Record<string, string>> = {
  [STUDIO_STATE_DIRECTORY]: '.studio-state',
  [STUDIO_UPDATES_DIRECTORY]: '.stacki-studio',
};

export function isStudioLocalPath(file: string): boolean {
  assert(!file.includes('\\'), 'Studio paths are POSIX paths');
  if (file === STUDIO_LOCAL_DIRECTORY || file.startsWith(STUDIO_LOCAL_DIRECTORY + '/')) {
    return true;
  }
  const legacy = Object.values(STUDIO_LEGACY_DIRECTORIES);
  assert(legacy.length === 2, 'Two older Studio folders are recognised');
  return file.split('/').some((part) => legacy.includes(part));
}
