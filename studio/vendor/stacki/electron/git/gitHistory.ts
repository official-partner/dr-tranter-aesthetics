
import { assert } from '../../shared/core/assert';
import { ReferencedError } from '../../shared/properties/i18n/referencedError';
import { MAIN_LIMITS } from '../lib/mainLimits';
import { gitErrorDetail } from './git';
import { projectPrefix } from './gitState';
import type { Git } from './git';

const US = '\x1f';
const RS = '\x1e';
const LOG_FORMAT = RS + ['%H', '%h', '%an', '%ae', '%aI', '%s', '%P', '%D'].join(US);

const DIFF_FLAGS = ['--diff-merges=first-parent', '-M'];

const isEmptyRepo = (error: unknown): boolean => /does not have any commits yet|bad default revision|unknown revision/i.test(gitErrorDetail(error));

export interface FileChange {
  readonly status: string;
  readonly path: string;
  readonly from?: string;
}

export interface CommitInfo {
  readonly files: FileChange[] | undefined;
  readonly hash: string | undefined;
  readonly shortHash: string | undefined;
  readonly author: string | undefined;
  readonly email: string | undefined;
  readonly when: string | undefined;
  readonly subject: string | undefined;
  readonly parents: readonly string[];
  readonly refs: readonly string[];
  readonly isMerge: boolean;
}

async function log(
  git: Git,
  {
    projectPath,
    ref,
    limit = 50,
    skip = 0,
    withFiles = false,
  }: {
    readonly projectPath: string;
    readonly ref?: string;
    readonly limit?: number;
    readonly skip?: number;
    readonly withFiles?: boolean;
  },
): Promise<{ commits: CommitInfo[]; atEnd: boolean }> {
  if (ref !== undefined && (ref.startsWith('-') || ref.includes('\0'))) {
    throw new ReferencedError('git.error.refInvalid');
  }
  const pageSize = Math.min(Math.max(Math.trunc(limit), 1), MAIN_LIMITS.logPageMax);
  const pageSkip = Math.max(Math.trunc(skip), 0);
  const args = ['-c', 'core.quotepath=off', 'log', '--topo-order', '--decorate=short', `--format=${LOG_FORMAT}`, `-n${pageSize}`, `--skip=${pageSkip}`];
  if (withFiles) {
    args.push('--name-status', '--relative', ...DIFF_FLAGS);
  }
  if (ref) {
    args.push(ref, '--');
  } else {
    args.push('--exclude=refs/stash', '--all');
  }
  let stdout: string;
  try {
    ({ stdout } = await git(projectPath, args));
  } catch (error: unknown) {
    if (isEmptyRepo(error)) {
      return { commits: [], atEnd: true };
    }
    throw error;
  }
  const commits: CommitInfo[] = stdout
    .split(RS)
    .filter((rec) => rec.trim())
    .map((rec) => {
      const nl = rec.indexOf('\n');
      const head = nl === -1 ? rec : rec.slice(0, nl);
      const rest = nl === -1 ? '' : rec.slice(nl + 1);
      const [hash, shortHash, author, email, when, subject, parents, refs] = head.split(US);
      const parentList = parents ? parents.split(' ').filter(Boolean) : [];
      return {
        files: withFiles ? parseNameStatus(rest) : undefined,
        hash,
        shortHash,
        author,
        email,
        when,
        subject,
        parents: parentList,
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        isMerge: parentList.length > 1,
      };
    });
  return { commits, atEnd: commits.length < pageSize };
}

function parseNameStatus(stdout: string): FileChange[] {
  const files: FileChange[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    const code = parts[0];
    if (code === undefined) {
      continue;
    }
    const from = parts[1];
    const to = parts[2];
    if (/^[RC]/.test(code) && parts.length >= 3 && from !== undefined && to !== undefined) {
      files.push({ status: code.charAt(0), path: to, from });
    } else if (parts.length >= 2 && from !== undefined) {
      files.push({ status: code.charAt(0), path: from });
    }
  }
  return files;
}

export interface StatusFile {
  readonly path: string;
  readonly from: string | undefined;
  readonly status: string;
  readonly staged: boolean;
  readonly untracked: boolean;
}

export function parseStatusRecords(stdout: string, prefix: string, limit: number): StatusFile[] {
  assert(prefix === '' || prefix.endsWith('/'), 'parseStatusRecords: a folder prefix ends with a slash');
  const records = stdout.split('\0');
  const files: StatusFile[] = [];
  const relative = (entryPath: string): string => (prefix !== '' && entryPath.startsWith(prefix) ? entryPath.slice(prefix.length) : entryPath);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record === undefined || record.length < 4) {
      continue;
    }
    if (files.length >= limit) {
      throw new ReferencedError('git.error.statusTooLarge', { count: limit });
    }
    const code = record.slice(0, 2);
    const entryPath = relative(record.slice(3));
    const renamed = code.includes('R') || code.includes('C');
    const from = renamed ? records[++index] : undefined;
    files.push({
      path: entryPath,
      from: from === undefined ? undefined : relative(from),
      status: code === '??' ? 'A' : code.trim().charAt(0) || 'M',
      staged: code.charAt(0) !== ' ' && code !== '??',
      untracked: code === '??',
    });
  }
  return files;
}

