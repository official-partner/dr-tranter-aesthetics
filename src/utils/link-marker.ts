/**
 * A list of links (project.css `.link-list`: the footer's, the menu's) shows one small square that glides to the
 * link under the pointer or the focus, instead of a square of its own on each link (Sam, comment 7, Nov 22: « c'est
 * le même élément point qui change d'endroit sur la même liste »). Without this script, with reduced motion or
 * without a mouse, each link shows its own square (project.css). Its job: show which link is about to be followed,
 * and that the list is one object. It rests on the link of the page shown, when the list has it (comment 19, Nov 24),
 * and goes back there when the pointer leaves. The square sits beside the list, never in it: the list's items are
 * its links.
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
    const home = list.querySelector<HTMLElement>('a[aria-current="page"]');

    const on = () => able.matches && !calm.matches;
    const sync = () => {
      if (on()) list.setAttribute("data-marked", "");
      else list.removeAttribute("data-marked");
    };
    /* `instant`: placed without travelling (it was hidden, or the list moved under it) */
    const show = (link: HTMLElement | null, instant = !current) => {
      if (!on()) return;
      if (!link) {
        current = null;
        return mark.removeAttribute("data-on");
      }
      const r = link.getBoundingClientRect();
      /* a list not shown yet (the closed menu): nothing to place */
      if (!r.height) return;
      current = link;
      const parent = mark.offsetParent?.getBoundingClientRect() ?? { top: 0, left: 0 };
      const box = list.getBoundingClientRect();
      if (instant) mark.setAttribute("data-placing", "");
      mark.style.setProperty("--_mark-x", `${box.left - parent.left}px`);
      mark.style.setProperty("--_mark-y", `${r.top + r.height / 2 - parent.top}px`);
      if (instant) {
        getComputedStyle(mark).translate;
        mark.removeAttribute("data-placing");
      }
      mark.setAttribute("data-on", "");
    };
    /* the list takes its size (the menu opening, a resize): the square takes its place again, without travelling */
    const sized = new ResizeObserver(() => {
      if (current) show(current, true);
      else if (home) show(home, true);
    });
    sized.observe(list);
    signal.addEventListener("abort", () => sized.disconnect());

    sync();
    able.addEventListener("change", sync, { signal });
    calm.addEventListener("change", sync, { signal });
    list.addEventListener("pointerover", (e) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>("a");
      if (link && link !== current) show(link);
    }, { signal });
    list.addEventListener("pointerleave", () => show(home), { signal });
    list.addEventListener("focusin", (e) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>("a");
      if (link?.matches(":focus-visible") && link !== current) show(link);
    }, { signal });
    list.addEventListener("focusout", (e) => {
      if (!list.contains(e.relatedTarget as Node)) show(home);
    }, { signal });
  });
}
