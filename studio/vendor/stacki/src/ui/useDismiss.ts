import type { RefObject } from 'react';
import { toRecord } from '../../shared/core/record';
import { epochNowMs, isCanvasPressMessage } from './popupDismiss';
import { useEffect } from 'react';


export default function useDismiss(ref: RefObject<HTMLElement> | undefined, { active }: { readonly active: boolean }, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const onDown = (event: MouseEvent): void => {
      const element = ref?.current;
      if (element && event.target instanceof Node && !element.contains(event.target)) {
        onDismiss();
      }
    };

    const onBlur = () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        blurTimer = undefined;
        if (document.activeElement?.tagName === 'IFRAME') {
          onDismiss();
        }
      }, 0);
    };

    const openedAtMs = epochNowMs();
    const onMessage = (event: MessageEvent<unknown>): void => {
      const type = toRecord(event.data)?.['type'];
      if (type === 'avb:click-node' || type === 'avb:open-node') {
        if (isCanvasPressMessage(event.data, { openedAtMs })) {
          onDismiss();
        }
      }
    };

    document.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    window.addEventListener('message', onMessage);
    return () => {
      clearTimeout(blurTimer);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('message', onMessage);
    };
  }, [ref, active, onDismiss]);
}
