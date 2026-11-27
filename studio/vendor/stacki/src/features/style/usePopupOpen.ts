import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

const POPUPS = '[role="menu"],[role="dialog"],[role="listbox"]';

export default function usePopupOpen(host: RefObject<HTMLElement> | undefined): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const look = () => setOpen(!!document.querySelector(POPUPS));
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true });
    if (host?.current) {
      watch.observe(host.current, { childList: true, subtree: true });
    }
    return () => watch.disconnect();
  }, [host]);
  return open;
}
