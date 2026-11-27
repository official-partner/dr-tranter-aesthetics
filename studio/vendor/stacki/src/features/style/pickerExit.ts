
import { useEffect, useRef } from 'react';
import { getHost, onHostChange } from './model/host';
import { epochNowMs, isCanvasPressMessage } from '../../ui/popupDismiss';

const PICKER_SELECTOR = '.embed-editor_varpicker';

export function useExitRestore({ active, restore }: { readonly active: boolean; readonly restore: () => void }): void {
  const latest = useRef(restore);
  latest.current = restore;
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const run = (): void => latest.current();
    const insidePicker = (target: unknown): boolean => target instanceof Element && target.closest(PICKER_SELECTOR) !== null;
    const press = (event: Event): void => {
      if (!insidePicker(event.target)) {
        run();
      }
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        run();
      }
    };
    const scroll = (event: Event): void => {
      if (!insidePicker(event.target)) {
        run();
      }
    };
    const openedAtMs = epochNowMs();
    const message = (event: MessageEvent<unknown>): void => {
      if (isCanvasPressMessage(event.data, { openedAtMs })) {
        run();
      }
    };
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') {
        run();
      }
    };
    const focusOut = (event: FocusEvent): void => {
      if (event.relatedTarget === null && !insidePicker(event.target)) {
        run();
      }
    };
    const selected = getHost().selectedId;
    const hostChanged = (): void => {
      if (getHost().selectedId !== selected) {
        run();
      }
    };
    const stopHost = onHostChange(hostChanged);
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('mousedown', press, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', run);
    window.addEventListener('message', message);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', run);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('focusout', focusOut, true);
    return () => {
      stopHost();
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('mousedown', press, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', run);
      window.removeEventListener('message', message);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', run);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('focusout', focusOut, true);
    };
  }, [active]);
}