async function status(git: Git, { projectPath }: { readonly projectPath: string }): Promise<StatusFile[]> {
  const prefix = await projectPrefix(git, projectPath);
  const { stdout } = await git(projectPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  return parseStatusRecords(stdout, prefix, MAIN_LIMITS.statusFilesMax);
}

export interface ProjectFile {
  readonly path: string;
  readonly status: string | undefined;
  readonly staged: boolean;
}

async function allFiles(git: Git, { projectPath }: { readonly projectPath: string }): Promise<ProjectFile[]> {
  const { stdout } = await git(projectPath, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const changed = new Map((await status(git, { projectPath })).map((entry) => [entry.path, entry]));
  const paths = [...new Set(stdout.split('\0').filter(Boolean))];
  const listed = new Set(paths);
  for (const [changedPath] of changed) {
    if (!listed.has(changedPath)) {
      paths.push(changedPath);
    }
  }
  return paths.sort().map((filePath) => {
    const change = changed.get(filePath);
    return {
      path: filePath,
      status: change ? change.status : undefined,
      staged: change ? change.staged : false,
    };
  });
}

export interface WorktreeInfo {
  readonly path: string;
  readonly head: string | undefined;
  readonly branch: string | undefined;
  readonly detached: boolean;
  readonly bare: boolean;
}

async function worktrees(git: Git, { projectPath }: { readonly projectPath: string }): Promise<WorktreeInfo[]> {
  const { stdout } = await git(projectPath, ['worktree', 'list', '--porcelain']);
  return stdout
    .split('\n\n')
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const out: {
        path: string | undefined;
        head: string | undefined;
        branch: string | undefined;
        detached: boolean;
        bare: boolean;
      } = {
        path: undefined,
        head: undefined,
        branch: undefined,
        detached: false,
        bare: false,
      };
      for (const line of rec.split('\n')) {
        const sp = line.indexOf(' ');
        const key = sp === -1 ? line : line.slice(0, sp);
        const value = sp === -1 ? '' : line.slice(sp + 1);
        if (key === 'worktree') {
          out.path = value;
        } else if (key === 'HEAD') {
          out.head = value;
        } else if (key === 'branch') {
          out.branch = value.replace(/^refs\/heads\//, '');
        } else if (key === 'detached') {
          out.detached = true;
        } else if (key === 'bare') {
          out.bare = true;
        }
      }
      return out;
    })
    .filter((worktree): worktree is WorktreeInfo => worktree.path !== undefined);
}


const TITLE = (seg: string): string => seg.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

export type FileKind = 'page' | 'component' | 'layout' | 'content' | 'asset' | 'style' | 'config' | 'script' | 'doc' | 'file';

export interface FileDescription {
  readonly path: string;
  readonly kind: FileKind;
  readonly label: string;
}

function describeFile(relPath: unknown): FileDescription {
  const posixPath = String(relPath || '').replace(/\\/g, '/');
  const base = posixPath.split('/').pop() || posixPath;

  const page = posixPath.match(/^src\/pages\/(.+)\.(astro|mdx?)$/i);
  const pageRoute = page?.[1];
  if (pageRoute !== undefined) {
    let route = pageRoute;
    if (route === 'index') {
      return { path: posixPath, kind: 'page', label: 'Home' };
    }
    if (route.endsWith('/index')) {
      route = route.slice(0, -'/index'.length);
    }
    return { path: posixPath, kind: 'page', label: route.split('/').map(TITLE).join(' / ') };
  }
  const comp = posixPath.match(/^src\/components\/(.+)\.(astro|jsx?|tsx?|vue|svelte)$/i);
  const compName = comp?.[1];
  if (compName !== undefined) {
    return { path: posixPath, kind: 'component', label: compName.split('/').pop() ?? compName };
  }

  const layout = posixPath.match(/^src\/layouts\/(.+)\.(astro|jsx?|tsx?)$/i);
  const layoutName = layout?.[1];
  if (layoutName !== undefined) {
    return { path: posixPath, kind: 'layout', label: layoutName.split('/').pop() ?? layoutName };
  }

  if (/^src\/content\//i.test(posixPath)) {
    return { path: posixPath, kind: 'content', label: base };
  }
  if (/^public\//i.test(posixPath)) {
    return { path: posixPath, kind: 'asset', label: base };
  }
  if (/\.(css|scss|sass|less)$/i.test(posixPath)) {
    return { path: posixPath, kind: 'style', label: base };
  }
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)$/i.test(posixPath)) {
    return { path: posixPath, kind: 'asset', label: base };
  }
  if (/^(package(-lock)?\.json|astro\.config\.[a-z]+|tsconfig\.json|\.gitignore)$/i.test(posixPath)) {
    return { path: posixPath, kind: 'config', label: base };
  }
  if (/\.(m|c)?[jt]sx?$/i.test(posixPath)) {
    return { path: posixPath, kind: 'script', label: base };
  }
  if (/\.mdx?$/i.test(posixPath)) {
    return { path: posixPath, kind: 'doc', label: base };
  }
  return { path: posixPath, kind: 'file', label: posixPath };
}

const describeFiles = <T extends { readonly path: string; readonly from?: string | undefined }>(
  files: readonly T[] | undefined,
): (T & FileDescription & { readonly from: string | undefined })[] => (files ?? []).map((file) => ({ ...file, ...describeFile(file.path), from: file.from }));

export { allFiles, log, status, worktrees, parseNameStatus, describeFile, describeFiles };
