import { assert } from '../../../shared/core/assert';

const isChip = (node: Node | undefined): node is Element => {
  const ElementType = node?.ownerDocument?.defaultView?.Element;
  return ElementType !== undefined && node instanceof ElementType && node.classList.contains('expr-chip');
};

function chipBesideCaret(host: HTMLElement, directory: -1 | 1): Element | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !host.contains(range.startContainer)) {
    return undefined;
  }
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType === 3) {
    if (directory < 0 ? offset > 0 : offset < (node.nodeValue?.length ?? 0)) {
      return undefined;
    }
    const sibling = (directory < 0 ? node.previousSibling : node.nextSibling) ?? undefined;
    return isChip(sibling) ? sibling : undefined;
  }
  const child = directory < 0 ? node.childNodes[offset - 1] : node.childNodes[offset];
  return isChip(child) ? child : undefined;
}

export function deleteChipAtCaret(host: HTMLElement | undefined, event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  if (!host) {
    return false;
  }
  if (event.key !== 'Backspace' && event.key !== 'Delete') {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  const chip = chipBesideCaret(host, event.key === 'Backspace' ? -1 : 1);
  if (!chip) {
    return false;
  }
  const parent = chip.parentNode;
  assert(parent !== null, 'Chip must remain attached to its editable host');
  const at = Array.from(parent.childNodes).indexOf(chip);
  assert(at >= 0, 'Chip must have an index in its parent');
  chip.remove();
  const range = document.createRange();
  range.setStart(parent, Math.min(at, parent.childNodes.length));
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) {
    return true;
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
