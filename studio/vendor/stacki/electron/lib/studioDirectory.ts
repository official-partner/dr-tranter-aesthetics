import * as fs from 'node:fs';
import * as path from 'node:path';

export function isStudioDirectory(directory: string, name: string): boolean {
  if (name !== 'studio') {
    return false;
  }
  const manifestBytesMax = 64 * 1024;
  try {
    const file = path.join(directory, 'package.json');
    if (fs.statSync(file).size > manifestBytesMax) {
      return false;
    }
    const bytes = fs.readFileSync(file);
    if (bytes.length > manifestBytesMax) {
      return false;
    }
    const manifest: unknown = JSON.parse(bytes.toString('utf8'));
    if (typeof manifest !== 'object') {
      return false;
    }
    if (manifest === null) {
      return false;
    }
    if ('name' in manifest) {
      return manifest.name === '@stacki/studio';
    }
    return false;
  } catch {
    return false;
  }
}
