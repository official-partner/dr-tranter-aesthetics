
export function commitInPlace(element: HTMLInputElement | HTMLTextAreaElement): void {
  const { selectionStart, selectionEnd } = element;
  element.blur();
  element.focus();
  if (selectionStart !== null && selectionEnd !== null) {
    try {
      element.setSelectionRange(selectionStart, selectionEnd);
    } catch {
    }
  }
}

export function commitEditableInPlace(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  const kept =
    selection !== null && selection.rangeCount > 0 && element.contains(selection.getRangeAt(0).endContainer) ? selection.getRangeAt(0).cloneRange() : undefined;
  element.blur();
  element.focus();
  if (kept !== undefined && selection !== null && element.contains(kept.endContainer)) {
    selection.removeAllRanges();
    selection.addRange(kept);
  }
}
