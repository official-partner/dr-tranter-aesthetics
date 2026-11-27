import { useEffect } from 'react';
import { reportActionToast } from './errorNotices';
import type { ToastKind } from './toastNotice';

export function NoticeToast({ message, kind }: { readonly message: string | undefined; readonly kind: ToastKind }) {
  useEffect(() => {
    if (message !== undefined && message !== '') {
      reportActionToast(message, kind, []);
    }
  }, [message, kind]);
  return undefined;
}
