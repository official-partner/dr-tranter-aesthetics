
import type { Translator } from '../../../shared/properties/i18n/messageRef';
import { reportActionToast } from '../../ui/errorNotices';

export function reportCodeCleared(translate: Translator, restore: () => void): void {
  reportActionToast(translate('props.codeCleared.notice'), 'info', [{ label: translate('props.codeCleared.restore'), run: restore }]);
}

export function reportBindingRemoved(translate: Translator, restore: () => void): void {
  reportActionToast(translate('props.bindingRemoved.notice'), 'info', [{ label: translate('props.bindingRemoved.undo'), run: restore }]);
}
