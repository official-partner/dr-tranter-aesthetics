import { useLayoutEffect, useRef, useState } from 'react';

export function useToastHost(): HTMLElement {
  const [host, setHost] = useState<HTMLElement>(document.body);
  const current = useRef(host);
  useLayoutEffect(() => {
    const update = (): void => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
      const next = dialogs.item(dialogs.length - 1) ?? document.body;
      if (next !== current.current) {
        current.current = next;
        setHost(next);
      }
    };
    const observer = new window.MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    update();
    return () => observer.disconnect();
  }, []);
  return host;
}
