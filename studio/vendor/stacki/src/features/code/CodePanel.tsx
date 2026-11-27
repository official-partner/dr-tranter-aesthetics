import { useMemo, type ReactNode } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorModel } from '../../editor/pageView';
import { componentSourceRanges, sourceLineLabel, sourceNodeAtOffset, sourceRangeForSelection, type SourceRange } from './codePanelModel';
import CodeEditor from '../../ui/CodeEditor';
import { PanelHeader } from '../../ui/PanelHeader';
import { useTranslate } from '../../lib/i18n/useTranslate';

interface CodePanelProps {
  readonly source: string;
  readonly relativePath: string;
  readonly model: EditorModel | undefined;
  readonly selectedId: string | undefined;
  readonly revealRange?: SourceRange | undefined;
  readonly onChange: (source: string, position: number) => void;
  readonly onSelect: (id: string) => void;
  readonly onOpenComponent: (name: string, id: string) => void;
  readonly extensions?: Extension | undefined;
  readonly overlay?: ReactNode;
}

export default function CodePanel(props: CodePanelProps) {
  const translate = useTranslate();
  const { source, relativePath, model, selectedId, revealRange, onChange, onSelect, onOpenComponent, extensions, overlay } = props;
  const selectionRange = useMemo(() => sourceRangeForSelection(model, selectedId, source.length), [model, selectedId, source.length]);
  const activeRange = revealRange ?? selectionRange;
  const components = useMemo(() => componentSourceRanges(model?.nodes ?? [], source), [model, source]);
  const lineLabel = sourceLineLabel(source, activeRange);
  return (
    <section className="code-panel">
      <PanelHeader
        title={translate('workspace.code.title')}
        actions={
          <>
            <span className="code-panel-path" title={relativePath}>
              {}
              <bdi dir="ltr">{relativePath}</bdi>
            </span>
            {lineLabel && <span className="code-panel-lines">{lineLabel}</span>}
          </>
        }
      />
      <div className="code-panel-editor">
        <CodeEditor
          language="astro"
          value={source}
          activeRange={activeRange}
          componentRanges={components}
          onChange={onChange}
          onPositionChange={(position) => {
            if (model?.bodyStart !== undefined && position < model.bodyStart) {
              onSelect('frontmatter');
              return;
            }
            const node = sourceNodeAtOffset(model?.nodes ?? [], position);
            if (node !== undefined) {
              onSelect(node.id);
            }
          }}
          onOpenComponent={onOpenComponent}
          extensions={extensions}
        />
        {overlay}
      </div>
    </section>
  );
}
