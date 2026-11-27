import type { MessageRef } from '../../../shared/core/i18n/messageReference';
import { SkeletonRows } from '../../ui/Skeleton';
import { translateReference } from '../../lib/i18n/translateErrorText';
import { useTranslate } from '../../lib/i18n/useTranslate';
import { assert } from '../../../shared/core/assert';
import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useMemo, useState } from 'react';
import { CodeTokens, useCodeLines } from '../../ui/CodeBlock';
import { languageFor } from '../../ui/codeHighlight';
import { ChevronLeftIcon } from '../../ui/Icons';
import type { HistoryCommit, HistoryCommitFile } from './historyBridge';
import { readHistoryDiff } from './historyDiffBridge';
import { parseHistoryPatch } from './historyDiffModel';
import type { HistoryDiffLine } from './historyDiffModel';

const HISTORY_DIFF_WINDOW = { rowHeightPx: 20, rowsInWindow: 600, rowsAbove: 150, snapRows: 100 } as const;

type DiffState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly messageRef?: MessageRef | undefined }
  | { readonly kind: 'ready'; readonly rows: readonly HistoryDiffLine[] };

export default function HistoryFileDiff({
  projectPath,
  commit,
  file,
  onBack,
  onRestore,
}: {
  readonly projectPath: string;
  readonly commit: HistoryCommit;
  readonly file: HistoryCommitFile;
  readonly onBack: () => void;
  readonly onRestore?: (() => void) | undefined;
}) {
  const translate = useTranslate();
  const [revision, setRevision] = useState(0);
  const state = useHistoryDiff(projectPath, commit.hash, file, revision);
  return (
    <div className="history-diff">
      <div className="history-diff-toolbar">
        <button autoFocus onClick={onBack}>
          <ChevronLeftIcon size={12} /> {translate('history.diff.allFiles')}
        </button>
        <span className="history-diff-path">{file.path}</span>
        {onRestore && <button onClick={onRestore}>{translate('history.diff.restoreFile')}</button>}
      </div>
      <div className="history-diff-comparison">
        {commit.parents[0]?.slice(0, 7) ?? translate('history.diff.emptyTree')} → {commit.shortHash}
        {commit.isMerge ? ` · ${translate('history.diff.firstParent')}` : ''}
      </div>
      {state.kind === 'loading' && <SkeletonRows count={4} />}
      {state.kind === 'error' && (
        <ErrorToast
          message={translateReference(state.message, state.messageRef, translate)}
          recovery={[{ label: translate('ui.retry'), run: () => setRevision((value) => value + 1) }]}
        />
      )}
      {state.kind === 'ready' && <HistoryDiffLines key={`${commit.hash}:${file.path}`} rows={state.rows} path={file.path} />}
    </div>
  );
}

function useHistoryDiff(projectPath: string, commit: string, file: HistoryCommitFile, revision: number): DiffState {
  const [state, setState] = useState<DiffState>({ kind: 'loading' });
  const { path, from } = file;
  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void readHistoryDiff({ projectPath, commit, path, from }).then((result) => {
      if (active) {
        setState(result.ok ? { kind: 'ready', rows: parseHistoryPatch(result.value) } : { kind: 'error', message: result.error, messageRef: result.errorRef });
      }
    });
    return () => {
      active = false;
    };
  }, [projectPath, commit, path, from, revision]);
  return state;
}

function HistoryDiffLines({ rows, path }: { readonly rows: readonly HistoryDiffLine[]; readonly path: string }) {
  const translate = useTranslate();
  if (rows.length === 0) {
    return <p className="history-note">{translate('history.diff.noTextChanges')}</p>;
  }
  return <HistoryDiffTable rows={rows} path={path} />;
}

function HistoryDiffTable({ rows, path }: { readonly rows: readonly HistoryDiffLine[]; readonly path: string }) {
  const translate = useTranslate();
  const [firstRow, setFirstRow] = useState(0);
  const lines = useCodeLines(
    rows
      .filter(isCodeRow)
      .map((row) => row.text)
      .join('\n'),
    languageFor(path),
  );
  const codeIndexes = useMemo(() => codeRowIndexes(rows), [rows]);
  const first = Math.min(firstRow, rows.length);
  const end = Math.min(rows.length, first + HISTORY_DIFF_WINDOW.rowsInWindow);
  return (
    <div
      className="history-diff-scroll"
      tabIndex={0}
      aria-label={translate('history.diff.label')}
      onScroll={(event) => setFirstRow(windowStart(event.currentTarget.scrollTop, rows.length))}
    >
      <div
        className="history-diff-lines"
        style={{ paddingTop: first * HISTORY_DIFF_WINDOW.rowHeightPx, paddingBottom: (rows.length - end) * HISTORY_DIFF_WINDOW.rowHeightPx }}
      >
        {rows.slice(first, end).map((row, offset) => {
          const index = first + offset;
          const line = isCodeRow(row) ? lines[codeIndexes[index] ?? 0] : undefined;
          return (
            <div key={index} className={`history-diff-line ${row.kind}`}>
              {isCodeRow(row) ? (
                <>
                  <span className="history-diff-number">{'before' in row ? row.before : ''}</span>
                  <span className="history-diff-number">{'after' in row ? row.after : ''}</span>
                  <span className="history-diff-sign">{row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : ' '}</span>
                  <span className="history-diff-code">{row.text === '' ? ' ' : <CodeTokens line={line} />}</span>
                </>
              ) : (
                <span className="history-diff-heading">{row.text}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function windowStart(scrollTop: number, rowCount: number): number {
  assert(scrollTop >= 0, 'windowStart: a scroll position is not negative');
  const top = Math.floor(scrollTop / HISTORY_DIFF_WINDOW.rowHeightPx) - HISTORY_DIFF_WINDOW.rowsAbove;
  const snapped = Math.floor(Math.max(top, 0) / HISTORY_DIFF_WINDOW.snapRows) * HISTORY_DIFF_WINDOW.snapRows;
  return Math.min(snapped, rowCount);
}

function codeRowIndexes(rows: readonly HistoryDiffLine[]): readonly number[] {
  const indexes: number[] = [];
  let codeRows = 0;
  for (const row of rows) {
    indexes.push(codeRows);
    if (isCodeRow(row)) {
      codeRows += 1;
    }
  }
  assert(indexes.length === rows.length, 'codeRowIndexes: one index per row');
  return indexes;
}

function isCodeRow(row: HistoryDiffLine): boolean {
  return row.kind !== 'metadata' && row.kind !== 'hunk';
}
