import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SITE_FILE_BYTES_MAX = 262_144;
const ASTRO_CONFIG_NAMES = ['astro.config.mjs', 'astro.config.ts', 'astro.config.mts', 'astro.config.js', 'astro.config.cjs'] as const;

export async function astroConfigSource(root: string): Promise<string | undefined> {
  for (const name of ASTRO_CONFIG_NAMES) {
    const source = await siteFile(path.join(root, name));
    if (source !== undefined) {
      return source;
    }
  }
  return undefined;
}

export function outputDirectory(config: string | undefined): string | undefined {
  const named = /\boutDir\s*:\s*([^,\n}]+)/.exec(config ?? '');
  if (named === null) {
    return './dist';
  }
  const literal = /^['"`]([^'"`]+)['"`]\s*$/.exec(named[1]?.trim() ?? '');
  const directory = literal?.[1];
  if (directory === undefined) {
    return undefined;
  }
  const normalized = path.posix.normalize(directory.replace(/^\.\//, ''));
  if (path.posix.isAbsolute(normalized)) {
    return undefined;
  }
  if (normalized === '.' || normalized.split('/').includes('..')) {
    return undefined;
  }
  return `./${normalized.replace(/\/$/, '')}`;
}

export async function siteFile(filename: string): Promise<string | undefined> {
  try {
    const metadata = await stat(filename);
    if (metadata.size > SITE_FILE_BYTES_MAX) {
      return undefined;
    }
    return await readFile(filename, 'utf8');
  } catch (failure: unknown) {
    if (failure instanceof Error && 'code' in failure && failure.code === 'ENOENT') {
      return undefined;
    }
    throw failure;
  }
}
