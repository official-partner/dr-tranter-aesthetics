import { toRecord } from '../../shared/core/record';

export const PACKAGE_MANIFEST_CHARS_MAX = 1_000_000;

export function hasDependency(text: string, name: string): boolean {
  if (text.length === 0 || text.length > PACKAGE_MANIFEST_CHARS_MAX) {
    return false;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return false;
  }
  const record = toRecord(manifest);
  const dependencies = toRecord(record?.['dependencies']);
  const development = toRecord(record?.['devDependencies']);
  return typeof dependencies?.[name] === 'string' || typeof development?.[name] === 'string';
}
