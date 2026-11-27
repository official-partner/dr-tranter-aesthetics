import { useMemo, useState } from 'react';
import type { Translator } from '../../../lib/i18n/localeContext';
import { useTranslate } from '../../../lib/i18n/useTranslate';
import { CodeTokens, useCodeLines } from '../../../ui/CodeBlock';
import { languageFor, type CodeLine } from '../../../ui/codeHighlight';
import { ExpandVerticalIcon } from '../../../ui/Icons';
import type { DiffRow } from '../lineDiff';
import {
  buildFileDiff,
  countsLabel,
  DIFF_VIEW_LIMITS,
  markTokens,
  visibleBlocks,
  wordRangesByRow,
  type CharRange,
  type DiffBlock,
  type FileDiff,
} from './diffModel';
import './diff.css';
import { relativePath } from './paths';

export interface DiffSides {
  readonly path: string;
  readonly oldText: string | undefined;
  readonly newText: string | undefined;
}

type TextDiff = Extract<FileDiff, { readonly kind: 'text' }>;

export function DiffView({
  diff,
  projectPath,
  header = 'path',
  size = 'regular',
}: {
  readonly diff: DiffSides;
  readonly projectPath: string;
  readonly header?: 'path' | 'none';
  readonly size?: 'regular' | 'compact';
}) {
  const translate = useTranslate();
  const model = useMemo(() => buildFileDiff(diff.oldText, diff.newText), [diff.oldText, diff.newText]);
  const name = relativePath(diff.path, projectPath);
  return (
    <div className={`ai-diffview ai-diffview-${size}`}>
      {header === 'path' && (
        <div className="ai-diffview-head">
          <span className="ai-diff-path" title={diff.path}>
            {name}
          </span>
          {diff.oldText === undefined && <span className="ai-diffview-kind">{translate('ai.diff.newFile')}</span>}
          {diff.newText === undefined && <span className="ai-diffview-kind">{translate('ai.diff.deleted')}</span>}
          {model.kind === 'text' && <span className="ai-diffview-counts">{countsLabel(model)}</span>}
        </div>
      )}
      <DiffBody model={model} path={diff.path} name={name} />
    </div>
  );
}

function DiffBody({ model, path, name }: { readonly model: FileDiff; readonly path: string; readonly name: string }) {
  const translate = useTranslate();
  switch (model.kind) {
    case 'binary':
      return <p className="ai-diffview-note">{translate('ai.diff.binary')}</p>;
    case 'same':
      return <p className="ai-diffview-note">{model.lineEndingsChanged ? translate('ai.diff.lineEndings') : translate('ai.diff.noChanges')}</p>;
    case 'text':
      return <TextRows model={model} path={path} name={name} />;
    default: {
      const exhaustive: never = model;
      return exhaustive;
    }
  }
}

function TextRows({ model, path, name }: { readonly model: TextDiff; readonly path: string; readonly name: string }) {
  const translate = useTranslate();
  const [revealed, setRevealed] = useState<ReadonlyMap<number, number>>(new Map());
  const [rowsShown, setRowsShown] = useState<number>(DIFF_VIEW_LIMITS.rowsCompactMax);
  const language = languageFor(path);
  const oldLines = useCodeLines(model.oldText, language);
  const newLines = useCodeLines(model.newText, language);
  const visible = useMemo(
    () =>
      visibleBlocks(model.rows, {
        context: DIFF_VIEW_LIMITS.contextLines,
        revealed,
        rowsMax: rowsShown,
      }),
    [model.rows, revealed, rowsShown],
  );
  const words = useMemo(() => wordRangesByRow(model.rows), [model.rows]);
  const reveal = (block: Extract<DiffBlock, { readonly kind: 'gap' }>): void => {
    setRevealed((previous) => new Map(previous).set(block.key, (previous.get(block.key) ?? 0) + block.step));
  };
  return (
    <div className="ai-diffview-scroll" tabIndex={0} aria-label={translate('ai.diff.changesTo', { name })}>
      {!model.exact && <p className="ai-diffview-note">{translate('ai.diff.large')}</p>}
      <div className="ai-diffview-lines">
        {visible.blocks.map((block) =>
          block.kind === 'gap' ? (
            <button key={`gap-${block.key}-${block.hidden}`} className="ai-diffview-gap" onClick={() => reveal(block)}>
              <ExpandVerticalIcon size={12} />
              {gapLabel(block, translate)}
            </button>
          ) : (
            <Line
              key={block.index}
              row={block.row}
              line={block.row.kind === 'deleted' ? oldLines[block.row.before - 1] : newLines[block.row.after - 1]}
              marks={words.get(block.index)}
            />
          ),
        )}
      </div>
      {visible.cut > 0 && (
        <button className="ai-diffview-gap" onClick={() => setRowsShown((previous) => previous + DIFF_VIEW_LIMITS.rowsPageMax)}>
          {translate('ai.diff.showMore')}
        </button>
      )}
    </div>
  );
}

function gapLabel(block: Extract<DiffBlock, { readonly kind: 'gap' }>, translate: Translator): string {
  return block.hidden <= block.step
    ? translate('ai.diff.showLines', { count: block.hidden })
    : translate('ai.diff.showSome', { step: block.step, count: block.hidden });
}

function Line({ row, line, marks }: { readonly row: DiffRow; readonly line: CodeLine | undefined; readonly marks: readonly CharRange[] | undefined }) {
  return (
    <div className={`history-diff-line ${row.kind}`}>
      <span className="history-diff-number">{row.kind === 'deleted' ? row.before : row.after}</span>
      <span className="history-diff-sign">{row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : ''}</span>
      <span className="history-diff-code">
        {row.text === '' ? ' ' : marks === undefined || line === undefined ? <CodeTokens line={line} /> : <MarkedCode line={line} marks={marks} />}
      </span>
    </div>
  );
}

function MarkedCode({ line, marks }: { readonly line: CodeLine; readonly marks: readonly CharRange[] }) {
  return markTokens(line, marks).map((token, index) => (
    <span key={index} className={token.marked === 'changed' ? 'code-token ai-diff-word' : 'code-token'} style={token.style}>
      {token.text}
    </span>
  ));
}
