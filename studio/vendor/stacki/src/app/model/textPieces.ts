
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';
import { encodeText } from '../../../shared/page/htmlText';
import type { EditGesture } from '../../editor/pageEdits';
import type { EditorModel, EditorNode } from '../../editor/pageView';
import { nodeGesture } from '../../editor/editGestures';
import { findEditorNodeById } from '../../editor/pageState';
import type { TextPiece } from '../../features/props/textConnect';

const TEXT_PIECES_MAX = 3;

export function textPiecesGesture(model: EditorModel, nodeId: string, pieces: readonly TextPiece[]): EditGesture | undefined {
  assert(pieces.length > 0, 'textPiecesGesture: a node is restated as at least one piece');
  assert(pieces.length <= TEXT_PIECES_MAX, 'textPiecesGesture: a connection makes at most three pieces');
  const node = findEditorNodeById(model.nodes, nodeId);
  if (node === undefined) {
    return undefined;
  }
  if (node.kind !== 'text' && node.kind !== 'expr') {
    return undefined;
  }
  const next = restatedNode(node.id, pieces);
  assert(next.id === node.id, 'textPiecesGesture: the node keeps its id');
  return nodeGesture(node.id, next, { coalesceKey: undefined, urgency: true });
}

function restatedNode(id: EditorNode['id'], pieces: readonly TextPiece[]): EditorNode {
  const [only] = pieces;
  if (pieces.length === 1 && only !== undefined && only.kind === 'text') {
    assert(only.value.length > 0, 'textPiecesGesture: words have words');
    assert(only.value.length <= LIMITS.nodeValueCharsMax, 'textPiecesGesture: words are inside the node value bound');
    return { id, kind: 'text', value: only.value };
  }
  const value = pieces.map(pieceSource).join('');
  assert(pieces.filter((piece) => piece.kind === 'expr').length === 1, 'textPiecesGesture: a connection is one chip');
  assert(value.length <= LIMITS.nodeValueCharsMax, 'textPiecesGesture: the source is inside the node value bound');
  return { id, kind: 'expr', value };
}

function pieceSource(piece: TextPiece): string {
  switch (piece.kind) {
    case 'text':
      assert(piece.value.length > 0, 'textPiecesGesture: a text piece has words');
      return encodeText(piece.value);
    case 'expr':
      assert(/^\{[^{}]+\}$/.test(piece.value), 'textPiecesGesture: an expression piece is written with its braces');
      return piece.value;
    default: {
      const exhaustive: never = piece;
      return exhaustive;
    }
  }
}
