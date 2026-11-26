import { getItems } from "@/utils/content";

/* The site's links, read by the footer and the menu: one place for each (CLAUDE.md, one place per fact). A page's
   address once it is built (Simon's brief, Nov 19, A2), the home until then. Contact and Careers open the « Send an
   enquiry » pop-up once it is built; the social addresses are still to come from the clinic. */
export type SiteLink = { label: string; href: string; footer?: boolean };

export const clinicLinks: SiteLink[] = [
  { label: "All treatments", href: "/treatments" },
  { label: "Our approach", href: "/approach" },
  { label: "Results", href: "/results" },
  { label: "Our team", href: "/" },
  { label: "The Clinic", href: "/the-clinic" },
  { label: "Journal", href: "/journal" },
];

/* LinkedIn is the menu's only: the footer as drawn has four */
export const connectLinks: SiteLink[] = [
  { label: "Contact", href: "/" },
  { label: "Careers", href: "/" },
  { label: "Facebook", href: "/" },
  { label: "Instagram", href: "/" },
  { label: "LinkedIn", href: "/", footer: false },
];

export const legalLinks: SiteLink[] = [
  { label: "Risks and complications", href: "/" },
  { label: "Privacy policy", href: "/" },
  { label: "Terms", href: "/" },
  { label: "Complaints", href: "/" },
];

/** Whether a link of a list leads to the page shown (`path`, Astro.url.pathname), so it carries aria-current and its
 * small square (Sam, Nov 24, comment 19: « la page active doit avoir son petit carré »). A link whose address the list
 * gives to several links (the home, while a page is still to come) is never the current one. */
export function isHere(href: string, path: string, list: { href: string }[]): boolean {
  const clean = (p: string) => p.replace(/\/+$/, "") || "/";
  return clean(href) === clean(path) && list.filter((l) => clean(l.href) === clean(href)).length === 1;
}

/** The concerns by group, each to its page once it has one, else to the Concerns page. */
export async function concernLinks() {
  const concerns = await getItems("concerns");
  const link = (c: (typeof concerns)[number]) => ({ id: c.id, name: c.data.name, href: c.data.statement ? `/concerns/${c.id}` : "/concerns" });
  return {
    structure: concerns.filter((c) => c.data.group === "Structure").map(link),
    surface: concerns.filter((c) => c.data.group !== "Structure").map(link),
  };
}
