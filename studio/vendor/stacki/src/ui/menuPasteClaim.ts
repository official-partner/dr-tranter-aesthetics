
import { assert } from '../../shared/core/assert';

const MENU_PASTE_CLAIMS_MAX = 16;

let menuPasteClaimCount = 0;

export function claimMenuPaste(): () => void {
  assert(menuPasteClaimCount >= 0, 'claimMenuPaste: the claim count is not negative');
  assert(menuPasteClaimCount < MENU_PASTE_CLAIMS_MAX, 'claimMenuPaste: claims are released');
  menuPasteClaimCount += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    assert(menuPasteClaimCount > 0, 'claimMenuPaste: a release has a claim to end');
    menuPasteClaimCount -= 1;
  };
}

export function menuPasteClaimed(): boolean {
  assert(menuPasteClaimCount >= 0, 'menuPasteClaimed: the claim count is not negative');
  return menuPasteClaimCount > 0;
}
