import { isUtf8 } from 'buffer';
import fs from 'fs';
import path from 'path';

import { toArray } from '../../shared/core/record';
import type { MergeResolution, MergeTextResolution } from '../../shared/ipc/mergeResolution';
import { parseMergeResolution, mergeConflictSnapshot } from '../../shared/ipc/mergeResolution';
import { described, type MessageRef } from '../../shared/properties/i18n/messageRef';
import { ReferencedError } from '../../shared/properties/i18n/referencedError';
import { writeProjectText } from '../../../../src/features/history/gitWorkspaceWrites';
import { parseConflict, renderResolved } from './conflicts';
import type { ConflictPart } from './conflicts';
import { gitErrorDetail, gitErrorFull } from './git';
import type { Git } from './git';
import { branchExists, readHead, requireNoUnfinishedOperation, requireValidBranchName, unfinishedOperation } from './gitState';


async function currentBranch(git: Git, projectPath: string): Promise<string | undefined> {
  const head = await readHead(git, projectPath);
  return head.branch ?? (head.born ? 'HEAD' : undefined);
}

function gitFailure(detail: string, fallback: ReferencedError): Error {
  const words = detail.trim();
  return words.length > 0 ? new Error(words) : fallback;
}

export interface MergeClash {
  readonly path: string;
  readonly ours: string | undefined;
  readonly theirs: string | undefined;
  readonly parts: readonly ConflictPart[] | undefined;
}

export type MergeOutcome =
  | {
      readonly ok: true;
      readonly into: string | undefined;
      readonly changed: boolean;
      readonly resolved?: number;
      readonly parkedError?: string | undefined;
      readonly parkedErrorRef?: MessageRef | undefined;
    }
  | {
      readonly ok: false;
      readonly conflicted: true;
      readonly from: string | undefined;
      readonly branch: string;
      readonly files: readonly MergeClash[];
    }
  | {
      readonly ok: false;
      readonly dirty: true;
      readonly from: string | undefined;
      readonly branch: string;
      readonly files: readonly string[];
    };

const WORK_IN_THE_WAY = /would be overwritten|Please commit your changes|Your local changes/i;

interface Parking {
  readonly park: (branch: string) => Promise<boolean>;
  readonly unpark: (branch: string) => Promise<{ readonly error?: string | undefined; readonly errorRef?: MessageRef | undefined }>;
}

async function conflictedFiles(git: Git, projectPath: string): Promise<string[]> {
  return (await git(projectPath, ['diff', '--name-only', '-z', '--diff-filter=U'])).stdout.split('\0').filter(Boolean);
}

async function conflictedFilePath(git: Git, projectPath: string, file: string): Promise<string> {
  const up = (await git(projectPath, ['rev-parse', '--show-cdup'])).stdout.trim();
  return path.resolve(projectPath, up, file);
}

async function conflictedParts(
  git: Git,
  projectPath: string,
  file: string,
  sides: Pick<MergeClash, 'ours' | 'theirs'>,
): Promise<readonly ConflictPart[] | undefined> {
  if (sides.ours === undefined || sides.theirs === undefined) {
    return undefined;
  }
  try {
    const bytes = fs.readFileSync(await conflictedFilePath(git, projectPath, file));
    return isUtf8(bytes) && !bytes.includes(0) ? parseConflict(bytes.toString('utf8')) : undefined;
  } catch {
    return undefined;
  }
}

const rootPathspec = (file: string): string => `:(top,literal)${file}`;

async function stage(git: Git, projectPath: string, stageNumber: number, file: string): Promise<string | undefined> {
  try {
    return (await git(projectPath, ['show', `:${stageNumber}:${file}`])).stdout;
  } catch {
    return undefined;
  }
}

async function resolveMerge(
  git: Git,
  request: {
    readonly projectPath: string;
    readonly branch: string;
    readonly choices?: Record<string, unknown>;
    readonly parking?: Parking | undefined;
  },
): Promise<MergeOutcome> {
  const { projectPath, branch, choices, parking } = request;
  requireRefName(branch);
  await requireNoUnfinishedOperation(git, projectPath);
  const into = await currentBranch(git, projectPath);
  const resolutions = Object.fromEntries(
    Object.entries(choices ?? {}).map(([file, choice]): readonly [string, MergeResolution] => [file, parseMergeResolution(choice)]),
  );
  const edited = Object.values(resolutions).filter((choice) => typeof choice === 'object' && 'kind' in choice);
  const refusal = await resolveMergeStart(git, { projectPath, branch, into, edited });
  if (refusal !== undefined && (await unfinishedOperation(git, projectPath)) !== 'merge') {
    if (parking !== undefined && WORK_IN_THE_WAY.test(gitErrorFull(refusal.error))) {
      return resolveMergeAroundWork(git, { ...request, parking: undefined }, parking, into ?? 'HEAD', refusal.error);
    }
    throw gitFailure(gitErrorDetail(refusal.error), new ReferencedError('git.error.mergeFinishFailed', { branch }));
  }
  if (refusal === undefined) {
    if (edited.length > 0) {
      await git(projectPath, ['merge', '--abort']);
      throw new ReferencedError('git.error.mergeChangedSinceReview');
    }
    return { ok: true, into, changed: true, resolved: 0 };
  }
  const left = await conflictedFiles(git, projectPath);
  try {
    if (edited.length > 0 && (left.length !== Object.keys(resolutions).length || left.some((file) => resolutions[file] === undefined))) {
      throw new ReferencedError('git.error.mergeFilesChanged');
    }
    for (const file of left) {
      const choice = resolutions[file] ?? 'ours';
      await resolveMergeFile(git, projectPath, file, choice);
    }
    await git(projectPath, ['commit', '--no-edit']);
  } catch (error: unknown) {
    try {
      await git(projectPath, ['merge', '--abort']);
    } catch {
    }
    throw gitFailure(gitErrorDetail(error), new ReferencedError('git.error.mergeFinishFailed', { branch }));
  }
  return { ok: true, into, changed: true, resolved: left.length };
}

