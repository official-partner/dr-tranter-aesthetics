
import { EditorState, type Extension, type Transaction } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { ExternalChange } from '@uiw/react-codemirror';
import { assert } from '../../shared/core/assert';

export type CodeEditorLockedEdges = { readonly prefixLength: number; readonly suffixLength: number };

const lockedEdgeMark = Decoration.mark({ class: 'code-editor_context' });

export function lockedEdgeExtensions(edges: CodeEditorLockedEdges): readonly Extension[] {
  assert(edges.prefixLength >= 0, 'lockedEdgeExtensions: a length is never negative');
  assert(edges.suffixLength >= 0, 'lockedEdgeExtensions: a length is never negative');
  if (edges.prefixLength === 0 && edges.suffixLength === 0) {
    return [];
  }
  return [
    EditorState.changeFilter.of((transaction) => lockedEdgeFilter(transaction, edges)),
    EditorView.decorations.of((view) => {
      const length = view.state.doc.length;
      const ranges = [];
      if (edges.prefixLength > 0) {
        ranges.push(lockedEdgeMark.range(0, Math.min(edges.prefixLength, length)));
      }
      if (edges.suffixLength > 0) {
        ranges.push(lockedEdgeMark.range(Math.max(length - edges.suffixLength, 0), length));
      }
      return Decoration.set(ranges, true);
    }),
  ];
}

function lockedEdgeFilter(transaction: Transaction, edges: CodeEditorLockedEdges): boolean | readonly number[] {
  if (transaction.annotation(ExternalChange) === true) {
    return true;
  }
  const length = transaction.startState.doc.length;
  let outside = false;
  transaction.changes.iterChangedRanges((from, to) => {
    if (from === to) {
      if (from < edges.prefixLength) {
        outside = true;
      } else if (from > length - edges.suffixLength) {
        outside = true;
      }
    }
  });
  return outside ? false : [0, edges.prefixLength, length - edges.suffixLength, length];
}
