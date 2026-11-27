
import fs from 'fs';
import path from 'path';

import { ReferencedError } from '../../shared/properties/i18n/referencedError';
import type { Git } from './git';

export type UnfinishedOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

const OPERATION_MARKERS: readonly (readonly [UnfinishedOperation, string])[] = [
  ['merge', 'MERGE_HEAD'],
  ['rebase', 'rebase-merge'],
  ['rebase', 'rebase-apply'],
  ['cherry-pick', 'CHERRY_PICK_HEAD'],
  ['revert', 'REVERT_HEAD'],
];

export async function unfinishedOperation(git: Git, projectPath: string): Promise<UnfinishedOperation | undefined> {
  const gitDirectory = (await git(projectPath, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  for (const [operation, marker] of OPERATION_MARKERS) {
    if (fs.existsSync(path.join(gitDirectory, marker))) {
      return operation;
    }
  }
  return undefined;
}

export async function requireNoUnfinishedOperation(git: Git, projectPath: string): Promise<void> {
  const operation = await unfinishedOperation(git, projectPath);
  if (operation !== undefined) {
    throw new ReferencedError('git.error.operationInProgress', { operation });
  }
}

export async function readHead(git: Git, projectPath: string): Promise<{ readonly branch: string | undefined; readonly born: boolean }> {
  let branch: string | undefined;
  try {
    branch = (await git(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim() || undefined;
  } catch {
    branch = undefined;
  }
  let born = true;
  try {
    await git(projectPath, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  } catch {
    born = false;
  }
  return { branch, born };
}

export async function projectPrefix(git: Git, projectPath: string): Promise<string> {
  return (await git(projectPath, ['rev-parse', '--show-prefix'])).stdout.trim();
}

export async function requireValidBranchName(git: Git, projectPath: string, name: string): Promise<void> {
  if (name.startsWith('-') || name.trim() !== name || name.length === 0 || name === '@' || name.includes('@{') || name === 'HEAD') {
    throw new ReferencedError('git.error.branchNameInvalid');
  }
  try {
    await git(projectPath, ['check-ref-format', '--branch', name]);
  } catch {
    throw new ReferencedError('git.error.branchNameInvalid');
  }
}

export async function branchExists(git: Git, projectPath: string, name: string): Promise<boolean> {
  try {
    await git(projectPath, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}