async function resolveMergeStart(
  git: Git,
  {
    projectPath,
    branch,
    into,
    edited,
  }: {
    readonly projectPath: string;
    readonly branch: string;
    readonly into: string | undefined;
    readonly edited: readonly MergeTextResolution[];
  },
): Promise<{ readonly error: unknown } | undefined> {
  for (const choice of edited) {
    if (into !== choice.expectedBranch) {
      throw new ReferencedError('git.error.mergeBranchChanged');
    }
  }
  try {
    const prepare = edited.length > 0 ? ['--no-commit', '--no-ff'] : [];
    await git(projectPath, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-edit', ...prepare, branch]);
    return undefined;
  } catch (error: unknown) {
    return { error };
  }
}

async function resolveMergeAroundWork(
  git: Git,
  request: Parameters<typeof resolveMerge>[1],
  parking: Parking,
  into: string,
  refusal: unknown,
): Promise<MergeOutcome> {
  if (!(await parking.park(into))) {
    throw gitFailure(gitErrorDetail(refusal), new ReferencedError('git.error.mergeFinishFailed', { branch: request.branch }));
  }
  let outcome: MergeOutcome;
  try {
    outcome = await resolveMerge(git, request);
  } catch (error: unknown) {
    await parking.unpark(into);
    throw error;
  }
  const back = await parking.unpark(into);
  return outcome.ok && back.error !== undefined ? { ...outcome, parkedError: back.error, parkedErrorRef: back.errorRef } : outcome;
}

async function resolveMergeFile(git: Git, projectPath: string, file: string, choice: MergeResolution): Promise<void> {
  const perHunk = toArray(choice);
  const target = await conflictedFilePath(git, projectPath, file);
  if (typeof choice === 'object' && 'kind' in choice) {
    const parts = parseConflict(fs.readFileSync(target, 'utf8'));
    if (mergeConflictSnapshot(parts) !== choice.expected) {
      throw new ReferencedError('git.error.mergeFileChanged');
    }
    writeProjectText(target, choice.text);
  } else if (perHunk) {
    const parts = parseConflict(fs.readFileSync(target, 'utf8'));
    writeProjectText(target, renderResolved(parts, perHunk));
  } else {
    await resolveMergeWholeFile(git, projectPath, file, choice === 'theirs' ? 'theirs' : 'ours');
    return;
  }
  await git(projectPath, ['add', '--', rootPathspec(file)]);
}

async function resolveMergeWholeFile(git: Git, projectPath: string, file: string, side: 'ours' | 'theirs'): Promise<void> {
  const spec = rootPathspec(file);
  const unmerged = (await git(projectPath, ['ls-files', '--unmerged', '-z', '--', spec])).stdout;
  const wanted = side === 'ours' ? '2' : '3';
  if (!unmerged.split('\0').some((entry) => entry.split('\t')[0]?.endsWith(` ${wanted}`))) {
    await git(projectPath, ['rm', '--force', '--quiet', '--', spec]);
    return;
  }
  await git(projectPath, ['checkout', `--${side}`, '--', spec]);
  await git(projectPath, ['add', '--', spec]);
}

async function mergeBranch(git: Git, { projectPath, branch }: { readonly projectPath: string; readonly branch: string }): Promise<MergeOutcome> {
  requireRefName(branch);
  await requireNoUnfinishedOperation(git, projectPath);
  const into = await currentBranch(git, projectPath);
  if (branch === into) {
    throw new ReferencedError('git.error.mergeSelf', { branch });
  }
  const before = (await git(projectPath, ['rev-parse', 'HEAD'])).stdout.trim();
  try {
    await git(projectPath, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-edit', branch]);
  } catch (error: unknown) {
    let files: string[] = [];
    try {
      files = await conflictedFiles(git, projectPath);
    } catch {
    }
    if (files.length) {
      const clashes: MergeClash[] = [];
      for (const file of files) {
        const sides = { ours: await stage(git, projectPath, 2, file), theirs: await stage(git, projectPath, 3, file) };
        clashes.push({ path: file, ...sides, parts: await conflictedParts(git, projectPath, file, sides) });
      }
      try {
        await git(projectPath, ['merge', '--abort']);
      } catch {
      }
      return { ok: false, conflicted: true, from: into, branch, files: clashes };
    }
    try {
      await git(projectPath, ['merge', '--abort']);
    } catch {
    }
    const detail = gitErrorFull(error);
    if (WORK_IN_THE_WAY.test(detail)) {
      const inTheWay = detail
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !/^(error|Please|Aborting|warning|hint|Updating|Merge with)/i.test(line) && !line.endsWith(':'));
      return { ok: false, dirty: true, from: into, branch, files: inTheWay };
    }
    throw gitFailure(gitErrorDetail(error), new ReferencedError('git.error.mergeFailed', { branch, into: into ?? 'HEAD' }));
  }
  const after = (await git(projectPath, ['rev-parse', 'HEAD'])).stdout.trim();
  return { ok: true, into, changed: after !== before };
}

export type DeleteOutcome =
  { readonly ok: true } | { readonly ok: false; readonly unmerged: true; readonly message: string; readonly messageRef?: MessageRef | undefined };

async function deleteBranch(
  git: Git,
  {
    projectPath,
    branch,
    force,
    allowTrunk,
  }: {
    readonly projectPath: string;
    readonly branch: string;
    readonly force?: boolean;
    readonly allowTrunk?: boolean;
  },
): Promise<DeleteOutcome> {
  requireRefName(branch);
  const here = await currentBranch(git, projectPath);
  if (branch === here) {
    throw new ReferencedError('git.error.deleteSelf', { branch });
  }
  if (!allowTrunk && (branch === 'main' || branch === 'master')) {
    throw new ReferencedError('git.error.deleteTrunk', { branch });
  }
  try {
    await git(projectPath, ['branch', force ? '-D' : '-d', branch]);
  } catch (error: unknown) {
    const detail = gitErrorDetail(error);
    if (/not fully merged/i.test(detail)) {
      return {
        ok: false,
        unmerged: true,
        ...described('git.action.delete.unmerged', { branch }),
      };
    }
    const worktree = detail.match(/used by worktree at '([^']+)'/);
    const where = worktree?.[1];
    if (where !== undefined) {
      throw new ReferencedError('git.error.deleteWorktree', { branch, path: where });
    }
    throw gitFailure(detail, new ReferencedError('git.error.deleteFailed', { branch }));
  }
  return { ok: true };
}

