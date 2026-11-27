import type { TextMatch } from './frameTextMatch';
import type { CanvasTextBreaks } from '../../shared/properties/canvasText';
import { createTextBuffer, type TextRunChange } from './frameTextBuffer';
import { placeTextCaret, textEditorRoot, textSelection, type TextSpace } from './frameTextSelection';
import { installNativeTextEvents } from './frameTextNativeEvents';
import { installInterceptedPointer, pointOnWords } from './frameTextPointer';
import { holdTextEditing, isCanvasTextEditing, styleTextEditor } from './frameTextEditing';

export interface NativeTextResult {
  readonly changes: readonly TextRunChange[];
  readonly restored: boolean;
  readonly keep: () => void;
}

interface NativeTextCallbacks {
  readonly changed: (value: string) => void;
  readonly refused: () => void;
  readonly done: (result: NativeTextResult) => void;
}

export function openNativeText(match: TextMatch, space: TextSpace, event: MouseEvent, callbacks: NativeTextCallbacks, breaks?: CanvasTextBreaks) {
  const root = textEditorRoot(match);
  if (!root || match.nodes.map((node) => node.data).join('').length > 10_000) {
    return undefined;
  }
  const { changed, refused, done } = callbacks;
  const attributes = ['contenteditable', 'data-avb-text-editor'].map((name) => ({
    name,
    value: root.getAttribute(name),
  }));
  const restoreAttributes = () => {
    for (const attribute of attributes) {
      if (attribute.value === null) {
        root.removeAttribute(attribute.name);
      } else {
        root.setAttribute(attribute.name, attribute.value);
      }
    }
  };
  const heightBefore = root.getBoundingClientRect().height;
  installNativeTextStyle(root, breaks);
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('data-avb-text-editor', '');
  const trimmed = root.getBoundingClientRect().height > heightBefore + GROWTH_TOLERANCE_PX ? trimEdgeWhitespace(root, match.nodes) : [];
  const folded = breaks === undefined ? [] : foldSourceNewlines(space.runs.flat());
  const buffer = createTextBuffer(root, space, changed);
  if (!buffer) {
    for (const edge of folded) {
      edge.node.data = edge.data;
    }
    restoreAttributes();
    for (const edge of trimmed) {
      edge.node.data = edge.data;
    }
    return undefined;
  }
  let closed = false;
  const finish = (action: 'apply' | 'cancel') => {
    if (closed) {
      return;
    }
    closed = true;
    cleanup();
    stopPointer();
    clearNativeTextSelection(root);
    const changes = action === 'apply' ? buffer.changes() : [];
    const { restored, keep: keepTyped } = buffer.restore();
    const unfolded = folded.map((edge) => ({ ...edge, shown: edge.node.data }));
    for (const edge of unfolded) {
      edge.node.data = edge.data;
    }
    const keep = () => {
      for (const edge of unfolded) {
        edge.node.data = edge.shown;
      }
      keepTyped();
    };
    restoreAttributes();
    for (const edge of trimmed) {
      edge.node.data = edge.data;
    }
    release();
    root.blur();
    done({ changes, restored, keep });
  };
  const release = holdTextEditing(root);
  const { cleanup, pressed } = installNativeTextEvents({ root, space, buffer, finish, refused, breaks });
  const stopPointer = installInterceptedPointer(root, match.nodes);
  root.focus({ preventScroll: true });
  placeTextCaret(space, event);
  return {
    finish,
    intact: buffer.intact,
    spread: buffer.spread,
    edited: () => buffer.changes().length > 0,
    contains: (click: MouseEvent) => {
      if (pressed() && holdsSelection(root)) {
        return true;
      }
      const range = document.caretRangeFromPoint(click.clientX, click.clientY);
      return pointOnWords(match.nodes, click.clientX, click.clientY) || (isCanvasTextEditing(click.target) && !!range && !!textSelection(match.nodes, range));
    },
  };
}

function holdsSelection(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return false;
  }
  return root.contains(selection.anchorNode) && root.contains(selection.focusNode);
}

function clearNativeTextSelection(root: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  if (root.contains(selection.anchorNode) || root.contains(selection.focusNode)) {
    selection.removeAllRanges();
  }
}

function foldSourceNewlines(nodes: readonly Text[]): TrimmedEdge[] {
  const folded: TrimmedEdge[] = [];
  for (const node of nodes) {
    if (/\n/.test(node.data)) {
      folded.push({ node, data: node.data });
      node.data = node.data.replace(/[\t\f\r ]*\n[\t\n\f\r ]*/g, ' ');
    }
  }
  return folded;
}

function installNativeTextStyle(root: HTMLElement, breaks: CanvasTextBreaks | undefined): void {
  const computed = getComputedStyle(root).whiteSpace;
  const whitespace = breaks !== undefined && /^(normal|nowrap)$/.test(computed) ? 'pre-line' : computed;
  styleTextEditor(whitespace);
}

const GROWTH_TOLERANCE_PX = 0.5;

interface TrimmedEdge {
  readonly node: Text;
  readonly data: string;
}

function trimEdgeWhitespace(root: HTMLElement, nodes: readonly Text[]): TrimmedEdge[] {
  const style = getComputedStyle(root);
  if (style.display === 'inline' || !/^(normal|nowrap|pre-line)$/.test(style.whiteSpace)) {
    return [];
  }
  const edges: TrimmedEdge[] = [];
  const blank = (node: Text) => node.data.length > 0 && /^[\t\n\f\r ]*$/.test(node.data);
  const content = (node: Node) => !(node instanceof Comment) && !(node instanceof Text && node.data.length === 0);
  for (const direction of ['previousSibling', 'nextSibling'] as const) {
    for (const node of direction === 'previousSibling' ? nodes : [...nodes].reverse()) {
      if (!blank(node) || node.parentNode !== root) {
        break;
      }
      let sibling = node[direction] ?? undefined;
      while (sibling !== undefined && !content(sibling)) {
        sibling = sibling[direction] ?? undefined;
      }
      const others = sibling !== undefined && !(sibling instanceof Text && blank(sibling) && nodes.includes(sibling));
      if (others) {
        break;
      }
      edges.push({ node, data: node.data });
      node.data = '';
    }
  }
  return edges;
}
