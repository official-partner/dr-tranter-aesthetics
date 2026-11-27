
import { caretOffset, setCaretOffset } from './cssCode';

export { commitInPlace } from '../../../ui/commitInPlace';

export function commitTokenFieldInPlace(element: HTMLElement): void {
  const offset = caretOffset(element);
  element.blur();
  element.focus();
  if (offset !== undefined) {
    setCaretOffset(element, offset);
  }
}
