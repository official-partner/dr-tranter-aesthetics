import type { CommitDiffRequest, CommitDiffResult } from '../../shared/ipc/gitCommitDiff';
import { described } from '../../shared/properties/i18n/messageRef';
import { gitErrorDetail } from './git';
import type { Git } from './git';

export async function readCommitDiff(git: Git, request: CommitDiffRequest): Promise<CommitDiffResult> {
  const argumentsList = [
    '-c',
    'diff.suppressBlankEmpty=false',
    '--literal-pathspecs',
    'show',
    '--format=',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-notes',
    '--no-relative',
    '--root',
    '--diff-merges=first-parent',
    '--find-renames',
    '--diff-algorithm=myers',
    '--unified=3',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '--output-indicator-new=+',
    '--output-indicator-old=-',
    '--output-indicator-context= ',
    '--end-of-options',
    request.commit,
    '--',
    request.path,
    ...(request.from === undefined ? [] : [request.from]),
  ];
  let patch: string;
  try {
    ({ stdout: patch } = await git(request.projectPath, argumentsList));
  } catch (error: unknown) {
    const detail = gitErrorDetail(error);
    if (detail) {
      return { ok: false, error: detail };
    }
    const unreadable = described('history.error.diffUnreadable');
    return { ok: false, error: unreadable.message, errorRef: unreadable.messageRef };
  }
  return { ok: true, value: patch };
}
