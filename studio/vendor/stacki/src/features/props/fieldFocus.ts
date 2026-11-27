
import { assert } from '../../../shared/core/assert';
import { LIMITS } from '../../../shared/core/limits';

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export type FieldFocus =
  | { readonly kind: 'unfocused' }
  | { readonly kind: 'focused'; readonly textRange: TextRange | undefined };

export const FIELD_UNFOCUSED: FieldFocus = { kind: 'unfocused' };

const FIELD_SELECTOR = '.attr-value-field, .props-field';

export function fieldOfHandle(handle: Element): Element | undefined {
  return handle.closest(FIELD_SELECTOR) ?? undefined;
}

export function fieldFocusOf(field: Element | undefined, active: Element | undefined): FieldFocus {
  if (field === undefined || active === undefined) {
    return FIELD_UNFOCUSED;
  }
  if (!field.contains(active)) {
    return FIELD_UNFOCUSED;
  }
  if (!editable(active)) {
    return FIELD_UNFOCUSED;
  }
  return { kind: 'focused', textRange: textRangeOf(active) };
}

export function textWithChip(value: string, focus: FieldFocus, chip: string): { readonly before: string; readonly after: string } {
  assert(value.length <= LIMITS.nodeValueCharsMax, 'textWithChip: the value is inside its bound');
  assert(chip.length > 0, 'textWithChip: a chip has words');
  switch (focus.kind) {
    case 'unfocused':
      return { before: '', after: '' };
    case 'focused': {
      const range = focus.textRange ?? { start: value.length, end: value.length };
      const start = Math.min(Math.max(range.start, 0), value.length);
      const end = Math.min(Math.max(range.end, start), value.length);
      const out = { before: value.slice(0, start), after: value.slice(end) };
      assert(out.before.length + out.after.length <= value.length, 'textWithChip: the chip only ever takes words away');
      return out;
    }
    default: {
      const exhaustive: never = focus;
      return exhaustive;
    }
  }
}

export function insertAtRange(host: HTMLElement, saved: Range | undefined, chip: Node): void {
  const range = host.ownerDocument.createRange();
  if (saved !== undefined && host.contains(saved.commonAncestorContainer)) {
    range.setStart(saved.startContainer, saved.startOffset);
    range.setEnd(saved.endContainer, saved.endOffset);
  } else {
    range.selectNodeContents(host);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(chip);
  assert(host.contains(chip), 'insertAtRange: the chip lands inside the field');
  const selection = host.ownerDocument.defaultView?.getSelection();
  if (selection) {
    const caret = host.ownerDocument.createRange();
    caret.setStartAfter(chip);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
}

function editable(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null) {
    return false;
  }
  if (element instanceof view.HTMLTextAreaElement || element instanceof view.HTMLInputElement) {
    return true;
  }
  const host = element.closest('[contenteditable]');
  return host !== null && host.getAttribute('contenteditable') !== 'false';
}

function textRangeOf(element: Element): TextRange | undefined {
  const view = element.ownerDocument.defaultView;
  if (view === null) {
    return undefined;
  }
  if (element instanceof view.HTMLTextAreaElement || element instanceof view.HTMLInputElement) {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start === null || end === null) {
      return undefined;
    }
    return { start, end };
  }
  return undefined;
}