export type SwitchOutcome =
  | { readonly ok: true; readonly from: string; readonly parked: boolean }
  | {
      readonly ok: false;
      readonly blocked: true;
      readonly from: string;
      readonly branch: string;
      readonly files: readonly string[];
    };

async function switchBranch(
  git: Git,
  {
    projectPath,
    branch,
    create,
    park,
    unpark,
  }: {
    readonly projectPath: string;
    readonly branch: string;
    readonly create?: boolean;
    readonly park: (branch: string) => Promise<boolean>;
    readonly unpark: (branch: string) => Promise<unknown>;
  },
): Promise<SwitchOutcome> {
  if (create) {
    await requireValidBranchName(git, projectPath, branch);
    if (await branchExists(git, projectPath, branch)) {
      throw new ReferencedError('git.error.branchExists');
    }
  } else {
    requireRefName(branch);
  }
  await requireNoUnfinishedOperation(git, projectPath);
  const head = await readHead(git, projectPath);
  const from = head.branch ?? 'HEAD';
  let parked = false;
  if (!create && from !== branch) {
    parked = await park(from);
  }
  try {
    await git(projectPath, create ? ['switch', '-c', branch] : ['switch', branch]);
  } catch (error: unknown) {
    if (parked) {
      await unpark(from);
    }
    const detail = gitErrorDetail(error);
    if (/would be overwritten|Please commit your changes|overwritten by/i.test(detail)) {
      const files = detail
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !/^(error|Please|Aborting|warning|hint)/i.test(line) && !line.endsWith(':'));
      return { ok: false, blocked: true, from, branch, files };
    }
    throw gitFailure(detail, new ReferencedError('git.error.switchFailed', { branch }));
  }
  return { ok: true, from, parked };
}

function requireRefName(name: string): void {
  if (name.length === 0 || name.startsWith('-') || name.includes('\0')) {
    throw new ReferencedError('git.error.refInvalid');
  }
}

const DEFAULT_BRANCH_CHARS_MAX = 255;

async function readDefaultBranch(git: Git, projectPath: string, trunk: string | undefined): Promise<string | undefined> {
  try {
    const named = (await git(projectPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).stdout.trim();
    const prefix = 'origin/';
    if (named.startsWith(prefix) && named.length > prefix.length && named.length <= DEFAULT_BRANCH_CHARS_MAX) {
      return named.slice(prefix.length);
    }
  } catch {
  }
  return trunk;
}

export { mergeBranch, deleteBranch, switchBranch, resolveMerge, readDefaultBranch };
