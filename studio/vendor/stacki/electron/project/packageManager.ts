
import * as fs from 'fs';
import * as path from 'path';
import { readJson, parseRecord } from '../lib/mainHelpers';
import { parsePackageManagerField, type PackageManager } from '../../shared/properties/packageManager';

export const PNPM_TOLERATE_IGNORED_BUILDS = '--config.strict-dep-builds=false';

export function installArguments(manager: PackageManager): readonly string[] {
  switch (manager) {
    case 'npm':
      return ['install', '--no-audit', '--no-fund'];
    case 'pnpm':
      return ['install', PNPM_TOLERATE_IGNORED_BUILDS];
    case 'yarn':
    case 'bun':
      return ['install'];
    default: {
      const exhaustive: never = manager;
      return exhaustive;
    }
  }
}

export function detectPackageManager(directory: string): PackageManager {
  for (const folder of ancestorsOf(directory)) {
    const found = managerIn(folder);
    if (found !== undefined) {
      return found;
    }
  }
  return 'npm';
}

export function ancestorsOf(directory: string): readonly string[] {
  let current = path.resolve(directory);
  const chain = [current];
  let parent = path.dirname(current);
  while (parent !== current) {
    current = parent;
    chain.push(current);
    parent = path.dirname(current);
  }
  return chain;
}

function managerIn(directory: string): PackageManager | undefined {
  const declared = declaredPackageManager(directory);
  if (declared !== undefined) {
    return declared;
  }
  const has = (file: string): boolean => fs.existsSync(path.join(directory, file));
  if (has('pnpm-lock.yaml') || has('pnpm-workspace.yaml')) {
    return 'pnpm';
  }
  if (has('yarn.lock')) {
    return 'yarn';
  }
  if (has('bun.lockb') || has('bun.lock')) {
    return 'bun';
  }
  if (has('package-lock.json') || has('npm-shrinkwrap.json')) {
    return 'npm';
  }
  return undefined;
}

function declaredPackageManager(directory: string): PackageManager | undefined {
  const manifest = path.join(directory, 'package.json');
  if (!fs.existsSync(manifest)) {
    return undefined;
  }
  try {
    return parsePackageManagerField(parseRecord(readJson(manifest))['packageManager']);
  } catch {
    return undefined;
  }
}
