/**
 * A list of links (project.css `.link-list`: the footer's, the menu's) shows one small square that glides to the
 * link under the pointer or the focus, instead of a square of its own on each link (Sam, comment 7, Nov 22: « c'est
 * le même élément point qui change d'endroit sur la même liste »). Without this script, with reduced motion or
 * without a mouse, each link shows its own square (project.css). Its job: show which link is about to be followed,
 * and that the list is one object. The square sits beside the list, never in it: the list's items are its links.
 */
export function linkMarkers(root: ParentNode, signal: AbortSignal): void {
  const able = matchMedia("(hover: hover) and (pointer: fine)");
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  root.querySelectorAll<HTMLElement>(".link-list").forEach((list) => {
    if (list.nextElementSibling?.hasAttribute("data-link-marker")) return;
    const mark = document.createElement("span");
    mark.setAttribute("data-link-marker", "");
    mark.setAttribute("aria-hidden", "true");
    list.after(mark);
    let current: HTMLElement | null = null;

    const on = () => able.matches && !calm.matches;
    const sync = () => {
      if (on()) list.setAttribute("data-marked", "");
      else list.removeAttribute("data-marked");
    };
    const show = (link: HTMLElement | null) => {
      if (!on() || link === current) return;
      const was = current;
      current = link;
      if (!link) return mark.removeAttribute("data-on");
      const parent = mark.offsetParent?.getBoundingClientRect() ?? { top: 0, left: 0 };
      const box = list.getBoundingClientRect();
      const r = link.getBoundingClientRect();
      /* placed at once where the pointer comes in, then it travels */
      if (!was) mark.setAttribute("data-placing", "");
      mark.style.setProperty("--_mark-x", `${box.left - parent.left}px`);
      mark.style.setProperty("--_mark-y", `${r.top + r.height / 2 - parent.top}px`);
      if (!was) {
        getComputedStyle(mark).translate;
        mark.removeAttribute("data-placing");
      }
      mark.setAttribute("data-on", "");
    };

    sync();
    able.addEventListener("change", sync, { signal });
    calm.addEventListener("change", sync, { signal });
    list.addEventListener("pointerover", (e) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>("a");
      if (link) show(link);
    }, { signal });
    list.addEventListener("pointerleave", () => show(null), { signal });
    list.addEventListener("focusin", (e) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>("a");
      if (link?.matches(":focus-visible")) show(link);
    }, { signal });
    list.addEventListener("focusout", (e) => {
      if (!list.contains(e.relatedTarget as Node)) show(null);
    }, { signal });
  });
}
